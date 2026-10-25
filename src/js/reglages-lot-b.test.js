// Tests — lot B « Reglages en onglet » (docs/proposition-reglages-en-onglet.md).
//
// Le lot B fait des Reglages un ONGLET : le noeud `#settings-modal` est DEPLACE
// tel quel dans le conteneur d'onglet (jamais recopie), la fenetre disparait
// (plus de voile, plus de `position: fixed`, plus de fermeture au clic
// exterieur). Ces tests tiennent les quatre exigences de la bascule :
//   1. UN SEUL chemin d'ouverture, et il mene a l'ONGLET (bouton du haut de
//      colonne, palette, badge distant, evenement externe) ;
//   2. le contenu n'est jamais masque (`hidden`) : deux endroits ajoutaient
//      `hidden` a la fermeture — dans un onglet, cela viderait l'ecran ;
//   3. fermer l'onglet (✕) vaut « Annuler », par le chemin NORMAL de fermeture ;
//   4. ouvrir les Reglages quitte d'abord le mode « Assistant seul » (sinon
//      l'onglet s'ouvre sous l'overlay plein ecran).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd());

/** Source sans dependance aux fins de ligne (piege CI Windows, quality-gate 3.4). */
function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/** Nombre d'occurrences d'une ancre (verrou des tests de source). */
function countOf(source, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** Corps d'une fonction/listener : accolades equilibrees depuis `marker`. */
function bodyOf(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`marqueur introuvable : ${marker}`);
  const open = source.indexOf("{", start + marker.length);
  if (open < 0) throw new Error(`accolade introuvable apres : ${marker}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

const settings = readSource("src/js/settings.js");
const tabs = readSource("src/js/tabs.js");
const css = readSource("src/css/style.css");
const main = readSource("src/js/main.js");
const superAgent = readSource("src/js/super-agent.js");

describe("lot B — un seul chemin d'ouverture, vers l'ONGLET", () => {
  it("le bouton du haut de colonne ouvre l'onglet (jamais la fenetre)", () => {
    const body = bodyOf(settings, 'btnSettings.addEventListener("click"');
    expect(body).toContain("openSettingsTab(");
    // Plus de fenetre : ni `remove("hidden")`, ni animation de modale.
    expect(body).not.toContain('classList.remove("hidden")');
    expect(body).not.toContain("animateModalOpen");
  });

  it("la palette passe par la MEME porte que le bouton (aucun second chemin)", () => {
    // main.js declenche le bouton : un seul chemin d'ouverture subsiste.
    expect(main).toContain('document.getElementById("btn-settings")?.click()');
    // L'evenement externe aussi.
    const body = bodyOf(settings, 'window.addEventListener("pilot-open-settings"');
    expect(body).toContain("openSettingsTab(");
    expect(body).not.toContain('classList.remove("hidden")');
  });

  it("l'ouverture aboutit au mode d'onglet `settings`", () => {
    expect(tabs).toContain('if (mode === "settings") {');
    const body = bodyOf(tabs, "async _openSettings(detail = null)");
    // Un onglet deja ouvert n'est ni recree ni recharge : on y revient.
    expect(body).toContain('this.tabs.find((t) => t.mode === "settings")');
    expect(body).toContain("this.switchTab(existing.id)");
    expect(body).toContain('className = "editor-wrapper settings-wrapper"');
    expect(body).toContain("createSettings(tab.wrapper, detail)");
    // Aucune duplication de l'ecran : on ne construit jamais un second noeud.
    expect(countOf(settings, 'document.getElementById("settings-modal")')).toBe(2);
  });

  it("le noeud est DEPLACE, classe `.modal-in-tab`, jamais recopie", () => {
    const body = bodyOf(settings, "export async function createSettings(container, detail = null)");
    expect(body).toContain("container.appendChild(modal);");
    expect(body).toContain('modal.classList.add("modal-in-tab");');
    expect(body).toContain('modal.classList.remove("hidden");');
    // Le balisage interne des Reglages n'est pas reecrit par le lot B.
    expect(body).not.toContain("innerHTML");
  });
});

describe("lot B — l'ecran de l'onglet n'est jamais vide par un `hidden`", () => {
  it("seul le cycle de vie de l'onglet touche `hidden`", () => {
    // 1 ajout au demontage, 2 retraits (affichage + echec d'ouverture), 1 ajout
    // sur echec : tous dans `createSettings`, AUCUN dans un gestionnaire.
    expect(countOf(settings, 'modal.classList.add("hidden")')).toBe(2);
    expect(countOf(settings, 'modal.classList.remove("hidden")')).toBe(1);
    const closeBody = bodyOf(settings, 'btnClose.addEventListener("click"');
    expect(closeBody).not.toContain('modal.classList.add("hidden")');
    const saveBody = bodyOf(settings, 'btnSave.addEventListener("click"');
    expect(saveBody).not.toContain('modal.classList.add("hidden")');
  });

  it("la fenetre a bien disparu : le style ne neutralise QUE le positionnement", () => {
    expect(css).toContain(".editor-wrapper.settings-wrapper { overflow: hidden; }");
    const block = bodyOf(css, "#settings-modal.modal-in-tab");
    expect(block).toContain("position: static");
    expect(block).toContain("inset: auto");
    expect(block).toContain("background: none");
    expect(block).toContain("backdrop-filter: none");
  });
});

describe("lot B — fermer l'onglet vaut « Annuler », sans confirmation", () => {
  it("le ✕ de l'onglet passe par le chemin NORMAL de fermeture", () => {
    const body = bodyOf(tabs, "async closeTab(tabId, options = {})");
    const at = body.indexOf('tab.mode === "settings"');
    const remove = body.indexOf("tab.wrapper.remove()");
    expect(at).toBeGreaterThan(-1);
    // Nettoyage AVANT le retrait du conteneur (sinon le noeud part avec lui).
    expect(remove).toBeGreaterThan(at);
    expect(body.slice(at, remove)).toContain("tab.unlistenSettings()");
    // Aucune confirmation pour un ecran sans saisie a sauver.
    expect(body).not.toContain('tab.mode === "settings" && !options.skipConfirm');
  });

  it("le retour a zero est celui d'« Annuler » (aucun etat laisse en vie)", () => {
    const body = bodyOf(settings, "async function resetSettingsContent()");
    expect(body).toContain("cancelProvidersIfDirty()");
    expect(body).toContain("stopLayaModelPoll()");
    expect(body).toContain("stopLayaProgressListener()");
    expect(body).toContain("stopReading()");
    expect(body).toContain("applyTheme(savedTheme, savedSubtheme)");
  });
});

describe("lot B — ouvrir les Reglages quitte le mode « Assistant seul »", () => {
  it("le chemin unique le fait AVANT d'ouvrir, et l'overlay ecoute", () => {
    const body = bodyOf(settings, "function openSettingsTab(detail = null)");
    expect(body).toContain('document.body.classList.contains("superagent-immersive-active")');
    expect(body).toContain('"pilot-exit-assistant-only"');
    // L'ecouteur est pose et retire avec les autres (aucune fuite).
    expect(superAgent).toContain('window.addEventListener("pilot-exit-assistant-only", onExitAssistantOnly)');
    expect(superAgent).toContain('window.removeEventListener("pilot-exit-assistant-only", onExitAssistantOnly)');
    const handler = bodyOf(superAgent, "const onExitAssistantOnly = () =>");
    expect(handler).toContain("exitImmersive()");
  });
});

describe("lot B — les quatre acces directs gardent leur cablage", () => {
  it("chaque identifiant reste cable dans main.js", () => {
    for (const id of ["btn-vault", "btn-feedback", "btn-gds-admin", "btn-gds-params"]) {
      expect(main).toContain(`getElementById("${id}")`);
    }
  });
});
