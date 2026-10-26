/**
 * Verrou — LE NOM DU MOTEUR EN SERVICE N'A QU'UN SEUL ENDROIT A L'ECRAN.
 *
 * Deux decisions du proprietaire se repondent :
 *   - 2026-10-25 : « le sous-titre du moteur vit dans le bandeau d'identification
 *     de la colonne de gauche, pas dans l'onglet » ;
 *   - 2026-10-26 : le detour de la decision 375 (qui avait descendu ce
 *     sous-titre en bas de la colonne, a cote du badge « Distant ») est ANNULE —
 *     le sous-titre remonte a sa place d'origine, le badge reste seul en bas,
 *     aligne a droite — ET la mention du moteur qui s'affichait encore sous la
 *     zone de saisie du chat (« Agent Pi (RPC) », « Agent Pi (Suivi) ») est
 *     RETIREE.
 *
 * PERIMETRE DE COMPTAGE (dit ici une fois, pour que le compte soit verifiable) :
 * on compte les endroits de l'INTERFACE DE TRAVAIL qui affichent le nom du
 * moteur en service en tant qu'INFORMATION DE STATUT, c'est-a-dire les textes
 * produits par la source unique `agentDisplayLabel()` (`backend-info.js`) :
 *   - le sous-titre du bandeau de la colonne de gauche (`#project-engine`) ;
 *   - la barre de statut du bas (`#status-filetype`, juste sous la zone de
 *     saisie du chat) ;
 *   - les barres de saisie des deux chats (`agent-chat-input-bar`).
 * Ne sont PAS comptes, et c'est deliberе :
 *   - le NOM D'ONGLET du chat (« π Agent Pi (RPC) ») : c'est le nom de l'onglet,
 *     comme « Notes.md » est le nom d'un fichier, pas une information de statut ;
 *   - le libelle de l'onglet des Options (`#settings-tab-agent-label`), qui vit
 *     dans une modale fermee par defaut et repond a une AUTRE decision (verrou :
 *     `libelle-moteur-options.test.js`) ;
 *   - les messages d'erreur et de chargement (« Agent Pi indisponible »), qui ne
 *     nomment le moteur que pour expliquer une panne.
 * Compte attendu a l'issue de la decision : EXACTEMENT 1. 0 ou plus de 1 = echec.
 *
 * DEUXIEME PASSE (2026-10-26, controle independant) : le compte n'est plus
 * seulement celui des trois zones ci-dessus. Il est verifie A L'ECHELLE DE TOUT
 * LE FRONT DE PRODUCTION (`index.html` + `src/js/**` hors `*.test.js`) : le
 * libelle visible « Moteur · » ne doit y apparaitre qu'UNE fois, dans
 * `main.js`, et le porteur `#project-engine` qu'UNE fois, dans le bandeau.
 * Motif de ce renforcement, mesure par contre-epreuve : la premiere version ne
 * cherchait que `agentDisplayLabel()` et les roles `(RPC)` / `(Suivi)` ; un
 * libelle reecrit EN DUR (`statusFiletype.textContent = "Moteur · Agent Pi"`)
 * la laissait VERTE. Les commentaires sont retires avant lecture (quality-gate
 * 3.4 et incident du verrou satisfait par sa propre prose).
 *
 * Ce fichier echoue si :
 *   (a) le bandeau ne porte plus le sous-titre, ou le porte deux fois ;
 *   (b) la barre de statut se remet a ecrire le nom du moteur ou son role
 *       (« (RPC) », « (Suivi) ») dans un onglet de chat ;
 *   (c) la ligne du bas de la colonne se remet a nommer le moteur a cote du
 *       badge « Distant » ;
 *   (d) une zone de saisie de chat porte un texte d'identite du moteur ;
 *   (e) le compte total des endroits n'est plus exactement 1 ;
 *   (f) le retrait a emporte autre chose que du texte : le selecteur de modele,
 *       le micro, le bouton d'envoi et la zone de saisie sont toujours la.
 *
 * CONTRE-EPREUVE (faite a la main, decrite dans le rapport de la mission) :
 * remettre `statusFiletype.textContent = \`${agentDisplayLabel()} (Suivi)\`` dans
 * `tabs.js` fait rougir (b), (e) et le compte. Aucun autre test ne doit bouger.
 *
 * Aucun navigateur n'est requis : lecture des sources (fins de ligne
 * normalisees, cf. quality-gate 3.4).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (...p) => readFileSync(resolve(ROOT, ...p), "utf8").replace(/\r\n/g, "\n");

const html = lire("index.html");
const mainJs = lire("src/js/main.js");
const tabsJs = lire("src/js/tabs.js");
const agentPiJs = lire("src/js/agent-pi.js");
const superAgentJs = lire("src/js/super-agent.js");

/** Contenu du bloc dont l'identifiant est donne (jusqu'a la balise suivante). */
function bloc(source, marqueur, fin, min = 1) {
  const debut = source.indexOf(marqueur);
  expect(debut, `marqueur introuvable : ${marqueur}`).toBeGreaterThan(-1);
  const finIndex = source.indexOf(fin, debut + marqueur.length);
  expect(finIndex, `fin introuvable apres : ${marqueur}`).toBeGreaterThan(debut);
  expect(finIndex - debut).toBeGreaterThanOrEqual(min);
  return source.slice(debut, finIndex);
}

/**
 * Source SANS ses commentaires (bloc et fin de ligne). Pure.
 *
 * Pourquoi : un verrou qui lit la prose se satisfait d'un commentaire
 * (`repli-menus-bas.test.js`, incident du 2026-10-26) — et, dans l'autre sens,
 * un commentaire qui CITE une ecriture fautive ferait rougir a tort. On ne juge
 * donc que le CODE.
 */
export function sansCommentaires(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Ecritures qui nomment le moteur DANS la barre de statut (`#status-filetype`).
 *
 * Deuxieme passe (2026-10-26) : la premiere version ne cherchait que
 * `agentDisplayLabel()` et les roles `(RPC)` / `(Suivi)`. Elle laissait donc
 * passer un libelle ECRIT EN DUR — contre-epreuve faite :
 * `statusFiletype.textContent = "Moteur · Agent Pi";` restait VERT. Desormais
 * toute ecriture dans la barre de statut qui nomme le moteur, d'ou qu'il
 * vienne, est refusee.
 * Pure : rend les extraits fautifs (liste vide = conforme).
 * @returns {string[]}
 */
export function ecrituresNommantLeMoteurDansLeStatut(source) {
  const lignes = sansCommentaires(source).split("\n");
  const ecritures = [
    /statusFiletype\.(textContent|innerText|innerHTML|outerHTML)\s*=/,
    /statusFiletype\.(append|prepend|insertAdjacentHTML|insertAdjacentText|replaceChildren)\s*\(/,
  ];
  const nomme = /agentDisplayLabel|\bMoteur\b|\bAgent Pi\b|\bAgent PLh\b|\(RPC\)|\(Suivi\)/;
  const fautives = [];
  lignes.forEach((ligne, i) => {
    if (!ecritures.some((m) => m.test(ligne))) return;
    // L'ecriture peut tenir sur plusieurs lignes (gabarit ou concatenation) :
    // on juge l'instruction avec ses deux lignes suivantes.
    const instruction = lignes.slice(i, i + 3).join("\n");
    if (nomme.test(instruction)) fautives.push(`L${i + 1}: ${ligne.trim()}`);
  });
  return fautives;
}

/**
 * Ecritures de la barre de statut qui nommeraient le moteur ou son role.
 * Conserve pour les cas historiques ; delegue au detecteur ELARGI ci-dessus.
 * Pure : rend la liste des ecritures fautives (vide = conforme).
 */
export function ecrituresDuMoteurDansLaBarreDeStatut(source) {
  return ecrituresNommantLeMoteurDansLeStatut(source);
}

/**
 * Fichiers de PRODUCTION du front : `index.html` + les modules `src/js` hors
 * `*.test.js`. C'est le perimetre du compte : la ou l'utilisateur peut lire un
 * texte, pas les tests.
 * @returns {string[]} chemins relatifs au depot, tries.
 */
export function sourcesDeProduction() {
  const modules = readdirSync(resolve(ROOT, "src", "js"))
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .sort()
    .map((f) => `src/js/${f}`);
  return ["index.html", ...modules];
}

/**
 * Occurrences du libelle visible du sous-titre (« Moteur · … ») dans une source,
 * commentaires retires. Pure.
 * @returns {number}
 */
export function occurrencesDuSousTitre(source) {
  return (sansCommentaires(source).match(/Moteur\s*\u00b7/g) || []).length;
}

/**
 * Endroits de l'interface de travail qui affichent le nom du moteur en service.
 * Pure : rend la liste des endroits trouves (libelles lisibles).
 * @returns {string[]}
 */
export function endroitsQuiNommentLeMoteur({ page, statut, chatPi, chatAssistant }) {
  const endroits = [];
  const compteur = (texte, motif) => (texte.match(motif) || []).length;

  // 1. Le sous-titre du bandeau : c'est LUI, et lui seul, qui doit rester.
  const dansLeBandeau = bloc(page, 'id="project-identity"', 'id="btn-open-project"');
  for (let i = 0; i < compteur(dansLeBandeau, /id="project-engine"/g); i += 1) {
    endroits.push("#project-engine (bandeau)");
  }

  // 2. La barre de statut du bas (sous la zone de saisie du chat).
  for (const m of ecrituresDuMoteurDansLaBarreDeStatut(statut)) {
    endroits.push(`#status-filetype (barre de statut) → ${m}`);
  }

  // 3. Les barres de saisie des deux chats.
  for (const [nom, source, marqueur, fin] of [
    ["agent pi", chatPi, 'className = "agent-chat-input-bar"', "wrapper.appendChild(inputBar)"],
    ["assistant", chatAssistant, 'className = "agent-chat-input-bar"', "wrapper.appendChild(inputBar)"],
  ]) {
    const barre = bloc(source, marqueur, fin);
    if (/Moteur\s*·|agentDisplayLabel|\bAgent Pi\b|\bAgent PLh\b/.test(barre)) {
      endroits.push(`zone de saisie ${nom}`);
    }
  }

  return endroits;
}

describe("Un seul endroit nomme le moteur — le bandeau", () => {
  it("le sous-titre est dans le bloc d'identite du projet, une seule fois", () => {
    const identite = bloc(html, 'id="project-identity"', 'id="btn-open-project"');
    expect((identite.match(/id="project-engine"/g) || []).length).toBe(1);
    // Sous le nom du projet, dans l'ordre du DOM.
    expect(identite.indexOf('id="btn-project-name"')).toBeLessThan(
      identite.indexOf('id="project-engine"'),
    );
    // Et nulle part ailleurs dans la page.
    expect((html.match(/id="project-engine"/g) || []).length).toBe(1);
  });

  it("il est rempli par la source UNIQUE, et suit la re-sonde du backend", () => {
    expect(mainJs).toContain('document.getElementById("project-engine")');
    // Une seule ecriture du libelle « Moteur · … » dans toute l'application.
    expect((mainJs.match(/"Moteur · " \+ agentDisplayLabel\(\)/g) || []).length).toBe(1);
    expect(mainJs).toContain(
      'window.addEventListener("pilot-backend-changed", syncEngineSubtitle)',
    );
  });
});

describe("Un seul endroit nomme le moteur — la barre de statut n'en est plus", () => {
  it("aucune ecriture du nom du moteur ni de son role dans la barre de statut", () => {
    expect(ecrituresDuMoteurDansLaBarreDeStatut(tabsJs)).toEqual([]);
  });

  it("un libelle ECRIT EN DUR dans la barre de statut est refuse lui aussi", () => {
    // Contre-epreuve de la 2e passe : la 1re version laissait ce sabotage VERT.
    const sabote = tabsJs.replace(
      "statusFiletype.textContent = '';",
      'statusFiletype.textContent = "Moteur \u00b7 Agent Pi";',
    );
    expect(sabote).not.toBe(tabsJs);
    expect(ecrituresNommantLeMoteurDansLeStatut(sabote).length).toBeGreaterThan(0);
  });

  it("un commentaire qui CITE une ecriture ne fait pas rougir le verrou", () => {
    const avecProse = `${tabsJs}\n// statusFiletype.textContent = \`Agent Pi (Suivi)\`;\n`;
    expect(ecrituresNommantLeMoteurDansLeStatut(avecProse)).toEqual([]);
  });

  it("les deux branches de chat vident la barre de statut au lieu de la remplir", () => {
    const corps = bloc(
      tabsJs,
      '} else if (tab && tab.mode === "agent") {',
      '} else if (tab && tab.mode === "prompt-builder") {',
    );
    expect(corps).toContain("statusFiletype.textContent = '';");
    expect(corps).not.toContain("(RPC)");
    expect(corps).not.toContain("(Suivi)");
    expect(corps).not.toContain("agentDisplayLabel");
  });

  it("la re-sonde du backend ne remplit plus la barre de statut non plus", () => {
    const corps = bloc(tabsJs, "// Barre de statut de l'onglet actif", "});", 10);
    expect(corps).not.toContain("(Suivi)");
    expect(corps).not.toContain("(RPC)");
    expect(corps).toContain("statusFiletype.textContent = \"\";");
  });
});

describe("Un seul endroit nomme le moteur — la ligne du bas n'en est plus", () => {
  it("la ligne du bas ne porte que le badge « Distant »", () => {
    const ligne = bloc(html, 'id="sidebar-engine-row"', "</aside>", 10);
    expect(ligne).toContain('id="remote-badge"');
    expect(ligne).not.toContain('id="project-engine"');
    expect(ligne).not.toContain("Moteur");
    // Une seule balise porteuse d'identifiant : le badge lui-meme.
    expect((ligne.match(/<span id=/g) || []).length).toBe(1);
  });
});

describe("Un seul endroit nomme le moteur — la zone de saisie n'en porte plus", () => {
  it("aucun texte d'identite du moteur dans les barres de saisie", () => {
    expect(endroitsQuiNommentLeMoteur({
      page: html,
      statut: tabsJs,
      chatPi: agentPiJs,
      chatAssistant: superAgentJs,
    })).toEqual(["#project-engine (bandeau)"]);
  });

  it("le retrait n'a emporte que du texte : saisie, micro, envoi et modele restent", () => {
    for (const [nom, source, saisie] of [
      ["agent pi", agentPiJs, 'id="agent-input"'],
      ["assistant", superAgentJs, 'id="superagent-input"'],
    ]) {
      const barre = bloc(source, 'className = "agent-chat-input-bar"', "wrapper.appendChild(inputBar)");
      expect(barre, `${nom} : zone de saisie perdue`).toContain(saisie);
      expect(barre, `${nom} : micro perdu`).toContain('data-action="voice"');
      expect(barre, `${nom} : bouton d'envoi perdu`).toContain('data-action="send"');
    }
    // Les selecteurs de modele sont intacts (ils ne vivent PAS dans la barre de
    // saisie : rien de ce cote n'a ete touche).
    expect(agentPiJs).toContain("agentSelectorIds(");
    expect(agentPiJs).toContain('class="agent-model-select"');
    expect(superAgentJs).toContain("#superagent-model-select");
  });
});

describe("Un seul endroit nomme le moteur — le compte a l'echelle du front", () => {
  it("le libelle « Moteur · » n'est ecrit qu'a UN endroit de tout le front", () => {
    const parFichier = sourcesDeProduction()
      .map((f) => [f, occurrencesDuSousTitre(lire(f))])
      .filter(([, n]) => n > 0);
    // Un seul fichier, une seule occurrence : le sous-titre du bandeau.
    expect(parFichier).toEqual([["src/js/main.js", 1]]);
  });

  it("le porteur #project-engine n'existe qu'une fois et aucun module n'en cree un second", () => {
    expect((html.match(/id="project-engine"/g) || []).length).toBe(1);
    for (const f of sourcesDeProduction().filter((x) => x.endsWith(".js"))) {
      expect(lire(f), `${f} : second porteur du sous-titre`).not.toContain(
        'id="project-engine"',
      );
    }
  });

  it("le compte final des endroits vaut EXACTEMENT 1", () => {
    expect(endroitsQuiNommentLeMoteur({
      page: html,
      statut: tabsJs,
      chatPi: agentPiJs,
      chatAssistant: superAgentJs,
    })).toHaveLength(1);
    // Et aucun autre module de production n'ecrit le libelle du sous-titre.
    for (const f of sourcesDeProduction()) {
      if (f === "src/js/main.js") continue;
      expect(occurrencesDuSousTitre(lire(f)), f).toBe(0);
    }
  });
});
