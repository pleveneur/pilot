// Tests — VERROU DU RELAIS D'UNE QUESTION D'AGENT DEPUIS L'ONGLET CHAT.
//
// TROU DE COUVERTURE (audit indépendant déjà rendu) : une question d'agent
// (`extension_ui_request` de l'extension `pilot-choices.ts`) remonte par TROIS
// voies, et une seule n'était tenue par AUCUN test :
//   - agents d'arrière-plan (bus)          → `agents-bus-questions-relais.test.js` ;
//   - surface de secours sans onglet 🧭    → `agent-question-surface.test.js` ;
//   - agent de l'ONGLET CHAT               → CE FICHIER (rien ne le tenait).
//
// Ce que fait `src/js/agent-pi.js` (branche `case "extension_ui_request"`,
// envoi vers la conversation de l'assistant, tâche de suivi #22) : quand
// l'onglet 🧭 Assistant est OUVERT *et* ACTIF, qu'aucune orchestration ne
// tourne et que la demande est relayable, l'évènement `AGENT_RELAY_EVENT` part
// avec la charge utile, l'agent et le projet, puis un `break` EMPÊCHE la
// peinture inline. Sinon `handleExtensionUiRequest(...)` peint les boutons dans
// l'onglet de l'agent.
//
// Défauts que ce verrou empêche de réintroduire :
//   - le `break` disparaît      → la question est relayée ET peinte sur place :
//                                 DEUX surfaces pour une seule question, deux
//                                 réponses concurrentes possibles ;
//   - la condition d'onglet actif est neutralisée → les boutons sont peints dans
//                                 un onglet que l'utilisateur ne regarde pas
//                                 (question invisible en pratique) ;
//   - une liste de types est recopiée dans la branche → la décision de la
//                                 source unique (`agent-choice-relay.js`) est
//                                 contournée : les portes internes (pré-écriture,
//                                 actions de l'assistant, contrôle de l'écran)
//                                 se remettent à remonter dans la conversation.
//
// Le COMPORTEMENT de `agent-pi.js` est correct : ce fichier ne verrouille que
// son BRANCHEMENT. Aucun doublon avec les deux verrous voisins — ils couvrent le
// bus et la surface de secours, jamais cette branche.
//
// Méthode : lecture de source (environnement de test `node`, sans jsdom, comme
// les autres verrous de branchement du dépôt). Tout découpage passe par
// `source-slice.js` (une ancre absente LÈVE au lieu de rendre un fragment vide,
// inventaire de `source-slice.test.js`), et toute lecture est normalisée en LF
// (quality-gate § 3.4 : runner Windows en CRLF).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { sliceSource, sliceFrom } from "./source-slice.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(resolve(here, p), "utf8").replace(/\r\n/g, "\n");

const AGENT_PI = read("agent-pi.js");

// ── Ancres de la branche (littérales, stables) ───────────────────────────────
const DEBUT_BRANCHE = '    case "extension_ui_request":\n';
const FIN_BRANCHE = '    case "model_change":\n';
/** Le SEUL appel de peinture inline des questions dans cette branche. */
const PEINTURE_INLINE = "      handleExtensionUiRequest(payload, messagesEl, state);";
const DEBUT_CONDITION = "      if (\n";
const FIN_CONDITION = "\n      ) {\n";
const DEBUT_ENVOI = "window.dispatchEvent(new CustomEvent(AGENT_RELAY_EVENT";
const FIN_ENVOI = "        break;\n";

// Découpages calculés À LA DEMANDE : une ancre qui disparaît fait échouer le
// TEST concerné (message explicite de `sliceSource`), pas le chargement du
// fichier — le rouge est ainsi lisible, cas par cas.
const branche = () => sliceSource(AGENT_PI, DEBUT_BRANCHE, FIN_BRANCHE, 200);
/** Bloc conditionnel + émission + `break`, jusqu'à la peinture inline. */
const relais = () => sliceSource(branche(), DEBUT_CONDITION, PEINTURE_INLINE, 200);
const condition = () => sliceSource(relais(), DEBUT_CONDITION, FIN_CONDITION, 120);
const envoi = () => sliceSource(relais(), DEBUT_ENVOI, FIN_ENVOI, 60);
const finDuRelais = () => sliceFrom(relais(), FIN_ENVOI, 5);

/** Position d'une ancre : ÉCHOUE si elle est absente (jamais −1 comparé à −1). */
function position(texte, ancre) {
  const i = texte.indexOf(ancre);
  expect(i, `ancre absente : ${ancre}`).toBeGreaterThan(-1);
  return i;
}

/** ÉCHOUE si `premier` n'est pas AVANT `second` (les deux doivent exister). */
function avant(texte, premier, second) {
  expect(position(texte, premier), `« ${premier} » doit précéder « ${second} »`).toBeLessThan(
    position(texte, second),
  );
}

const compte = (texte, aiguille) => texte.split(aiguille).length - 1;

/** Tous les modules JS de `src/js` (hors tests) qui DÉFINISSENT une fonction. */
function modulesQuiDefinissent(motif) {
  return readdirSync(here)
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .filter((f) => motif.test(read(f)))
    .sort();
}

describe("branche `extension_ui_request` — la décision vient de la SOURCE UNIQUE", () => {
  it("la fonction de décision n'est définie QU'à un endroit du dépôt", () => {
    // « Jamais une liste de types recopiée » : la même décision sert le bus et
    // l'onglet chat, elle ne peut pas exister en deux exemplaires.
    expect(modulesQuiDefinissent(/export function isRelayableAgentChoice/)).toEqual([
      "agent-choice-relay.js",
    ]);
  });

  it("la branche consulte `isRelayableAgentChoice(payload)`, une seule fois", () => {
    expect(compte(branche(), "isRelayableAgentChoice(payload)")).toBe(1);
  });

  it("aucune liste de types d'extension n'est recopiée dans la branche", () => {
    // Les trois types relayables ne sont PAS décidés ici : s'ils l'étaient, la
    // décision pourrait diverger de celle du bus (d'où le module unique).
    for (const methode of ["select", "confirm", "input"]) {
      expect(branche(), `type recopié dans la branche : ${methode}`).not.toMatch(
        new RegExp(`method\\s*===\\s*["'\`]${methode}["'\`]`),
      );
      expect(branche(), `liste de types recopiée : ${methode}`).not.toMatch(
        new RegExp(`["'\`]${methode}["'\`]\\s*\\.includes`),
      );
    }
    // …et les portes internes ne sont pas filtrées ici non plus (c'est la
    // source unique qui les exclut).
    expect(branche()).not.toContain("isInternalAgentGate");
    expect(branche()).not.toContain("EDIT_GATE_SENTINEL");
    expect(branche()).not.toContain("ASSISTANT_ACTION_SENTINEL");
    expect(branche()).not.toContain("SCREEN_GATE_SENTINEL");
  });
});

describe("branche `extension_ui_request` — les QUATRE conditions sont présentes ENSEMBLE", () => {
  it("onglet Assistant ouvert, pas d'orchestration, onglet actif, demande relayable", () => {
    const bloc = condition();
    expect(bloc).toContain("window._pilotSuperAgentOpen");
    expect(bloc).toContain("!state.orchestrationRunning");
    expect(bloc).toContain("isSuperAgentActiveTab()");
    expect(bloc).toContain("isRelayableAgentChoice(payload)");
  });

  it("elles sont TOUTES exigées : trois `&&`, aucun `||`", () => {
    // Un `||` suffirait à relayer sans l'une des quatre (typiquement sans
    // l'onglet actif) : la branche redeviendrait un relais inconditionnel.
    expect(compte(condition(), "&&")).toBe(3);
    expect(condition()).not.toContain("||");
  });

  it("« onglet actif » veut bien dire : l'onglet affiché est celui de l'assistant", () => {
    // La condition ne vaut que si l'utilisateur REGARDE la conversation de
    // l'assistant ; un helper vidé de son sens rendrait la condition toujours
    // vraie (peinture dans un onglet invisible).
    const helper = sliceSource(AGENT_PI, "function isSuperAgentActiveTab() {", "\n}\n", 60);
    expect(helper).toContain('window._pilotTabs?.getActiveTab?.()?.mode === "superagent"');
    // En cas de panne (pas d'onglet), la réponse par défaut est « pas actif ».
    expect(helper).toContain("return false;");
  });
});

describe("branche `extension_ui_request` — l'émission porte les trois informations du retour", () => {
  it("charge utile, identifiant de l'agent et chemin du projet", () => {
    const emit = envoi();
    expect(emit).toMatch(/detail:\s*\{/);
    // 1. la charge utile de la question (relayée telle quelle, sans réécriture) ;
    expect(emit).toContain("payload,");
    // 2. l'agent visé : la réponse devra revenir à CETTE session ;
    expect(emit).toContain('agentId: state.agentId || "default"');
    // 3. le projet courant : sans lui, la réponse ne retrouve pas la session.
    expect(emit).toContain("projectPath: window._pilotProjectPath || null");
  });

  it("l'émission utilise l'évènement PARTAGÉ, jamais un nom recopié", () => {
    expect(envoi()).toContain("new CustomEvent(AGENT_RELAY_EVENT,");
    // Aucun littéral d'évènement en dur dans la branche.
    expect(branche()).not.toContain('"pilot-agent-relay-request"');
  });
});

describe("branche `extension_ui_request` — le `break` empêche la double surface", () => {
  it("le `break` vient APRÈS l'émission et referme le bloc du relais", () => {
    avant(relais(), DEBUT_ENVOI, FIN_ENVOI);
    expect(compte(relais(), "break;")).toBe(1);
    // Le bloc conditionnel est refermé avant la peinture inline : celle-ci est
    // donc bien HORS du relais, et non un second porteur.
    expect(finDuRelais()).toContain("      }\n");
  });

  it("quand le relais a lieu, la peinture inline n'a PAS lieu dans la même branche", () => {
    // `relais()` s'arrête à l'appel de peinture : l'ordre exigé est
    // condition → émission → break → peinture. Sans le `break`, le bloc du
    // relais ne contiendrait plus son terminator et ce cas échoue.
    expect(relais()).not.toContain("handleExtensionUiRequest(payload, messagesEl, state)");
    avant(branche(), FIN_ENVOI, PEINTURE_INLINE);
    // Une seule peinture inline dans toute la branche : aucun double appel.
    expect(compte(branche(), PEINTURE_INLINE)).toBe(1);
  });
});

describe("branche `extension_ui_request` — le chemin de repli reste intact", () => {
  it("sans relais, la question est peinte dans l'onglet de l'agent", () => {
    expect(branche()).toContain(PEINTURE_INLINE);
    // L'appel est HORS du bloc du relais (donc atteint quand l'onglet 🧭 n'est
    // ni ouvert, ni actif, ou quand une orchestration tourne, ou quand la
    // demande est une porte interne).
    expect(finDuRelais()).not.toContain("handleExtensionUiRequest");
    avant(branche(), DEBUT_CONDITION, PEINTURE_INLINE);
  });

  it("la branche se termine par un `break` (aucune chute dans les cas suivants)", () => {
    const fin = sliceFrom(branche(), PEINTURE_INLINE, 5);
    expect(fin).toContain("break;");
  });

  it("le traitement des `notify` (statut du modèle) survit au relais", () => {
    // Non relayable et pourtant indispensable : il met à jour le sélecteur de
    // modèle AVANT la décision de relais — il ne doit pas être emporté par un
    // futur remaniement du bloc.
    expect(branche()).toContain('payload.method === "notify"');
    expect(branche()).toContain("state.currentModel = modelMatch[1];");
    avant(branche(), 'payload.method === "notify"', DEBUT_CONDITION);
  });
});
