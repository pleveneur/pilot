// Tests — lecture a voix haute des reponses de l'assistant (read-aloud.js).
//
// Controles automatiques exigés par la demande :
//   1. le bouton DISPARAIT-IL d'une reponse de l'assistant ? (presence reelle
//      dans un bloc cree par l'interface, pas seulement dans le module)
//   2. le nettoyage du balisage lit-il encore des SYMBOLES ? (titres, gras,
//      liens, tableaux, blocs de code)
//   3. le decoupage par phrases est-il encore applique ? (morceaux courts,
//      ordre conserve, limite de longueur)
//   4. deux lectures peuvent-elles se SUPERPOSER ? (une seule a la fois, la
//      precedente s'arrete proprement)
//
// NB : super-agent.js importe Tauri, markdown-it, l'agent Pi… On mocke ces
// dependances et on fournit un DOM minimal, comme super-agent-bubble-badges.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// ── DOM minimal (suffisant pour creer et inspecter les bulles) ──────────────
vi.hoisted(() => {
  const noop = () => {};

  const classesOf = (el) => String(el.className || "").split(/\s+/).filter(Boolean);

  function descendants(el, out = []) {
    for (const child of el.children || []) {
      out.push(child);
      descendants(child, out);
    }
    return out;
  }

  function matches(el, selector) {
    const sel = String(selector || "").trim();
    if (sel.startsWith(".")) return classesOf(el).includes(sel.slice(1));
    return String(el.tagName || "").toLowerCase() === sel.toLowerCase();
  }

  function makeEl(tag) {
    const el = {
      tagName: tag,
      className: "",
      textContent: "",
      innerHTML: "",
      style: {},
      dataset: {},
      children: [],
      handlers: {},
      attrs: {},
      disabled: false,
      title: "",
      appendChild(c) {
        el.children.push(c);
        c.parentNode = el;
        return c;
      },
      insertBefore(c) {
        el.children.unshift(c);
        c.parentNode = el;
        return c;
      },
      removeChild(c) {
        el.children = el.children.filter((x) => x !== c);
        return c;
      },
      querySelectorAll(selector) {
        return descendants(el).filter((d) => matches(d, selector));
      },
      querySelector(selector) {
        return descendants(el).find((d) => matches(d, selector)) || null;
      },
      addEventListener(type, fn) {
        (el.handlers[type] = el.handlers[type] || []).push(fn);
      },
      removeEventListener(type, fn) {
        el.handlers[type] = (el.handlers[type] || []).filter((f) => f !== fn);
      },
      setAttribute(name, value) {
        el.attrs[name] = String(value);
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null;
      },
      remove() {
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      classList: {
        add(...names) {
          el.className = Array.from(new Set([...classesOf(el), ...names])).join(" ");
        },
        remove(...names) {
          el.className = classesOf(el).filter((c) => !names.includes(c)).join(" ");
        },
        toggle(name, force) {
          const on = force === undefined ? !classesOf(el).includes(name) : !!force;
          if (on) el.classList.add(name);
          else el.classList.remove(name);
          return on;
        },
        contains(name) {
          return classesOf(el).includes(name);
        },
      },
      get firstChild() {
        return el.children[0] || null;
      },
    };
    return el;
  }

  globalThis.window = globalThis;
  globalThis._pilotProjectPath = "C:/Travail/AutreProjet";
  globalThis.addEventListener = noop;
  globalThis.removeEventListener = noop;
  globalThis.dispatchEvent = noop;
  globalThis.document = {
    createElement: makeEl,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    body: makeEl("body"),
    documentElement: { lang: "fr" },
  };
  globalThis.__makeEl = makeEl;
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("markdown-it", () => ({ default: vi.fn(() => ({ render: () => "" })) }));
vi.mock("./icons.js", () => ({ refreshIcons: vi.fn() }));
vi.mock("./backend-info.js", () => ({ agentDisplayLabel: vi.fn(), backendKind: vi.fn() }));
vi.mock("./agent-pi.js", () => ({ appendDelegatedMessage: vi.fn(), purgeAgentTabView: vi.fn() }));
vi.mock("./loop-detection.js", () => ({
  detectRepeatedBlock: vi.fn(),
  detectRepeatedWord: vi.fn(),
  detectRepeatedToolCalls: vi.fn(),
  detectSemanticLoop: vi.fn(),
  buildToolLoopFingerprint: vi.fn(),
}));
vi.mock("./desktop-notify.js", () => ({
  notifySuperAgentDone: vi.fn(),
  playAssistantSound: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock("./agents.js", () => ({
  loadAgentRegistry: vi.fn(),
  upsertAgent: vi.fn(),
  normalizeAgent: vi.fn(),
  validateAgentId: vi.fn(),
  classifyAgent: vi.fn(),
}));
vi.mock("./agents-bus.js", () => ({
  runAgentsForAssistant: vi.fn(),
  runAgentsForAssistantAsync: vi.fn(),
  setBusNotifyCallback: vi.fn(),
}));
vi.mock("./reservations.js", () => ({ estimateAndReserve: vi.fn() }));
vi.mock("./structured-brief.js", () => ({ applyAssistantBriefEnvelope: vi.fn() }));
vi.mock("./super-agent-schedule.js", () => ({ shouldScheduleTick: vi.fn(), parseScheduleEvery: vi.fn() }));

const {
  markupToSpeech,
  splitSentences,
  pickVoiceForLang,
  speechLang,
  speechAvailable,
  ensureVoice,
  createSpeaker,
  createReadAloudButton,
  messageTextOf,
  SPEECH_MAX_CHUNK,
} = await import("./read-aloud.js");
const { createSuperAgentBlock } = await import("./super-agent.js");

// ── Utilitaires d'essai ─────────────────────────────────────────────────────

/** Fausse synthese vocale : enregistre ce qui serait lu, sans son. */
function makeSynth({ voices = [{ lang: "fr-FR", name: "Amelie" }] } = {}) {
  const listeners = new Map();
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
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener(type, fn) {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
    fire(type) {
      const fn = listeners.get(type);
      if (fn) fn();
    },
    listenerCount() {
      return listeners.size;
    },
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

/** Fausse fenetre porteuse de la synthese vocale. */
function makeWin(synth) {
  return {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    document: { documentElement: { lang: "fr" } },
  };
}

/** Classe tous les elements sous `el` par nom de classe (inspection d'arbre). */
function findAll(el, className) {
  return el.querySelectorAll("." + className);
}

/** Fait "avancer" la lecture : termine le dernier enonce parle. */
function finishLast(synth) {
  const last = synth.spoken[synth.spoken.length - 1];
  if (last && typeof last.onend === "function") last.onend();
}

/** Deroule toute la lecture (tous les morceaux) jusqu'au dernier. */
function playUntilEnd(synth) {
  let guard = 0;
  while (guard < 1000) {
    const count = synth.spoken.length;
    finishLast(synth);
    if (synth.spoken.length === count) return;
    guard += 1;
  }
}

const ROOT = path.resolve(process.cwd());

/** Source sans dependance aux fins de ligne (piege CI Windows, quality-gate 3.4). */
function readSource(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
}

// ── 1. Nettoyage du balisage (la voix ne doit pas debiter de symboles) ──────

describe("markupToSpeech — texte lisible par la voix", () => {
  it("ne lit PAS le contenu d'un bloc de code (et le signale)", () => {
    const text = markupToSpeech("Voici le code :\n```js\nconst secret = 42;\nlancer();\n```\nEt la suite.");
    expect(text).toMatch(/bloc de code/i);
    expect(text).not.toContain("const secret");
    expect(text).not.toContain("lancer()");
    expect(text).not.toContain("```");
  });

  it("ne lit pas non plus un bloc de code HTML (<pre>)", () => {
    const text = markupToSpeech("<p>Avant</p><pre><code>echo interdit</code></pre><p>Apres</p>");
    expect(text).toMatch(/bloc de code/i);
    expect(text).not.toContain("echo interdit");
  });

  it("remplace un lien par son libelle (jamais l'adresse)", () => {
    const text = markupToSpeech("Voir [la documentation](https://exemple.test/doc) pour le reste.");
    expect(text).toContain("la documentation");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("](");
  });

  it("retire titres, puces, gras, italique, code inline, citations et barres de tableau", () => {
    const md = [
      "## Titre de section",
      "**Importance** et *nuance* et `code_inline`.",
      "- premiere puce",
      "- seconde puce",
      "> une citation",
      "| Colonne A | Colonne B |",
      "| --- | --- |",
      "| valeur 1 | valeur 2 |",
      "---",
    ].join("\n");
    const text = markupToSpeech(md);
    for (const symbol of ["#", "**", "*", "`", "|", "---", ">"]) {
      expect(text).not.toContain(symbol);
    }
    expect(text).toContain("Titre de section");
    expect(text).toContain("Importance");
    expect(text).toContain("premiere puce");
    expect(text).toContain("valeur 1");
  });

  it("retire le balisage HTML rendu et garde la ponctuation", () => {
    const html = '<h2>Titre</h2><p>Une phrase <strong>forte</strong>.</p><ul><li>Un point</li></ul>';
    const text = markupToSpeech(html);
    expect(text).not.toContain("<");
    expect(text).not.toContain("strong");
    expect(text).toContain("Titre");
    expect(text).toContain("Une phrase forte.");
    expect(text).toContain("Un point");
  });

  it("est sans effet sur un texte deja propre (idempotent)", () => {
    const clean = "Une phrase simple. Et une autre !";
    expect(markupToSpeech(clean)).toBe(clean);
    expect(markupToSpeech(markupToSpeech(clean))).toBe(clean);
  });
});

// ── 2. Decoupage par phrases ────────────────────────────────────────────────

describe("splitSentences — morceaux courts, ordre conserve", () => {
  it("decoupe une phrase par phrase en gardant la ponctuation", () => {
    const chunks = splitSentences("Premiere phrase. Deuxieme phrase ! Troisieme ?");
    expect(chunks).toEqual(["Premiere phrase.", "Deuxieme phrase !", "Troisieme ?"]);
  });

  it("borne la longueur d'une phrase trop longue, sans perdre de texte", () => {
    const long = "mot ".repeat(200).trim() + ".";
    const chunks = splitSentences(long, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(60);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " "));
  });

  it("respecte la limite par defaut et separe aussi sur les sauts de ligne", () => {
    const text = "Une phrase.\nUne autre phrase.\n" + "Longue ".repeat(100) + "fin.";
    const chunks = splitSentences(text);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(SPEECH_MAX_CHUNK);
  });

  it("renvoie une liste vide pour un texte vide", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   \n ")).toEqual([]);
    expect(splitSentences(null)).toEqual([]);
  });
});

// ── 3. Langue et choix de voix ──────────────────────────────────────────────

describe("voix — langue de l'interface d'abord", () => {
  it("demande le francais quand l'interface est en francais", () => {
    expect(speechLang({ documentElement: { lang: "fr" } }, { language: "en-US" })).toBe("fr-FR");
    expect(speechLang({ documentElement: { lang: "fr-FR" } }, null)).toBe("fr-FR");
    expect(speechLang({ documentElement: { lang: "" } }, { language: "en-GB" })).toBe("en-GB");
  });

  it("prend la premiere voix disponible dans cette langue", () => {
    const voices = [
      { lang: "en-US", name: "Alex" },
      { lang: "fr-FR", name: "Amelie" },
      { lang: "fr-CA", name: "Thomas" },
    ];
    expect(pickVoiceForLang(voices, "fr-FR").name).toBe("Amelie");
    expect(pickVoiceForLang(voices, "fr-CA").name).toBe("Thomas");
    expect(pickVoiceForLang(voices, "de-DE")).toBe(null);
    expect(pickVoiceForLang([], "fr-FR")).toBe(null);
  });

  it("signale l'absence de synthese vocale dans la fenetre", () => {
    expect(speechAvailable({})).toBe(false);
    expect(speechAvailable(null)).toBe(false);
    expect(speechAvailable(makeWin(makeSynth()))).toBe(true);
  });
});

// ── 4. Une seule lecture a la fois, decoupage enchainee, arret ──────────────

describe("createSpeaker — une lecture, des morceaux, un arret net", () => {
  it("enonce les morceaux DANS L'ORDRE, un par un", async () => {
    const synth = makeSynth();
    const speaker = createSpeaker(makeWin(synth), { lang: "fr-FR" });
    await speaker.speak("Premier morceau. Second morceau. Troisieme morceau.");
    expect(synth.spoken.map((u) => u.text)).toEqual(["Premier morceau."]);
    finishLast(synth);
    expect(synth.spoken.map((u) => u.text)).toEqual(["Premier morceau.", "Second morceau."]);
    finishLast(synth);
    expect(synth.spoken.map((u) => u.text)).toEqual([
      "Premier morceau.",
      "Second morceau.",
      "Troisieme morceau.",
    ]);
    // Chaque enonce porte la langue demandee (voix francaise).
    expect(synth.spoken[0].lang).toBe("fr-FR");
    expect(synth.spoken[0].voice && synth.spoken[0].voice.name).toBe("Amelie");
  });

  it("ne fait JAMAIS se superposer deux lectures", async () => {
    const synth = makeSynth();
    const win = makeWin(synth);
    const premier = createSpeaker(win, { lang: "fr-FR" });
    const second = createSpeaker(win, { lang: "fr-FR" });

    await premier.speak("Texte du premier message. Suite du premier message.");
    const enoncesPremier = synth.spoken.length;
    expect(enoncesPremier).toBe(1);
    expect(premier.speaking()).toBe(true);

    await second.speak("Texte du second message.");
    // La lecture precedente a ete ARRETEE (cancel) puis remplacee.
    expect(synth.cancelCalls).toBeGreaterThan(0);
    expect(premier.speaking()).toBe(false);
    expect(second.speaking()).toBe(true);
    // Le premier message ne reprend pas : son enonce termine ne relance rien.
    const textsOfSecond = synth.spoken.slice(enoncesPremier).map((u) => u.text);
    expect(textsOfSecond.join(" ")).toContain("second message");
    expect(textsOfSecond.join(" ")).not.toContain("premier message");
    finishLast(synth);
    expect(synth.spoken.slice(enoncesPremier).map((u) => u.text).join(" ")).not.toContain("premier message");
  });

  it("s'arrete a tout moment (cancel + plus aucun morceau ensuite)", async () => {
    const synth = makeSynth();
    const speaker = createSpeaker(makeWin(synth), { lang: "fr-FR" });
    await speaker.speak("Un. Deux. Trois.");
    const count = synth.spoken.length;
    speaker.stop();
    expect(synth.cancelCalls).toBeGreaterThan(0);
    expect(speaker.speaking()).toBe(false);
    finishLast(synth);
    expect(synth.spoken.length).toBe(count);
  });

  it("attend le chargement des voix (sinon la premiere lecture serait muette)", async () => {
    const synth = makeSynth({ voices: [] });
    const speaker = createSpeaker(makeWin(synth), { lang: "fr-FR", waitMs: 50 });
    const done = speaker.speak("Bonjour.");
    await Promise.resolve();
    await Promise.resolve();
    // Voix pas encore chargees : on n'a rien lance.
    expect(synth.spoken.length).toBe(0);
    synth.voices = [{ lang: "fr-FR", name: "Amelie" }];
    synth.fire("voiceschanged");
    await done;
    expect(synth.spoken.length).toBe(1);
    expect(synth.spoken[0].voice && synth.spoken[0].voice.name).toBe("Amelie");
  });

  it("ensureVoice retombe sur null sans bloquer quand aucune voix n'arrive", async () => {
    const synth = makeSynth({ voices: [] });
    await expect(ensureVoice(synth, "fr-FR", 10)).resolves.toBe(null);
    expect(synth.listenerCount()).toBe(0); // plus d'ecouteur en attente
  });
});

// ── 5. Bouton : present, lisible, etat visible, cas d'echec ────────────────

describe("bouton de lecture", () => {
  let synth;

  beforeEach(() => {
    synth = makeSynth();
    globalThis.speechSynthesis = synth;
    globalThis.SpeechSynthesisUtterance = FakeUtterance;
  });

  afterEach(() => {
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
  });

  it("affiche l'etat en TEXTE et par un changement visuel (sans couleur)", async () => {
    const holder = globalThis.document.createElement("div");
    const button = createReadAloudButton({
      getText: () => "Texte a lire.",
      win: globalThis,
      doc: globalThis.document,
    });
    holder.appendChild(button);
    expect(button.querySelector(".agent-read-label").textContent).toBe("\u00c9couter");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.querySelector(".agent-read-icon").innerHTML).toContain('data-lucide="volume-2"');

    await button.handlers.click[0]();
    expect(button.querySelector(".agent-read-label").textContent).toBe("Arr\u00eater");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("agent-read-btn-speaking")).toBe(true);
    expect(button.querySelector(".agent-read-icon").innerHTML).toContain('data-lucide="square"');
    expect(button.getAttribute("aria-label")).toContain("Arr\u00eater");

    // Second clic : arret.
    await button.handlers.click[0]();
    expect(button.querySelector(".agent-read-label").textContent).toBe("\u00c9couter");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(synth.cancelCalls).toBeGreaterThan(0);
  });

  it("reste present mais INACTIF sans synthese vocale, avec explication", () => {
    delete globalThis.speechSynthesis;
    delete globalThis.SpeechSynthesisUtterance;
    const button = createReadAloudButton({
      getText: () => "Texte.",
      win: globalThis,
      doc: globalThis.document,
    });
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/synth\u00e8se vocale/i);
    expect(button.getAttribute("aria-label")).toMatch(/synth\u00e8se vocale/i);
    expect(button.classList.contains("agent-read-btn-unavailable")).toBe(true);
  });

  it("ne lit pas de symboles : le texte envoye a la synthese est nettoye", async () => {
    const block = createSuperAgentBlock(globalThis.document.createElement("div"));
    const flow = block.querySelector(".agent-stream-flow");
    const section = globalThis.document.createElement("div");
    section.className = "agent-text-section";
    section.innerHTML = "## Titre\n**gras** et [lien](https://exemple.test)\n```js\nsecret();\n```";
    flow.appendChild(section);

    const button = block.querySelector(".agent-read-btn");
    await button.handlers.click[0]();
    playUntilEnd(synth);
    const lu = synth.spoken.map((u) => u.text).join(" ");
    expect(lu).toContain("Titre");
    expect(lu).toContain("gras");
    expect(lu).toContain("lien");
    expect(lu).not.toContain("#");
    expect(lu).not.toContain("**");
    expect(lu).not.toContain("https://");
    expect(lu).not.toContain("secret()");
  });

  it("messageTextOf ignore les blocs de code et la reflexion", () => {
    const block = createSuperAgentBlock(globalThis.document.createElement("div"));
    const flow = block.querySelector(".agent-stream-flow");
    const section = globalThis.document.createElement("div");
    section.className = "agent-text-section";
    section.innerHTML = "<p>Reponse lisible.</p><pre><code>code_non_lu()</code></pre>";
    flow.appendChild(section);
    const thinking = globalThis.document.createElement("div");
    thinking.className = "agent-thinking";
    thinking.textContent = "reflexion privee";
    flow.appendChild(thinking);

    const text = messageTextOf(block);
    expect(text).toContain("Reponse lisible.");
    expect(text).not.toContain("code_non_lu()");
  });
});

// ── 6. Bouton pose sur les SEULES reponses de l'assistant ─────────────────

describe("presence du bouton dans une reponse reelle", () => {
  it("le bloc de reponse de l'assistant porte le bouton (rangee d'actions)", () => {
    const block = createSuperAgentBlock(globalThis.document.createElement("div"));
    const rows = findAll(block, "agent-message-actions");
    expect(rows.length).toBe(1);
    const buttons = findAll(block, "agent-read-btn");
    expect(buttons.length).toBe(1);
    // Rangee d'actions posee sous la bulle, dans le message assistant.
    expect(block.classList.contains("agent-message-assistant")).toBe(true);
    expect(block.children[0].className).toContain("agent-bubble-assistant");
    expect(button_present_in_bubble_row(block)).toBe(true);
  });

  it("le bouton est branche DANS les fabriques de reponse assistant, jamais ailleurs", () => {
    // Controle de branchement : une seule pose par fichier, et cette pose est
    // dans la fonction qui cree une reponse de l'assistant (ni message
    // utilisateur, ni evenement systeme).
    const cases = [
      { file: "src/js/super-agent.js", factory: "export function createSuperAgentBlock(" },
      { file: "src/js/agent-pi.js", factory: "function createAssistantBlock(" },
    ];
    for (const { file, factory } of cases) {
      const src = readSource(file);
      // Appel REEL (et non une simple mention dans un commentaire).
      const occurrences = (src.match(/attachReadAloud\(el,/g) || []).length;
      expect(occurrences, `${file} : une seule pose attendue`).toBe(1);
      const start = src.indexOf(factory);
      expect(start, `${file} : fabrique introuvable`).toBeGreaterThan(-1);
      const end = src.indexOf("\n}\n", start);
      expect(end, `${file} : fin de fabrique introuvable`).toBeGreaterThan(start);
      expect(src.slice(start, end)).toContain("attachReadAloud(el,");
      // Aucun autre message ne porte le bouton : les fabriques de message
      // utilisateur / systeme ne mentionnent jamais la pose.
      const userFactory = src.slice(
        file.includes("agent-pi") ? src.indexOf("export function appendDelegatedMessage(") : src.indexOf("function appendMessage("),
      );
      if (userFactory.length) {
        expect(userFactory.slice(0, userFactory.indexOf("\n}\n"))).not.toContain("attachReadAloud(");
      }
    }
  });
});

/** Le bouton est-il dans la rangee d'actions du message (et pas dans la bulle) ? */
function button_present_in_bubble_row(block) {
  const row = findAll(block, "agent-message-actions")[0];
  if (!row) return false;
  const bubble = findAll(block, "agent-bubble-assistant")[0];
  const inBubble = findAll(bubble, "agent-read-btn").length > 0;
  return findAll(row, "agent-read-btn").length === 1 && !inBubble;
}
