// Tests — LE DÉLAI D'ENVOI DU MODE VOCAL EST RÉGLABLE (1 à 5 s, 2 s par défaut)
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le délai reste de DEUX SECONDES par défaut : la constante historique
//      `VOCAL_SILENCE_SEND_MS` (= 2000) devient la VALEUR PAR DÉFAUT du réglage,
//      elle n'est pas changée et elle reste la seule valeur par défaut.
//   2. La décision `decideVocalSilenceSend` ne lit PLUS de constante : le délai
//      lui ARRIVE avec l'état (`delaiMs`), fourni par le seul lecteur du réglage
//      — l'écran Vocal, au moment où il arme son minuteur.
//   3. Une valeur quelconque (absente, illisible, hors bornes, hors pas) est
//      ramenée à un délai utilisable par UNE fonction pure
//      (`normalizeVocalSilenceSendMs`) : bornes 1–5 s, pas de 0,5 s, défaut 2 s.
//   4. Le réglage se fait à UN SEUL endroit (Paramètres → onglet « Assistant » →
//      section « Mode Vocal », juste sous le réglage de la voix), avec le même
//      mécanisme de mémorisation que les réglages voisins (`vocal_silence_send_ms`
//      dans la configuration). Aucun second réglage, aucun second minuteur,
//      aucun second chemin d'envoi.
//   5. Un changement de réglage PENDANT une dictée ne modifie JAMAIS le minuteur
//      déjà lancé : il s'applique au prochain armement (le mot suivant, ou la
//      dictée suivante). On ne coupe pas une parole en changeant un réglage.
//   6. Aucune régression des gardes : chaque mot repousse l'échéance, une garde
//      qui refuse annule le minuteur, et l'envoi reste le chemin existant.
//
// Les commentaires sont ASCII ; les chaînes qui viennent du code sont copiées
// telles quelles. Fins de ligne normalisées (quality-gate 3.4).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  decideVocalSilenceSend,
  normalizeVocalSilenceSendMs,
  vocalSilenceSendLabel,
  VOCAL_SILENCE_CANCEL,
  VOCAL_SILENCE_CLOSE,
  VOCAL_SILENCE_WAIT,
  VOCAL_SILENCE_SEND_MS,
  VOCAL_SILENCE_SEND_MIN_MS,
  VOCAL_SILENCE_SEND_MAX_MS,
  VOCAL_SILENCE_SEND_STEP_MS,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/vocal-conversation.js");
const SETTINGS = lire("src/js/settings.js");
const HTML = lire("index.html");
// Le balisage seul (sans les commentaires) : les commentaires qui expliquent un
// reglage ne doivent pas faire croire a une section supplementaire.
const HTML_NC = HTML.replace(/<!--[\s\S]*?-->/g, "");
const RUST = lire("src-tauri/src/lib.rs");
const SPEC_VOCAL = lire("spec_modes_ecran_vocal.md");
const SPEC_DICTEE = lire("spec_voice_input.md");
const SPEC_LECTURE = lire("spec_read_aloud.md");
const HELP_OVERVIEW = lire("help/overview.md");
const HANDBOOK = lire("help/handbook.md");

const compte = (src, texte) => src.split(texte).length - 1;

/** Corps d'une fonction (ancre de fin : fermeture en colonne 2). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }\n", 40);
}

// L'état d'une dictée au repos, du point de vue de la décision du silence.
const PRET = {
  modeOuvert: true,
  pilotParle: false,
  reflechit: false,
  occupe: false,
  dicteeOuverte: true,
  repriseMain: false,
  motEntendu: true,
};

// ── 1. Le défaut : deux secondes, inchangé ─────────────────────────────────
describe("le défaut : deux secondes, et une seule valeur par défaut", () => {
  it("la constante historique vaut toujours 2 000 ms", () => {
    expect(VOCAL_SILENCE_SEND_MS).toBe(2000);
  });

  it("bornes et pas du réglage : 1 s à 5 s par pas de 0,5 s", () => {
    expect(VOCAL_SILENCE_SEND_MIN_MS).toBe(1000);
    expect(VOCAL_SILENCE_SEND_MAX_MS).toBe(5000);
    expect(VOCAL_SILENCE_SEND_STEP_MS).toBe(500);
  });

  it("une seule déclaration de la valeur par défaut dans tout le module", () => {
    expect((MODULE.match(/VOCAL_SILENCE_SEND_MS = \d+;/g) || [])).toHaveLength(1);
    // L'écran Vocal ne la recopie pas : il n'a que la valeur relue.
    expect(SUPER).not.toContain("VOCAL_SILENCE_SEND_MS");
    // Et les Paramètres non plus (aucun 2000 écrit à la main côté interface).
    expect(SETTINGS).not.toMatch(/vocal_silence_send_ms:\s*2000/);
  });
});

// ── 2. La normalisation : une seule fonction décide ce qu'une valeur vaut ──
describe("normalisation : toute valeur devient un délai utilisable", () => {
  it("absent, nul, illisible ou négatif ⇒ la valeur par défaut (2 s)", () => {
    for (const v of [undefined, null, 0, "", "abc", -1500, NaN, Infinity]) {
      expect(normalizeVocalSilenceSendMs(v), String(v)).toBe(VOCAL_SILENCE_SEND_MS);
    }
  });

  it("en dessous du minimum, on remonte à 1 s (jamais un délai nul)", () => {
    expect(normalizeVocalSilenceSendMs(500)).toBe(VOCAL_SILENCE_SEND_MIN_MS);
    expect(normalizeVocalSilenceSendMs(999)).toBe(VOCAL_SILENCE_SEND_MIN_MS);
    expect(normalizeVocalSilenceSendMs(1)).toBe(VOCAL_SILENCE_SEND_MIN_MS);
  });

  it("au-dessus du maximum, on redescend à 5 s", () => {
    expect(normalizeVocalSilenceSendMs(5001)).toBe(VOCAL_SILENCE_SEND_MAX_MS);
    expect(normalizeVocalSilenceSendMs(60000)).toBe(VOCAL_SILENCE_SEND_MAX_MS);
  });

  it("une valeur hors pas est alignée sur le pas du curseur", () => {
    expect(normalizeVocalSilenceSendMs(1700)).toBe(1500);
    expect(normalizeVocalSilenceSendMs(1800)).toBe(2000);
    expect(normalizeVocalSilenceSendMs(2200)).toBe(2000);
    expect(normalizeVocalSilenceSendMs(2600)).toBe(2500);
    expect(normalizeVocalSilenceSendMs(3400)).toBe(3500);
  });

  it("les valeurs du curseur passent inchangées (idempotence)", () => {
    for (const ms of [1000, 1500, 2000, 2500, 3000, 4000, 5000]) {
      expect(normalizeVocalSilenceSendMs(ms), String(ms)).toBe(ms);
      expect(normalizeVocalSilenceSendMs(normalizeVocalSilenceSendMs(ms))).toBe(ms);
    }
  });

  it("le libellé est lisible et en français (secondes, jamais un nombre nu)", () => {
    expect(vocalSilenceSendLabel(2000)).toBe("2 secondes");
    expect(vocalSilenceSendLabel(1000)).toBe("1 seconde");
    expect(vocalSilenceSendLabel(1500)).toBe("1,5 secondes");
    expect(vocalSilenceSendLabel(2500)).toBe("2,5 secondes");
    expect(vocalSilenceSendLabel(5000)).toBe("5 secondes");
    // Une valeur illisible affiche la valeur réellement appliquée.
    expect(vocalSilenceSendLabel(undefined)).toBe("2 secondes");
    expect(vocalSilenceSendLabel(60000)).toBe("5 secondes");
  });
});

// ── 3. La décision REÇOIT le délai (elle ne lit plus de constante) ─────────
describe("décision : le délai arrive avec l'état, à chaque armement", () => {
  it("sans délai fourni, on attend deux secondes (défaut)", () => {
    const d = decideVocalSilenceSend(PRET, "mot");
    expect(d.action).toBe(VOCAL_SILENCE_WAIT);
    expect(d.delai).toBe(VOCAL_SILENCE_SEND_MS);
  });

  it("le délai fourni est celui qui repousse l'échéance", () => {
    expect(decideVocalSilenceSend({ ...PRET, delaiMs: 1000 }).delai).toBe(1000);
    expect(decideVocalSilenceSend({ ...PRET, delaiMs: 5000 }).delai).toBe(5000);
    expect(decideVocalSilenceSend({ ...PRET, delaiMs: 3000 }).delai).toBe(3000);
  });

  it("une valeur aberrante est bornée, jamais appliquée telle quelle", () => {
    expect(decideVocalSilenceSend({ ...PRET, delaiMs: 99999 }).delai).toBe(5000);
    expect(decideVocalSilenceSend({ ...PRET, delaiMs: 10 }).delai).toBe(1000);
    expect(decideVocalSilenceSend({ ...PRET, delaiMs: "bonjour" }).delai).toBe(2000);
  });

  it("les gardes passent AVANT le délai : rien ne part, quel qu'il soit", () => {
    for (const delaiMs of [1000, 2000, 5000]) {
      expect(decideVocalSilenceSend({ ...PRET, delaiMs, pilotParle: true }, "echeance").action).toBe(
        VOCAL_SILENCE_CANCEL
      );
      expect(decideVocalSilenceSend({ ...PRET, delaiMs, repriseMain: true }).action).toBe(
        VOCAL_SILENCE_CANCEL
      );
      expect(decideVocalSilenceSend({ ...PRET, delaiMs, modeOuvert: false }).action).toBe(
        VOCAL_SILENCE_CANCEL
      );
    }
    // L'échéance referme toujours avec un délai de 0 (rien à reprogrammer).
    expect(decideVocalSilenceSend({ ...PRET, delaiMs: 5000 }, "echeance")).toEqual({
      action: VOCAL_SILENCE_CLOSE,
      raison: "silence",
      delai: 0,
    });
  });
});

// ── 4. Dans le temps : changer le réglage ne touche pas au minuteur en vol ─
// Ce banc reproduit EXACTEMENT la règle de l'appelant (`vocalNoteWord`) : la
// valeur réglée est lue AU MOMENT D'ARMER, jamais surveillée ensuite.
function banc(delaiInitial = VOCAL_SILENCE_SEND_MS) {
  const envois = [];
  let minuteur = 0;
  let motRecu = false;
  // La « valeur relue » : ce que `refreshVocalSilenceSendMs` met à jour.
  let delaiRegle = delaiInitial;
  const vue = () => ({ ...PRET, motEntendu: motRecu, delaiMs: delaiRegle });
  const clear = () => {
    if (!minuteur) return;
    clearTimeout(minuteur);
    minuteur = 0;
  };
  const mot = () => {
    motRecu = true;
    const d = decideVocalSilenceSend(vue());
    clear();
    if (d.action !== VOCAL_SILENCE_WAIT || !d.delai) return;
    minuteur = setTimeout(() => {
      minuteur = 0;
      if (decideVocalSilenceSend(vue(), "echeance").action !== VOCAL_SILENCE_CLOSE) return;
      envois.push("envoyer");
    }, d.delai);
  };
  return {
    envois,
    mot,
    clear,
    // Le réglage change (enregistrement des Paramètres) : la valeur connue est
    // remplacée, RIEN d'autre — aucun minuteur n'est réarmé ni annulé ici.
    setReglage: (ms) => {
      delaiRegle = normalizeVocalSilenceSendMs(ms);
    },
    enVol: () => minuteur !== 0,
  };
}

describe("dans le temps : délai réglé, report par les mots, minuteur en vol intact", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("le délai MINIMUM (1 s) part plus vite que le défaut", () => {
    vi.useFakeTimers();
    const b = banc(1000);
    b.mot();
    vi.advanceTimersByTime(999);
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("le délai MAXIMUM (5 s) laisse le temps de respirer entre deux phrases", () => {
    vi.useFakeTimers();
    const b = banc(5000);
    b.mot();
    vi.advanceTimersByTime(4999);
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("chaque mot repousse l'échéance, avec le délai réglé", () => {
    vi.useFakeTimers();
    const b = banc(3000);
    b.mot();
    vi.advanceTimersByTime(2500);
    b.mot();
    vi.advanceTimersByTime(2500); // 5 000 ms depuis le premier mot
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(500); // 3 000 ms depuis le dernier mot
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("changer le réglage PENDANT une dictée ne modifie pas le minuteur déjà lancé", () => {
    vi.useFakeTimers();
    const b = banc(2000);
    b.mot(); // minuteur armé à 2 s
    vi.advanceTimersByTime(500);
    b.setReglage(5000); // l'utilisateur glisse le curseur pendant qu'il parle
    // Le minuteur en vol garde SON échéance : rien n'est réarmé, rien n'est annulé.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(1499); // 1 999 ms depuis le mot
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(1); // 2 000 ms : l'échéance d'ORIGINE
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("la nouvelle valeur s'applique au PROCHAIN armement (le mot suivant)", () => {
    vi.useFakeTimers();
    const b = banc(2000);
    b.mot();
    vi.advanceTimersByTime(300);
    b.setReglage(5000);
    b.mot(); // armement suivant : la nouvelle valeur est lue ICI
    vi.advanceTimersByTime(4999);
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("et au prochain ARMEMENT d'une dictée suivante (aucun minuteur en vol)", () => {
    vi.useFakeTimers();
    const b = banc(2000);
    b.mot();
    vi.advanceTimersByTime(2000);
    expect(b.envois).toEqual(["envoyer"]);
    b.setReglage(1000); // la dictée suivante doit partir en 1 s
    b.mot();
    vi.advanceTimersByTime(999);
    expect(b.envois).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(b.envois).toEqual(["envoyer", "envoyer"]);
  });

  it("une garde qui refuse annule le minuteur, même avec un long délai", () => {
    vi.useFakeTimers();
    const b = banc(5000);
    b.mot();
    b.clear(); // ce que fait `vocalSyncSilenceSend` quand une garde refuse
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20000);
    expect(b.envois).toHaveLength(0);
  });
});

// ── 5. Le branchement dans l'écran Vocal : une lecture, un seul minuteur ───
describe("super-agent.js : le réglage est lu au SEUL endroit qui arme le minuteur", () => {
  it("la valeur relue vit dans une seule variable, initialisée « pas encore lue »", () => {
    expect(compte(SUPER, "let vocalSilenceSendMs = 0;")).toBe(1);
    // Passée à la décision avec l'état, et à un seul endroit.
    expect(compte(SUPER, "delaiMs: vocalSilenceSendMs,")).toBe(1);
    const etat = corpsFonction(SUPER, "function vocalSilenceState()");
    expect(etat).toContain("delaiMs: vocalSilenceSendMs,");
    // Aucune lecture du réglage dans la décision du silence elle-même.
    const note = corpsFonction(SUPER, "function vocalNoteWord()");
    expect(note).not.toContain("vocal_silence_send_ms");
    expect(note).toContain("decideVocalSilenceSend(vocalSilenceState())");
  });

  it("la relecture lit la configuration et borne la valeur (fail-open)", () => {
    const relu = corpsFonction(SUPER, "async function refreshVocalSilenceSendMs()");
    expect(relu).toContain('await invoke("get_config");');
    expect(relu).toContain("cfg.vocal_silence_send_ms");
    expect(relu).toContain("normalizeVocalSilenceSendMs(");
    // Panne de configuration : la valeur par défaut (2 s) reprend la main.
    expect(relu).toContain("catch (_) {");
    // La relecture ne touche JAMAIS au minuteur : aucun réarmement, aucune annulation.
    expect(relu).not.toContain("clearVocalSilenceTimer");
    expect(relu).not.toContain("setTimeout");
    expect(relu).not.toContain("clearTimeout");
  });

  it("elle est faite au montage de l'onglet ET à chaque changement de réglage", () => {
    // Deux appels, pas un de plus : une premiere lecture au montage (sinon la
    // valeur resterait au defaut jusqu'au premier enregistrement) et la relecture
    // a chaud dans le handler DEJA existant de `pilot-config-changed`.
    expect(compte(SUPER, "refreshVocalSilenceSendMs();")).toBe(2);
    const onConfig = sliceSource(SUPER, "const onConfigChanged = () => {", "\n  };", 40);
    expect(onConfig).toContain("refreshVocalSilenceSendMs();");
    // Aucun second écouteur ajouté pour ce réglage (issue #12 : pas de fuite).
    expect(compte(SUPER, 'window.addEventListener("pilot-config-changed"')).toBe(2);
  });

  it("aucune régression : un seul minuteur, un seul envoi, décision réévaluée", () => {
    expect((SUPER.match(/vocalSilenceTimer = setTimeout\(/g) || [])).toHaveLength(1);
    const note = corpsFonction(SUPER, "function vocalNoteWord()");
    expect(note).toContain("clearVocalSilenceTimer();");
    expect(note).toContain("if (decision.action !== VOCAL_SILENCE_WAIT || !decision.delai) return;");
    expect(note).toContain(
      'if (decideVocalSilenceSend(vocalSilenceState(), "echeance").action !== VOCAL_SILENCE_CLOSE) return;'
    );
    expect(note).toContain("vocalCloseForSend();");
    expect((SUPER.match(/applyVoiceEnd\(\{/g) || [])).toHaveLength(1);
  });
});

// ── 6. Le réglage : un seul endroit, même style, même mémorisation ─────────
describe("Paramètres → onglet Assistant : un curseur, à côté du réglage de la voix", () => {
  const ID = 'id="setting-vocal-silence-send"';

  it("le curseur existe une seule fois, dans l'onglet Assistant", () => {
    expect(compte(HTML, ID)).toBe(1);
    const panneau = HTML.indexOf('data-settings-panel="superagent"');
    expect(panneau).toBeGreaterThan(-1);
    const suivant = HTML.indexOf('data-settings-panel="', panneau + 10);
    const debut = HTML.indexOf(ID);
    expect(debut).toBeGreaterThan(panneau);
    expect(suivant === -1 || debut < suivant).toBe(true);
  });

  it("il est justement après la section du réglage de la voix", () => {
    const voix = HTML_NC.indexOf('id="settings-section-read-aloud"');
    const debutDelai = HTML_NC.indexOf(
      '<div class="settings-section" id="settings-section-vocal-delay"'
    );
    expect(voix).toBeGreaterThan(-1);
    expect(debutDelai).toBeGreaterThan(voix);
    // Aucune autre section entre les deux : ils sont voisins.
    const entre = HTML_NC.slice(voix, debutDelai);
    expect(compte(entre, 'class="settings-section"')).toBe(0);
  });

  it("curseur 1 à 5 s par pas de 0,5 s, valeur de départ 2 s", () => {
    const section = sliceSource(
      HTML_NC,
      '<div class="settings-section" id="settings-section-vocal-delay">',
      "\n          </div>\n",
      200
    );
    expect(section).toContain('type="range"');
    expect(section).toContain('min="1000"');
    expect(section).toContain('max="5000"');
    expect(section).toContain('step="500"');
    expect(section).toContain('value="2000"');
    // Même style de contrôle que les réglages voisins : une ligne de réglage.
    expect(section).toContain('class="setting-row"');
  });

  it("libellé relié au champ et valeur courante affichée en clair", () => {
    const section = sliceSource(
      HTML_NC,
      '<div class="settings-section" id="settings-section-vocal-delay">',
      "\n          </div>\n",
      200
    );
    expect(section).toMatch(/<label for="setting-vocal-silence-send"/);
    expect(section).toContain('aria-describedby="vocal-silence-send-note"');
    expect(section).toContain('id="vocal-silence-send-label"');
    // La valeur de départ est lisible, pas un nombre nu.
    expect(section).toContain(">2 secondes<");
  });

  it("même mémorisation que les réglages voisins (champ de configuration)", () => {
    // Un seul accès DOM au curseur.
    expect(compte(SETTINGS, 'getElementById("setting-vocal-silence-send")')).toBe(1);
    // Chargé depuis la configuration, borné par la source unique.
    expect(SETTINGS).toMatch(
      /refreshVocalSilenceSend\(currentConfig && currentConfig\.vocal_silence_send_ms\);/
    );
    // Enregistré dans la configuration, toujours borné (jamais 0 ni 9000 écrit).
    expect(SETTINGS).toMatch(/vocal_silence_send_ms: inputVocalSilenceSend/);
    expect(SETTINGS).toMatch(/normalizeVocalSilenceSendMs\(parseInt\(inputVocalSilenceSend\.value, 10\)\)/);
    // Appliqué pendant le glissement (la valeur affichée suit le curseur).
    expect(SETTINGS).toMatch(
      /inputVocalSilenceSend\.addEventListener\("input", \(\) => \{\s*\n\s*refreshVocalSilenceSend\(parseInt\(inputVocalSilenceSend\.value, 10\)\);/
    );
    // Un seul formatage de la valeur (aucun nombre nu affiché ailleurs).
    expect(SETTINGS).toContain("vocalSilenceSendLabel(ms)");
  });

  it("côté Rust : un champ persistant, défaut 2 000 ms, aucune migration", () => {
    expect(RUST).toMatch(/#\[serde\(default = "default_vocal_silence_send_ms"\)\]\s*\n\s*vocal_silence_send_ms: u32,/);
    expect(RUST).toMatch(/fn default_vocal_silence_send_ms\(\) -> u32 \{ 2000 \}/);
    expect(RUST).toContain("vocal_silence_send_ms: default_vocal_silence_send_ms(),");
  });
});

// ── 7. La documentation et l'aide disent la vérité ─────────────────────────
describe("documentation : le réglage est décrit, le défaut de 2 s reste dit", () => {
  it("la spec du mode Vocal : réglable, 1 à 5 s, défaut 2 s, application au prochain armement", () => {
    const bloc = sliceSource(SPEC_VOCAL, "### 6bis.1", "### 6bis.2", 400);
    expect(bloc).toContain("vocal_silence_send_ms");
    expect(bloc).toMatch(/1 à 5 s/i);
    expect(bloc).toMatch(/2 s|deux secondes/i);
    expect(bloc).toMatch(/prochain armement/i);
    // La phrase devenue fausse a disparu de la spec.
    expect(SPEC_VOCAL).not.toContain("le délai ne se règle pas et ne se voit pas");
  });

  it("la spec de la dictée vocale le dit aussi (une seule règle, deux docs)", () => {
    expect(SPEC_DICTEE).toContain("vocal_silence_send_ms");
    expect(SPEC_DICTEE).toMatch(/1 à 5 s/i);
    expect(SPEC_DICTEE).not.toContain("Aucun réglage, aucun bouton, aucun affichage : le délai ne se règle pas.");
  });

  it("la spec de la lecture des réponses nomme la section voisine", () => {
    expect(SPEC_LECTURE).toContain("Mode Vocal");
    expect(SPEC_LECTURE).toContain("vocal_silence_send_ms");
  });

  it("l'aide embarquée dit où régler le délai et quel est le défaut", () => {
    const blocAide = sliceSource(
      HELP_OVERVIEW,
      "<!-- HELP:lire-reponses -->",
      "<!-- /HELP:lire-reponses -->",
      100
    );
    expect(blocAide).toContain("Délai d'envoi");
    expect(blocAide).toMatch(/2 secondes/i);
    // L'aide générée (embarquée via include_str!) contient bien la phrase.
    expect(HANDBOOK).toContain("Délai d'envoi");
  });
});
