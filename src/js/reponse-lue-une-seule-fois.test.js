// ── UNE REPONSE NE SE LIT PAS DEUX FOIS (verrou anti-regression) ───────────
//
// Le defaut rapporte : en mode Vocal, la meme phrase etait prononcee deux fois
// de suite. Deux chemins peuvent la prononcer deux fois, et AUCUN des deux
// n'avait de garde :
//
//   1. la lecture AUTOMATIQUE part de la fin de tour (`agent_end` →
//      `autoReadVocalReply`). Un tour peut avoir plusieurs fins (`agent_end`
//      de relance) ; la seule garde etait l'etat transitoire du bouton, qui
//      retombe a `idle` des que la lecture est finie ⇒ la meme reponse etait
//      relue EN ENTIER ;
//   2. la voix du SYSTEME enchaine ses morceaux sur `utterance.onend`. Un
//      `onend` signale deux fois pour le meme enonce (Chromium / WebView2)
//      lancait DEUX FOIS le morceau suivant ⇒ la meme phrase s'entendait deux
//      fois de suite.
//
// Chaque garde a son test ici, et chacun ECHOUE sans sa correction :
//   - `claimAutoRead` n'existait pas (la relecture automatique etait possible) ;
//   - `speakIndex` n'avait aucune memoire d'index (le morceau partait en double).

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import {
  AUTO_READ_FLAG,
  claimAutoRead,
  isAutoReadDone,
} from "./reponse-lue-une-seule-fois.js";
import { createSpeaker } from "./read-aloud.js";

const ROOT = path.resolve(process.cwd());

/** Source sans dependance aux fins de ligne (piege CI Windows, quality-gate 3.4). */
function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

// ── Harnais : une fausse synthese vocale, sans son ──────────────────────────

function makeSynth() {
  const synth = {
    spoken: [],
    cancelCalls: 0,
    voices: [{ lang: "fr-FR", name: "Amelie" }],
    speak(u) {
      synth.spoken.push(u);
    },
    cancel() {
      synth.cancelCalls += 1;
    },
    getVoices() {
      return synth.voices;
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return synth;
}

class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.lang = "";
    this.voice = null;
    this.onstart = null;
    this.onend = null;
    this.onerror = null;
  }
}

function makeWin(synth) {
  return {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    document: { documentElement: { lang: "fr" } },
  };
}

/** Un bouton d'ecoute, reduit a ce que la decision regarde : son `dataset`. */
function makeButton() {
  return { dataset: {} };
}

// ── 1. La lecture automatique ne part qu'UNE fois par reponse ───────────────

describe("claimAutoRead — une reponse lue automatiquement une seule fois", () => {
  it("autorise la PREMIERE lecture, refuse toutes les suivantes", () => {
    const bouton = makeButton();
    expect(claimAutoRead(bouton)).toBe(true); // la fin de tour lit la reponse
    expect(isAutoReadDone(bouton)).toBe(true);
    // Deuxieme fin de tour pour le MEME tour : rien ne repart.
    expect(claimAutoRead(bouton)).toBe(false);
    expect(claimAutoRead(bouton)).toBe(false);
    // La marque est celle du bouton (elle meurt avec la bulle).
    expect(bouton.dataset[AUTO_READ_FLAG]).toBe("1");
  });

  it("deux boutons differents sont deux lectures differentes", () => {
    const premier = makeButton();
    const second = makeButton();
    expect(claimAutoRead(premier)).toBe(true);
    expect(claimAutoRead(second)).toBe(true);
  });

  it("sans memoire possible (objet inattendu), la lecture reste possible", () => {
    // Aucune regression : on ne supprime pas une lecture legitime faute de
    // pouvoir la compter.
    expect(claimAutoRead(null)).toBe(true);
    expect(claimAutoRead({})).toBe(true);
    expect(isAutoReadDone(null)).toBe(false);
  });

  it("le bouton d'ecoute de l'ecran Vocal demande la garde avant de cliquer", () => {
    const src = readSource("src/js/super-agent.js");
    const debut = src.indexOf("function autoReadVocalReply() {");
    expect(debut).toBeGreaterThan(-1);
    const fin = src.indexOf("\n  }", debut);
    const corps = src.slice(debut, fin);
    // La lecture automatique est bien branchée sur la garde…
    expect(corps).toContain("claimAutoRead(bouton)");
    // …et l'import existe (une seule source de la decision).
    expect(src).toContain('from "./reponse-lue-une-seule-fois.js"');
    // Aucun second mecanisme de lecture n'a ete ajoute ici.
    expect(corps).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance|speak\(/);
  });
});

// ── 2. Un morceau n'est jamais prononce deux fois ──────────────────────────

describe("createSpeaker — un enonce termine deux fois ne double pas la suite", () => {
  it("un `onend` recu deux fois pour le meme morceau ne relance pas le suivant", async () => {
    const synth = makeSynth();
    const speaker = createSpeaker(makeWin(synth), { lang: "fr-FR", waitMs: 10 });
    await speaker.speak("Premier morceau. Second morceau.");
    expect(synth.spoken.map((u) => u.text)).toEqual(["Premier morceau."]);

    const premier = synth.spoken[0];
    premier.onend();
    expect(synth.spoken.map((u) => u.text)).toEqual(["Premier morceau.", "Second morceau."]);

    // Le moteur signale une SECONDE fois la fin du premier morceau : sans la
    // garde d'index, « Second morceau. » partait une deuxieme fois.
    premier.onend();
    premier.onend();
    expect(synth.spoken.map((u) => u.text)).toEqual(["Premier morceau.", "Second morceau."]);
  });

  it("la lecture normale va bien jusqu'au bout, dans l'ordre", async () => {
    const synth = makeSynth();
    const speaker = createSpeaker(makeWin(synth), { lang: "fr-FR", waitMs: 10 });
    await speaker.speak("Un. Deux. Trois.");
    for (let i = 0; i < 3; i += 1) {
      const dernier = synth.spoken[synth.spoken.length - 1];
      dernier.onend();
    }
    expect(synth.spoken.map((u) => u.text)).toEqual(["Un.", "Deux.", "Trois."]);
    // Fin de lecture : une seule annonce d'etat final, et plus rien en vol.
    expect(speaker.speaking()).toBe(false);
  });

  it("l'arret coupe toujours : plus aucun morceau ne part apres un stop", async () => {
    const synth = makeSynth();
    const speaker = createSpeaker(makeWin(synth), { lang: "fr-FR", waitMs: 10 });
    await speaker.speak("Un. Deux. Trois.");
    const premier = synth.spoken[0];
    speaker.stop();
    premier.onend();
    expect(synth.spoken.map((u) => u.text)).toEqual(["Un."]);
  });
});
