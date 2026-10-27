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
//   6. Le lot 2 ne fait pas le lot 3 (aucun micro) ni le lot 4 (aucune coupure
//      de la parole par la voix) : le trait de niveau reste inerte a 8 %.
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
  it("le disque fait 168 px, en anneau plein de 2 px + remplissage radial", () => {
    const corps = bloc(CSS, ".vocal-orb {");
    expect(corps).toMatch(/width:\s*168px/);
    expect(corps).toMatch(/height:\s*168px/);
    expect(corps).toMatch(/border-radius:\s*50%/);
    expect(corps).toMatch(/border:\s*2px solid var\(--vocal-state/);
    expect(corps).toMatch(/radial-gradient\(/);
    expect(corps).toMatch(/18%/);
  });

  it("le trait du niveau fait 200 x 3 px, rayon 2 px", () => {
    const zone = bloc(CSS, ".vocal-level {");
    expect(zone).toMatch(/width:\s*200px/);
    expect(zone).toMatch(/height:\s*3px/);
    const barre = bloc(CSS, ".vocal-level-bar");
    expect(barre).toMatch(/height:\s*3px/);
    expect(barre).toMatch(/border-radius:\s*2px/);
  });

  it("le trait est a 24 px du disque (le meme ecart pour toute la pile)", () => {
    expect(bloc(CSS, ".vocal-stage")).toMatch(/gap:\s*24px/);
  });

  it("LOT 2 : sans micro, le trait d'ecoute reste au silence (8 %)", () => {
    expect(bloc(CSS, ".pilot-vocal.vocal-state-listening .vocal-level-bar")).toMatch(
      /width:\s*8%/,
    );
    // Aucun niveau invente : la seule source serait le micro, absent au lot 2.
    expect(SUPER).not.toMatch(/getUserMedia|AudioContext|mediaDevices/);
  });

  it("aucune couleur en dur dans les etats : uniquement --vocal-state", () => {
    for (const sel of [
      ".vocal-orb {",
      ".vocal-level-bar",
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

  it("le CSS fige alors le trait : 8 / 45 / 20 / 70 %, sans animation", () => {
    const attendus = [
      ["idle", "8%"],
      ["listening", "45%"],
      ["thinking", "20%"],
      ["speaking", "70%"],
    ];
    for (const [etat, largeur] of attendus) {
      expect(
        bloc(CSS, `.pilot-vocal.vocal-reduced.vocal-state-${etat} .vocal-level-bar`),
      ).toMatch(new RegExp(`width:\\s*${largeur}`));
    }
    expect(CSS).toMatch(/\.pilot-vocal\.vocal-reduced[\s\S]{0,400}animation:\s*none/);
  });
});

// ---------------------------------------------------------------------------
describe("6. l'ecran ne montre RIEN de la conversation", () => {
  it("le contenu de l'ecran est l'objet, le trait, la ligne d'etat et la saisie", () => {
    const corps = corpsFonction(SUPER, "function buildVocalOverlay");
    expect(corps).toMatch(/vocal-orb/);
    expect(corps).toMatch(/vocal-level/);
    expect(corps).toMatch(/vocal-status/);
    // Jamais l'historique de la conversation : aucun conteneur de messages.
    expect(corps).not.toMatch(/message/i);
  });

  it("la ligne d'etat est annoncee aux lecteurs d'ecran (une seule, polie)", () => {
    expect(SUPER).toMatch(/vocal-status[\s\S]{0,200}role", "status"|role=?"status"/);
  });

  it("le bouton des modes est DEPLACE, jamais duplique", () => {
    expect(HTML.match(/id="screen-mode-button"/g) || []).toHaveLength(1);
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
    // micro de dictee existant suit. Aucun micro d'ECOUTE n'est ajoute au lot 2.
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
  it("1. le meme bouton de mode : la pastille « Vocal » est celle du lot 1", () => {
    expect(CSS).toMatch(
      /#screen-mode-button\[data-screen-mode="vocal"\] \.screen-mode-dot\s*\{[^}]*var\(--vocal-listen/,
    );
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

  it("le bouton des modes repasse en largeur AUTO dans la barre de 44 px", () => {
    const corps = bloc(CSS, "body.pilot-vocal-active #screen-mode-button");
    expect(corps).toMatch(/width:\s*auto/);
    const barre = bloc(CSS, ".vocal-top {");
    expect(barre).toMatch(/height:\s*44px/);
    expect(barre).toMatch(/margin-top:\s*var\(--window-controls-height\)/);
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

  it("aucune coupure de la parole par la voix (lot 4) : l'etat vient de la lecture seule", () => {
    // L'etat de l'ecran ne connait que deux sources : la LECTURE (parole) et le
    // travail de l'assistant (reflexion). Rien n'ecoute le micro : le lot 4
    // (« couper Pilot en parlant ») n'est donc ni fait ni simule ici.
    const corps = corpsFonction(SUPER, "function applyVocalState");
    expect(corps).toMatch(/vocalScreenState\(\{ speaking: vocalSpeaking, reflecting: reflectingActive \}\)/);
    expect(corps).not.toMatch(/micro|getUserMedia|AudioContext/);
    expect(SUPER).not.toMatch(/getUserMedia|AudioContext|AnalyserNode/);
  });

  it("quitter l'ecran rend le silence : la voix lancee ici ne continue pas ailleurs", () => {
    const corps = corpsFonction(SUPER, "function exitVocal");
    expect(corps).toMatch(/if \(vocalSpeaking\) stopReading\(\);/);
    // Et l'arret passe par la SEULE voie existante (read-aloud.js) : aucune
    // synthese propre a cet ecran.
    expect(corps).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance/);
  });
});
