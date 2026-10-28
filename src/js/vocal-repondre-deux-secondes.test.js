// Tests — LE MODE VOCAL REPOND DEUX SECONDES APRES LE DERNIER MOT
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le délai est DECIDE, il n'est plus subi : deux secondes après le dernier
//      mot récupéré, s'il n'y a pas de nouveau mot, la demande part. Avant, le
//      seul signal d'envoi était la FIN que déclare le moteur de reconnaissance
//      du navigateur — et cette fin peut arriver plusieurs secondes après le
//      dernier mot (le moteur attend son propre silence, parfois très long).
//   2. Chaque nouveau TEXTE (provisoire ou définitif) REPOUSSE l'échéance : on
//      ne coupe jamais quelqu'un qui parle encore.
//   3. Un SEUL minuteur à la fois, annulé dès que la dictée se referme, quand
//      Pilot parle ou réfléchit, et aux trois sorties du mode.
//   4. Aucun envoi pendant la lecture, la réflexion, ou après une reprise en
//      main de l'utilisateur dans la zone de saisie (garde existante).
//   5. Aucun second envoi, aucun second moteur : à l'échéance on REFERME la
//      dictée par la voie qui existe déjà (l'arrêt du moteur), et sa fin
//      d'écoute normale passe par `applyVoiceEnd` → `send`, comme aujourd'hui.
//   6. Aucun réglage, aucun bouton, aucun affichage nouveau.
//
// Les commentaires sont en ASCII ; les chaînes qui viennent du code sont
// copiées telles quelles. Les fins de ligne sont normalisées (quality-gate 3.4).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  decideVocalSilenceSend,
  VOCAL_SILENCE_CLOSE,
  VOCAL_SILENCE_CANCEL,
  VOCAL_SILENCE_WAIT,
  VOCAL_SILENCE_SEND_MS,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/vocal-conversation.js");
const SPEC_VOCAL = lire("spec_modes_ecran_vocal.md");
const SPEC_DICTEE = lire("spec_voice_input.md");
const HELP = lire("help/overview.md");

/** Corps d'une fonction (ancre de fin : la fermeture en colonne 2). */
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

// ── 1. La valeur demandée : deux secondes, pas autre chose ─────────────────
describe("le délai : deux secondes, constante nommée, une seule", () => {
  it("vaut exactement 2 000 ms (valeur demandée, pas « plus long pour être sûr »)", () => {
    expect(VOCAL_SILENCE_SEND_MS).toBe(2000);
  });

  it("n'existe qu'UNE fois dans le module de décisions (aucun second délai)", () => {
    expect((MODULE.match(/VOCAL_SILENCE_SEND_MS = \d+;/g) || [])).toHaveLength(1);
    // Le module reste PUR : ni horloge, ni minuteur, ni DOM.
    const code = MODULE.split("\n")
      .filter((l) => !l.trimStart().startsWith("//"))
      .join("\n");
    expect(code).not.toContain("setTimeout");
    expect(code).not.toContain("Date.now");
    expect(code).not.toContain("document.");
    expect(code).not.toContain("SpeechRecognition");
  });
});

// ── 2. La décision pure : l'ordre des règles est la spécification ──────────
describe("décision : un mot repousse, l'échéance referme, les gardes annulent", () => {
  it("un mot reçu demande d'ATTENDRE deux secondes de plus", () => {
    const d = decideVocalSilenceSend(PRET, "mot");
    expect(d.action).toBe(VOCAL_SILENCE_WAIT);
    expect(d.raison).toBe("mot-entendu");
    expect(d.delai).toBe(VOCAL_SILENCE_SEND_MS);
    // Sans préciser le moment, on est au moment du mot (défaut).
    expect(decideVocalSilenceSend(PRET)).toEqual(d);
  });

  it("l'échéance atteinte sans nouveau mot REFERME la dictée", () => {
    const d = decideVocalSilenceSend(PRET, "echeance");
    expect(d.action).toBe(VOCAL_SILENCE_CLOSE);
    expect(d.raison).toBe("silence");
    expect(d.delai).toBe(0);
  });

  it("Pilot PARLE : rien ne part (ni au mot, ni à l'échéance)", () => {
    for (const moment of ["mot", "echeance"]) {
      const d = decideVocalSilenceSend({ ...PRET, pilotParle: true }, moment);
      expect(d.action, moment).toBe(VOCAL_SILENCE_CANCEL);
      expect(d.raison, moment).toBe("pilot-parle");
    }
  });

  it("Pilot TRAVAILLE : rien ne part (le tour en cours prime)", () => {
    for (const moment of ["mot", "echeance"]) {
      expect(decideVocalSilenceSend({ ...PRET, reflechit: true }, moment).raison).toBe("tour-en-cours");
      expect(decideVocalSilenceSend({ ...PRET, occupe: true }, moment).raison).toBe("tour-en-cours");
    }
  });

  it("l'utilisateur a REPRIS LA MAIN : rien ne part", () => {
    for (const moment of ["mot", "echeance"]) {
      const d = decideVocalSilenceSend({ ...PRET, repriseMain: true }, moment);
      expect(d.action, moment).toBe(VOCAL_SILENCE_CANCEL);
      expect(d.raison, moment).toBe("reprise-main");
    }
  });

  it("la dictée déjà refermée : rien à fermer, rien à envoyer", () => {
    for (const moment of ["mot", "echeance"]) {
      expect(decideVocalSilenceSend({ ...PRET, dicteeOuverte: false }, moment).raison).toBe(
        "dictee-fermee"
      );
    }
  });

  it("aucun mot récupéré : une dictée muette n'envoie rien", () => {
    const d = decideVocalSilenceSend({ ...PRET, motEntendu: false }, "echeance");
    expect(d.action).toBe(VOCAL_SILENCE_CANCEL);
    expect(d.raison).toBe("sans-mot");
  });

  it("hors du mode Vocal, cet écran n'envoie jamais rien", () => {
    const d = decideVocalSilenceSend({ ...PRET, modeOuvert: false }, "echeance");
    expect(d.action).toBe(VOCAL_SILENCE_CANCEL);
    expect(d.raison).toBe("hors-mode");
  });

  it("l'ordre des règles est celui de la spec (combinaisons tranchées)", () => {
    // hors mode AVANT tout le reste
    expect(
      decideVocalSilenceSend({ modeOuvert: false, pilotParle: true, motEntendu: true }, "echeance").raison
    ).toBe("hors-mode");
    // Pilot parle AVANT la réflexion, la dictée fermée et la reprise en main
    expect(
      decideVocalSilenceSend({ ...PRET, pilotParle: true, reflechit: true }, "echeance").raison
    ).toBe("pilot-parle");
    // la réflexion AVANT « dictée fermée »
    expect(
      decideVocalSilenceSend({ ...PRET, reflechit: true, dicteeOuverte: false }, "echeance").raison
    ).toBe("tour-en-cours");
    // la dictée fermée AVANT la reprise en main
    expect(
      decideVocalSilenceSend({ ...PRET, dicteeOuverte: false, repriseMain: true }, "echeance").raison
    ).toBe("dictee-fermee");
    // la reprise en main AVANT « aucun mot »
    expect(
      decideVocalSilenceSend({ ...PRET, repriseMain: true, motEntendu: false }, "echeance").raison
    ).toBe("reprise-main");
    // et l'échéance n'est JAMAIS prononcée tant qu'une garde refuse
    expect(decideVocalSilenceSend({ ...PRET, pilotParle: true }, "echeance").action).not.toBe(
      VOCAL_SILENCE_CLOSE
    );
  });

  it("entrées absentes ou invalides : jamais une exception, jamais un envoi", () => {
    expect(decideVocalSilenceSend().action).toBe(VOCAL_SILENCE_CANCEL);
    expect(decideVocalSilenceSend(undefined, undefined).raison).toBe("hors-mode");
    expect(decideVocalSilenceSend(null, "echeance").action).toBe(VOCAL_SILENCE_CANCEL);
    expect(decideVocalSilenceSend({ ...PRET }, "n'importe quoi").raison).toBe("mot-entendu");
  });
});

// ── 3. Le comportement dans le temps : délai, report, un seul minuteur ─────
// Le banc ci-dessous reproduit la règle de l'appelant (celle que `vocalNoteWord`
// applique) : il est adossé à la décision PURE, et le §4 vérifie que le source
// implémente EXACTEMENT cette forme (une seule affectation de minuteur, remise à
// zéro avant réarmement, réévaluation à l'échéance, fermeture par `rec.stop()`).
function banc() {
  const envois = [];
  let minuteur = 0;
  let motRecu = false;
  const etat = { ...PRET, motEntendu: false };
  const vue = () => ({ ...etat, motEntendu: motRecu });
  const clear = () => {
    if (!minuteur) return;
    clearTimeout(minuteur);
    minuteur = 0;
  };
  const sync = () => {
    // Ce que fait `vocalSyncSilenceSend` : annuler dès que les gardes refusent.
    if (decideVocalSilenceSend(vue()).action === VOCAL_SILENCE_WAIT) return;
    clear();
  };
  const mot = () => {
    // Ce que fait `vocalNoteWord` : un mot repousse, et il n'y a jamais deux
    // minuteurs (celui en vol est remplacé).
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
  return { envois, etat, vue, sync, mot, clear, enVol: () => minuteur !== 0 };
}

describe("dans le temps : le délai est respecté et chaque mot le repousse", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("RIEN ne part avant deux secondes, et la demande part à l'échéance", () => {
    vi.useFakeTimers();
    const b = banc();
    b.mot();
    vi.advanceTimersByTime(VOCAL_SILENCE_SEND_MS - 1);
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(b.envois).toEqual(["envoyer"]);
    // Une seule demande, même si le temps continue de passer.
    vi.advanceTimersByTime(10_000);
    expect(b.envois).toHaveLength(1);
  });

  it("chaque nouveau mot REPOUSSE l'échéance (on ne coupe pas une parole)", () => {
    vi.useFakeTimers();
    const b = banc();
    b.mot();
    vi.advanceTimersByTime(1500);
    b.mot(); // l'utilisateur continue de parler
    vi.advanceTimersByTime(1500); // 3 000 ms depuis le PREMIER mot
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(500); // 2 000 ms depuis le DERNIER mot
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("un seul minuteur à la fois, quel que soit le nombre de mots", () => {
    vi.useFakeTimers();
    const b = banc();
    b.mot();
    b.mot();
    b.mot();
    expect(vi.getTimerCount()).toBe(1);
    expect(b.enVol()).toBe(true);
  });

  it("rien ne part pendant que Pilot LIT (la garde annule, aucun envoi tardif)", () => {
    vi.useFakeTimers();
    const b = banc();
    b.mot();
    b.etat.pilotParle = true; // Pilot commence à lire
    b.sync();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(b.envois).toHaveLength(0);
  });

  it("rien ne part pendant que Pilot RÉFLÉCHIT", () => {
    vi.useFakeTimers();
    const b = banc();
    b.mot();
    b.etat.reflechit = true;
    b.sync();
    vi.advanceTimersByTime(10_000);
    expect(b.envois).toHaveLength(0);
  });

  it("rien ne part après une REPRISE EN MAIN dans la zone de saisie", () => {
    vi.useFakeTimers();
    const b = banc();
    b.mot();
    b.etat.repriseMain = true; // l'utilisateur a tapé
    b.sync();
    vi.advanceTimersByTime(10_000);
    expect(b.envois).toHaveLength(0);
    // Et un nouveau mot ne réarme rien du tout : sa saisie prime.
    b.mot();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(b.envois).toHaveLength(0);
  });

  it("fermeture du mode ⇒ aucun envoi tardif (le minuteur part avec le mode)", () => {
    vi.useFakeTimers();
    const b = banc();
    b.mot();
    b.etat.modeOuvert = false; // sortie du mode
    b.sync();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(b.envois).toHaveLength(0);
  });

  it("une dictée muette n'envoie rien (aucun mot reçu)", () => {
    vi.useFakeTimers();
    const b = banc();
    b.sync();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(b.envois).toHaveLength(0);
  });
});

// ── 4. Le câblage : un seul minuteur, un seul envoi (celui d'aujourd'hui) ──
describe("câblage dans super-agent.js : un minuteur, un seul chemin d'envoi", () => {
  it("la décision est IMPORTÉE, jamais recopiée", () => {
    expect(SUPER).toContain('} from "./vocal-conversation.js";');
    expect(SUPER).toContain("decideVocalSilenceSend,");
    expect(SUPER).toContain("VOCAL_SILENCE_CLOSE,");
    expect(SUPER).toContain("VOCAL_SILENCE_WAIT,");
    expect(SUPER).not.toContain("export function decideVocalSilenceSend");
  });

  it("UN SEUL minuteur de silence : une seule affectation dans tout le fichier", () => {
    expect((SUPER.match(/vocalSilenceTimer = setTimeout\(/g) || [])).toHaveLength(1);
    expect((SUPER.match(/let vocalSilenceTimer = 0;/g) || [])).toHaveLength(1);
    // Une seule remise à zéro par annulation, et une seule par annulation
    // réelle (aucune minuterie orpheline qui survivrait à la dictée).
    expect(corpsFonction(SUPER, "function clearVocalSilenceTimer()")).toContain(
      "clearTimeout(vocalSilenceTimer);"
    );
  });

  it("chaque texte récupéré REPOUSSE l'échéance (provisoire comme définitif)", () => {
    const resultat = sliceSource(SUPER, "    rec.onresult = (e) => {", "    rec.onerror = (ev) => {", 100);
    // Un résultat identique au précédent n'est pas un nouveau mot : sinon un
    // moteur qui répète son résultat intermédiaire repousserait sans fin.
    expect(resultat).toContain("if (transcript && transcript !== dernierTexte) {");
    expect(resultat).toContain("vocalNoteWord();");
    // Un seul appel : aucune seconde détection de « nouveau mot » ailleurs.
    expect((SUPER.match(/vocalNoteWord\(\);/g) || [])).toHaveLength(1);
    // La décision est consultée AVANT de réarmer, et le minuteur en vol est
    // remplacé (jamais deux en vol).
    const note = corpsFonction(SUPER, "function vocalNoteWord()");
    expect(note).toContain("const decision = decideVocalSilenceSend(vocalSilenceState());");
    expect(note).toContain("clearVocalSilenceTimer();");
    expect(note).toContain("if (decision.action !== VOCAL_SILENCE_WAIT || !decision.delai) return;");
  });

  it("la décision est RÉÉVALUÉE à l'échéance (l'état a pu changer)", () => {
    const note = corpsFonction(SUPER, "function vocalNoteWord()");
    expect(note).toContain(
      'if (decideVocalSilenceSend(vocalSilenceState(), "echeance").action !== VOCAL_SILENCE_CLOSE) return;'
    );
    expect(note).toContain("vocalCloseForSend();");
  });

  it("l'échéance REFERME la dictée par la voie existante — aucun second envoi", () => {
    const ferme = corpsFonction(SUPER, "function vocalCloseForSend()");
    // L'arrêt du moteur produit une fin d'écoute NORMALE : elle passe par
    // `applyVoiceEnd` → `send`, exactement comme aujourd'hui.
    expect(ferme).toContain("rec.stop();");
    // Aucun envoi écrit ici, aucun second mécanisme de fin.
    expect(ferme).not.toContain("send(");
    expect(ferme).not.toContain("applyVoiceEnd");
    // Si le moteur n'existe plus, on referme proprement (aucun micro ouvert).
    expect(ferme).toContain("stopVoiceInput();");
    // Un seul `applyVoiceEnd` dans tout le fichier (celui qui existait déjà) et
    // un seul envoi dans la voie unique de dictée.
    expect((SUPER.match(/applyVoiceEnd\(\{/g) || [])).toHaveLength(1);
    expect((corpsFonction(SUPER, "function startVoiceInput()").match(/send\(/g) || [])).toHaveLength(1);
  });

  it("le minuteur est annulé : dictée refermée, Pilot parle/réfléchit, sorties", () => {
    // Fin d'écoute (quelle qu'en soit la cause) et arrêt programmé.
    expect(corpsFonction(SUPER, "function stopVoiceInput()")).toContain("clearVocalSilenceTimer();");
    expect(sliceSource(SUPER, "    rec.onend = () => {", "      const arretDemande = voiceStopVoulu;", 100)).toContain(
      "clearVocalSilenceTimer();"
    );
    // Nouvelle session : on repart de zéro (aucun mot, aucun minuteur).
    const demarrage = corpsFonction(SUPER, "function startVoiceInput()");
    expect(demarrage).toContain("vocalMotRecu = false;");
    expect(demarrage).toContain("clearVocalSilenceTimer();");
    // Pilot parle ou réfléchit : même point d'application que la conversation.
    const sync = corpsFonction(SUPER, "function vocalSyncConversation()");
    expect(sync).toContain("vocalSyncSilenceSend();");
    expect(sync).toContain("clearVocalSilenceTimer();");
    const applique = corpsFonction(SUPER, "function vocalSyncSilenceSend()");
    expect(applique).toContain("clearVocalSilenceTimer();");
    // Les trois sorties du mode passent par exitVocal : le minuteur y est annulé.
    expect(corpsFonction(SUPER, "function exitVocal()")).toContain("clearVocalSilenceTimer();");
    expect(SUPER).toMatch(/function enterImmersive\([\s\S]{0,600}exitVocal\(\)/);
    expect(SUPER).toMatch(/onVocalKeydown[\s\S]{0,600}exitVocal\(\)/);
  });

  it("l'état lu par la décision réutilise la SEULE source d'état de l'écran", () => {
    const etat = corpsFonction(SUPER, "function vocalSilenceState()");
    expect(etat).toContain("const base = vocalConversationState();");
    expect(etat).toContain("repriseMain: voiceUserTookOver === true,");
    expect(etat).toContain("motEntendu: vocalMotRecu === true,");
    // Aucune seconde source : ni état parallèle, ni second drapeau de parole.
    expect(etat).not.toContain("vocalSpeaking =");
    expect(etat).not.toContain("SpeechRecognition");
  });

  it("aucune valeur en dur ni trace de débogage dans le module pur", () => {
    // Le délai PAR DÉFAUT n'est jamais recopié hors du module de décisions :
    // l'écran Vocal ne connaît que la valeur relue (`vocalSilenceSendMs`).
    // Le réglage lui-même vit ailleurs (Paramètres + configuration) et il est
    // verrouillé par `vocal-delai-envoi-reglable.test.js`.
    expect(SUPER).not.toContain("VOCAL_SILENCE_SEND_MS");
    expect(SUPER).not.toMatch(/vocalSilenceSendMs\s*=\s*2000/);
    expect(MODULE).not.toContain("localStorage");
    expect(MODULE).not.toContain("read_aloud_");
    // Le module pur ne LIT aucune configuration (le champ n'y est que cité en
    // commentaire) : la valeur arrive par l'état, jamais par un appel.
    expect(MODULE).not.toContain("invoke(");
    expect(MODULE).not.toContain("get_config");
    // Aucune trace de débogage propre à ce délai.
    expect(SUPER).not.toMatch(/console\.[a-z]+\([^)]*silence/i);
  });
});

// ── 5. La documentation dit la vérité ─────────────────────────────────────
describe("documentation : la spec et l'aide disent les deux secondes", () => {
  it("la spec du mode Vocal nomme le délai et son signal", () => {
    expect(SPEC_VOCAL).toMatch(/deux secondes/i);
    expect(SPEC_VOCAL).toMatch(/dernier mot/i);
    expect(SPEC_VOCAL).toMatch(/decideVocalSilenceSend/);
  });

  it("la spec de la dictée vocale le dit aussi (une seule règle, deux docs)", () => {
    expect(SPEC_DICTEE).toMatch(/deux secondes/i);
    expect(SPEC_DICTEE).toMatch(/decideVocalSilenceSend/);
    expect(SPEC_DICTEE).toMatch(/dernier mot/i);
  });

  it("l'aide embarquée le dit en langage utilisateur", () => {
    expect(HELP).toMatch(/deux secondes/i);
  });
});
