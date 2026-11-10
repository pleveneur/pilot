// Tests — LA FIN D'ECOUTE EST REPOUSSEE PAR LA VOIX, PAS SEULEMENT PAR LE TEXTE
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Le minuteur d'envoi sur silence ne comptait que les MOTS TRANSCRITS.
//      Quand la transcription rend la main en retard, on continuait de parler
//      sans qu'aucun mot n'arrive : l'echeance tombait et la dictee se refermait
//      au milieu de la phrase, alors que le micro ENTENDAIT la voix. Un SON
//      capte repousse desormais l'echeance. C'est le defaut corrige, et c'est
//      la premiere chose que ce fichier rend impossible.
//   2. Le son utilise le mecanisme de niveau qui EXISTE DEJA (deux seuils,
//      `vocalCapte`, le drapeau `vocalMicCapte` de la veille de 20 s) : aucun
//      second capteur, aucun second lissage, aucun seuil nouveau.
//   3. GARDE-FOU : un bruit de fond permanent ne tient pas l'ecran ouvert. Le
//      report est borne par un plafond mesure depuis le dernier mot TRANSCRIT
//      (15 s, voir la justification dans vocal-conversation.js).
//   4. Ce qui est deja verrouille ne bouge pas : les seuils de la decision du
//      silence, le delai par defaut (2 s) et le reglage restent inchanges ;
//      l'interruption par la voix (barge-in) et la veille de 20 s aussi.
//   5. L'arret REEL de la dictee envoie toujours : a l'echeance, on referme par
//      la voie qui existe deja (`vocalCloseForSend`), aucun second envoi.
//
// Les commentaires sont en ASCII ; les chaines qui viennent du code sont
// copiees telles quelles. Les fins de ligne sont normalisees (quality-gate 3.4).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sliceSource } from "./source-slice.js";
import {
  decideVocalSilenceSend,
  decideVocalSoundExtension,
  normalizeVocalSilenceSendMs,
  VOCAL_SILENCE_CLOSE,
  VOCAL_SILENCE_WAIT,
  VOCAL_SILENCE_SEND_MS,
  VOCAL_SILENCE_SEND_MIN_MS,
  VOCAL_SILENCE_SEND_MAX_MS,
  VOCAL_SILENCE_SOUND_MAX_MS,
  VOCAL_SOUND_HOLD,
  VOCAL_SOUND_RESTART,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) =>
  readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const SUPER = lire("src/js/super-agent.js");
const MODULE = lire("src/js/vocal-conversation.js");
const SPEC = lire("spec_modes_ecran_vocal.md");

/** Corps d'une fonction (ancre de fin : la fermeture en colonne 2). */
function corpsFonction(src, entete) {
  return sliceSource(src, entete, "\n  }\n", 40);
}

/** Nombre d'occurrences d'un fragment (compte des branchements, pas de regex). */
const compte = (src, frag) => (src.match(new RegExp(frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

// L'etat d'une dictee ouverte au repos, du point de vue des deux decisions.
const PRET = {
  modeOuvert: true,
  pilotParle: false,
  dicteeOuverte: true,
  repriseMain: false,
  motEntendu: true,
  delaiMs: VOCAL_SILENCE_SEND_MS,
};

// ── 1. La decision PURE : le son repousse, et il est borne ───────────────────
describe("1. la decision du report par le son (pure)", () => {
  it("un son capte repousse l'echeance, une voix absente la laisse tomber", () => {
    const repousse = decideVocalSoundExtension({ ...PRET, voixCaptee: true, ecouleMs: 0 });
    expect(repousse.action).toBe(VOCAL_SOUND_RESTART);
    expect(repousse.delai).toBe(VOCAL_SILENCE_SEND_MS);
    expect(decideVocalSoundExtension({ ...PRET, voixCaptee: false })).toEqual({
      action: VOCAL_SOUND_HOLD,
      raison: "sans-voix",
      delai: 0,
    });
  });

  it("le report suit le delai REGLE, et il est borne par le plafond", () => {
    // Reglage a 5 s : c'est lui qui commande, pas une constante recopiee.
    const cinq = decideVocalSoundExtension({ ...PRET, delaiMs: 5000, voixCaptee: true, ecouleMs: 0 });
    expect(cinq.delai).toBe(5000);
    // Reglage a 1 s.
    const une = decideVocalSoundExtension({ ...PRET, delaiMs: 1000, voixCaptee: true, ecouleMs: 0 });
    expect(une.delai).toBe(1000);
    // Au-dela du plafond, on ne repousse plus du tout : l'echeance est tenue.
    expect(decideVocalSoundExtension({ ...PRET, voixCaptee: true, ecouleMs: VOCAL_SILENCE_SOUND_MAX_MS })).toEqual({
      action: VOCAL_SOUND_HOLD,
      raison: "plafond",
      delai: 0,
    });
    // Juste avant le plafond, le report est RACCOURCI a ce qui reste : le
    // plafond ne peut jamais etre depasse par un report de 2 s.
    const fin = decideVocalSoundExtension({
      ...PRET,
      voixCaptee: true,
      ecouleMs: VOCAL_SILENCE_SOUND_MAX_MS - 120,
    });
    expect(fin.action).toBe(VOCAL_SOUND_RESTART);
    expect(fin.delai).toBe(120);
  });

  it("le son ne repousse rien quand un fait de conversation prime sur lui", () => {
    const cas = [
      ["hors-mode", { modeOuvert: false }],
      ["pilot-parle", { pilotParle: true }],
      ["dictee-fermee", { dicteeOuverte: false }],
      ["reprise-main", { repriseMain: true }],
      ["sans-mot", { motEntendu: false }],
    ];
    for (const [raison, extra] of cas) {
      expect(decideVocalSoundExtension({ ...PRET, voixCaptee: true, ecouleMs: 0, ...extra })).toEqual({
        action: VOCAL_SOUND_HOLD,
        raison,
        delai: 0,
      });
    }
    // Aucun etat, aucune exception : la fonction repond toujours.
    expect(decideVocalSoundExtension().action).toBe(VOCAL_SOUND_HOLD);
    expect(decideVocalSoundExtension(null).action).toBe(VOCAL_SOUND_HOLD);
  });

  it("le plafond justifie est plus court que la veille et plus long que les reglages", () => {
    // Le plafond est un GARDE-FOU, pas une duree de confort : il doit rester
    // sous l'autre reference de silence du produit (veille de 20 s) et au-dessus
    // du reglage maximal, sinon il couperait la parole qu'il protege.
    expect(VOCAL_SILENCE_SOUND_MAX_MS).toBe(15000);
    expect(VOCAL_SILENCE_SOUND_MAX_MS).toBeGreaterThan(VOCAL_SILENCE_SEND_MAX_MS * 2);
    expect(VOCAL_SILENCE_SOUND_MAX_MS).toBeLessThan(20000);
    // Rien n'a bouge du cote du reglage : defaut 2 s, bornes 1-5 s.
    expect(VOCAL_SILENCE_SEND_MS).toBe(2000);
    expect(normalizeVocalSilenceSendMs(undefined)).toBe(2000);
    expect(normalizeVocalSilenceSendMs(900)).toBe(VOCAL_SILENCE_SEND_MIN_MS);
    expect(normalizeVocalSilenceSendMs(60000)).toBe(VOCAL_SILENCE_SEND_MAX_MS);
  });

  it("la decision est PURE : elle ne lit ni l'horloge ni le micro", () => {
    const corps = sliceSource(MODULE, "export function decideVocalSoundExtension(", "\n}\n", 60);
    expect(corps).not.toContain("Date.now");
    expect(corps).not.toContain("setTimeout");
    expect(corps).not.toContain("performance.");
    expect(corps).not.toContain("getUserMedia");
    expect(corps).not.toContain("invoke(");
    // Le delai par defaut n'est jamais recopie : il vient de la seule constante.
    expect(corps).not.toContain("2000");
  });
});

// ── 2. Le comportement dans le temps (banc adosse aux decisions pures) ───────
// Ce banc reproduit la regle de l'appelant, celle que `vocalNoteWord` applique :
// un mot arme l'unique minuteur ; a l'echeance, la decision du silence est
// REEVALUEE, puis celle du SON — et c'est la seule chose qui a change.
function banc() {
  const envois = [];
  const journal = [];
  let minuteur = 0;
  let motRecu = false;
  let motInstant = 0;
  let voix = false;
  let pilotParle = false;
  let repriseMain = false;
  const vue = () => ({
    modeOuvert: true,
    pilotParle,
    dicteeOuverte: true,
    repriseMain,
    motEntendu: motRecu,
    delaiMs: VOCAL_SILENCE_SEND_MS,
  });
  const vueSon = () => ({ ...vue(), voixCaptee: voix, ecouleMs: motInstant ? Date.now() - motInstant : 0 });
  const clear = () => {
    if (!minuteur) return;
    clearTimeout(minuteur);
    minuteur = 0;
  };
  const mot = () => {
    motRecu = true;
    motInstant = Date.now();
    const d = decideVocalSilenceSend(vue());
    clear();
    if (d.action !== VOCAL_SILENCE_WAIT || !d.delai) return;
    const armer = (delai) => {
      minuteur = setTimeout(() => {
        minuteur = 0;
        if (decideVocalSilenceSend(vue(), "echeance").action !== VOCAL_SILENCE_CLOSE) return;
        const son = decideVocalSoundExtension(vueSon());
        if (son.action === VOCAL_SOUND_RESTART && son.delai > 0) {
          journal.push("repousser");
          armer(son.delai);
          return;
        }
        envois.push("envoyer");
      }, delai);
    };
    armer(d.delai);
  };
  return {
    envois,
    journal,
    mot,
    clear,
    setVoix: (v) => {
      voix = v === true;
    },
    setPilotParle: (v) => {
      pilotParle = v === true;
    },
    setRepriseMain: (v) => {
      repriseMain = v === true;
    },
    enVol: () => minuteur !== 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("2. le temps : la voix tient l'ecoute ouverte, le plafond la referme", () => {
  it("une voix continue repousse l'echeance : l'ecoute ne se referme pas pendant la parole", () => {
    vi.useFakeTimers();
    const b = banc();
    b.setVoix(true);
    b.mot();
    // Deux secondes sans nouveau MOT, mais la voix est la : rien ne part.
    vi.advanceTimersByTime(VOCAL_SILENCE_SEND_MS);
    expect(b.envois).toHaveLength(0);
    expect(b.journal).toEqual(["repousser"]);
    // Et ca recommence : la parole continue, l'echeance recule encore.
    vi.advanceTimersByTime(VOCAL_SILENCE_SEND_MS);
    expect(b.envois).toHaveLength(0);
    expect(b.journal).toEqual(["repousser", "repousser"]);
    // LA PAROLE S'ARRETE : le silence ordinaire referme la dictee (et l'envoi
    // suit, par la voie existante) — le correctif n'empeche pas l'envoi.
    b.setVoix(false);
    vi.advanceTimersByTime(VOCAL_SILENCE_SEND_MS);
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("le son ne repousse pas indefiniment : le plafond referme, mesure depuis le dernier mot", () => {
    vi.useFakeTimers();
    const b = banc();
    b.setVoix(true);
    b.mot();
    // Un bruit permanent (ventilateur, television) est exactement ce cas : le
    // plafond doit refermer, sinon plus rien ne partirait jamais.
    vi.advanceTimersByTime(VOCAL_SILENCE_SOUND_MAX_MS - 1);
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("un nouveau mot REMET le plafond a zero (il compte depuis le dernier mot)", () => {
    vi.useFakeTimers();
    const b = banc();
    b.setVoix(true);
    b.mot();
    vi.advanceTimersByTime(8000);
    expect(b.envois).toHaveLength(0);
    // Un mot est enfin transcrit : la transcription est vivante, le plafond
    // repart de cet instant precisement.
    b.mot();
    vi.advanceTimersByTime(VOCAL_SILENCE_SOUND_MAX_MS - 1);
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(b.envois).toEqual(["envoyer"]);
  });

  it("sans voix, l'echeance tombe au delai regle — le comportement d'avant est intact", () => {
    vi.useFakeTimers();
    const b = banc();
    b.mot();
    vi.advanceTimersByTime(VOCAL_SILENCE_SEND_MS - 1);
    expect(b.envois).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(b.envois).toEqual(["envoyer"]);
    expect(b.journal).toEqual([]);
  });

  it("Pilot parle ou l'utilisateur a repris la main : le son ne repousse RIEN", () => {
    vi.useFakeTimers();
    // Pilot lit sa reponse : le micro l'entend lui-meme (echo des haut-parleurs).
    // Repousser sur ce son ferait tourner le minuteur sans fin pendant la lecture.
    const lecture = banc();
    lecture.setVoix(true);
    lecture.setPilotParle(true);
    lecture.mot();
    vi.advanceTimersByTime(VOCAL_SILENCE_SEND_MS * 4);
    expect(lecture.envois).toHaveLength(0);
    expect(lecture.journal).toEqual([]);
    // Reprise en main : la saisie de l'utilisateur prime, rien ne part.
    const reprise = banc();
    reprise.setVoix(true);
    reprise.setRepriseMain(true);
    reprise.mot();
    vi.advanceTimersByTime(VOCAL_SILENCE_SEND_MS * 4);
    expect(reprise.envois).toHaveLength(0);
    expect(reprise.journal).toEqual([]);
  });
});

// ── 3. Le branchement reel, dans super-agent.js ─────────────────────────────
describe("3. le branchement : un seul minuteur, une seule source de niveau", () => {
  it("l'echeance est repoussee par le son, puis refermee par la voie existante", () => {
    const note = corpsFonction(SUPER, "function vocalNoteWord()");
    // L'ordre compte : la decision du silence d'abord (elle peut tout annuler),
    // le son ensuite, et l'envoi seulement si rien ne repousse.
    const iSilence = note.indexOf('decideVocalSilenceSend(vocalSilenceState(), "echeance")');
    const iSon = note.indexOf("const son = decideVocalSoundExtension(vocalSoundState());");
    const iFermer = note.indexOf("vocalCloseForSend();");
    expect(iSilence).toBeGreaterThan(-1);
    expect(iSon).toBeGreaterThan(iSilence);
    expect(iFermer).toBeGreaterThan(iSon);
    // Le report passe par le MEME minuteur, remplace — jamais un second.
    expect(note).toContain("if (son.action === VOCAL_SOUND_RESTART && son.delai > 0) {");
    expect(note).toContain("armer(son.delai);");
    expect(note).toContain("vocalSilenceTimer = setTimeout(");
    expect(compte(SUPER, "vocalSilenceTimer = setTimeout(")).toBe(1);
    // Un seul appel a la decision du son dans tout le fichier.
    expect(compte(SUPER, "decideVocalSoundExtension(")).toBe(1);
    // Le repere du dernier mot est pose par le SEUL point qui recoit un mot.
    expect(note).toContain("vocalMotInstant = Date.now();");
    expect(compte(SUPER, "vocalMotInstant = Date.now();")).toBe(1);
    // Une nouvelle session repart de zero (aucun plafond herite).
    expect(corpsFonction(SUPER, "function startVoiceInput()")).toContain("vocalMotInstant = 0;");
  });

  it("le son vient du niveau DEJA mesure — aucun second capteur, aucun seuil nouveau", () => {
    const etat = corpsFonction(SUPER, "function vocalSoundState()");
    // Une seule source d'etat : celle de la decision du silence.
    expect(etat).toContain("const base = vocalSilenceState();");
    // Le drapeau de niveau existant, celui de la veille de 20 s.
    expect(etat).toContain("voixCaptee: vocalMicListening === true && vocalMicCapte === true,");
    expect(etat).toContain("ecouleMs: vocalMotInstant ? Date.now() - vocalMotInstant : 0,");
    // Aucune seconde mesure : pas de capture, pas d'analyseur, pas de seuil.
    expect(etat).not.toContain("getUserMedia");
    expect(etat).not.toContain("AudioContext");
    expect(etat).not.toContain("createAnalyser");
    expect(SUPER).not.toContain("createAnalyser");
    // `vocalMicCapte` n'a qu'un seul ecrivain de mesure (la decision de niveau
    // existante) : le correctif n'ajoute aucune ecriture.
    expect(compte(SUPER, "vocalMicCapte = pas.capte;")).toBe(1);
    // Les seuils de cette decision ne sont pas touches (ils vivent dans
    // vocal-mic.js et super-agent.js, hors de ce correctif).
    expect(corpsFonction(SUPER, "function vocalSetLevel(niveau)")).toContain("vocalVoiceStep({");
  });

  it("l'interruption par la voix et la veille de 20 s ne sont pas touchees", () => {
    // Le barge-in garde sa garde « pendant une dictee, ce n'est pas une prise de
    // parole » et son etat d'armement : rien de ce correctif n'y entre.
    const barge = corpsFonction(SUPER, "function vocalBargeIn(rapport)");
    expect(barge).toContain("if (voiceActive) return;");
    expect(barge).toContain("vocalInterruptTarget(");
    expect(barge).not.toContain("vocalSoundState");
    expect(barge).not.toContain("decideVocalSoundExtension");
    // La veille garde son unique rearmement, a la detection de voix.
    expect(corpsFonction(SUPER, "function vocalRestartVeilleTimer()").length).toBeGreaterThan(40);
    expect(corpsFonction(SUPER, "function vocalNoteWord()")).toContain("vocalRestartVeilleTimer();");
    expect(corpsFonction(SUPER, "function vocalSetLevel(niveau)")).toContain("vocalRestartVeilleTimer();");
  });

  it("rien n'est recopie : ni le defaut, ni le plafond, dans l'ecran", () => {
    // Le delai par defaut n'apparait jamais dans l'ecran (verrou existant), et
    // le plafond non plus : il n'existe qu'a un seul endroit.
    expect(SUPER).not.toContain("VOCAL_SILENCE_SEND_MS");
    expect(SUPER).not.toContain("VOCAL_SILENCE_SOUND_MAX_MS");
    expect(SUPER).not.toContain("15000");
    expect(compte(MODULE, "export const VOCAL_SILENCE_SOUND_MAX_MS = 15000;")).toBe(1);
    // Le reglage du proprietaire n'est pas touche par ce correctif.
    expect(compte(MODULE, "export const VOCAL_SILENCE_SEND_MS = 2000;")).toBe(1);
    expect(compte(MODULE, "export const VOCAL_SILENCE_SEND_MIN_MS = 1000;")).toBe(1);
    expect(compte(MODULE, "export const VOCAL_SILENCE_SEND_MAX_MS = 5000;")).toBe(1);
  });

  it("la specification dit la regle et le garde-fou", () => {
    expect(SPEC).toContain("Le SON de la voix repousse l'échéance");
    expect(SPEC).toContain("VOCAL_SILENCE_SOUND_MAX_MS");
    expect(SPEC).toContain("RAPPORT-fin-ecoute-repoussee-par-la-voix.md");
    expect(SPEC).toContain("fin-ecoute-repoussee-par-la-voix.test.js");
  });
});
