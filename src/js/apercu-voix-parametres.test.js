// Tests — ecouter chaque voix proposee dans les Parametres (apercu avant de
// choisir). Reglage : Parametres → onglet « Assistant » → section « Lecture des
// reponses a voix haute ».
//
// Ces controles tiennent la demande telle qu'elle a ete formulee :
//   1. l'apercu passe par le MEME chemin de lecture que le bouton « Ecouter »
//      pose sous une reponse : un SECOND moteur, un SECOND nettoyage du texte ou
//      une seconde liste de voix font ECHOUER ces tests ;
//   2. UN SEUL apercu a la fois (ecouter une autre voix arrete la precedente) et
//      quitter les Parametres arrete l'ecoute en cours ;
//   3. aucun echec muet et aucune exception : l'ecran des Parametres reste
//      utilisable ;
//   4. un modele local NON telecharge ne joue JAMAIS la voix du systeme a la
//      place : c'est dit, et le telechargement reste un geste de l'utilisateur.
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// read-aloud.js importe local-voice.js (donc la couche Tauri) : on la neutralise
// comme dans les autres tests de lecture.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const { previewVoice, previewNotInstalledHint, stopReading, VOICE_PREVIEW_SAMPLE } = await import(
  "./read-aloud.js"
);

const ROOT = path.resolve(process.cwd());

/** Source sans dependance aux fins de ligne (piege CI Windows, quality-gate 3.4). */
function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

/** Nombre d'occurrences (verrou des tests de source). */
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

/**
 * Corps d'une fonction : du marqueur jusqu'a l'accolade fermante equilibree.
 * Sert a verrouiller ce qui se passe DANS l'apercu (et nulle part ailleurs).
 */
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

// ── Fausse synthese vocale (aucun son) ─────────────────────────────────────

function makeSynth({ voices = [{ lang: "fr-FR", name: "Amelie", voiceURI: "amelie" }] } = {}) {
  const synth = {
    spoken: [],
    cancelCalls: 0,
    voices,
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

/** Attend un fait observable (jamais un delai suppose suffisant). */
function waitUntil(predicate, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("condition non atteinte"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** Termine le dernier enonce parle (la lecture avance d'un morceau). */
function finishLast(synth) {
  const last = synth.spoken[synth.spoken.length - 1];
  if (last && typeof last.onend === "function") last.onend();
}

// ── 1. Un seul chemin de lecture (aucun second moteur, aucun second nettoyage) ──

describe("l'apercu reutilise le chemin de lecture reel", () => {
  const readAloud = readSource("src/js/read-aloud.js");
  const settings = readSource("src/js/settings.js");

  it("la prise de parole n'existe qu'a UN endroit (aucun second moteur)", () => {
    // Si quelqu'un fabrique un second lecteur pour l'apercu, ces deux compteurs
    // passent a 2 et le test echoue.
    expect(countOf(readAloud, "new Utterance(")).toBe(1);
    expect(countOf(readAloud, "synth.speak(")).toBe(1);
  });

  it("le nettoyage du texte n'existe qu'a UN endroit (speech-text.js)", () => {
    // Un seul endroit nettoie ET decoupe pour la voix : `speak`.
    expect(countOf(readAloud, "splitSentences(textForSpeech(")).toBe(1);
    // L'apercu n'a ni le droit de nettoyer ni celui de decouper lui-meme.
    const preview = bodyOf(readAloud, "export async function previewVoice(choice, options = {})");
    expect(preview).not.toContain("textForSpeech(");
    expect(preview).not.toContain("splitSentences(");
    expect(preview).not.toContain("new Utterance");
    expect(preview).not.toContain("speechSynthesis");
  });

  it("l'apercu passe par createSpeaker(), puis par speak()", () => {
    const preview = bodyOf(readAloud, "export async function previewVoice(choice, options = {})");
    expect(preview).toContain("createSpeaker(");
    expect(preview).toContain(".speak(");
    expect(preview).toContain("VOICE_PREVIEW_SAMPLE");
  });

  it("les Parametres ne parlent jamais directement a la synthese", () => {
    // Lire la LISTE des voix est permis ; parler ne l'est pas.
    expect(countOf(settings, ".speak(")).toBe(0);
    expect(countOf(settings, "SpeechSynthesisUtterance")).toBe(0);
    expect(countOf(settings, "createSpeaker(")).toBe(0);
    expect(countOf(settings, "tts_local_synthesize")).toBe(0);
    // Un seul point d'entree, l'apercu.
    expect(countOf(settings, "previewVoice(")).toBe(1);
  });

  it("l'apercu lit bien par le chemin commun (etat « speaking » puis « ended »)", async () => {
    const synth = makeSynth();
    const win = makeWin(synth);
    const states = [];
    const done = previewVoice("amelie", { win, onstate: (s) => states.push(s) });
    await waitUntil(() => synth.spoken.length === 1);
    expect(states).toContain("speaking");
    // Le texte parle est un morceau du nettoyage commun : jamais le balisage.
    expect(synth.spoken[0].lang).toBe("fr-FR");
    expect(synth.spoken[0].voice.name).toBe("Amelie");
    for (let guard = 0; guard < 50 && !states.includes("ended"); guard += 1) {
      finishLast(synth);
      await Promise.resolve();
    }
    expect(await done).toEqual({ ok: true });
    expect(states).toContain("ended");
  });
});

// ── 2. Une seule lecture a la fois ─────────────────────────────────────────

describe("un seul apercu a la fois", () => {
  it("ecouter une autre voix arrete proprement la precedente", async () => {
    const synth = makeSynth({
      voices: [
        { lang: "fr-FR", name: "Amelie", voiceURI: "amelie" },
        { lang: "fr-FR", name: "Thomas", voiceURI: "thomas" },
      ],
    });
    const win = makeWin(synth);
    const firstStates = [];
    const secondStates = [];

    const first = previewVoice("amelie", { win, onstate: (s) => firstStates.push(s) });
    await waitUntil(() => synth.spoken.length === 1);
    expect(synth.spoken[0].voice.name).toBe("Amelie");

    const second = previewVoice("thomas", { win, onstate: (s) => secondStates.push(s) });
    await waitUntil(() => synth.spoken.length === 2);
    // La premiere prise de parole a ete coupee (aucune superposition).
    expect(synth.cancelCalls).toBeGreaterThanOrEqual(1);
    expect(firstStates).toContain("stopped");
    expect(synth.spoken[1].voice.name).toBe("Thomas");
    // Une fois arretee, la premiere lecture ne relance RIEN.
    const before = synth.spoken.length;
    synth.spoken[0].onend();
    expect(synth.spoken.length).toBe(before);
    // La premiere promesse se termine sans erreur.
    await first;

    // On termine la seconde.
    for (let guard = 0; guard < 50 && !secondStates.includes("ended"); guard += 1) {
      finishLast(synth);
      await Promise.resolve();
    }
    expect(await second).toEqual({ ok: true });
    expect(secondStates).toContain("ended");
  });

  it("la phrase d'exemple est courte (deux phrases au plus)", () => {
    expect(typeof VOICE_PREVIEW_SAMPLE).toBe("string");
    expect(VOICE_PREVIEW_SAMPLE.length).toBeGreaterThan(40);
    expect(VOICE_PREVIEW_SAMPLE.length).toBeLessThanOrEqual(160);
    const sentences = VOICE_PREVIEW_SAMPLE.split(/[.!?]+/).filter((s) => s.trim());
    expect(sentences.length).toBeLessThanOrEqual(2);
    // En francais : la phrase est accentuee, elle sert a juger la voix.
    expect(VOICE_PREVIEW_SAMPLE).toMatch(/[éèàêûô]/);
  });

  it("quitter les Options arrete l'ecoute en cours", () => {
    const settings = readSource("src/js/settings.js");
    // Annuler (btnClose) et le ✕ de l'onglet passent par le MEME retour a zero.
    // Depuis le lot B (Reglages en onglet), ce retour NE MASQUE PLUS rien :
    // ajouter `hidden` viderait l'ecran de l'onglet.
    const closeBody = bodyOf(settings, 'btnClose.addEventListener("click"');
    expect(closeBody).toContain("resetSettingsContent()");
    expect(closeBody).not.toContain('classList.add("hidden")');
    // Enregistrer arrete aussi l'ecoute en cours (aucun son orphelin), sans
    // fermer l'onglet : on voit le resultat de ce qu'on vient de changer.
    const saveBody = bodyOf(settings, 'btnSave.addEventListener("click"');
    expect(saveBody).toContain("stopReading()");
    expect(saveBody).not.toContain('classList.add("hidden")');
    // Le retour a zero contient l'arret de la lecture.
    const resetBody = bodyOf(settings, "async function resetSettingsContent()");
    expect(resetBody).toContain("stopReading()");
    // Fermer la fenetre : aucun son orphelin.
    expect(settings).toContain('window.addEventListener("pagehide"');
  });
});

// ── 3. Aucun echec muet, aucune exception ──────────────────────────────────

describe("un echec ne part jamais en silence", () => {
  it("sans synthese vocale : l'apercu le DIT (aucune exception)", async () => {
    const win = { document: { documentElement: { lang: "fr" } } };
    const states = [];
    const result = await previewVoice("", { win, onstate: (s) => states.push(s) });
    expect(result).toEqual({ ok: false });
    expect(states).toContain("unavailable");
  });

  it("aucune voix installee : l'apercu le DIT", async () => {
    const synth = makeSynth({ voices: [] });
    const win = makeWin(synth);
    const states = [];
    const result = await previewVoice("", { win, onstate: (s) => states.push(s), waitMs: 0 });
    expect(result).toEqual({ ok: false });
    expect(states).toContain("no-voice");
  });

  it("une synthese qui tombe en panne ne leve rien et ne bloque pas l'ecran", async () => {
    const synth = makeSynth();
    synth.speak = () => {
      throw new Error("panne de la synthese");
    };
    const win = makeWin(synth);
    const states = [];
    const result = await previewVoice("amelie", { win, onstate: (s) => states.push(s) });
    expect(result).toEqual({ ok: true });
    expect(states).toContain("speaking");
    // Le meme arret que la lecture : le bouton de la rangee revient a « Ecouter ».
    expect(() => stopReading()).not.toThrow();
  });

  it("un message d'echec est AFFICHE sur la rangee concernee", () => {
    const settings = readSource("src/js/settings.js");
    const body = bodyOf(settings, "async function startVoicePreview");
    expect(body).toContain("readAloudStateLabel(");
    expect(body).toContain("setPreviewMessage(");
    expect(body).toContain("onstate");
    // Le meme bouton devient « Arreter » (libelle en texte clair).
    expect(settings).toContain("setPreviewButtonState(");
    const button = bodyOf(settings, "function setPreviewButtonState");
    expect(button).toContain("aria-pressed");
    expect(button).toContain("data");
  });
});

// ── 4. Modele non telecharge : jamais la voix du systeme a la place ───────

describe("modele local absent : on le dit, on ne lit pas une autre voix", () => {
  it("le message nomme la voix, dit « pas encore installee » et propose le telechargement", () => {
    const hint = previewNotInstalledHint("Français — voix de femme (qualité moyenne, 60 Mo)");
    expect(hint).toMatch(/pas encore install/);
    expect(hint).toMatch(/Installer la voix locale/);
    expect(hint).toMatch(/sans votre geste/);
    expect(hint).toMatch(/voix de femme/);
    // Aucun terme technique dans ce que voit l'utilisateur.
    expect(hint).not.toMatch(/\.onnx|espeak|piper|exception|errno/i);
  });

  it("la verification d'installation PRECEDE toute lecture (aucun repli silencieux)", () => {
    const settings = readSource("src/js/settings.js");
    const body = bodyOf(settings, "async function startVoicePreview");
    const installedAt = body.indexOf("installed");
    const previewAt = body.indexOf("previewVoice(");
    expect(installedAt).toBeGreaterThan(-1);
    expect(previewAt).toBeGreaterThan(-1);
    expect(installedAt).toBeLessThan(previewAt);
    expect(body).toContain("previewNotInstalledHint(");
    // Aucun telechargement lance par l'apercu lui-meme (geste obligatoire).
    expect(body).not.toContain("downloadLocalVoiceModel(");
    expect(body).not.toContain("startReadAloudDownload(");
  });

  it("un repli du moteur local reste visible sur la rangee (et journalise)", () => {
    const settings = readSource("src/js/settings.js");
    const body = bodyOf(settings, "async function startVoicePreview");
    expect(body).toContain('"local-fallback"');
  });
});

// ── 5. Une seule liste de voix et un seul emplacement dans l'interface ────

describe("les rangees d'ecoute reprennent la liste du selecteur", () => {
  it("la liste des voix proposees est calculee UNE fois (aucune seconde liste)", () => {
    const settings = readSource("src/js/settings.js");
    const render = bodyOf(settings, "function renderReadAloudVoice");
    expect(countOf(render, "voiceChoiceOptions(")).toBe(1);
    expect(render).toContain("renderVoicePreviews(options)");
    const rows = bodyOf(settings, "function renderVoicePreviews");
    expect(rows).not.toContain("availableVoices(");
    expect(rows).not.toContain("voiceChoiceOptions(");
    expect(rows).not.toContain("LOCAL_VOICE_MODELS");
  });

  it("le conteneur d'ecoute est dans la section existante (et une seule fois)", () => {
    const html = readSource("index.html");
    expect(countOf(html, 'id="read-aloud-voice-previews"')).toBe(1);
    const sectionAt = html.indexOf('id="settings-section-read-aloud"');
    expect(sectionAt).toBeGreaterThan(-1);
    expect(html.indexOf('id="read-aloud-voice-previews"')).toBeGreaterThan(sectionAt);
    // Le selecteur reste l'unique champ de voix.
    expect(countOf(html, 'id="setting-read-aloud-voice"')).toBe(1);
  });

  it("la documentation decrit l'ecoute d'exemple (spec, aide, README)", () => {
    const spec = readSource("spec_read_aloud.md");
    expect(spec).toContain("previewVoice");
    expect(spec).toMatch(/aper/);
    const help = readSource("help/overview.md");
    const from = help.indexOf("<!-- HELP:lire-reponses -->");
    const to = help.indexOf("<!-- /HELP:lire-reponses -->");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const block = help.slice(from, to);
    expect(block).toContain("phrase d'exemple");
    const readme = readSource("README.md");
    expect(readme).toContain("phrase d'exemple");
  });
});
