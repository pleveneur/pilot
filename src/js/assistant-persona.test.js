// Tests — NOM ET PORTRAIT DU PERSONNAGE ACTIF DE L'ASSISTANT
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. `nom.txt` PRESENT → l'Assistant affiche le nom du personnage.
//   2. `nom.txt` ABSENT (ou vide / illisible) → il garde son nom habituel.
//      L'absence n'est pas une panne : aucune exception, aucun message.
//   3. `portrait.png` PRESENT → le portrait est affiché (data: URL).
//   4. `portrait.png` ABSENT (ou invalide) → l'icône habituelle (🧭).
//   5. Une reponse inattendue du socle (forme bizarre, commande absente, IPC en
//      echec) ne leve JAMAIS : elle donne le repli.
//   6. Les BRANCHEMENTS existent reellement : le nom affiche passe par
//      `superAgentDisplayLabel` (priorite au personnage), le bouton d'onglet
//      utilise le portrait a la place de 🧭, et le personnage est RELU a
//      l'ouverture de l'onglet ET au retour de focus (avec retrait de
//      l'ecouteur a la fermeture de l'onglet).
//   7. Pilot ne fait que LIRE : le module ne contient aucune ecriture ni
//      creation de dossier (le dossier appartient a Presences).
//
// Les commentaires sont en ASCII. Les chaines qui viennent du code sont
// copiees telles quelles.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  DEFAULT_ASSISTANT_ICON,
  DEFAULT_ASSISTANT_NAME,
  PERSONA_IMAGE_FILE,
  PERSONA_NAME_FILE,
  PERSONA_NAME_MAX_CHARS,
  getAssistantPersona,
  getAssistantPersonaName,
  getAssistantPortrait,
  normalizePersona,
  normalizePersonaName,
  personaDirFor,
  personaDisplayName,
  personaPortraitSrc,
  refreshAssistantPersona,
  resetAssistantPersona,
  setAssistantPersona,
} from "./assistant-persona.js";

const ICI = dirname(fileURLToPath(import.meta.url));

function lireSource(rel) {
  return readFileSync(join(ICI, rel), "utf8").replace(/\r\n/g, "\n");
}

// PNG minimal (signature + premier morceau IHDR) : suffisant pour l'affichage.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wD/6Bb2AAAAAElFTkSuQmCC";
const DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

beforeEach(() => {
  resetAssistantPersona();
});

// ── 1. Le contrat du dossier ────────────────────────────────────────────────
describe("dossier lu (contrat de Presences)", () => {
  it("le dossier est <donnees de Pilot>/.pilot/portrait, avec les noms de fichiers fixes", () => {
    expect(personaDirFor("C:\\Users\\moi\\AppData\\Roaming\\com.pilot.editor")).toBe(
      "C:/Users/moi/AppData/Roaming/com.pilot.editor/.pilot/portrait",
    );
    expect(personaDirFor("/home/moi/.local/share/com.pilot.editor/")).toBe(
      "/home/moi/.local/share/com.pilot.editor/.pilot/portrait",
    );
    // Aucun dossier de donnees : chemin logique du contrat, jamais une exception.
    expect(personaDirFor("")).toBe(".pilot/portrait");
    expect(personaDirFor(null)).toBe(".pilot/portrait");
    expect(PERSONA_NAME_FILE).toBe("nom.txt");
    expect(PERSONA_IMAGE_FILE).toBe("portrait.png");
  });

  it("la lecture reelle est cote Rust (une seule autorite, aucun second mecanisme)", () => {
    const src = lireSource("./assistant-persona.js");
    expect(src).toContain('call("read_assistant_persona")');
    // Aucune ecriture, aucune creation de dossier : Pilot ne fait que LIRE.
    // (Les commentaires sont retires pour ne pas compter la prose du contrat.)
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    for (const interdit of ["writeTextFile", "writeFile", "createDir", "removeDir", "mkdir", "fs."]) {
      expect(code).not.toContain(interdit);
    }
  });
});

// ── 2. Le NOM : present → affiche ; absent → habituel ───────────────────────
describe("nom du personnage", () => {
  it("nom.txt present : le nom du personnage est retenu et affiche", () => {
    const etat = setAssistantPersona({ name: "Aurelia\n", portrait: null });
    expect(etat.name).toBe("Aurelia");
    expect(getAssistantPersonaName()).toBe("Aurelia");
    // `superAgentDisplayLabel` prefere le personnage au nom regle.
    expect(personaDisplayName(getAssistantPersonaName(), "Mon assistant")).toBe("Aurelia");
  });

  it("nom.txt absent : le nom habituel est conserve (repli)", () => {
    setAssistantPersona({ name: null, portrait: null });
    expect(getAssistantPersonaName()).toBe("");
    expect(personaDisplayName(getAssistantPersonaName(), "")).toBe(DEFAULT_ASSISTANT_NAME);
    expect(personaDisplayName(getAssistantPersonaName(), "Mon assistant")).toBe("Mon assistant");
  });

  it("nom vide, blanc ou de controle seul : repli, jamais un nom fantome", () => {
    expect(normalizePersonaName("")).toBe("");
    expect(normalizePersonaName("   \n\t\n ")).toBe("");
    expect(normalizePersonaName("\u0000\u0007")).toBe("");
    expect(normalizePersonaName(null)).toBe("");
    expect(normalizePersonaName(42)).toBe("");
    expect(setAssistantPersona({ name: "  \n", portrait: null }).name).toBe("");
  });

  it("contenu illisible ou trop long : repli borne, jamais une exception", () => {
    // Valeur d'une autre forme que celle du socle : repli silencieux.
    expect(normalizePersona({ name: { pas: "un nom" } })).toEqual({ name: "", portrait: "" });
    expect(normalizePersona("texte")).toEqual({ name: "", portrait: "" });
    expect(normalizePersona(null)).toEqual({ name: "", portrait: "" });
    // Nom demesure : tronque a la borne du contrat, sans casser le rendu.
    const long = "A".repeat(PERSONA_NAME_MAX_CHARS + 50);
    expect(normalizePersonaName(long).length).toBe(PERSONA_NAME_MAX_CHARS);
    // Premiere ligne utile seulement (un editeur Windows peut laisser un vide).
    expect(normalizePersonaName("\r\n  Aurelia  \r\nDeuxieme")).toBe("Aurelia");
    // Le nom du personnage garde la priorite sur le nom regle, et un nom regle
    // vide ne produit jamais un onglet sans nom.
    expect(personaDisplayName("  Aurelia ", "Mon assistant")).toBe("Aurelia");
    expect(personaDisplayName("", "   ")).toBe(DEFAULT_ASSISTANT_NAME);
  });
});

// ── 3. Le PORTRAIT : present → image ; absent → icone habituelle ────────────
describe("portrait du personnage", () => {
  it("portrait.png present : l'image est affichee a la place de l'icone", () => {
    const etat = setAssistantPersona({ name: "Aurelia", portrait: DATA_URL });
    expect(etat.portrait).toBe(DATA_URL);
    expect(getAssistantPortrait()).toBe(DATA_URL);
    expect(DEFAULT_ASSISTANT_ICON).toBe("🧭");
  });

  it("portrait.png absent : aucune image, icone habituelle", () => {
    setAssistantPersona({ name: "Aurelia", portrait: null });
    expect(getAssistantPortrait()).toBe("");
    expect(getAssistantPersona()).toEqual({ name: "Aurelia", portrait: "" });
  });

  it("image inutilisable : repli, jamais une image cassee ni une exception", () => {
    expect(personaPortraitSrc("C:/tmp/portrait.png")).toBe("");
    expect(personaPortraitSrc("https://exemple.test/portrait.png")).toBe("");
    expect(personaPortraitSrc("data:image/png;base64,")).toBe("");
    expect(personaPortraitSrc("data:image/png;base64,@@invalide@@")).toBe("");
    expect(personaPortraitSrc(null)).toBe("");
    expect(normalizePersona({ portrait: "pas-une-image" }).portrait).toBe("");
  });
});

// ── 4. La RELECTURE : ouverture de l'onglet, focus, panne ────────────────────
describe("relecture du personnage (aucun redemarrage)", () => {
  it("la commande Rust est appelee et son resultat applique", async () => {
    const appels = [];
    const etat = await refreshAssistantPersona({
      invoke: async (cmd) => {
        appels.push(cmd);
        return { name: "Aurelia", portrait: DATA_URL };
      },
    });
    expect(appels).toEqual(["read_assistant_persona"]);
    expect(etat).toEqual({ name: "Aurelia", portrait: DATA_URL });
    // Changer de personnage : une seconde relecture suffit (aucun redemarrage).
    await refreshAssistantPersona({
      invoke: async () => ({ name: "Autre", portrait: null }),
    });
    expect(getAssistantPersonaName()).toBe("Autre");
    expect(getAssistantPortrait()).toBe("");
  });

  it("socle indisponible ou reponse illisible : repli, jamais d'exception", async () => {
    setAssistantPersona({ name: "Aurelia", portrait: DATA_URL });
    const echec = await refreshAssistantPersona({
      invoke: async () => {
        throw new Error("commande absente");
      },
    });
    expect(echec).toEqual({ name: "", portrait: "" });
    expect(getAssistantPersona()).toEqual({ name: "", portrait: "" });
    // Reponse d'une autre forme : meme repli, aucune exception.
    const bizarre = await refreshAssistantPersona({ invoke: async () => undefined });
    expect(bizarre).toEqual({ name: "", portrait: "" });
  });
});

// ── 5. Les BRANCHEMENTS dans l'interface ────────────────────────────────────
describe("branchements de l'interface", () => {
  it("le nom d'onglet passe par superAgentDisplayLabel, personnage en tete", () => {
    const src = lireSource("./super-agent.js");
    const corps = sliceSource(
      src,
      "export function superAgentDisplayLabel() {",
      "\n}",
      40,
    );
    expect(corps).toContain("personaDisplayName(getAssistantPersonaName(), configCache.name)");
    // Le personnage est relu A L'OUVERTURE de l'onglet ET au retour de focus.
    const creation = sliceSource(src, "export async function createSuperAgent(container) {", "window.addEventListener(\"focus\", onPersonaFocus);", 200);
    expect(creation).toContain("await refreshAssistantPersonaAndApply();");
    // ... et l'ecouteur de focus est bien RETIRE a la fermeture de l'onglet.
    const fermeture = sliceSource(src, "unlisten: async () => {", "window._pilotSuperAgentOpen = false;", 200);
    expect(fermeture).toContain('window.removeEventListener("focus", onPersonaFocus);');
  });

  it("le bouton d'onglet affiche le portrait a la place de l'icone habituelle", () => {
    const src = lireSource("./tabs.js");
    const rendu = sliceSource(src, "  _renderTabButton(tab) {", "btn.addEventListener(\"click\"", 500);
    expect(rendu).toContain('const superPortrait = tab.mode === "superagent" ? getAssistantPortrait() : "";');
    expect(rendu).toContain('class="tab-avatar"');
    // Sans portrait, l'icone habituelle reste exactement celle d'avant.
    expect(rendu).toContain('tab.mode === "superagent" ? "🧭 "');
    // Le nom du personnage vient d'un fichier : il est echappe avant le HTML.
    expect(rendu).toContain('const nomAffiche = tab.mode === "superagent" ? esc(tab.name) : tab.name;');
    // `updateSuperAgentLabel` re-rend le bouton : le portrait suit le nom sans
    // second mecanisme (aucun parametre ajoute a sa signature).
    expect(src).toContain("updateSuperAgentLabel(label) {");
  });
});
