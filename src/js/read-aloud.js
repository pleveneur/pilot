// read-aloud.js — Lecture a voix haute des reponses de l'assistant.
//
// Technologie : la synthese vocale DEJA presente dans la fenetre
// (`window.speechSynthesis`, Web Speech API). Aucune dependance externe, aucun
// service en ligne, aucun telechargement, aucun cout.
//
// Regles tenues ici (elles ne vivent qu'a cet endroit) :
//   1. Un clic LIT le message, un second clic ARRETE la lecture.
//   2. AUCUNE lecture automatique : rien ne part sans un clic.
//   3. UNE SEULE lecture a la fois : lancer un autre message arrete proprement
//      le precedent (aucun chevauchement, jamais deux voix ensemble).
//   4. Le texte lu est nettoye : plus de balisage (titres, listes, gras, liens,
//      tableaux), les blocs de code ne sont PAS debites, les liens sont lus par
//      leur libelle.
//   5. Le texte est decoupe phrase par phrase (avec une limite de longueur) et
//      enchaine dans l'ordre ; l'arret fonctionne a tout moment.
//   6. Synthese vocale absente ou aucune voix disponible : le bouton reste
//      present mais INACTIF, avec une explication courte en infobulle.
//   7. Langue : celle de l'interface, et on prend la premiere voix disponible
//      dans cette langue. Le chargement des voix est attendu (sinon la premiere
//      lecture partirait en silence).
//
// Le module est sans dependance : il recoit `win` (fenetre porteuse de
// `speechSynthesis`) et `doc` — ce qui le rend testable sans navigateur.

/** Longueur maximale d'un morceau lu (en caracteres). */
export const SPEECH_MAX_CHUNK = 180;

/** Attente maximale du chargement des voix (ms) avant de parler quand meme. */
export const VOICES_WAIT_MS = 1500;

/** Message court affiche quand la bulle ne contient rien a lire. */
const EMPTY_MESSAGE_HINT = "Rien a lire dans ce message.";

/** Lecture en cours, UNE SEULE a la fois pour toute l'application. */
let currentPlayback = null;

/** Compteur d'identifiants de lecture (jeton d'annulation). */
let playbackSeq = 0;

/** Appelle `fn` sans jamais laisser remonter d'exception (API navigateur). */
function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/**
 * Vrai si la synthese vocale est utilisable dans cette fenetre.
 * @param {Window} [win]
 * @returns {boolean}
 */
export function speechAvailable(win) {
  const w = win || globalThis.window;
  return !!(w && w.speechSynthesis && typeof w.SpeechSynthesisUtterance === "function");
}

/**
 * Langue a demander a la synthese vocale : celle de l'interface
 * (`<html lang>`), sinon celle du systeme, sinon le francais.
 * @param {Document} [doc]
 * @param {Navigator} [nav]
 * @returns {string} ex. "fr-FR"
 */
export function speechLang(doc, nav) {
  const d = doc || globalThis.document;
  const declared = (d && d.documentElement && d.documentElement.lang) || "";
  if (String(declared).trim()) return normalizeLang(declared);
  const n = nav || globalThis.navigator;
  const system = (n && n.language) || "";
  if (String(system).trim()) return normalizeLang(system);
  return "fr-FR";
}

/** Normalise une langue ("fr", "fr-fr", "fr_FR" -> "fr-FR"). */
function normalizeLang(raw) {
  const cleaned = String(raw || "").trim().replace(/_/g, "-");
  if (!cleaned) return "fr-FR";
  const parts = cleaned.split("-");
  const base = parts[0].toLowerCase();
  if (parts.length === 1) return base === "fr" ? "fr-FR" : base;
  return base + "-" + parts[1].toUpperCase();
}

/** Base de langue ("fr-FR" -> "fr") pour comparer des voix. */
function langBase(raw) {
  return String(raw || "").trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Premiere voix disponible dans la langue demandee (comparaison sur la langue
 * de base : une voix "fr-CA" convient a une interface "fr-FR").
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} lang
 * @returns {SpeechSynthesisVoice|null}
 */
export function pickVoiceForLang(voices, lang) {
  const list = (Array.isArray(voices) ? voices : []).filter(Boolean);
  if (!list.length) return null;
  const wanted = normalizeLang(lang).toLowerCase();
  const exact = list.find(
    (v) => String(v.lang || "").replace(/_/g, "-").toLowerCase() === wanted,
  );
  if (exact) return exact;
  const base = langBase(lang);
  return list.find((v) => langBase(v.lang) === base) || null;
}

/**
 * Nettoie un texte (Markdown rendu en HTML et/ou Markdown brut) pour qu'il soit
 * LISIBLE par la voix : aucun symbole de balisage, blocs de code non debites,
 * liens remplaces par leur libelle, ponctuation conservee (elle donne le
 * rythme de la phrase).
 * @param {string} raw
 * @returns {string}
 */
export function markupToSpeech(raw) {
  let t = String(raw == null ? "" : raw);

  // Blocs de code : on ne les LIT PAS (on signale seulement qu'il y en a).
  t = t.replace(/```[\s\S]*?```/g, " bloc de code. ");
  t = t.replace(/~~~[\s\S]*?~~~/g, " bloc de code. ");
  t = t.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, " bloc de code. ");
  // Code en ligne : le contenu (nom de fichier, commande) est lisible, on garde.
  t = t.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "$1");

  // Liens et images : on garde le LIBELLE, jamais l'adresse.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");

  // Balisage HTML structurel -> ponctuation et pauses.
  t = t.replace(/<\s*br\s*\/?>/gi, "\n");
  t = t.replace(/<\s*li[^>]*>/gi, "\n");
  t = t.replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|section|article|blockquote|ul|ol)\s*>/gi, ". ");
  t = t.replace(/<[^>]+>/g, " ");

  // Tableaux Markdown : lignes de separation supprimees, barres -> pauses.
  t = t.replace(/^[ \t]*\|?[\s:|-]*-[\s:|-]*\|[ \t]*$/gm, " ");
  t = t.replace(/\|/g, " ");

  // Titres, citations, puces, numeros de liste : symboles retires.
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "");
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, "");
  t = t.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  t = t.replace(/^[ \t]*\d+[.)][ \t]+/gm, "");
  // Regles horizontales (---, ***, ___).
  t = t.replace(/^[ \t]*([-*_])[ \t]*\1[ \t]*\1[\s\S]*$/gm, " ");

  // Emphase / code inline / raye : symboles retires.
  t = t.replace(/\*\*|__|~~/g, "");
  t = t.replace(/[*`]/g, "");

  // Entites HTML courantes.
  t = t
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&(?:hellip|mldr);/gi, "...");

  // Espaces et ponctuation : une phrase propre, sans ".." ni "mot .".
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\s*\n\s*/g, "\n");
  t = t.replace(/([.!?])[ \t]*\./g, "$1");
  t = t.replace(/\s+([.,])/g, "$1");
  t = t.replace(/\n{2,}/g, "\n");
  return t.trim();
}

/**
 * Decoupe un texte en morceaux courts, phrase par phrase, en preservant l'ordre.
 * Une phrase trop longue est recoupee (virgule, point-virgule, deux-points,
 * puis espace) pour ne jamais depasser `maxLen`.
 * @param {string} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
export function splitSentences(text, maxLen = SPEECH_MAX_CHUNK) {
  const clean = String(text == null ? "" : text).trim();
  if (!clean) return [];
  const limit = Math.max(20, Number(maxLen) || SPEECH_MAX_CHUNK);
  const out = [];
  for (const line of clean.split(/\n+/)) {
    for (const sentence of sentencesOfLine(line)) {
      if (sentence.length <= limit) {
        out.push(sentence);
        continue;
      }
      // Phrase trop longue : on coupe au dernier separateur naturel.
      let rest = sentence;
      while (rest.length > limit) {
        const slice = rest.slice(0, limit + 1);
        let cut = -1;
        for (const sep of [", ", "; ", ": ", " "]) {
          const idx = slice.lastIndexOf(sep);
          if (idx > 0) {
            cut = idx + sep.length;
            break;
          }
        }
        if (cut <= 0) cut = limit;
        const piece = rest.slice(0, cut).trim();
        if (piece) out.push(piece);
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
    }
  }
  return out;
}

/** Decoupe une ligne en phrases (ponctuation forte suivie d'une espace). */
function sentencesOfLine(line) {
  const out = [];
  let buf = "";
  const chars = Array.from(String(line || ""));
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    buf += c;
    if (c === "." || c === "!" || c === "?" || c === "\u2026") {
      const next = chars[i + 1];
      if (next === undefined || next === " " || next === "\t") {
        const sentence = buf.trim();
        if (sentence) out.push(sentence);
        buf = "";
      }
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Attend que les voix soient chargees (le premier appel les renvoie souvent
 * vides) puis renvoie la voix de la langue demandee.
 * @param {SpeechSynthesis} synth
 * @param {string} lang
 * @param {number} [waitMs]
 * @returns {Promise<SpeechSynthesisVoice|null>}
 */
export function ensureVoice(synth, lang, waitMs = VOICES_WAIT_MS) {
  if (!synth) return Promise.resolve(null);
  const read = () => {
    const voices = safeCall(() => synth.getVoices(), []);
    return Array.isArray(voices) ? voices : Array.from(voices || []);
  };
  const initial = read();
  if (initial.length) return Promise.resolve(pickVoiceForLang(initial, lang));
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      safeCall(() => synth.removeEventListener("voiceschanged", finish));
      resolve(pickVoiceForLang(read(), lang));
    };
    safeCall(() => synth.addEventListener("voiceschanged", finish));
    timer = setTimeout(finish, Math.max(0, Number(waitMs) || 0));
    // Node (tests) : ne pas retenir la boucle d'evenements.
    if (timer && typeof timer.unref === "function") timer.unref();
  });
}

/** Arrete TOUTE lecture en cours (quel que soit le bouton qui l'a lancee). */
export function stopReading() {
  if (currentPlayback) currentPlayback.stop();
}

/**
 * Cree un lecteur pour une fenetre. Une seule lecture a la fois pour toute
 * l'application : un nouveau `speak` arrete la lecture precedente.
 * @param {Window} win
 * @param {{lang?: string, waitMs?: number}} [options]
 */
export function createSpeaker(win, options = {}) {
  const w = win || globalThis.window;
  const synth = (w && w.speechSynthesis) || null;
  const Utterance = (w && w.SpeechSynthesisUtterance) || null;
  const lang = options.lang || speechLang(w && w.document);
  const waitMs = options.waitMs == null ? VOICES_WAIT_MS : options.waitMs;
  const self = { token: null, speaking: () => false, speak, stop: stopReading };

  /**
   * Lit un texte (nettoye puis decoupe). Renvoie une promesse resolue a la fin
   * ou a l'arret.
   * @param {string} text
   * @param {{onstate?: (state: "speaking"|"stopped"|"ended"|"unavailable"|"empty") => void}} [handlers]
   */
  async function speak(text, handlers = {}) {
    const notify = (state) => safeCall(() => handlers.onstate && handlers.onstate(state));
    if (!synth || !Utterance) {
      notify("unavailable");
      return false;
    }
    const chunks = splitSentences(markupToSpeech(text));
    if (!chunks.length) {
      notify("empty");
      return false;
    }
    stopReading(); // une seule lecture a la fois
    const token = { id: ++playbackSeq, stopped: false };
    const playback = {
      token,
      stop() {
        if (token.stopped) return;
        token.stopped = true;
        safeCall(() => synth.cancel());
        if (currentPlayback === playback) currentPlayback = null;
        notify("stopped");
      },
    };
    currentPlayback = playback;
    self.token = token;

    // Etat affiche tout de suite (le chargement des voix peut prendre un
    // instant) : le bouton passe a « Arreter » sans attendre.
    notify("speaking");

    // Voix : on attend leur chargement (sinon la premiere lecture est muette).
    const voice = await ensureVoice(synth, lang, waitMs);
    // Arret (ou autre lecture) pendant l'attente : on ne parle pas.
    if (token.stopped || currentPlayback !== playback) return false;

    const speakIndex = (index) => {
      if (token.stopped || currentPlayback !== playback) return;
      if (index >= chunks.length) {
        currentPlayback = null;
        token.stopped = true;
        notify("ended");
        return;
      }
      const utterance = new Utterance(chunks[index]);
      utterance.lang = lang;
      if (voice) utterance.voice = voice;
      utterance.onend = () => speakIndex(index + 1);
      utterance.onerror = () => {
        if (!token.stopped) playback.stop();
      };
      safeCall(() => synth.speak(utterance));
    };

    speakIndex(0);
    return true;
  }

  self.speaking = () => !!currentPlayback && currentPlayback.token === self.token;
  return self;
}

/** Textes d'un message : sections rendues (HTML) nettoyees, sinon la bulle. */
export function messageTextOf(messageEl) {
  if (!messageEl) return "";
  const sections = safeCall(
    () => (messageEl.querySelectorAll ? messageEl.querySelectorAll(".agent-text-section") : []),
    [],
  );
  const parts = [];
  for (let i = 0; i < (sections ? sections.length : 0); i++) {
    const section = sections[i];
    if (!section) continue;
    const html = typeof section.innerHTML === "string" ? section.innerHTML : "";
    const clean = markupToSpeech(html || section.textContent || "");
    if (clean) parts.push(clean);
  }
  if (parts.length) return parts.join("\n");
  const bubble = safeCall(() => (messageEl.querySelector ? messageEl.querySelector(".agent-bubble") : null));
  const raw = (bubble && (bubble.innerHTML || bubble.textContent)) || messageEl.textContent || "";
  return markupToSpeech(raw);
}

/** Etats d'affichage du bouton (texte + visuel, comprehensible sans couleur). */
export const LABELS = {
  idle: { text: "\u00c9couter", icon: "volume-2", title: "Lire cette r\u00e9ponse \u00e0 voix haute", aria: "Lire la r\u00e9ponse \u00e0 voix haute" },
  speaking: { text: "Arr\u00eater", icon: "square", title: "Arr\u00eater la lecture \u00e0 voix haute", aria: "Arr\u00eater la lecture \u00e0 voix haute" },
  unavailable: {
    text: "\u00c9couter",
    icon: "volume-x",
    title: "La synth\u00e8se vocale n'est pas disponible dans cette fen\u00eatre.",
    aria: "La synth\u00e8se vocale n'est pas disponible dans cette fen\u00eatre",
  },
};

/**
 * Applique un etat au bouton (libelle en TEXTE + `aria-pressed` + classe).
 * @param {HTMLElement} button
 * @param {"idle"|"speaking"|"unavailable"} state
 */
export function applyButtonState(button, state) {
  if (!button) return;
  const spec = LABELS[state] || LABELS.idle;
  const label = button.querySelector ? button.querySelector(".agent-read-label") : null;
  if (label) label.textContent = spec.text;
  button.setAttribute("aria-pressed", state === "speaking" ? "true" : "false");
  button.setAttribute("aria-label", spec.aria);
  button.title = spec.title;
  button.dataset.readState = state;
  if (button.classList) {
    button.classList.toggle("agent-read-btn-speaking", state === "speaking");
    button.classList.toggle("agent-read-btn-unavailable", state === "unavailable");
  }
  return button;
}

/**
 * Cree le bouton « Ecouter / Arreter ». Fonctionne sans synthese vocale : dans
 * ce cas le bouton est present mais inactif, avec une explication en infobulle.
 * @param {{doc?: Document, win?: Window, getText: () => string, lang?: string,
 *          refreshIcons?: (root: HTMLElement) => void}} options
 */
export function createReadAloudButton({ doc, win, getText, lang, refreshIcons } = {}) {
  const w = win || globalThis.window;
  const d = doc || (w && w.document) || globalThis.document;
  if (!d) return null;
  const button = d.createElement("button");
  button.type = "button";
  button.className = "agent-btn agent-read-btn";
  button.dataset.readState = "idle";
  const iconHolder = d.createElement("span");
  iconHolder.className = "agent-read-icon";
  const label = d.createElement("span");
  label.className = "agent-read-label";
  button.appendChild(iconHolder);
  button.appendChild(label);

  // Visuel d'etat : l'icone change en meme temps que le libelle (etat
  // comprehensible sans couleur). L'icone est une balise Lucide standard ;
  // `refreshIcons` (icons.js) la rend — aucun import supplementaire ici.
  const paintIcon = (name) => {
    iconHolder.innerHTML = `<i data-lucide="${name}" class="icon-sm" aria-hidden="true"></i>`;
    if (typeof refreshIcons === "function") safeCall(() => refreshIcons(iconHolder));
  };
  const setState = (state) => {
    const spec = LABELS[state] || LABELS.idle;
    applyButtonState(button, state);
    paintIcon(spec.icon);
  };

  if (!speechAvailable(w)) {
    button.disabled = true;
    setState("unavailable");
    return button;
  }
  setState("idle");

  const speaker = createSpeaker(w, { lang: lang || speechLang(d) });
  button.addEventListener("click", async () => {
    if (button.dataset.readState === "speaking") {
      speaker.stop();
      return;
    }
    const text = safeCall(() => (typeof getText === "function" ? getText() : ""), "") || "";
    const ok = await speaker.speak(text, {
      onstate: (state) => {
        if (state === "speaking") setState("speaking");
        else if (state === "empty") {
          applyButtonState(button, "idle");
          button.title = EMPTY_MESSAGE_HINT;
        } else setState("idle");
      },
    });
    return ok;
  });
  return button;
}

/**
 * Pose la rangee d'actions (bouton de lecture) sous une bulle de l'assistant.
 * A n'appeler QUE pour un message de l'assistant : ni les messages de
 * l'utilisateur ni les evenements systeme ne portent ce bouton.
 * @param {HTMLElement} messageEl - element `.agent-message-assistant`
 * @param {{doc?: Document, win?: Window, getText?: () => string, lang?: string,
 *          refreshIcons?: (root: HTMLElement) => void}} [options]
 * @returns {HTMLElement|null} le bouton pose
 */
export function attachReadAloud(messageEl, options = {}) {
  const d = options.doc || (options.win && options.win.document) || globalThis.document;
  if (!messageEl || !d) return null;
  const row = d.createElement("div");
  row.className = "agent-message-actions";
  const button = createReadAloudButton({
    doc: d,
    win: options.win,
    lang: options.lang,
    refreshIcons: options.refreshIcons,
    getText: options.getText || (() => messageTextOf(messageEl)),
  });
  if (!button) return null;
  row.appendChild(button);
  messageEl.appendChild(row);
  return button;
}
