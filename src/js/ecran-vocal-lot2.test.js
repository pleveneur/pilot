// Tests — LOT 2 : l'ecran du mode Vocal (RAPPORT-trois-modes-ecran-vocal.md
// §2 « l'ecran Vocal de haut en bas », §3 « la colonne et la sortie du mode »,
// §4 « etats visuels et contrastes », §5 « Lot 2 »).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. « Vocal » possede desormais son PROPRE ecran : il n'emprunte plus celui
//      de « Assistant seul » (une seule source : `screenModeScreen`).
//   2. Les quatre etats (repos / ecoute / reflexion / parole) ont une priorite
//      fixe et UNE seule classe a la fois ; la ligne d'etat est unique et
//      neutre (le texte ne porte jamais la couleur).
//   3. L'ecran ne montre RIEN de la conversation : pas d'historique, pas de
//      second lecteur audio, pas de second bouton de mode.
//   4. Il n'y a JAMAIS deux pleins ecrans superposes (on sort de l'immersif
//      avant d'entrer en Vocal, et inversement).
//   5. Trois sorties (meme bouton, Echap, fermeture de l'onglet) et une
//      restitution SYMETRIQUE des deux noeuds deplaces (bouton de mode et
//      barre de saisie) : aucun noeud perdu, aucun doublon.
//   6. Le lot 2 ne fait pas le lot 4 (aucune coupure de la parole par la voix).
//      Depuis le LOT 3, la longueur du trait vient du NIVEAU REELLEMENT MESURE,
//      mais la capture vit dans `vocal-mic.js` : ce fichier verifie donc que
//      `super-agent.js` ne contient AUCUNE des API micro (un seul mecanisme,
//      aucun doublon) et que le silence reste le repli (8 %).
//
// Les commentaires sont en ASCII ; les chaines qui viennent de l'interface
// (textes affiches, selecteurs CSS) sont copiees telles quelles.
import { vi, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
// Le projet interdit un decoupage de source calcule a la main dans les tests
// (une ancre absente rendrait l'assertion vraie par construction). On passe
// donc par les helpers verifies de source-slice.js.
import { sliceSource, sliceFrom } from "./source-slice.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("markdown-it", () => ({
  default: vi.fn(() => ({ use() { return this; }, render: () => "" })),
}));
vi.mock("./icons.js", () => ({ refreshIcons: vi.fn() }));
vi.mock("./backend-info.js", () => ({ agentDisplayLabel: vi.fn(), backendKind: vi.fn() }));
vi.mock("./agent-pi.js", () => ({ appendDelegatedMessage: vi.fn(), purgeAgentTabView: vi.fn() }));
vi.mock("./loop-detection.js", () => ({
  detectRepeatedBlock: vi.fn(), detectRepeatedWord: vi.fn(),
  detectRepeatedToolCalls: vi.fn(), detectSemanticLoop: vi.fn(),
  buildToolLoopFingerprint: vi.fn(),
}));
vi.mock("./desktop-notify.js", () => ({ notifySuperAgentDone: vi.fn(), playAssistantSound: vi.fn() }));
vi.mock("./agents.js", () => ({
  loadAgentRegistry: vi.fn(), upsertAgent: vi.fn(), normalizeAgent: vi.fn(),
  validateAgentId: vi.fn(), classifyAgent: vi.fn(),
}));
vi.mock("./agents-bus.js", () => ({
  runAgentsForAssistant: vi.fn(), runAgentsForAssistantAsync: vi.fn(), setBusNotifyCallback: vi.fn(),
}));
vi.mock("./reservations.js", () => ({ estimateAndReserve: vi.fn() }));
vi.mock("./structured-brief.js", () => ({ applyAssistantBriefEnvelope: vi.fn() }));
vi.mock("./super-agent-schedule.js", () => ({
  shouldScheduleTick: vi.fn(),
  parseScheduleEvery: vi.fn(),
  formatReminderNotificationLabel: vi.fn(),
  planDueReminderInjections: vi.fn(() => ({ toInject: [], mode: "none", held: [], waitingForOwner: 0 })),
  buildReminderInjectionMessage: vi.fn(),
  formatReminderGroupNotificationLabel: vi.fn(),
  formatReminderHoldNotice: vi.fn(),
  createReminderHoldGuard: vi.fn(() => ({ reset() {}, shouldNotify: () => false })),
}));

// `super-agent.js` pose des ecouteurs au chargement du module (preview.js) : un
// `window` minimal suffit, comme dans super-agent-reflecting.test.js.
if (!globalThis.window) {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  };
}

const {
  vocalScreenState,
  vocalStateClass,
  vocalStatusText,
  vocalReducedMotion,
} = await import("./super-agent.js");
const { screenModeScreen, isImmersiveScreenMode } = await import("./screen-mode.js");

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
// Le source peut arriver en CRLF (runner Windows) : on normalise AVANT de
// chercher une ancre contenant un saut de ligne (quality-gate §3.4).
const CSS = lire("src/css/style.css");
const SUPER = lire("src/js/super-agent.js");
const HTML = lire("index.html");

/**
 * Corps d'une fonction du module (de sa declaration jusqu'a la premiere
 * accolade fermante en colonne 3) : les assertions ne debordent jamais sur le
 * reste du fichier.
 */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }", i);
  return src.slice(i, fin > -1 ? fin : undefined);
}

/** Corps d'un bloc CSS `selecteur { ... }` (premiere occurrence). */
function bloc(css, selecteur) {
  // Du selecteur jusqu'a son accolade fermante ; sliceSource LEVE si le
  // selecteur n'existe pas (aucun fragment vide silencieux).
  return sliceSource(css, selecteur, "}", 2);
}

// ---------------------------------------------------------------------------
describe("1. « Vocal » a son PROPRE ecran (fin de l'emprunt du lot 1)", () => {
  it("les trois modes gardent un ecran distinct", () => {
    expect(screenModeScreen("detailed")).toBe("detailed");
    expect(screenModeScreen("assistant")).toBe("assistant");
    expect(screenModeScreen("vocal")).toBe("vocal");
  });

  it("une valeur inconnue retombe sur l'ecran normal (aucune regression)", () => {
    expect(screenModeScreen("VOCAL")).toBe("detailed");
    expect(screenModeScreen("")).toBe("detailed");
    expect(screenModeScreen(undefined)).toBe("detailed");
  });

  it("« Assistant seul » et « Vocal » demandent tous deux un plein ecran", () => {
    expect(isImmersiveScreenMode("assistant")).toBe(true);
    expect(isImmersiveScreenMode("vocal")).toBe(true);
    expect(isImmersiveScreenMode("detailed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("2. les quatre etats, leur priorite et leur classe unique", () => {
  it("au repos, aucun drapeau : « idle »", () => {
    expect(vocalScreenState({})).toBe("idle");
    expect(vocalScreenState()).toBe("idle");
    expect(vocalScreenState(null)).toBe("idle");
  });

  it("la PAROLE prime sur tout le reste (c'est Pilot qui tient la parole)", () => {
    expect(vocalScreenState({ speaking: true, reflecting: true, listening: true })).toBe("speaking");
  });

  it("puis la REFLEXION, puis l'ECOUTE", () => {
    expect(vocalScreenState({ reflecting: true, listening: true })).toBe("thinking");
    expect(vocalScreenState({ listening: true })).toBe("listening");
  });

  it("seul `true` compte : une valeur approchee ne change pas l'etat", () => {
    expect(vocalScreenState({ speaking: "true", reflecting: 1 })).toBe("idle");
  });

  it("une seule classe a la fois, et elle est previsible", () => {
    expect(vocalStateClass({})).toBe("vocal-state-idle");
    expect(vocalStateClass({ listening: true })).toBe("vocal-state-listening");
    expect(vocalStateClass({ reflecting: true })).toBe("vocal-state-thinking");
    expect(vocalStateClass({ speaking: true })).toBe("vocal-state-speaking");
  });

  it("les quatre classes existent dans le CSS et posent la MEME variable", () => {
    const paires = [
      ["vocal-state-idle", "--vocal-rest"],
      ["vocal-state-listening", "--vocal-listen"],
      ["vocal-state-thinking", "--vocal-think"],
      ["vocal-state-speaking", "--vocal-speak"],
    ];
    for (const [classe, jeton] of paires) {
      const corps = bloc(CSS, `.pilot-vocal.${classe}`);
      expect(corps).toMatch(new RegExp(`--vocal-state:\\s*var\\(${jeton}\\)`));
    }
  });
});

// ---------------------------------------------------------------------------
describe("3. l'UNIQUE ligne d'etat (§2.3)", () => {
  it("une seule phrase par etat, celle du rapport", () => {
    expect(vocalStatusText("idle")).toBe("Je vous écoute.");
    expect(vocalStatusText("listening")).toBe("Je vous écoute…");
    expect(vocalStatusText("thinking")).toBe("Je réfléchis…");
    expect(vocalStatusText("speaking")).toBe("Je réponds.");
  });

  it("une valeur inconnue retombe sur la phrase du repos", () => {
    expect(vocalStatusText("boum")).toBe("Je vous écoute.");
    expect(vocalStatusText(undefined)).toBe("Je vous écoute.");
  });

  it("le texte n'est JAMAIS colore par l'etat : il reste --text-primary", () => {
    const corps = bloc(CSS, ".vocal-status");
    expect(corps).toMatch(/color:\s*var\(--text-primary\)/);
    expect(corps).not.toMatch(/--vocal-state/);
    // --text-muted est interdit ici (2,90:1 en clair) : aucun jeton d'etat non
    // plus, la couleur vit dans l'objet.
    expect(corps).not.toMatch(/--text-muted/);
  });

  it("et il est a 15 px / graisse 500, centre", () => {
    const corps = bloc(CSS, ".vocal-status");
    expect(corps).toMatch(/font-size:\s*var\(--font-zone\)/);
    expect(corps).toMatch(/font-weight:\s*var\(--fw-medium\)/);
    expect(corps).toMatch(/text-align:\s*center/);
  });
});

// ---------------------------------------------------------------------------
describe("4. l'objet lumineux et son trait (§2.2)", () => {
  it("le disque fait de 120 a 336 px (un seul jeton), anneau de 2 px + remplissage radial", () => {
    const corps = bloc(CSS, ".vocal-orb {");
    // Le 13/11 le disque a double et suit la hauteur de la fenetre
    // (CONCEPTION-ecran-vocal-cercle-et-bas.md §1.5). Il ne porte donc plus une
    // taille en dur mais le jeton UNIQUE, borne 120..336 px, et ses deux lueurs
    // (`--vocal-crown`, `--vocal-arc`) en sont des fractions.
    expect(corps).toMatch(/width:\s*var\(--vocal-orb-size\)/);
    expect(corps).toMatch(/height:\s*var\(--vocal-orb-size\)/);
    const overlay = bloc(CSS, ".pilot-vocal {");
    expect(overlay).toMatch(/--vocal-orb-size:\s*clamp\(120px,[^;]*336px\)/);
    expect(corps).toMatch(/border-radius:\s*50%/);
    expect(corps).toMatch(/border:\s*2px solid var\(--vocal-state/);
    expect(corps).toMatch(/radial-gradient\(/);
    expect(corps).toMatch(/18%/);
  });

  it("le trait du niveau a DISPARU (12/11) : aucun noeud, aucune regle", () => {
    // Renversement explicite de l'avenant du 28/10 (« la petite barre
    // reste ») : le proprietaire ne veut plus de trait sous le cercle. Le
    // niveau du micro continue d'etre mesure (il allume l'etat « ecoute » et
    // remplit le halo interieur) mais plus rien ne le dessine.
    expect(CSS).not.toMatch(/\.vocal-level\b/);
    expect(CSS).not.toMatch(/vocal-level-bar/);
    expect(CSS).not.toMatch(/--vocal-level/);
    const corps = corpsFonction(SUPER, "function buildVocalOverlay");
    expect(corps).not.toMatch(/vocal-level/);
  });

  it("la ligne d'etat a quitte le bloc du disque (elle est au-dessus de la saisie)", () => {
    // 28/10 : le texte n'est plus sous le cercle. Il est un enfant DIRECT de
    // l'overlay, entre le bloc du disque et la barre de saisie — le `gap` de la
    // pile ne reserve donc plus aucune place au texte.
    const corps = corpsFonction(SUPER, "function buildVocalOverlay");
    const ordre = [...corps.matchAll(/class="(vocal-[a-z-]+)/g)].map((m) => m[1]);
    expect(ordre).toEqual([
      "vocal-top",
      "vocal-stage",
      "vocal-orb",
      // Mission « ecran Vocal » : le portrait est au CENTRE DU DISQUE, premier
      // enfant de `.vocal-orb` — donc avant le halo et le bouton de relance.
      "vocal-portrait",
      "vocal-halo",
      "vocal-restart",
      "vocal-mic-fix",
      // LOT 1 (CONCEPTION-ecran-vocal-portrait-et-colonnes.md §2.1) : les deux
      // colonnes laterales et leur conteneur de liste. Le personnage n'est plus
      // ici (il est dans le disque) et le nom est cree apres le modele.
      "vocal-side-discussion",
      "vocal-side-tasks",
      "vocal-side-body",
      "vocal-status",
      "vocal-input",
    ]);
    // La scene est REFERMEE avant la phrase : trois `</div>` (objet, conteneur
    // de liste, scene). Les deux colonnes sont des `<aside>` : elles se ferment
    // par `</aside>`, elles ne comptent donc pas ici.
    const scene = sliceSource(
      corps,
      '<div class="vocal-stage">',
      '<div class="vocal-status"',
      20,
    );
    expect(scene.match(/<\/div>/g)?.length).toBe(3);
    expect(bloc(CSS, ".vocal-stage")).toMatch(/gap:\s*32px/);
  });

  it("LOT 3 : la mesure du micro reste, sans trait pour la dessiner", () => {
    // Le niveau MESURE ne dessine plus qu'une chose : le halo interieur.
    const niveau = corpsFonction(SUPER, "function vocalSetLevel");
    expect(niveau).toMatch(/--vocal-heard/);
    expect(niveau).toMatch(/planLevel\(/);
    expect(niveau).not.toMatch(/--vocal-level/);
    // Un seul mecanisme : les API micro ne sont PAS dans super-agent.js.
    expect(SUPER).not.toMatch(/getUserMedia|AudioContext|mediaDevices/);
  });

  it("aucune couleur en dur dans les etats : uniquement --vocal-state", () => {
    for (const sel of [
      ".vocal-orb {",
      ".vocal-orb::before {",
      ".vocal-orb::after {",
    ]) {
      expect(bloc(CSS, sel)).toMatch(/var\(--vocal-state/);
    }
  });

  it("les quatre teintes existent en theme sombre ET en theme clair", () => {
    const sombre = sliceSource(CSS, ".theme-dark {", ".theme-light {", 400);
    const clair = sliceSource(CSS, ".theme-light {", "\n}\n", 400);
    for (const jeton of ["--vocal-rest", "--vocal-listen", "--vocal-think", "--vocal-speak"]) {
      expect(sombre).toContain(jeton);
      expect(clair).toContain(jeton);
    }
    // En clair, les teintes de succes / alerte du projet sont trop claires pour
    // le seuil de 3:1 : elles sont assombries (valeurs mesurees du rapport).
    expect(clair).toMatch(/--vocal-listen:\s*#1f7a4d/);
    expect(clair).toMatch(/--vocal-think:\s*#6d28d9/);
    expect(clair).toMatch(/--vocal-speak:\s*#b45309/);
  });
});

// ---------------------------------------------------------------------------
// LOT B — le halo d'ecoute : la voix de l'UTILISATEUR, a l'interieur du cercle
// (CONCEPTION-cercle-equaliseur.md §6). Ce bloc verrouille quatre choses :
//   - un seul element, dans la boite interieure du disque : il ne peut deborder
//     ni sur l'anneau ni sur le contour de la voix de Pilot ;
//   - sa couleur est celle de l'ECOUTE, jamais `--vocal-state` (decision 5 :
//     une couleur par voix, les deux ne se confondent pas) ;
//   - il n'existe qu'en ecoute : deux gardes qui tombent ensemble ;
//   - en mouvement reduit il est fige mais LISIBLE, pas eteint.
describe("4bis. le halo d'ecoute (lot B) : la voix de l'utilisateur", () => {
  it("il est ENFANT du disque, pose dans sa boite interieure (166 px de rayon)", () => {
    const corps = corpsFonction(SUPER, "function buildVocalOverlay");
    // ENFANT DIRECT du disque : le balisage du disque, du `div` a sa fermeture.
    // Depuis le bouton de relance (decisions 401/402), le disque contient DEUX
    // enfants (le halo et ce bouton), separes par un commentaire : la garde ne
    // peut donc plus exiger que le halo soit la PREMIERE chose apres le `div`.
    // Ce qui compte est inchange : le halo est dans la boite du disque.
    const disque = sliceSource(corps, '<div class="vocal-orb">', "</div>", 40);
    expect(disque).toMatch(/<span class="vocal-halo">/);
    const halo = bloc(CSS, ".vocal-halo {");
    expect(halo).toMatch(/position:\s*absolute/);
    expect(halo).toMatch(/inset:\s*0/);
    expect(halo).toMatch(/border-radius:\s*50%/);
    // Le degrade s'arrete au plus tard a `closest-side` : rien ne depasse.
    expect(halo).toMatch(/radial-gradient\(\s*closest-side/);
    // Aucun decoupage sur le disque : il couperait l'enveloppe et l'arc.
    expect(bloc(CSS, ".vocal-orb {")).not.toMatch(/overflow/);
  });

  it("sa teinte est celle de la voix de l'utilisateur, jamais --vocal-state", () => {
    const halo = bloc(CSS, ".vocal-halo {");
    expect(halo).toMatch(/var\(--vocal-listen\)/);
    expect(halo).not.toMatch(/--vocal-state/);
    // Et surtout pas la teinte de Pilot : les deux voix restent distinctes.
    expect(halo).not.toMatch(/--vocal-speak/);
  });

  it("le niveau vient de LA mesure deja lisse (repli 0 : aucun rond residuel)", () => {
    expect(bloc(CSS, ".vocal-halo {")).toMatch(/--vocal-halo:\s*var\(--vocal-heard, 0\)/);
    const niveau = corpsFonction(SUPER, "function vocalSetLevel");
    expect(niveau).toMatch(/--vocal-heard/);
    // Un seul chiffre pose par le code : la projection du niveau deja lisse,
    // et rien d'autre (aucun second capteur, aucun second lissage).
    expect(niveau).toMatch(/planLevel\(/);
    expect(niveau).not.toMatch(/getUserMedia|AudioContext|mediaDevices/);
  });

  it("il n'existe qu'en ecoute : les deux gardes tombent ensemble", () => {
    expect(bloc(CSS, ".pilot-vocal.vocal-state-listening .vocal-halo")).toMatch(/opacity:\s*1/);
    expect(bloc(CSS, ".pilot-vocal:not(.vocal-state-listening) .vocal-halo")).toMatch(
      /--vocal-halo:\s*0/,
    );
  });

  it("en mouvement reduit il est fige a 0,55 (lisible) et neutralise", () => {
    expect(bloc(CSS, ".pilot-vocal.vocal-reduced.vocal-state-listening .vocal-halo")).toMatch(
      /--vocal-halo:\s*0\.55/,
    );
    expect(CSS).toMatch(/\.pilot-vocal\.vocal-reduced \.vocal-halo,/);
  });
});

// ---------------------------------------------------------------------------
describe("5. reduction de mouvement : le MEME drapeau, aucun nouveau reglage (§4.3)", () => {
  const fauxWin = (reduce, flag) => ({
    matchMedia: () => ({ matches: reduce }),
    _pilotModalAnimations: flag,
  });

  it("sans `matchMedia` : aucune reduction (jamais d'exception)", () => {
    expect(vocalReducedMotion(null)).toBe(false);
    expect(vocalReducedMotion({})).toBe(false);
  });

  it("preference systeme active et parametre absent : on respecte", () => {
    expect(vocalReducedMotion(fauxWin(true, undefined))).toBe(true);
  });

  it("le parametre « Animer l'ouverture des modales » force les animations", () => {
    expect(vocalReducedMotion(fauxWin(true, true))).toBe(false);
  });

  it("preference inactive : rien ne change", () => {
    expect(vocalReducedMotion(fauxWin(false, undefined))).toBe(false);
  });

  it("le CSS ne fige plus aucun trait : la decision est partie avec lui", () => {
    // Les quatre largeurs figees (8 / 45 / 20 / 70 %) etaient celles du trait.
    // Plus de trait, plus de largeur : le halo, lui, garde sa valeur figee
    // lisible (0,55 en ecoute, verifiee par le test du lot B).
    for (const etat of ["idle", "listening", "thinking", "speaking"]) {
      expect(CSS).not.toMatch(
        new RegExp(`\\.pilot-vocal\\.vocal-reduced\\.vocal-state-${etat} \\.vocal-level-bar`),
      );
    }
    expect(CSS).toMatch(/--vocal-halo:\s*0\.55/);
    expect(CSS).toMatch(/\.pilot-vocal\.vocal-reduced[\s\S]{0,400}animation:\s*none/);
  });
});

// ---------------------------------------------------------------------------
describe("6. l'ecran ne montre RIEN de la conversation", () => {
  it("le contenu de l'ecran est l'objet, la ligne d'etat et la saisie", () => {
    const corps = corpsFonction(SUPER, "function buildVocalOverlay");
    expect(corps).toMatch(/vocal-orb/);
    expect(corps).toMatch(/vocal-status/);
    // Le trait a disparu le 12/11 : l'ecran nu n'a plus que l'objet et le mot.
    expect(corps).not.toMatch(/vocal-level/);
    // Jamais l'historique de la conversation : aucun conteneur de messages.
    expect(corps).not.toMatch(/message/i);
  });

  it("la ligne d'etat est annoncee aux lecteurs d'ecran (une seule, polie)", () => {
    expect(SUPER).toMatch(/vocal-status[\s\S]{0,200}role", "status"|role=?"status"/);
  });

  it("le bouton des modes est DEPLACE, jamais duplique", () => {
    expect(HTML.match(/id="mode-logo"/g) || []).toHaveLength(1);
    expect((SUPER.match(/SCREEN_MODE_BUTTON_ID/g) || []).length).toBeLessThan(12);
  });

  it("aucun second lecteur audio : la lecture reste celle de read-aloud.js", () => {
    // L'etat « Pilot parle » vient de l'evenement de read-aloud.js, et la
    // lecture du mode Vocal passe par le BOUTON de la reponse (aucune seconde
    // synthese creee pour cet ecran).
    expect(SUPER).toMatch(/READ_ALOUD_STATE_EVENT/);
    expect(SUPER).toMatch(/agent-read-btn/);
    const corps = corpsFonction(SUPER, "function autoReadVocalReply");
    expect(corps).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|\bspeak\(/);
  });

  it("la barre de saisie emportee garde son micro de dictee et son envoi", () => {
    // Elle est DEPLACEE telle quelle (§2.4) : on ne reconstruit rien, donc le
    // micro de dictee existant suit. Le micro d'ECOUTE du lot 3 vit dans
    // vocal-mic.js : aucune API micro n'entre dans ce fichier.
    expect(SUPER).not.toMatch(/getUserMedia|AudioContext|AnalyserNode|mediaDevices/);
    expect(SUPER).toMatch(/agent-mic-btn/);
  });
});

// ---------------------------------------------------------------------------
describe("7. jamais deux pleins ecrans superposes (§3.2)", () => {
  it("entrer en Vocal sort D'ABORD du mode assistant seul", () => {
    const corps = corpsFonction(SUPER, "function enterVocal");
    const sortie = corps.indexOf("exitImmersive()");
    const entree = corps.indexOf("document.body.appendChild(vocalOverlay)");
    expect(sortie).toBeGreaterThan(-1);
    expect(entree).toBeGreaterThan(sortie);
  });

  it("entrer dans l'immersif sort du Vocal (les deux sens sont couverts)", () => {
    const corps = corpsFonction(SUPER, "function enterImmersive");
    expect(corps).toMatch(/vocalOverlay[\s\S]{0,120}exitVocal\(\)/);
  });

  it("le raccourci Ctrl+Shift+A sort du Vocal au lieu d'empiler", () => {
    const corps = corpsFonction(SUPER, "const onImmersiveKeydown =");
    expect(corps).toMatch(/if \(vocalOverlay\)/);
    expect(corps).toMatch(/exitVocal\(\)/);
  });
});

// ---------------------------------------------------------------------------
describe("8. les trois sorties, et la restitution symetrique des noeuds", () => {
  it("1. le meme bouton de mode : le logo se pose a la meme place que dans l'autre plein ecran", () => {
    // Adaptation L4 : le bouton dedie et sa pastille « Vocal » ont disparu avec
    // les lots 1 a 3 du document de conception du logo-bouton (decision Q2 = A).
    // L'intention d'origine — « le mode Vocal a bien SON bouton de sortie, et
    // il ne saute pas d'un ecran a l'autre » — est conservee autrement : la
    // meme regle CSS porte les DEUX pleins ecrans, donc la meme place.
    const corps = bloc(CSS, "body.pilot-vocal-active #mode-logo");
    expect(corps).toMatch(/position:\s*absolute/);
    expect(corps).toMatch(/top:\s*8px/);
    expect(corps).toMatch(/left:\s*13px/);
    expect(CSS).toMatch(/body\.superagent-immersive-active #mode-logo,\nbody\.pilot-vocal-active #mode-logo \{/);
    // Plus aucune pastille de mode dans la feuille de style.
    expect(CSS).not.toContain(".screen-mode-dot");
    expect(CSS).not.toContain("#screen-mode-button");
  });

  it("2. Echap : un ecouteur dedie, qui cede la touche a une modale ouverte", () => {
    expect(SUPER).toMatch(/const onVocalKeydown = /);
    const corps = corpsFonction(SUPER, "const onVocalKeydown =");
    expect(corps).toMatch(/"Escape"|Escape/);
    expect(corps).toMatch(/exitVocal\(\)/);
    // Une modale ouverte garde Echap : elle est au-dessus de l'ecran.
    expect(corps).toMatch(/\.modal:not\(\.hidden\)/);
  });

  it("3. la fermeture de l'onglet arrete la lecture et sort du Vocal", () => {
    expect(SUPER).toMatch(/if \(vocalOverlay\) \{\n        stopReading\(\);\n        exitVocal\(\);/);
  });

  it("chaque noeud deplace est restitue a sa place exacte (parent + voisin)", () => {
    const corps = corpsFonction(SUPER, "function exitVocal");
    // Bouton des modes d'abord (sinon il serait detruit avec l'overlay)...
    const bouton = corps.indexOf("modeHome.parent.insertBefore(modeButton, next)");
    // ...puis la barre de saisie.
    const saisie = corps.indexOf("vocalInputHome.parent.insertBefore(inputBar, next)");
    expect(bouton).toBeGreaterThan(-1);
    expect(saisie).toBeGreaterThan(bouton);
  });

  it("le placeholder et la hauteur de la saisie reviennent comme avant", () => {
    expect(SUPER).toMatch(/vocalPlaceholderHome = inputEl\.placeholder/);
    expect(SUPER).toMatch(/inputEl\.placeholder = vocalPlaceholderHome/);
    // Plafond de saisie propre au mode Vocal, sans dupliquer le redimensionnement.
    expect(SUPER).toMatch(/function inputMaxHeight/);
    expect(bloc(CSS, ".vocal-input {")).toMatch(/width:\s*min\(720px/);
  });

  it("la barre de 44 px ne porte plus de bouton : c'est une bande de respiration", () => {
    // Adaptation L4 : l'ancien test verifiait la largeur AUTO du bouton dans
    // cette barre. La barre ne porte plus RIEN (le logo va dans l'overlay) ; ce
    // qui doit continuer a etre verifie, c'est sa geometrie — et son vide.
    const barre = bloc(CSS, ".vocal-top {");
    expect(barre).toMatch(/height:\s*44px/);
    expect(barre).toMatch(/margin-top:\s*var\(--window-controls-height\)/);
    // Aucune regle de bouton pour cette barre ne revient.
    expect(CSS).not.toContain("body.pilot-vocal-active #screen-mode-button");
    // Le balisage de la barre est VIDE : aucun noeud n'y est pose.
    const build = corpsFonction(SUPER, "function buildVocalOverlay");
    expect(build).toContain('<div class="vocal-top"></div>');
  });
});

// ---------------------------------------------------------------------------
describe("9. coordination avec la lecture et l'envoi (§3.3)", () => {
  it("ecrire / valider pendant que Pilot parle ARRETE la lecture, puis envoie", () => {
    const corps = corpsFonction(SUPER, "async function send()");
    const arret = corps.indexOf("if (vocalOverlay) stopReading();");
    expect(arret).toBeGreaterThan(-1);
    // L'arret est la PREMIERE chose faite : aucun envoi avant la coupure.
    const envoi = corps.indexOf("sendPrompt");
    if (envoi > -1) expect(arret).toBeLessThan(envoi);
  });

  it("la reponse est lue par la lecture EXISTANTE, une seule fois", () => {
    expect(SUPER).toContain("function autoReadVocalReply");
    const corps = corpsFonction(SUPER, "function autoReadVocalReply");
    // On CLIQUE le bouton de lecture de la derniere reponse : aucune seconde
    // lecture n'est creee.
    expect(corps).toMatch(/agent-read-btn/);
    expect(corps).toMatch(/click\(\)/);
    // Une lecture deja en cours n'est pas relancee.
    expect(corps).toMatch(/readState/);
  });

  it("hors du mode Vocal, la lecture automatique ne fait rien", () => {
    const corps = corpsFonction(SUPER, "function autoReadVocalReply");
    expect(corps).toMatch(/if \(!vocalOverlay\) return/);
  });

  it("aucune synthese vocale propre a l'ecran : la parole vient de la lecture existante", () => {
    // L'etat de l'ecran ne connait que trois sources, dans cet ordre : la
    // LECTURE (parole), le travail de l'assistant (reflexion) et le niveau du
    // micro (ecoute, lot 3) — et ce dernier n'est vrai que si le micro CAPTE.
    const corps = corpsFonction(SUPER, "function applyVocalState");
    expect(corps).toMatch(/speaking: vocalSpeaking/);
    expect(corps).toMatch(/reflecting: reflectingActive/);
    expect(corps).toMatch(/listening: vocalMicListening/);
    expect(corps).not.toMatch(/getUserMedia|AudioContext/);
    expect(SUPER).not.toMatch(/getUserMedia|AudioContext|AnalyserNode/);
    // Aucune reconnaissance de parole dans l'ecran : le niveau ne sert qu'a la
    // longueur du trait (la dictee garde son propre moteur dans la saisie).
    expect(corps).not.toMatch(/SpeechRecognition/);
  });

  it("LOT 4a : parler par-dessus la lecture l'ARRETE, par la seule voie existante", () => {
    // La COUPURE existe depuis le lot 4a, mais elle n'ajoute aucun lecteur :
    // l'arret emprunte `stopReading` (read-aloud.js), comme la sortie du mode.
    const corps = corpsFonction(SUPER, "function vocalBargeIn");
    expect(corps).toMatch(/stopReading\(\)/);
    expect(corps).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|new Audio\(/);
    // La decision vient de la GARDE du micro, jamais d'un seuil ecrit ici.
    expect(corps).not.toMatch(/getUserMedia|AudioContext|AnalyserNode|rmsOf|0\.0[0-9]/);
    // Hors mode Vocal : rien ne change pour les autres ecrans.
    expect(corps).toMatch(/if \(!vocalOverlay\) return;/);
    // Et pas de reprise automatique : couper ne relance aucune lecture.
    // LOT 4b : la garde « Pilot ne parle pas -> aucune coupure de lecture » est
    // desormais portee par la decision UNIQUE `vocalInterruptTarget` (parole >
    // reflexion > rien), qui dit exactement la meme chose pour la lecture. Un
    // seul endroit a lire, deux etats servis (voir
    // vocal-couper-la-reflexion.test.js).
    expect(corps).toMatch(
      /vocalInterruptTarget\(\{ speaking: vocalSpeaking, reflecting: reflectingActive \}\)/,
    );
    expect(corps).not.toMatch(/agent-read-btn|\.click\(\)/);
  });

  it("quitter l'ecran rend le silence : la voix lancee ici ne continue pas ailleurs", () => {
    const corps = corpsFonction(SUPER, "function exitVocal");
    expect(corps).toMatch(/if \(vocalSpeaking\) stopReading\(\);/);
    // Et l'arret passe par la SEULE voie existante (read-aloud.js) : aucune
    // synthese propre a cet ecran.
    expect(corps).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance/);
  });
});
