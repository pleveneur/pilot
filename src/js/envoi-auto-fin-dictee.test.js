// Tests — ENVOI AUTOMATIQUE à la fin d'une dictée vocale.
//
// Décision du propriétaire (2026-10-26) : à la fin d'une dictée, si du texte a été
// dicté, le message part TOUT SEUL — l'utilisateur n'appuie plus sur Entrée.
//
// Ce que ces tests tiennent (les cinq cas qui comptent, plus les branchements) :
//   1. fin NORMALE + texte dicté  ⇒ un seul envoi, par le chemin d'envoi existant ;
//      (VERROU : si l'envoi automatique disparaît, ce test tombe)
//   2. fin sur ERREUR (reconnaissance, permission, panne réseau) ⇒ aucun envoi et
//      le texte est laissé tel quel dans la zone de saisie ;
//   3. texte dicté vide / uniquement des espaces ⇒ aucun envoi ;
//      (VERROU : s'il partait un texte vide, ce test tombe)
//   4. évènement de fin reçu DEUX fois ⇒ un seul envoi (jamais de doublon) ;
//   5. l'UTILISATEUR reprend la main pendant la dictée ⇒ sa saisie n'est pas
//      réécrite et rien ne part (il valide lui-même) ;
//   6. le câblage de l'onglet agent π (agent-pi.js) utilise bien ce module pour la
//      décision et l'ORDRE, et n'ajoute aucun second mécanisme d'envoi ;
//   7. le MÊME comportement dans la barre de saisie de l'Assistant 🧭
//      (super-agent.js) : même module, mêmes règles, chemin d'envoi existant
//      (`send`), aucune décision recopiée ;
//   8. les deux appelants partagent bien le module (aucun des deux ne réimplémente
//      la décision) et le module n'a pas changé de nature (toujours sans envoi).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyVoiceEnd,
  composeVoiceInputValue,
  decideVoiceAutoSend,
  normalizedVoiceText,
  VOICE_END_EMPTY,
  VOICE_END_NO_SESSION,
  VOICE_END_SEND,
  VOICE_END_USER_TAKEOVER,
} from "./voice-auto-send.js";
import { sliceSource } from "./source-slice.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));

// ── Harnais : reproduit EXACTEMENT le motif de l'onglet agent π ──────────────
// `voiceActive` est la seule source d'état de la session ; la fin d'écoute lit
// ce drapeau AVANT de le refermer (c'est ce qui empêche un second envoi).
function createAgentWindow(preText = "") {
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
  // Le moteur écrit le texte reconnu (comportement de `rec.onresult`).
  const speech = (dictatedText) => {
    if (!state.voiceActive) return;
    if (state.userTookOver) return; // sa saisie prime : le moteur n'écrit plus
    state.value = composeVoiceInputValue(preText, dictatedText);
  };
  // L'utilisateur TAPE (ou vide) la zone pendant la dictée : évènement `input`
  // (un `inputEl.value = …` programmatique n'en émet aucun).
  const userTypes = (value) => {
    if (state.voiceActive) state.userTookOver = true;
    state.value = value;
  };
  // Fin sur erreur : la session est refermée AVANT que `onend` n'arrive.
  const error = () => {
    state.voiceActive = false;
  };
  // Chemin d'envoi EXISTANT (image de `sendPrompt`) : vide la zone et envoie.
  const send = () => {
    const text = state.value.trim();
    if (!text) return;
    state.sends.push(text);
    state.value = "";
  };
  const end = (dictatedText) => {
    const wasActive = state.voiceActive;
    return applyVoiceEnd({
      sessionActive: wasActive,
      preText,
      dictatedText,
      userEdited: state.userTookOver,
      closeSession: () => {
        state.voiceActive = false;
      },
      write: (value) => {
        state.value = value;
      },
      send,
    });
  };
  return { state, start, speech, userTypes, error, end };
}

// ── 1. Fin normale + texte dicté ⇒ un seul envoi ─────────────────────────────
describe("fin normale d'une dictée avec du texte : la demande part toute seule", () => {
  it("envoie une seule fois, par le chemin d'envoi existant", () => {
    const w = createAgentWindow();
    w.start();
    w.speech("ouvre le fichier spec");
    const res = w.end("ouvre le fichier spec");

    expect(res.autoSend).toBe(true);
    expect(res.sent).toBe(true);
    expect(res.reason).toBe(VOICE_END_SEND);
    expect(w.state.sends).toEqual(["ouvre le fichier spec"]);
    // La zone de saisie est vidée par le chemin d'envoi lui-même (comme Entrée).
    expect(w.state.value).toBe("");
    // Plus d'écoute annoncée : la session est refermée.
    expect(w.state.voiceActive).toBe(false);
  });

  it("conserve le texte déjà présent dans la zone avant la dictée", () => {
    const w = createAgentWindow("Regarde ");
    w.start();
    w.speech("corrige le bug");
    w.end("corrige le bug");

    expect(w.state.sends).toEqual(["Regarde corrige le bug"]);
  });
});

// ── 2. Fin sur erreur ⇒ aucun envoi ─────────────────────────────────────────
describe("fin sur erreur (reconnaissance, permission, panne réseau) : aucun envoi", () => {
  it("ne rien envoyer et laisser le texte tel quel", () => {
    const w = createAgentWindow();
    w.start();
    w.speech("bonjour je voulais dire");
    w.error(); // refus de permission / network / not-allowed
    const res = w.end("bonjour je voulais dire");

    expect(res.autoSend).toBe(false);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe(VOICE_END_NO_SESSION);
    expect(w.state.sends).toEqual([]);
    // Le texte reconnu reste dans la zone : rien n'est effacé.
    expect(w.state.value).toBe("bonjour je voulais dire");
  });

  it("un arrêt manuel (bouton micro) ne déclenche pas d'envoi", () => {
    const w = createAgentWindow();
    w.start();
    w.speech("ne pars pas tout de suite");
    w.error(); // `stopVoiceInput()` referme la session exactement de la même façon
    w.end("ne pars pas tout de suite");
    expect(w.state.sends).toEqual([]);
    expect(w.state.value).toBe("ne pars pas tout de suite");
  });
});

// ── 3. Texte vide ⇒ aucun envoi ─────────────────────────────────────────────
describe("texte dicté vide ou blanc : aucun envoi", () => {
  it("n'envoie pas quand rien n'a été dicté", () => {
    const w = createAgentWindow();
    w.start();
    const res = w.end("");

    expect(res.autoSend).toBe(false);
    expect(res.reason).toBe(VOICE_END_EMPTY);
    expect(w.state.sends).toEqual([]);
  });

  it("n'envoie pas un message composé uniquement d'espaces", () => {
    const w = createAgentWindow("   ");
    w.start();
    const res = w.end("   \n\t ");

    expect(res.autoSend).toBe(false);
    expect(w.state.sends).toEqual([]);
    // Aucun envoi vide : la zone ne contient toujours que des blancs.
    expect(w.state.value.trim()).toBe("");
  });
});

// ── 4. Double évènement de fin ⇒ un seul envoi ──────────────────────────────
describe("évènement de fin reçu deux fois : un seul message par dictée", () => {
  it("le second évènement de fin n'envoie rien", () => {
    const w = createAgentWindow();
    w.start();
    w.speech("lance les tests");
    const premier = w.end("lance les tests");
    const second = w.end("lance les tests");

    expect(premier.sent).toBe(true);
    expect(second.autoSend).toBe(false);
    expect(second.sent).toBe(false);
    expect(w.state.sends).toEqual(["lance les tests"]);
  });

  it("la session est refermée AVANT l'envoi (aucune fenêtre de doublon)", () => {
    const ordre = [];
    let ouvert = true;
    applyVoiceEnd({
      sessionActive: true,
      preText: "",
      dictatedText: "go",
      closeSession: () => {
        ouvert = false;
        ordre.push("close");
      },
      write: (v) => ordre.push("write:" + v),
      send: () => {
        // Au moment de l'envoi, la session est DÉJÀ refermée.
        ordre.push(ouvert ? "send-session-ouverte" : "send-session-fermee");
      },
    });
    expect(ordre).toEqual(["close", "write:go", "send-session-fermee"]);
  });
});

// ── 4bis. L'utilisateur reprend la main ⇒ sa saisie prime, rien ne part ──────
describe("l'utilisateur reprend la main pendant la dictée : rien ne part, sa saisie n'est pas écrasée", () => {
  it("un texte tapé à la main n'est jamais réécrit par le texte dicté", () => {
    const w = createAgentWindow();
    w.start();
    w.speech("ce que j'avais dicte");
    w.userTypes("ce que j'ai tape moi-meme");
    w.speech("la suite dictee"); // le moteur ne réécrit plus la zone
    const res = w.end("ce que j'avais dicte la suite dictee");

    expect(res.autoSend).toBe(false);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe(VOICE_END_USER_TAKEOVER);
    expect(w.state.sends).toEqual([]);
    // Ce que l'utilisateur a écrit est intact : le texte dicté ne l'a pas écrasé.
    expect(w.state.value).toBe("ce que j'ai tape moi-meme");
    expect(w.state.voiceActive).toBe(false);
  });

  it("une zone vidée à la main reste vide : aucun texte vide n'est envoyé", () => {
    const w = createAgentWindow();
    w.start();
    w.speech("un long texte dicte");
    w.userTypes(""); // l'utilisateur efface tout pendant la dictée
    const res = w.end("un long texte dicte");

    expect(res.sent).toBe(false);
    expect(w.state.sends).toEqual([]);
    expect(w.state.value).toBe("");
  });

  it("la reprise en main prime sur un texte dicté non vide (aucune écriture, aucun envoi)", () => {
    const ecritures = [];
    const envois = [];
    const res = applyVoiceEnd({
      sessionActive: true,
      preText: "deja la",
      dictatedText: "du texte dicte",
      userEdited: true,
      closeSession: () => {},
      write: (v) => ecritures.push(v),
      send: () => envois.push("envoi"),
    });

    expect(res.reason).toBe(VOICE_END_USER_TAKEOVER);
    expect(res.autoSend).toBe(false);
    expect(res.sent).toBe(false);
    expect(ecritures).toEqual([]); // la zone n'est même pas réécrite
    expect(envois).toEqual([]);
  });
});

// ── 4ter. Harnais de la barre de saisie de l'Assistant 🧭 ────────────────────
// Reproduit la barre de l'Assistant : même état de session (`voiceActive` + le
// drapeau de reprise en main), et surtout le chemin d'envoi RÉEL `send()` de
// super-agent.js, avec ses gardes propres (texte trimé vide ⇒ rien, Assistant
// occupé ⇒ la saisie est CONSERVÉE, question en attente ⇒ elle est validée au
// lieu d'ouvrir un nouveau tour).
function createAssistantWindow(preText = "") {
  const state = {
    value: preText,
    voiceActive: false,
    userTookOver: false,
    busy: false,
    pendingQuestion: false,
    notes: [],
    sends: [],
  };
  const write = (value) => {
    state.value = value;
  };
  // Image fidèle de `send()` (super-agent.js) : les gardes sont dans le MÊME
  // ordre, et un refus ne vide jamais la zone.
  const send = () => {
    if (state.pendingQuestion) {
      state.notes.push(state.value);
      state.value = "";
      return;
    }
    const text = state.value.trim();
    if (!text) return;
    if (state.busy) return;
    state.value = "";
    state.sends.push(text);
  };
  const start = () => {
    state.voiceActive = true;
    state.userTookOver = false;
  };
  const speech = (dictatedText) => {
    if (!state.voiceActive) return;
    if (state.userTookOver) return;
    state.value = composeVoiceInputValue(preText, dictatedText);
  };
  const userTypes = (value) => {
    if (state.voiceActive) state.userTookOver = true;
    state.value = value;
  };
  const error = () => {
    state.voiceActive = false;
  };
  const end = (dictatedText) => {
    const wasActive = state.voiceActive;
    return applyVoiceEnd({
      sessionActive: wasActive,
      preText,
      dictatedText,
      userEdited: state.userTookOver,
      closeSession: () => {
        state.voiceActive = false;
      },
      write,
      send,
    });
  };
  return { state, start, speech, userTypes, error, end };
}

// ── 4quater. Assistant 🧭 : même comportement que l'onglet agent π ──────────
describe("barre de saisie de l'Assistant 🧭 : la dictée part toute seule, par send()", () => {
  it("envoie une seule fois à la fin normale, par le chemin d'envoi existant", () => {
    const w = createAssistantWindow();
    w.start();
    w.speech("fais le point sur les projets");
    const res = w.end("fais le point sur les projets");

    expect(res.autoSend).toBe(true);
    expect(res.sent).toBe(true);
    expect(res.reason).toBe(VOICE_END_SEND);
    expect(w.state.sends).toEqual(["fais le point sur les projets"]);
    // La zone est vidée par `send()` lui-même, comme après un appui sur Entrée.
    expect(w.state.value).toBe("");
    expect(w.state.voiceActive).toBe(false);
  });

  it("ajoute le texte déjà présent dans la zone avant la dictée", () => {
    const w = createAssistantWindow("Pour demain : ");
    w.start();
    w.speech("relance les agents bloqués");
    w.end("relance les agents bloqués");

    expect(w.state.sends).toEqual(["Pour demain : relance les agents bloqués"]);
  });

  it("une fin signalée DEUX fois ne produit qu'un seul message", () => {
    const w = createAssistantWindow();
    w.start();
    w.speech("résume la journée");
    const premier = w.end("résume la journée");
    const second = w.end("résume la journée");

    expect(premier.sent).toBe(true);
    expect(second.sent).toBe(false);
    expect(second.reason).toBe(VOICE_END_NO_SESSION);
    expect(w.state.sends).toEqual(["résume la journée"]);
  });

  it("erreur ou arrêt manuel : aucun envoi, le texte reconnu reste dans la zone", () => {
    for (const fermeture of ["erreur", "arret-manuel"]) {
      const w = createAssistantWindow();
      w.start();
      w.speech("je voulais dire que");
      w.error(); // onerror / stopVoiceInput referment la session de la même façon
      const res = w.end("je voulais dire que");

      expect(res.autoSend, fermeture).toBe(false);
      expect(res.sent, fermeture).toBe(false);
      expect(w.state.sends, fermeture).toEqual([]);
      // Le texte reconnu reste affiché : rien n'est effacé par surprise.
      expect(w.state.value, fermeture).toBe("je voulais dire que");
    }
  });

  it("texte vide ou uniquement des espaces : aucun envoi", () => {
    const vide = createAssistantWindow();
    vide.start();
    expect(vide.end("").sent).toBe(false);
    expect(vide.state.sends).toEqual([]);

    const blancs = createAssistantWindow("   ");
    blancs.start();
    const res = blancs.end("  \n\t ");
    expect(res.autoSend).toBe(false);
    expect(res.reason).toBe(VOICE_END_EMPTY);
    expect(blancs.state.sends).toEqual([]);
  });

  it("reprise en main : la saisie de l'utilisateur est intacte et rien ne part", () => {
    const w = createAssistantWindow();
    w.start();
    w.speech("une phrase dictee");
    w.userTypes("ce que j'ecris moi-meme");
    const res = w.end("une phrase dictee");

    expect(res.reason).toBe(VOICE_END_USER_TAKEOVER);
    expect(res.sent).toBe(false);
    expect(w.state.sends).toEqual([]);
    expect(w.state.value).toBe("ce que j'ecris moi-meme");
    expect(w.state.voiceActive).toBe(false);
  });

  it("Assistant occupé : rien ne part, mais le texte dicté reste dans la zone", () => {
    // Garde PROPRE à `send()` de l'Assistant (tour venu d'ailleurs). L'envoi
    // automatique ne la contourne pas : la saisie est conservée, jamais perdue.
    const w = createAssistantWindow();
    w.state.busy = true;
    w.start();
    w.speech("une demande");
    w.end("une demande");

    expect(w.state.sends).toEqual([]);
    expect(w.state.value).toBe("une demande");
  });

  it("question en attente : le chemin existant valide la question (comme Entrée)", () => {
    const w = createAssistantWindow();
    w.state.pendingQuestion = true;
    w.start();
    w.speech("oui pour le projet Kalico");
    w.end("oui pour le projet Kalico");

    expect(w.state.sends).toEqual([]);
    expect(w.state.notes).toEqual(["oui pour le projet Kalico"]);
  });
});

// ── 5. Décision pure, isolée ────────────────────────────────────────────────
describe("decideVoiceAutoSend — décision seule, sans effet", () => {
  it("n'envoie que sur une fin normale ET un texte dicté non vide", () => {
    expect(decideVoiceAutoSend({ sessionActive: true, dictatedText: "ok" }).autoSend).toBe(true);
    expect(decideVoiceAutoSend({ sessionActive: true, dictatedText: "  " }).autoSend).toBe(false);
    expect(decideVoiceAutoSend({ sessionActive: true, dictatedText: "" }).autoSend).toBe(false);
    expect(decideVoiceAutoSend({ sessionActive: false, dictatedText: "ok" }).autoSend).toBe(false);
    // Entrée manquante / malformée : jamais d'envoi.
    expect(decideVoiceAutoSend(undefined).autoSend).toBe(false);
    expect(decideVoiceAutoSend({}).autoSend).toBe(false);
  });

  it("ne décide rien pour un drapeau de session non strictement vrai", () => {
    expect(decideVoiceAutoSend({ sessionActive: "true", dictatedText: "ok" }).autoSend).toBe(false);
    expect(decideVoiceAutoSend({ sessionActive: 1, dictatedText: "ok" }).autoSend).toBe(false);
  });

  it("n'envoie jamais quand l'utilisateur a repris la main", () => {
    const d = decideVoiceAutoSend({ sessionActive: true, dictatedText: "ok", userEdited: true });
    expect(d.autoSend).toBe(false);
    expect(d.reason).toBe(VOICE_END_USER_TAKEOVER);
    // Un drapeau non strictement vrai ne vaut PAS une reprise en main : le cas
    // normal continue de partir tout seul.
    expect(decideVoiceAutoSend({ sessionActive: true, dictatedText: "ok", userEdited: false }).autoSend).toBe(true);
    expect(decideVoiceAutoSend({ sessionActive: true, dictatedText: "ok" }).autoSend).toBe(true);
  });

  it("normalise le texte dicté (jamais null/undefined)", () => {
    expect(normalizedVoiceText(null)).toBe("");
    expect(normalizedVoiceText(undefined)).toBe("");
    expect(normalizedVoiceText("  bonjour  ")).toBe("bonjour");
  });

  it("compose la zone de saisie exactement comme avant la modification", () => {
    expect(composeVoiceInputValue("", "salut")).toBe("salut");
    expect(composeVoiceInputValue("salut ", "ça va")).toBe("salut ça va");
    expect(composeVoiceInputValue("salut", "ça va")).toBe("salut ça va");
    // Comportement HISTORIQUE conservé à l'identique : une espace est ajoutée
    // dès que le texte déjà présent n'en finit pas une (même sans texte dicté).
    expect(composeVoiceInputValue("salut", "")).toBe("salut ");
    expect(composeVoiceInputValue(null, "salut")).toBe("salut");
  });
});

// ── 6. Câblage dans l'onglet agent π ───────────────────────────────────────
describe("câblage de agent-pi.js : décision et ordre délégués, un seul envoi", () => {
  const lire = (nom) =>
    fs.readFileSync(path.join(ICI, nom), "utf8").replace(/\r\n/g, "\n");
  const src = lire("agent-pi.js");

  it("importe le module de décision (et rien d'autre pour l'envoi automatique)", () => {
    expect(src).toContain('import { applyVoiceEnd } from "./voice-auto-send.js";');
  });

  it("la fin d'écoute lit le drapeau AVANT de refermer la session", () => {
    const bloc = sliceSource(src, "    rec.onend = () => {", "    try {\n      rec.start();", 200);
    expect(bloc).toContain("const wasActive = voiceActive;");
    // Le drapeau est lu avant la fermeture : l'ordre exact des deux lignes compte.
    const posLecture = bloc.indexOf("const wasActive = voiceActive;");
    const posFermeture = bloc.indexOf("closeSession: () => { voiceActive = false;");
    expect(posLecture).toBeGreaterThan(-1);
    expect(posFermeture).toBeGreaterThan(posLecture);
  });

  it("n'a qu'UN seul point d'envoi, qui réutilise sendPrompt", () => {
    const bloc = sliceSource(src, "    rec.onend = () => {", "    try {\n      rec.start();", 200);
    expect(bloc).toContain("applyVoiceEnd({");
    expect(bloc).toContain("sessionActive: wasActive");
    expect(bloc).toContain("send: () => { sendPrompt(); }");
    // Aucun second mécanisme : une seule occurrence de sendPrompt dans le bloc.
    expect(bloc.match(/sendPrompt\(/g) || []).toHaveLength(1);
    // La décision n'est plus prise en ligne dans agent-pi.js.
    expect(bloc).not.toContain("decideVoiceAutoSend");
  });

  it("la fin sur erreur referme la session (donc aucun envoi derrière)", () => {
    const blocErreur = sliceSource(src, "    rec.onerror = (ev) => {", "    rec.onend = () => {", 100);
    expect(blocErreur).toContain("voiceActive = false;");
  });

  it("le module de décision n'envoie rien lui-même (aucune dépendance)", () => {
    const module = lire("voice-auto-send.js");
    expect(module).not.toContain("sendPrompt(");
    expect(module).not.toContain("invoke(");
    expect(module).not.toContain("import ");
  });

  it("la reprise en main est détectée, respectée et transmise à la décision", () => {
    // Détection : un évènement `input` reçu PENDANT l'écoute vient de l'utilisateur
    // (les écritures du moteur sont programmatiques, donc sans évènement `input`).
    const blocEtat = sliceSource(src, "  let voiceUserTookOver = false;", "  // ── H7 :", 50);
    expect(blocEtat).toContain('inputEl.addEventListener("input"');
    expect(blocEtat).toContain("if (voiceActive) voiceUserTookOver = true;");
    // Le moteur n'écrit plus la zone après la reprise en main (garde AVANT l'écriture).
    const blocResultat = sliceSource(src, "    rec.onresult = (e) => {", "    rec.onerror = (ev) => {", 100);
    const garde = blocResultat.indexOf("if (voiceUserTookOver) return;");
    const ecriture = blocResultat.indexOf("inputEl.value = preText + sep + transcript;");
    expect(garde).toBeGreaterThan(-1);
    expect(ecriture).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(ecriture);
    // La fin d'écoute transmet la reprise en main à la décision unique.
    const blocFin = sliceSource(src, "    rec.onend = () => {", "    try {\n      rec.start();", 100);
    expect(blocFin).toContain("userEdited: voiceUserTookOver");
    // Chaque dictée repart proprement (le drapeau ne survit pas à la précédente).
    const blocDemarrage = sliceSource(src, '    let finalText = "";', "    const norm =", 10);
    expect(blocDemarrage).toContain("voiceUserTookOver = false;");
  });
});

// ── 7. Câblage dans la barre de saisie de l'Assistant 🧭 ────────────────────
describe("câblage de super-agent.js : même module, même ordre, un seul envoi", () => {
  const lire = (nom) =>
    fs.readFileSync(path.join(ICI, nom), "utf8").replace(/\r\n/g, "\n");
  const src = lire("super-agent.js");

  it("importe le module partagé de décision", () => {
    expect(src).toContain('import { applyVoiceEnd } from "./voice-auto-send.js";');
  });

  it("la fin d'écoute délègue à applyVoiceEnd et lit le drapeau AVANT de refermer", () => {
    const bloc = sliceSource(src, "    rec.onend = () => {", "    try {\n      rec.start();", 200);
    expect(bloc).toContain("const wasActive = voiceActive;");
    expect(bloc).toContain("applyVoiceEnd({");
    expect(bloc).toContain("sessionActive: wasActive");
    const posLecture = bloc.indexOf("const wasActive = voiceActive;");
    const posDelegation = bloc.indexOf("applyVoiceEnd({");
    const posFermeture = bloc.indexOf("closeSession: () => { voiceActive = false;");
    expect(posDelegation).toBeGreaterThan(posLecture);
    expect(posFermeture).toBeGreaterThan(posDelegation);
  });

  it("n'a qu'UN seul point d'envoi, qui réutilise send()", () => {
    const bloc = sliceSource(src, "    rec.onend = () => {", "    try {\n      rec.start();", 200);
    expect(bloc).toContain("send: () => { send(); }");
    // Aucun second mécanisme : une seule occurrence de `send(` dans le bloc.
    expect(bloc.match(/send\(/g) || []).toHaveLength(1);
    // La décision n'est pas recopiée ici.
    expect(bloc).not.toContain("decideVoiceAutoSend");
    // L'ancien comportement (réécrire la zone sans jamais envoyer) a disparu.
    expect(bloc).not.toContain("if (wasActive) {");
  });

  it("la fin sur erreur referme la session (donc aucun envoi derrière)", () => {
    const blocErreur = sliceSource(src, "    rec.onerror = (ev) => {", "    rec.onend = () => {", 100);
    expect(blocErreur).toContain("voiceActive = false;");
  });

  it("la reprise en main est détectée, respectée et transmise à la décision", () => {
    const blocEtat = sliceSource(src, "  let voiceUserTookOver = false;", "  function stopVoiceInput() {", 50);
    expect(blocEtat).toContain('inputEl.addEventListener("input"');
    expect(blocEtat).toContain("if (voiceActive) voiceUserTookOver = true;");
    // Le moteur n'écrit plus la zone après la reprise en main (garde AVANT l'écriture).
    const blocResultat = sliceSource(src, "    rec.onresult = (e) => {", "    rec.onerror = (ev) => {", 100);
    const garde = blocResultat.indexOf("if (voiceUserTookOver) return;");
    const ecriture = blocResultat.indexOf("inputEl.value = preText + sep + transcript;");
    expect(garde).toBeGreaterThan(-1);
    expect(ecriture).toBeGreaterThan(-1);
    expect(garde).toBeLessThan(ecriture);
    // La fin d'écoute transmet la reprise en main à la décision unique.
    const blocFin = sliceSource(src, "    rec.onend = () => {", "    try {\n      rec.start();", 100);
    expect(blocFin).toContain("userEdited: voiceUserTookOver");
    // Chaque dictée repart proprement.
    const blocDemarrage = sliceSource(src, '    let finalText = "";', "    const norm =", 10);
    expect(blocDemarrage).toContain("voiceUserTookOver = false;");
  });
});

// ── 8. Un seul module pour les deux appelants ──────────────────────────────
describe("un seul module décide pour les DEUX barres de saisie", () => {
  const lire = (nom) =>
    fs.readFileSync(path.join(ICI, nom), "utf8").replace(/\r\n/g, "\n");

  it("agent-pi.js et super-agent.js importent le MÊME module, sans recopier la décision", () => {
    for (const fichier of ["agent-pi.js", "super-agent.js"]) {
      const src = lire(fichier);
      expect(src, fichier).toContain('import { applyVoiceEnd } from "./voice-auto-send.js";');
      // Aucune copie de la décision dans un appelant.
      expect(src, fichier).not.toContain("export function decideVoiceAutoSend");
    }
  });

  it("le module partagé reste sans envoi, sans DOM et sans dépendance", () => {
    const module = lire("voice-auto-send.js");
    for (const interdit of ["sendPrompt(", "invoke(", "document.", "window.", "import ", "fetch("]) {
      expect(module, interdit).not.toContain(interdit);
    }
  });
});
