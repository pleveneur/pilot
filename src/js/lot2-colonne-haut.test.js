/**
 * Verrou du LOT 2 de la presentation : LE HAUT DE LA COLONNE DE GAUCHE.
 *
 * Decisions du proprietaire (`docs/proposition-presentation-ui.md` § 6 lot 2,
 * § 2 et § 3) :
 *   - le bandeau d'identification passe de 72 a 48 px de haut ;
 *   - le nom du projet passe de 22 a 15 px (--font-zone : le SEUL texte
 *     au-dessus de 13 px de l'application) ;
 *   - le menu « Projets » devient un bouton NOMME « Projets » a chevron ;
 *   - les SEPT icones nues du haut deviennent des boutons NOMMES :
 *     « Brouillon » et « Options » (le panneau s'appelait « Reglages » a
 *     l'epoque ; le libelle a ete renomme depuis, l'identifiant `btn-settings`
 *     est inchange) ; la troisieme porte nommee d'alors,
 *     « Aide », a depuis QUITTE l'ecran : son onglet n'existe plus, c'est
 *     l'Assistant qui repond sur la documentation — voir
 *     `retrait-ecran-aide.test.js`) ;
 *   - le CADRE bleu du haut disparait (un seul cadre accentue par colonne,
 *     celui du bloc du bas) ;
 *   - le badge « Distant » prend place a droite, avec son mot ;
 *   - le sous-titre du moteur en service (« Moteur · Agent Pi » /
 *     « Moteur · Agent PLh ») vit DANS le bandeau d'identification (decision
 *     Q1 = option b).
 *     MISE A JOUR (decision 375 du proprietaire, `RAPPORT-badge-distant-bas.md`) :
 *     ce sous-titre est DESCENDU dans la ligne d'information du BAS de la
 *     colonne (`#sidebar-engine-row`), ou il nomme le moteur A COTE du badge
 *     « Distant » qui occupait seul une ligne en haut. Le bandeau garde ses
 *     48 px et son logo ; seule cette ligne de texte a change de place.
 *
 * Ce qui ne doit PAS changer : les identifiants des boutons conserves
 * (`btn-scratchpad`, `btn-settings`), les identifiants des quatre
 * portes retirees (`btn-vault`, `btn-feedback`, `btn-gds-admin`,
 * `btn-gds-params` : elles reviennent dans Options au LOT 7), le bouton
 * `btn-open-project` et le menu `projects-dropdown` avec ses entrees.
 *
 * Ce fichier echoue si :
 *   (a) le bandeau n'est plus a 48 px, ou une taille > 13 px revient dans le
 *       bandeau (hors nom du projet) ;
 *   (b) le nom du projet n'est plus en 15 px, ou ne tronque plus (un nom tres
 *       long doit s'arreter par ellipse, pas elargir la colonne) ;
 *   (c) « Projets » n'est plus un bouton nomme, ou perd son etat ouvert ;
 *   (d) les deux portes nommees perdent leur libelle ou leur identifiant, ou
 *       une porte « Aide » revient dans le haut, ou un bouton (l'un des deux
 *       ou un nouveau) reapparait dans `#global-actions` — depuis le Lot A de
 *       `RAPPORT-design-colonne-entrees.md` § 4, ce conteneur ne porte plus
 *       AUCUN bouton : « Brouillon » et « Options » sont les deux premieres
 *       lignes du bloc du bas (verrou d'ordre : `lot3-colonne-bas.test.js`) ;
 *   (e) une des quatre portes retirees reste dans le haut, ou son retrait
 *       n'est pas tolere par le cablage (demarrage casse) ;
 *   (f) le cadre accent du haut revient, ou celui du bas disparait ;
 *   (g) le badge « Distant » n'est plus nomme, ou repasse en carre 32 x 32 ;
 *   (h) le sous-titre du moteur quitte la ligne d'information du bas de la
 *       colonne (ou se retrouve dans le bandeau), ou n'a plus de source ;
 *   (i) une couleur est ecrite en dur dans le bandeau (thème clair casse).
 *
 * Aucun navigateur n'est requis : lecture des fichiers (fins de ligne
 * normalisees, cf. quality-gate 3.4).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) =>
  readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const css = lire("src/css/style.css");
const html = lire("index.html");
const mainJs = lire("src/js/main.js");
const sidebarJs = lire("src/js/sidebar.js");

/** Blocs de regle dont le selecteur est ecrit EXACTEMENT `selector {`. */
function blocs(source, selector) {
  const echappe = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)${echappe} \\{([^}]*)\\}`, "g");
  const trouves = [];
  let m;
  while ((m = re.exec(source)) !== null) trouves.push(m[1]);
  return trouves;
}

/** Le bloc doit exister : un selecteur renomme fait echouer le test. */
function bloc(source, selector) {
  const trouves = blocs(source, selector);
  expect(trouves.length, `regle CSS absente : ${selector}`).toBeGreaterThan(0);
  return trouves.join("\n");
}

/** Declarations `prop: valeur;` d'un bloc, en minuscules. */
function declarations(corps) {
  return corps.replace(/\s+/g, " ").toLowerCase();
}

const BANDEAU = "#project-selector";
const NOM = "#btn-project-name";
const MOTEUR = ".project-engine";
const PROJETS = "#btn-open-project";

/** Blocs de style qui decrivent le haut de la colonne. */
const BLOCS_BANDEAU = [BANDEAU, NOM, MOTEUR, PROJETS, "#project-identity"];

describe("LOT 2 (a) — le bandeau d'identification fait 48 px", () => {
  it("la hauteur du bandeau est 48 px", () => {
    const d = declarations(bloc(css, BANDEAU));
    expect(d).toContain("height: 48px");
    expect(d).not.toContain("72px");
  });

  it("le bandeau garde son inset de 16 px et son filet bas", () => {
    const d = declarations(bloc(css, BANDEAU));
    expect(d).toContain("padding: 8px 8px 8px 16px");
    expect(d).toContain("border-bottom: 1px solid var(--border-subtle)");
  });

  it("aucun texte du bandeau ne depasse 13 px (hors nom du projet)", () => {
    const tailleTropGrande = [];
    for (const sel of BLOCS_BANDEAU) {
      if (sel === NOM) continue;
      for (const corps of blocs(css, sel)) {
        for (const m of corps.matchAll(/font-size:\s*(\d+)px/g)) {
          if (Number(m[1]) > 13) tailleTropGrande.push(`${sel} → ${m[1]}px`);
        }
      }
    }
    expect(tailleTropGrande).toEqual([]);
  });
});

describe("LOT 2 (b) — le nom du projet : 15 px et troncature", () => {
  it("le nom passe a --font-zone (15 px), plus de 22 px en dur", () => {
    const d = declarations(bloc(css, NOM));
    expect(d).toContain("font-size: var(--font-zone)");
    expect(d).not.toMatch(/font-size:\s*22px/);
  });

  it("le nom tronque par ellipse et ne pousse jamais le bouton « Projets »", () => {
    const d = declarations(bloc(css, NOM));
    expect(d).toContain("white-space: nowrap");
    expect(d).toContain("overflow: hidden");
    expect(d).toContain("text-overflow: ellipsis");
    expect(d).toContain("min-width: 0");
    // Le bloc identite prend la place disponible ; le bouton, lui, est fixe.
    const identite = declarations(bloc(css, "#project-identity"));
    expect(identite).toContain("flex: 1");
    expect(identite).toContain("min-width: 0");
    const bouton = declarations(bloc(css, PROJETS));
    expect(bouton).toContain("flex: 0 0 auto");
  });
});

describe("LOT 2 (c) — « Projets » est un bouton nomme", () => {
  it("le bouton porte le mot « Projets » et un chevron", () => {
    const m = html.match(
      /<button id="btn-open-project"[^>]*>([\s\S]*?)<\/button>/,
    );
    expect(m, "bouton #btn-open-project introuvable").not.toBeNull();
    expect(m[1]).toContain("Projets");
    expect(m[1]).toContain('class="dropdown-arrow"');
  });

  it("le bouton est une pastille de 28 px, largeur au contenu", () => {
    const d = declarations(bloc(css, PROJETS));
    expect(d).toContain("height: 28px");
    expect(d).toContain("width: auto");
    expect(d).toContain("margin-left: auto");
    expect(d).not.toContain("width: 48px");
  });

  it("l'etat OUVERT du bouton suit l'affichage du menu (un seul point de verite)", () => {
    // CSS : classe `open` = fond accent + chevron retourne.
    const ouvert = bloc(css, "#btn-open-project.open");
    expect(declarations(ouvert)).toContain("color-mix(in srgb, var(--accent) 14%");
    expect(declarations(bloc(css, "#btn-open-project.open .dropdown-arrow")))
      .toContain("rotate(180deg)");
    // JS : la classe et `aria-expanded` sont posees dans les DEUX chemins.
    expect(sidebarJs).toContain('this.btnOpen?.classList.add("open")');
    expect(sidebarJs).toContain('this.btnOpen.classList.remove("open")');
    expect(sidebarJs).toContain('setAttribute("aria-expanded", "true")');
    expect(sidebarJs).toContain('setAttribute("aria-expanded", "false")');
    // Etat ferme annonce des le rendu initial.
    expect(html).toMatch(/id="btn-open-project"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/id="btn-open-project"[^>]*aria-haspopup="true"/);
  });

  it("le menu garde ses entrees et son ancre", () => {
    for (const id of [
      "projects-dropdown",
      "dd-new-project",
      "dd-add-gds-project",
      "dd-recent-list",
      "dd-close-project",
    ]) {
      expect(html, `entree de menu perdue : ${id}`).toContain(`id="${id}"`);
    }
  });
});

describe("LOT 2 (d) — sept icones nues deviennent deux boutons nommes", () => {
  const PORTES = [
    ["btn-scratchpad", "Brouillon"],
    ["btn-settings", "Options"],
  ];

  it("les deux portes gardent leur identifiant ET portent leur libelle", () => {
    for (const [id, libelle] of PORTES) {
      const m = html.match(new RegExp(`<button id="${id}"[^>]*>([\\s\\S]*?)</button>`));
      expect(m, `bouton ${id} introuvable`).not.toBeNull();
      expect(m[1], `${id} sans libelle visible`).toContain(libelle);
      expect(m[1], `${id} sans icone`).toContain("data-lucide=");
    }
  });

  // Lot A (`RAPPORT-design-colonne-entrees.md` § 4) : les deux portes ont QUITTE
  // le haut de la colonne. Le compte attendu passe donc de 2 a 0 — remettre un
  // bouton ici (meme par megarde) fait rougir ce test.
  it("le haut ne contient plus aucun bouton", () => {
    const bloc_actions = html.match(/<div id="global-actions">([\s\S]*?)\n    <\/div>/);
    expect(bloc_actions, "conteneur #global-actions introuvable").not.toBeNull();
    const boutons = bloc_actions[1].match(/<button /g) || [];
    expect(boutons).toHaveLength(0);
  });

  it("les deux portes ont bien quitte le haut (aucun de leurs identifiants n'y reste)", () => {
    const bloc_actions = html.match(/<div id="global-actions">([\s\S]*?)\n    <\/div>/);
    expect(bloc_actions, "conteneur #global-actions introuvable").not.toBeNull();
    for (const [id] of PORTES) {
      expect(bloc_actions[1], `${id} encore en haut de la colonne`).not.toContain(
        `id="${id}"`,
      );
    }
    // Le badge « Distant » a QUITTE ce conteneur (decision 375 : il est
    // descendu dans `#sidebar-engine-row`, a droite du sous-titre du moteur) :
    // il ne doit pas revenir ici, sinon la ligne vide du haut reapparait.
    expect(bloc_actions[1]).not.toContain('id="remote-badge"');
  });

  it("le conteneur du haut n'occupe plus aucune hauteur (44 px rendus)", () => {
    // Lot A § 3.4 du rapport : marges et padding a 0. Depuis la decision 375,
    // le badge n'est plus son enfant : le conteneur est VIDE, il ne peut donc
    // plus rien depenser en hauteur (ni 28 px de badge, ni 44 px avec l'air).
    const d = declarations(bloc(css, "#global-actions"));
    expect(d).toContain("margin: 0;");
    expect(d).toContain("padding: 0;");
    expect(d).not.toMatch(/margin: 8px/);
    expect(d).not.toMatch(/padding: 0 8px 8px/);
    // Le badge, lui, prend son air dans la ligne qui l'accueille.
    expect(declarations(bloc(css, "#sidebar-engine-row"))).toContain(
      "height: 28px;",
    );
  });

  it("la porte « Aide » ne revient pas dans le haut de la colonne", () => {
    // Raison : l'onglet Aide a ete retire de l'ecran (l'Assistant repond sur la
    // documentation). Un bouton « Aide » qui revient ici rouvrirait le neant :
    // `main.js` n'a plus de cablage et `tabs.js` plus de mode `help`.
    const bloc_actions = html.match(/<div id="global-actions">([\s\S]*?)\n    <\/div>/);
    expect(bloc_actions).not.toBeNull();
    expect(bloc_actions[1]).not.toContain('id="btn-help"');
    expect(html).not.toContain('id="btn-help"');
  });

  // Lot A : la regle « pastille » 28 px des deux portes n'existe plus (plus
  // aucun bouton dans `#global-actions`). Les deux portes prennent la regle des
  // lignes du panneau : 32 px et `var(--font-sm)`. La classe du libelle, elle,
  // reste `.ga-label` (decision §3.8 du rapport).
  it("les deux portes prennent la regle des lignes du panneau (32 px, 12 px)", () => {
    expect(css, "regle morte `#global-actions button` revenue").not.toContain(
      "#global-actions button {\n  width: auto;\n  height: 28px;",
    );
    // `.pj-panel button` porte DEUX regles (base 32 px, puis la mise en ligne
    // pleine largeur) : on lit l'ensemble, comme le verrou du bloc du bas.
    const panneau = [...css.matchAll(/(?:^|\n)\.pj-panel button \{([^}]*)\}/g)]
      .map((m) => m[1])
      .join("\n");
    expect(panneau, "regle `.pj-panel button` absente").toContain("width: 100%");
    expect(panneau).toContain("font-size: var(--font-sm)");
    expect(css).toContain(".ga-label {");
  });
});

describe("LOT 2 (e) — les quatre portes retirees ne cassent pas le demarrage", () => {
  const RETIREES = ["btn-vault", "btn-feedback", "btn-gds-admin", "btn-gds-params"];

  it("elles ne sont plus dans le haut de la colonne", () => {
    const bloc_actions = html.match(/<div id="global-actions">([\s\S]*?)\n    <\/div>/);
    expect(bloc_actions).not.toBeNull();
    for (const id of RETIREES) {
      expect(bloc_actions[1], `porte encore presente en haut : ${id}`)
        .not.toContain(`id="${id}"`);
    }
  });

  it("leur cablage tolere l'absence (aucun `null.addEventListener` au demarrage)", () => {
    for (const id of RETIREES) {
      const cablage = new RegExp(
        `getElementById\\("${id}"\\)\\?\\.addEventListener`,
      );
      expect(mainJs, `cablage non tolerant pour ${id}`).toMatch(cablage);
    }
  });

  it("les identifiants restent connus du code (retour au LOT 7 sans renommage)", () => {
    for (const id of RETIREES) {
      expect(mainJs).toContain(`"${id}"`);
    }
  });
});

describe("LOT 2 (f) — un seul cadre accentue par colonne", () => {
  it("le cadre accent du haut est retire", () => {
    const d = declarations(bloc(css, "#global-actions"));
    expect(d).not.toContain("border: 1px solid var(--accent)");
    expect(d).not.toContain("color-mix(in srgb, var(--accent) 16%");
    expect(d).not.toContain("background:");
  });

  it("le cadre accent du bas, lui, reste", () => {
    const d = declarations(bloc(css, "#project-footer"));
    expect(d).toContain("var(--accent)");
  });
});

describe("LOT 2 (g) — le badge « Distant » est nomme et a la bonne famille", () => {
  it("le badge porte le mot « Distant »", () => {
    const m = html.match(/<span id="remote-badge"[\s\S]*?<\/span>/);
    expect(m, "badge #remote-badge introuvable").not.toBeNull();
    expect(m[0]).toContain("Distant");
    expect(m[0]).toContain("remote-badge-label");
  });

  it("le badge reprend la famille des portes (28 px, 11 px / 600, jetons de theme)", () => {
    const d = declarations(bloc(css, ".remote-badge"));
    expect(d).toContain("height: 28px");
    expect(d).toContain("width: auto");
    expect(d).toContain("padding: 0 8px");
    expect(d).toContain("font-size: var(--font-xs)");
    expect(d).toContain("font-weight: var(--fw-semibold)");
    expect(d).toContain("background: var(--surface-2)");
    expect(d).toContain("border: 1px solid var(--border-subtle)");
    expect(d).not.toMatch(/width:\s*32px/);
  });

  it("le compteur et l'action du badge sont conserves", () => {
    expect(html).toContain('id="remote-badge-count"');
  });
});

describe("LOT 2 (h) — le sous-titre du moteur vit dans la ligne du bas", () => {
  // MISE A JOUR (decision 375 du proprietaire) : le sous-titre a quitte le
  // bandeau pour la LIGNE D'INFORMATION DU BAS de la colonne, ou le badge
  // « Distant » le rejoint a sa droite. Verrou complet du nouvel emplacement :
  // `badge-distant-bas.test.js`.
  it("l'element est place DANS #sidebar-engine-row, qui ferme #sidebar", () => {
    const debut = html.indexOf('id="sidebar-engine-row"');
    const moteur = html.indexOf('id="project-engine"');
    const fin = html.indexOf("</aside>");
    expect(debut).toBeGreaterThan(-1);
    expect(moteur).toBeGreaterThan(debut);
    expect(fin).toBeGreaterThan(moteur);
    // Et il n'est plus dans le bandeau d'identification.
    const bandeauDebut = html.indexOf('id="project-selector"');
    const bandeauFin = html.indexOf('id="open-projects-bar"');
    expect(html.indexOf('id="project-engine"')).toBeGreaterThan(bandeauFin);
    expect(moteur).toBeGreaterThan(bandeauDebut);
  });

  it("il est rempli par la source UNIQUE du libelle du moteur (backend-info.js)", () => {
    expect(mainJs).toContain('document.getElementById("project-engine")');
    expect(mainJs).toContain("agentDisplayLabel()");
    // Et il suit une re-sonde du backend (pi ↔ plh).
    expect(mainJs).toContain(
      'window.addEventListener("pilot-backend-changed", syncEngineSubtitle)',
    );
  });

  it("il ne reserve pas de hauteur avant la premiere sonde", () => {
    expect(declarations(bloc(css, ".project-engine"))).toContain("overflow: hidden");
    expect(css).toContain(".project-engine:empty { display: none; }");
  });
});

describe("LOT 2 (i) — thème clair : aucune couleur en dur dans le bandeau", () => {
  it("toutes les couleurs du haut viennent des jetons de theme", () => {
    const enDur = [];
    for (const sel of [...BLOCS_BANDEAU, "#global-actions", ".remote-badge"]) {
      for (const corps of blocs(css, sel)) {
        for (const m of corps.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)) {
          enDur.push(`${sel} → ${m[0]}`);
        }
      }
    }
    expect(enDur).toEqual([]);
  });
});
