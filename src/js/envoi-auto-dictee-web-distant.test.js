// Tests — ENVOI AUTOMATIQUE à la fin d'une dictée vocale, sur le WEB DISTANT.
//
// Le bureau envoie tout seul le message à la fin d'une dictée (`agent-pi.js`,
// `super-agent.js`). Le web distant ne le faisait pas : il fallait appuyer sur ➤.
// Ces tests tiennent l'ALIGNEMENT des deux côtés :
//
//   A. la DÉCISION est la même (module partagé `voice-auto-send.js`, aucune copie) :
//      1. fin normale + texte dicté ⇒ un seul envoi, par le chemin d'envoi existant ;
//      2. évènement de fin reçu DEUX fois ⇒ un seul envoi ;
//      3. texte vide / uniquement des espaces ⇒ aucun envoi ;
//      4. fin sur ERREUR ⇒ aucun envoi, session refermée avant ;
//      5. ARRÊT MANUEL ⇒ aucun envoi (comportement d'avant inchangé) ;
//      6. l'utilisateur a repris la main au clavier ⇒ AUCUN envoi, sa saisie intacte ;
//   B. le BRANCHEMENT dans `web/js/app.js` (test de source, VERROU : le saboter
//      doit faire rougir) : import du module partagé, délégation dans `rec.onend`,
//      drapeau de reprise en main, un seul chemin d'envoi (`submitPrompt`) ;
//   C. le module partagé est bien SERVI au web par le serveur axum depuis sa
//      source unique du bureau (aucune copie dans `web/`).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyVoiceEnd,
  composeVoiceInputValue,
  VOICE_END_EMPTY,
  VOICE_END_NO_SESSION,
  VOICE_END_SEND,
  VOICE_END_USER_TAKEOVER,
} from "./voice-auto-send.js";
import { sliceSource } from "./source-slice.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "../..");
const WEB = path.join(RACINE, "web");

const lireWeb = (rel) => fs.readFileSync(path.join(WEB, rel), "utf8").replace(/\r\n/g, "\n");
const lireSrc = (rel) => fs.readFileSync(path.join(RACINE, rel), "utf8").replace(/\r\n/g, "\n");

// ── Harnais : reproduit EXACTEMENT le motif de `web/js/app.js` ──────────────
// `voiceActive` est la seule source d'état de la session ; `rec.onend` lit ce
// drapeau AVANT de le refermer (c'est ce qui empêche un second envoi) ; l'envoi
// emprunte le chemin existant du formulaire (`submitPrompt`).
function createWebWindow(preText = "") {
  const state = {
    value: preText,
    voiceActive: false,
    userTookOver: false,
    sends: [],
  };
  const start = () => {
    state.voiceActive = true;
    state.userTookOver = false;
  };
  // Écriture du moteur de reconnaissance (`rec.onresult`) : programmatique, donc
  // SANS évènement `input` — comme dans le navigateur.
  const speech = (dictatedText) => {
    if (!state.voiceActive) return;
    if (state.userTookOver) return; // sa saisie prime : le moteur n'écrit plus
    state.value = composeVoiceInputValue(preText, dictatedText);
  };
  // L'utilisateur tape dans la zone pendant l'écoute → évènement `input`.
  const userTypes = (text) => {
    state.value = text;
    if (state.voiceActive) state.userTookOver = true;
  };
  // `rec.onerror` du web : la session est refermée ICI.
  const fail = () => {
    state.voiceActive = false;
  };
  // Arrêt manuel (bouton micro) : `stopVoiceInput`.
  const stopManually = () => {
    state.voiceActive = false;
  };
  // `rec.onend` du web : délègue TOUT au module partagé.
  const end = (dictatedText) => {
    const wasActive = state.voiceActive;
    return applyVoiceEnd({
      sessionActive: wasActive,
      preText,
      dictatedText,
      userEdited: state.userTookOver,
      closeSession: () => { state.voiceActive = false; },
      write: (value) => { state.value = value; },
      send: () => { state.sends.push(state.value); },
    });
  };
  return { state, start, speech, userTypes, fail, stopManually, end };
}

describe("A. la décision du web distant est celle du bureau", () => {
  it("1. texte dicté → UN SEUL envoi, par le chemin d'envoi existant", () => {
    const w = createWebWindow("");
    w.start();
    w.speech("fais les tests");
    const res = w.end("fais les tests");
    expect(res.autoSend).toBe(true);
    expect(res.reason).toBe(VOICE_END_SEND);
    expect(w.state.sends).toEqual(["fais les tests"]);
  });

  it("2. fin reçue DEUX fois (onend doublé) → un seul envoi, jamais de doublon", () => {
    const w = createWebWindow("");
    w.start();
    w.speech("bonjour");
    w.end("bonjour");
    w.end("bonjour"); // second évènement de fin : la session est déjà refermée
    expect(w.state.sends).toHaveLength(1);
    expect(w.state.sends[0]).toBe("bonjour");
  });

  it("3. texte vide ou seulement des espaces → aucun envoi, zone vide inchangée", () => {
    const vide = createWebWindow("");
    vide.start();
    const res = vide.end("");
    expect(res.reason).toBe(VOICE_END_EMPTY);
    expect(vide.state.sends).toHaveLength(0);
    expect(vide.state.value).toBe("");

    const espaces = createWebWindow("");
    espaces.start();
    espaces.end("   ");
    expect(espaces.state.sends).toHaveLength(0);
  });

  it("4. fin sur ERREUR → aucun envoi, et la zone n'est pas réécrite", () => {
    const w = createWebWindow("déjà tapé ");
    w.start();
    w.speech("mot à moitié");
    w.fail(); // rec.onerror : session refermée
    const res = w.end("mot à moitié");
    expect(res.reason).toBe(VOICE_END_NO_SESSION);
    expect(w.state.sends).toHaveLength(0);
    // Le texte dicté ne remplace pas ce que l'utilisateur voit déjà.
    expect(w.state.value).toBe("déjà tapé mot à moitié");
  });

  it("5. ARRÊT MANUEL du micro → aucun envoi (comportement d'avant conservé)", () => {
    const w = createWebWindow("");
    w.start();
    w.speech("ceci ne doit pas partir");
    w.stopManually();
    const res = w.end("ceci ne doit pas partir");
    expect(res.reason).toBe(VOICE_END_NO_SESSION);
    expect(w.state.sends).toHaveLength(0);
  });

  it("6. clavier pendant l'écoute → AUCUN envoi et la saisie de l'utilisateur est intacte", () => {
    const w = createWebWindow("");
    w.start();
    w.speech("texte dicté");
    w.userTypes("j'ai écrit ça moi-même");
    const res = w.end("texte dicté");
    expect(res.reason).toBe(VOICE_END_USER_TAKEOVER);
    expect(res.autoSend).toBe(false);
    expect(w.state.sends).toHaveLength(0);
    // La règle « tu gardes toujours la main » : rien n'est réécrit.
    expect(w.state.value).toBe("j'ai écrit ça moi-même");
  });

  it("6 bis. reprise en main : même le texte dicté vide n'écrase pas la saisie", () => {
    const w = createWebWindow("");
    w.start();
    w.userTypes("déjà écrit");
    w.end("");
    expect(w.state.value).toBe("déjà écrit");
    expect(w.state.sends).toHaveLength(0);
  });

  it("le texte déjà présent dans la zone est CONSERVÉ avant le texte dicté", () => {
    const w = createWebWindow("contexte :");
    w.start();
    w.speech("ajoute un test");
    w.end("ajoute un test");
    expect(w.state.sends).toEqual(["contexte : ajoute un test"]);
  });
});

// ── B. Câblage dans web/js/app.js ──────────────────────────────────────────
describe("B. câblage de web/js/app.js : module partagé, un seul chemin d'envoi", () => {
  const src = lireWeb("js/app.js");

  it("importe le module partagé (aucune décision recopiée dans le web)", () => {
    expect(src).toContain("import { applyVoiceEnd, composeVoiceInputValue } from './voice-auto-send.js?v=1';");
    expect(src).not.toContain("function decideVoiceAutoSend");
    expect(src).not.toContain("function applyVoiceEnd");
  });

  it("un SEUL point d'envoi automatique, délégué au module", () => {
    expect(src.match(/applyVoiceEnd\(/g) || []).toHaveLength(1);
    const bloc = sliceSource(src, "  rec.onend = () => {", "  try {\n    rec.start();", 200);
    expect(bloc).toContain("applyVoiceEnd({");
    expect(bloc).toContain("sessionActive: wasActive");
    expect(bloc).toContain("userEdited: voiceUserTookOver");
    // L'envoi réutilise le chemin EXISTANT du formulaire, et rien d'autre.
    expect(bloc).toContain("send: () => { submitPrompt(); }");
    expect(bloc.match(/submitPrompt\(/g) || []).toHaveLength(1);
    // La décision n'est pas prise en ligne dans le web.
    expect(bloc).not.toContain("decideVoiceAutoSend");
    // L'ancien comportement (réécrire la zone sans jamais envoyer) a disparu.
    expect(bloc).not.toContain("if (wasActive) {");
  });

  it("la fin d'écoute lit le drapeau AVANT de refermer la session", () => {
    const bloc = sliceSource(src, "  rec.onend = () => {", "  try {\n    rec.start();", 200);
    const posLecture = bloc.indexOf("const wasActive = voiceActive;");
    const posFermeture = bloc.indexOf("closeSession: () => { voiceActive = false;");
    expect(posLecture).toBeGreaterThan(-1);
    expect(posFermeture).toBeGreaterThan(posLecture);
  });

  it("toutes les clés attendues par le module sont transmises", () => {
    const appel = sliceSource(
      src,
      "    applyVoiceEnd({",
      "    });\n    if (mic) mic.classList.remove('rec');",
      100,
    );
    for (const cle of [
      "sessionActive:",
      "preText,",
      "dictatedText: finalText,",
      "userEdited: voiceUserTookOver,",
      "closeSession:",
      "write:",
      "send:",
    ]) {
      expect(appel, cle).toContain(cle);
    }
  });

  it("la fin sur erreur referme la session (donc aucun envoi derrière)", () => {
    const blocErreur = sliceSource(src, "  rec.onerror = (ev) => {", "  rec.onend = () => {", 100);
    expect(blocErreur).toContain("voiceActive = false;");
    // Aucun envoi dans le chemin d'erreur.
    expect(blocErreur).not.toContain("applyVoiceEnd");
    expect(blocErreur).not.toContain("submitPrompt");
  });

  it("la reprise en main au clavier est détectée, respectée et transmise", () => {
    // Détection : un évènement `input` PENDANT l'écoute vient de l'utilisateur.
    const blocEtat = sliceSource(src, "let voiceUserTookOver = false;", "function updateMicState() {", 50);
    expect(blocEtat).toContain("input.addEventListener('input'");
    expect(blocEtat).toContain("if (voiceActive) voiceUserTookOver = true;");
    // Le moteur n'écrit plus la zone après la reprise en main (garde AVANT l'écriture).
    const blocResultat = sliceSource(src, "  rec.onresult = (e) => {", "  rec.onerror = (ev) => {", 200);
    const garde = blocResultat.indexOf("if (voiceUserTookOver) return;");
    const ecriture = blocResultat.indexOf("input.value = composeVoiceInputValue(preText, transcript);");
    expect(garde).toBeGreaterThan(-1);
    expect(ecriture).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(ecriture);
    // Chaque dictée repart proprement (le drapeau ne survit pas à la précédente).
    const blocDemarrage = sliceSource(src, "  const preText = input.value;", "  const norm = (s) =>", 20);
    expect(blocDemarrage).toContain("voiceUserTookOver = false;");
  });

  it("le chemin d'envoi est UNIQUE et partagé avec Entrée / ➤", () => {
    const blocSubmit = sliceSource(
      src,
      "async function submitPrompt() {",
      "document.getElementById('prompt-input').addEventListener('keydown'",
      100,
    );
    expect(blocSubmit).toContain("async function submitPrompt()");
    expect(blocSubmit).toContain("await submitPrompt();");
    // Le formulaire ne contient plus sa propre logique d'envoi (elle est extraite).
    expect(blocSubmit.match(/apiJson\(endpoint/g) || []).toHaveLength(1);
    // Trois appels au total : définition + formulaire + fin de dictée.
    expect(src.match(/submitPrompt\(/g) || []).toHaveLength(3);
  });

  it("l'arrêt manuel ne change pas de comportement (aucun envoi)", () => {
    const blocStop = sliceSource(src, "function stopVoiceInput() {", "function toggleVoiceInput() {", 30);
    expect(blocStop).toContain("voiceActive = false;");
    expect(blocStop).not.toContain("submitPrompt");
    expect(blocStop).not.toContain("applyVoiceEnd");
  });
});

// ── C. Un seul module : servi au web depuis la source du bureau ─────────────
describe("C. le module partagé est servi au web, jamais recopié", () => {
  it("aucune copie du module dans web/ (le web importe la source unique)", () => {
    expect(fs.existsSync(path.join(WEB, "js/voice-auto-send.js"))).toBe(false);
    const fichiers = [];
    for (const f of fs.readdirSync(path.join(WEB, "js"))) fichiers.push(f);
    expect(fichiers).not.toContain("voice-auto-send.js");
  });

  it("le serveur axum l'embarque depuis src/js/voice-auto-send.js et le sert sous /js/", () => {
    const serveur = lireSrc("src-tauri/src/web_server.rs");
    expect(serveur).toContain('include_str!("../../src/js/voice-auto-send.js")');
    expect(serveur).toContain('const SHARED_VOICE_AUTO_SEND_PATH: &str = "js/voice-auto-send.js";');
    // L'URL servie correspond au spécificateur d'import du web (`./…` depuis /js/).
    const importWeb = lireWeb("js/app.js").match(/from '\.\/([^']+)';/);
    expect(importWeb).not.toBeNull();
    expect("js/" + importWeb[1].replace(/\?.*$/, "")).toBe("js/voice-auto-send.js");
  });

  it("le module partagé reste pur (aucun DOM, aucune dépendance, aucun envoi)", () => {
    const module = lireSrc("src/js/voice-auto-send.js");
    for (const interdit of ["document.", "window.", "fetch(", "import ", "invoke(", "submitPrompt("]) {
      expect(module, interdit).not.toContain(interdit);
    }
  });
});
