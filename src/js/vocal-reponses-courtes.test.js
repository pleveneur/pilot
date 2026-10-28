// Tests — EN MODE VOCAL, PILOT PARLE COURT
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le mode Vocal ajoute UNE consigne a la demande envoyee a l'agent :
//      repondre en DEUX phrases exactement (defaut « courtes », longueur arretee
//      par le proprietaire), pas de listes, pas de titres, pas de noms de
//      fichiers, pas de code, aller droit a l'utile a dire a voix haute — et
//      developper si l'utilisateur le demande explicitement
//      (« detaille », « explique », « pourquoi », « comment »).
//   2. La consigne est ajoutee a UN SEUL endroit (le point de composition de la
//      demande de l'ecran Vocal, `send()` de super-agent.js) et nulle part
//      ailleurs : le chat ecrit et l'onglet Assistant gardent leurs reponses
//      actuelles (aucun autre ecran ne change de comportement).
//   3. La brievete vient de la CONSIGNE, jamais d'une coupe : aucune troncature,
//      aucune limite de caracteres, la demande de l'utilisateur reste intacte.
//   4. Les cas de SECURITE (panne, refus, erreur de micro, demande de
//      confirmation) sont exclus EXPLICITEMENT dans la consigne : ils restent
//      entierement dits.
//   5. Aucun autre reglage, aucun bouton : la LONGUEUR des reponses, elle, se
//      regle depuis le 2026-10-27 (quatre niveaux, « courtes » par defaut) —
//      voir `vocal-longueur-reglable.test.js`. Ce fichier verifie seulement que
//      le module de consigne reste PUR (ni DOM, ni configuration, ni etat) et
//      que le defaut demande DEUX phrases exactement.
//
// Les commentaires sont en ASCII ; les chaines qui viennent du code sont
// copiees telles quelles. Les fins de ligne sont normalisees (quality-gate 3.4).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import { VOCAL_BREVITY_INSTRUCTION, composeVocalPrompt } from "./vocal-brevity.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const MODULE = lire("src/js/vocal-brevity.js");
const SUPER = lire("src/js/super-agent.js");
const AGENT_PI = lire("src/js/agent-pi.js");
const RUST = lire("src-tauri/src/super_agent.rs");
const SPEC_VOCAL = lire("spec_modes_ecran_vocal.md");
const HELP = lire("help/overview.md");
const HANDBOOK = lire("help/handbook.md");

/** Corps de `send()` (ancre de fin : la fonction suivante du fichier). */
function corpsSend() {
  return sliceSource(
    SUPER,
    "  async function send() {",
    "  // ── Bouton « Analyser et ranger mes données »",
    1000
  );
}

/** Tous les modules de l'application (hors tests). */
function modulesApp() {
  return readdirSync(ICI)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => ({ nom: f, src: lire(`src/js/${f}`) }));
}

// ── 1. La consigne : ce qu'elle demande, mot pour mot ─────────────────────
describe("la consigne de conversation parlee", () => {
  it("demande DEUX phrases, le nombre exact retenu", () => {
    expect(VOCAL_BREVITY_INSTRUCTION).toMatch(/DEUX phrases/);
    expect(VOCAL_BREVITY_INSTRUCTION).toMatch(/exactement deux, pas trois/);
    // Aucune ancienne fourchette ne subsiste dans le defaut.
    expect(VOCAL_BREVITY_INSTRUCTION).not.toMatch(/TROIS PHRASES/);
    expect(VOCAL_BREVITY_INSTRUCTION).not.toMatch(/AU PLUS/);
  });

  it("interdit listes, titres, tableaux, noms de fichiers et code", () => {
    const consigne = VOCAL_BREVITY_INSTRUCTION;
    expect(consigne).toMatch(/Pas de listes/);
    expect(consigne).toMatch(/pas de titres/);
    expect(consigne).toMatch(/pas de tableaux/);
    expect(consigne).toMatch(/pas de noms de fichiers/);
    expect(consigne).toMatch(/pas de code/);
  });

  it("dit d'aller droit a ce qui est utile a dire a voix haute", () => {
    expect(VOCAL_BREVITY_INSTRUCTION).toMatch(/utile à dire à voix haute/);
  });

  it("developpe seulement si l'utilisateur le demande, avec ses mots", () => {
    const consigne = VOCAL_BREVITY_INSTRUCTION;
    for (const mot of ["détaille", "explique", "pourquoi", "comment"]) {
      expect(consigne, mot).toContain(mot);
    }
    expect(consigne).toMatch(/demande explicitement de développer/);
    // Developper reste une reponse PARLEE : comprehensible a l'oreille.
    expect(consigne).toMatch(/compréhensible à l'oreille/);
  });

  it("exclut EXPLICITEMENT les cas de securite du regime court", () => {
    const consigne = VOCAL_BREVITY_INSTRUCTION;
    for (const cas of ["panne", "refus", "erreur", "micro", "demande de confirmation"]) {
      expect(consigne, cas).toContain(cas);
    }
    // L'exception passe AVANT la brievete, et elle est dite en entier.
    expect(consigne).toMatch(/AVANT la brièveté/);
    expect(consigne).toMatch(/ENTIÈREMENT/);
  });
});

// ── 2. La composition : point unique, texte de l'utilisateur intact ───────
describe("composeVocalPrompt : la consigne seulement pour l'ecran Vocal", () => {
  it("en mode Vocal : la demande est SUIVIE de la consigne, en tete intacte", () => {
    const demande = "Où en est le projet Pilot ?";
    const message = composeVocalPrompt(demande, { modeVocal: true });
    // La demande de l'utilisateur est conservee MOT POUR MOT en tete.
    expect(message.startsWith(demande)).toBe(true);
    expect(message).toBe(`${demande}\n\n${VOCAL_BREVITY_INSTRUCTION}`);
    // Une seule consigne, jamais deux.
    expect(message.split("## Mode vocal").length).toBe(2);
  });

  it("hors du mode Vocal : le texte revient INCHANGE (chat ecrit et Assistant)", () => {
    const demande = "Où en est le projet Pilot ?";
    expect(composeVocalPrompt(demande, { modeVocal: false })).toBe(demande);
    expect(composeVocalPrompt(demande)).toBe(demande);
    expect(composeVocalPrompt(demande, {})).toBe(demande);
    expect(composeVocalPrompt(demande, null)).toBe(demande);
    // Aucune trace de la consigne dans le chemin ecrit.
    expect(composeVocalPrompt(demande)).not.toContain("Mode vocal");
  });

  it("une demande vide ne recoit rien (aucune consigne orpheline)", () => {
    for (const vide of ["", "   ", "\n\n", null, undefined, 42]) {
      expect(composeVocalPrompt(vide, { modeVocal: true })).toBe(
        typeof vide === "string" ? vide : ""
      );
    }
  });

  it("AUCUNE COUPE : rien du texte n'est perdu, aucune limite de caracteres", () => {
    const longue = "mot ".repeat(4000).trim();
    const message = composeVocalPrompt(longue, { modeVocal: true });
    // Tout le texte est la (longueur totale = demande + separateur + consigne).
    expect(message.length).toBe(longue.length + 2 + VOCAL_BREVITY_INSTRUCTION.length);
    expect(message.slice(0, longue.length)).toBe(longue);
    // Le module ne coupe rien : aucune primitive de troncature, aucun plafond.
    const code = MODULE.split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(code).not.toContain(".slice(");
    expect(code).not.toContain(".substring(");
    expect(code).not.toContain(".substr(");
    expect(code).not.toMatch(/MAX_[A-Z_]*CHARS/);
    expect(code).not.toMatch(/\.length\s*>\s*\d/);
  });
});

// ── 3. Le cablage : un seul point d'application ──────────────────────────
describe("cablage : la consigne n'est ajoutee qu'au point de composition vocal", () => {
  it("la consigne et son assemblage sont IMPORTES, jamais recopies", () => {
    expect(SUPER).toContain(
      'import { composeVocalPrompt, normalizeVocalBrevityLevel } from "./vocal-brevity.js";'
    );
    expect(SUPER).not.toContain("export function composeVocalPrompt");
    expect(SUPER).not.toContain("export const VOCAL_BREVITY_INSTRUCTION");
    // Le texte de la consigne n'est ecrit que dans son module.
    expect(SUPER).not.toContain("DEUX phrases, exactement deux");
    expect(AGENT_PI).not.toContain("DEUX phrases, exactement deux");
    expect(RUST).not.toContain("DEUX phrases, exactement deux");
    expect(RUST).not.toContain("Mode vocal — parler court");
  });

  it("il n'y a qu'UN appel dans toute l'application (super-agent.js)", () => {
    const appels = modulesApp()
      .filter(({ nom }) => nom !== "vocal-brevity.js")
      .flatMap(({ nom, src }) => (src.match(/composeVocalPrompt\(/g) || []).map(() => nom));
    expect(appels).toEqual(["super-agent.js"]);
    // Le module ne fait que DEFINIR l'assemblage : une seule definition.
    expect((MODULE.match(/export function composeVocalPrompt\(/g) || [])).toHaveLength(1);
  });

  it("`send()` marque la provenance (ecran Vocal) et envoie le message compose", () => {
    const send = corpsSend();
    expect(send).toContain(
      "const messageAgent = composeVocalPrompt(text, {\n      modeVocal: vocalOverlay !== null,\n      niveau: vocalLongueurNiveau,\n    });"
    );
    // Le message ENVOYE a l'agent est le message compose...
    expect(send).toContain('await invoke("send_super_agent_prompt", { message: messageAgent });');
    // ...et le texte de l'utilisateur n'est PAS envoye a la place.
    expect(send).not.toContain('{ message: text }');
    // La bulle et les badges gardent le texte de l'utilisateur tel qu'il l'a dit.
    expect(send).toContain('appendMessage(messagesEl, "user", text);');
    expect(send).toContain("collectBubbleBadgeProjects(text)");
  });

  it("la provenance est l'ecran Vocal REEL, pas un drapeau parallele", () => {
    // `vocalOverlay` est la seule marque « le mode Vocal est affiche » ; la
    // consigne ne peut donc pas fuir vers le chat ecrit.
    expect(SUPER).toContain("let vocalOverlay = null;");
    expect(corpsSend()).toContain("vocalOverlay !== null");
    expect(corpsSend()).not.toMatch(/localStorage|read_aloud_|vocalBrevity/);
  });

  it("aucun second chemin de prompt pour le mode Vocal n'a ete cree", () => {
    // Un seul envoi vers la session de l'assistant, un seul invoke.
    expect((SUPER.match(/"send_super_agent_prompt"/g) || [])).toHaveLength(1);
    // Aucun second composeur de message dans les modules de l'ecran Vocal.
    const vocab = ["vocal-conversation.js", "vocal-mic.js", "voice-auto-send.js"];
    for (const nom of vocab) {
      const src = lire(`src/js/${nom}`);
      expect(src, nom).not.toContain("composeVocalPrompt");
      expect(src, nom).not.toContain("Mode vocal — parler court");
    }
  });

  it("le module de consigne reste PUR : ni DOM, ni configuration, ni etat", () => {
    expect(MODULE).not.toContain("localStorage");
    expect(MODULE).not.toContain("document.");
    expect(MODULE).not.toContain("read_aloud_");
    // Le module est PUR : ni DOM, ni invoke, ni etat.
    expect(MODULE).not.toContain("invoke(");
    expect(MODULE).not.toContain("window.");
    // Le reglage est lu par l'ecran (super-agent.js) et ecrit par les Parametres
    // (settings.js) : la cle de configuration n'est pas dans le module pur.
    expect(MODULE).not.toContain("vocal_brevity_level");
  });
});

// ── 4. La documentation dit la verite ────────────────────────────────────
describe("documentation : la spec et l'aide disent la regle", () => {
  it("la spec du mode Vocal nomme la consigne et son point unique", () => {
    expect(SPEC_VOCAL).toMatch(/parle court/i);
    expect(SPEC_VOCAL).toContain("src/js/vocal-brevity.js");
    expect(SPEC_VOCAL).toContain("composeVocalPrompt");
    expect(SPEC_VOCAL).toMatch(/aucune troncature|jamais tronqu/i);
  });

  it("l'aide embarquee le dit en langage utilisateur (source puis handbook)", () => {
    expect(HELP).toMatch(/deux phrases/i);
    expect(HANDBOOK).toMatch(/deux phrases/i);
  });
});
