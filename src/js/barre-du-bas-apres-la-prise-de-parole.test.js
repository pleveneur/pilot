// Tests — « la barre du bas s'efface de nouveau APRÈS une prise de parole ».
//
// DÉFAUT REPRODUIT (rapport `docs/rapports/RAPPORT-barre-du-bas-apres-la-prise-de-parole.md`,
// 2026-11-15) : la barre du bas s'effaçait bien au repos, mais dès que l'on
// prononçait une phrase elle réapparaissait et ne s'effaçait PLUS — même en
// arrêtant de parler, sans rien toucher.
//
// La cause n'était pas dans les quatre règles de `vocalChromeVisible` : elle
// était dans le BRANCHEMENT. Quand la demande dictée était mise EN FILE (le
// moteur travaille — cas explicitement prévu : la dictée est armée pendant un
// tour, `vocal-conversation.js` règle 8), la branche d'enfilage de `send()`
// sortait AVANT le vidage de la zone. Le texte transcrit restait donc dans le
// champ, et la règle 2 (« un champ rempli ne s'efface jamais », décision du
// propriétaire) interdisait le masquage POUR TOUJOURS.
//
// Ce que ce fichier verrouille :
//   1. la CONSÉQUENCE : champ rempli ⇒ le bas est retenu ; champ vidé ⇒
//      l'échéance du décompte efface. La règle 2 reste INTACTE (c'est elle qui
//      retenait : on ne la touche pas, on lui rend un champ honnête) ;
//   2. le BRANCHEMENT : dans `enfilerDemande`, le texte est d'abord PRIS (file),
//      puis la zone est vidée, puis l'écran est réappliqué — dans cet ordre ;
//   3. la NON-DUPLICATION : le vidage emploie les deux lignes du chemin normal,
//      sans minuteur, sans stockage, sans réglage ; la branche « file pleine »
//      (où rien n'est pris) garde le texte, elle, et le chemin normal n'a pas
//      bougé ;
//   4. de BOUT EN BOUT : après une phrase, la barre redevient effaçable ; sans
//      le correctif, elle resterait visible pour toujours (reproduction).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vocalChromeVisible } from "./vocal-chrome.js";
import { sliceSource } from "./source-slice.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
// Lecture NORMALISÉE (LF) : le runner CI Windows travaille en CRLF, et les
// ancres multi-lignes de ce fichier n'y survivraient pas.
const SUPER = fs
  .readFileSync(path.join(ICI, "super-agent.js"), "utf8")
  .replace(/\r\n/g, "\n");
const CHROME = fs
  .readFileSync(path.join(ICI, "vocal-chrome.js"), "utf8")
  .replace(/\r\n/g, "\n");

// Les faits d'un écran Vocal AU REPOS : aucune panne, aucune question, pointeur
// ailleurs et décompte écoulé. Seul le contenu du champ change d'un cas à l'autre.
function faitsRepos(texteDuChamp) {
  return {
    question: false,
    saisie: String(texteDuChamp || "").trim() !== "",
    micFerme: "",
    pointeurActif: false,
    pointeurGeste: false,
  };
}

// ── 1. La conséquence : c'est bien le champ rempli qui retenait le bas ──────
describe("1. le champ est la seule chose qui retenait le bas après une parole", () => {
  it("un champ rempli retient le bas — la règle 2 est INTACTE (décision du propriétaire)", () => {
    expect(vocalChromeVisible(faitsRepos("ouvre le fichier spec"))).toBe(true);
    // La règle 2 n'a pas été touchée par le correctif : la retenue reste, telle
    // quelle. Un correctif qui l'aurait assouplie changerait la décision, pas le
    // branchement — et ce test le refuserait.
    expect(CHROME).toContain("if (f.saisie === true) return true;");
  });

  it("un champ vidé n'interdit plus l'effacement : l'échéance du décompte efface", () => {
    expect(vocalChromeVisible(faitsRepos(""))).toBe(false);
    expect(vocalChromeVisible(faitsRepos("   \n\t "))).toBe(false);
  });

  it("aucun état de conversation ne peut retenir le bas à la place du champ", () => {
    // Parole, réflexion, écoute : aucun fait de ce genre n'est transmis. Les
    // cinq faits sont ceux du 2026-11-13 — le correctif ne change RIEN à la
    // décision, il lui rend seulement un champ vidé.
    const faits = sliceSource(SUPER, "const faits = {", "// LA ZONE DE SAISIE NE DEPEND PAS", 200);
    const cles = Array.from(faits.matchAll(/^ {6}([a-zA-Z]+):/gm), (m) => m[1]);
    expect(cles).toEqual([
      "question",
      "saisie",
      "micFerme",
      "pointeurActif",
      "pointeurGeste",
    ]);
    expect(faits).toContain('saisie: texte.trim() !== ""');
    expect(faits).toContain("micFerme: vocalMicFerme");
    expect(faits).toContain("question: hasPendingQuestion()");
  });
});

// ── 2. Le branchement : la demande PRISE libère la zone ─────────────────────
describe("2. une demande mise en file ne laisse pas son texte dans le champ", () => {
  const ENFILER = sliceSource(SUPER, "function enfilerDemande(text) {", "\n  }", 200);

  it("le texte est d'abord PRIS (file), la zone est vidée ENSUITE", () => {
    const iFile = ENFILER.indexOf("demandesEnAttente = [...demandesEnAttente, text]");
    const iVide = ENFILER.indexOf('inputEl.value = ""');
    expect(iFile).toBeGreaterThan(-1);
    expect(iVide).toBeGreaterThan(-1);
    // Rien n'est perdu : le texte vit dans la file AVANT d'être effacé de la zone.
    expect(iVide).toBeGreaterThan(iFile);
  });

  it("la zone est vidée AVANT que l'écran ne soit réappliqué", () => {
    // Sans cet ordre, `applyVocalState` relirait un champ encore rempli et la
    // décision continuerait de retenir le bas : le correctif ne servirait à rien.
    const iVide = ENFILER.indexOf('inputEl.value = ""');
    const iEtat = ENFILER.indexOf("applyVocalState();");
    expect(iEtat).toBeGreaterThan(-1);
    expect(iVide).toBeLessThan(iEtat);
  });

  it("le vidage est celui du chemin normal : mêmes deux lignes, aucun autre mécanisme", () => {
    expect(ENFILER).toContain('inputEl.value = "";\n    inputEl.style.height = "auto";');
    // Aucun second minuteur, aucun stockage, aucun réglage : le défaut venait
    // d'un ordre de lignes, il se répare par un ordre de lignes.
    expect(ENFILER).not.toMatch(
      /setTimeout|setInterval|requestAnimationFrame|localStorage|sessionStorage|get_config|save_config|invoke\(/,
    );
  });

  it("le chemin d'envoi normal vide toujours la zone (mécanisme existant, inchangé)", () => {
    const envoi = sliceSource(
      SUPER,
      "const messageAgent = composeVocalPrompt(",
      "const userBubble = appendMessage(",
      100,
    );
    expect(envoi).toContain('inputEl.value = ""');
    expect(envoi).toContain('inputEl.style.height = "auto"');
  });

  it("la file PLEINE, elle, garde le texte dans la zone (rien n'est pris)", () => {
    const refus = sliceSource(
      SUPER,
      "if (decisionDemande.action === DEMANDE_REFUSEE) {",
      "if (voiceActive) stopVoiceInput();",
      100,
    );
    expect(refus).toContain("MESSAGE_DEMANDE_FILE_PLEINE");
    expect(refus).not.toContain('inputEl.value = ""');
  });

  it("la branche d'enfilage de `send` ne peut pas sortir sans libérer la zone", () => {
    const enfilage = sliceSource(
      SUPER,
      "if (decisionDemande.action === DEMANDE_ENFILER) {",
      "if (decisionDemande.action === DEMANDE_REFUSEE) {",
      80,
    );
    expect(enfilage).toContain("enfilerDemande(text);");
    expect(enfilage).toContain("return;");
    // Le seul vidage possible est donc celui de `enfilerDemande` : c'est pour
    // cela que le test ci-dessus le tient.
    expect(enfilage).not.toContain('inputEl.value = ""');
  });
});

// ── 3. Bout en bout : après une phrase, la barre redevient effaçable ────────
describe("3. après une prise de parole terminée, le bas peut s'effacer de nouveau", () => {
  // Reproduit la suite RÉELLE, sans DOM : l'utilisateur parle (le moteur écrit le
  // texte dans le champ), l'échéance du silence envoie la demande pendant que
  // l'Assistant travaille, la demande est PRISE dans la file — puis les 10 000 ms
  // du décompte s'écoulent et la décision reprend la main.
  function apresUnePhrase({ videLaZone }) {
    let champ = "ouvre le fichier spec"; // `rec.onresult` a écrit la transcription
    const file = [];
    file.push(champ); // `enfilerDemande` : le texte est PRIS, rien n'est perdu
    // `videLaZone` = le correctif : la zone est libérée parce que le texte est pris.
    if (videLaZone) champ = "";
    return { visible: vocalChromeVisible(faitsRepos(champ)), file, champ };
  }

  it("avec le correctif : le décompte écoulé EFFACE le bas, la demande est en file", () => {
    const apres = apresUnePhrase({ videLaZone: true });
    expect(apres.file).toEqual(["ouvre le fichier spec"]); // rien n'est perdu
    expect(apres.champ).toBe(""); // le champ est libre
    expect(apres.visible).toBe(false); // le bas s'efface
  });

  it("sans le correctif, le texte resté dans le champ retient le bas POUR TOUJOURS", () => {
    // C'est la reproduction du symptôme rapporté : la demande est bien prise,
    // mais le champ garde son texte, donc chaque échéance du décompte se fait
    // refuser — indéfiniment, sans qu'aucun geste ne soit nécessaire.
    const apres = apresUnePhrase({ videLaZone: false });
    expect(apres.file).toEqual(["ouvre le fichier spec"]); // la demande est partie
    expect(apres.champ).toBe("ouvre le fichier spec"); // … le texte est resté
    expect(apres.visible).toBe(true); // … et le bas ne s'efface plus
  });
});

// ── 4. La preuve du défaut, écrite une seule fois et sans détour ────────────
describe("4. reproduction du défaut (le champ garde le texte de la dictée)", () => {
  it("un champ qui garde le texte interdit le masquage à CHAQUE échéance", () => {
    // Trois échéances de suite, comme trois minutes sans rien toucher : la
    // décision répond la même chose, parce que la règle 2 n'a pas d'horloge.
    const champRempli = "ouvre le fichier spec";
    for (let echeance = 0; echeance < 3; echeance += 1) {
      expect(vocalChromeVisible(faitsRepos(champRempli))).toBe(true);
    }
    // Une fois la zone libérée (le correctif), la même échéance efface.
    expect(vocalChromeVisible(faitsRepos(""))).toBe(false);
  });
});
