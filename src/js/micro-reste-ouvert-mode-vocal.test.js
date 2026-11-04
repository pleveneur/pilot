// Tests — LE MICRO NE PEUT PLUS S'ARRETER TOUT SEUL DANS LE MODE VOCAL
// (docs/rapports/RAPPORT-micro-arret-mode-vocal.md).
//
// CE QUE CE FICHIER VERROUILLE (et pourquoi) :
//   1. Une perte SPONTANEE de la capture (piste `ended` : casque debranche,
//      peripherique change, autre application qui prend le micro, analyseur
//      muet) reouvre le micro TOUTE SEULE tant que l'ECRAN le tient — c'est le
//      defaut rapporte : « le micro s'arrete en pleine conversation et il faut
//      parfois le rouvrir a la main ».
//   2. SANS la garde de l'ecran (`setKeepOpen`), rien ne se rouvre : le
//      comportement d'avant est intact, c'est la garde qui change.
//   3. Une SORTIE du mode (`fermer()`) n'est JAMAIS défaite : aucune minuterie
//      ne rallume le micro apres la sortie, meme si une reprise etait en attente.
//   4. Une cause DEFINITIVE (refus de l'utilisateur, aucun peripherique) n'est
//      jamais redemandee : aucune boucle de permission.
//   5. Le delai s'ALLONGE puis PLAFONNE (pas une tentative toutes les 400 ms).
//   6. Une seule capture a la fois : deux demandes concurrentes ne peuvent pas
//      ouvrir deux flux.
//   7. Le branchement est ecrit UNE fois : la garde est posee a l'entree du mode,
//      retiree a la sortie, et `vocalMic.fermer()` n'apparait qu'a la sortie.
//   8. La phrase « le micro est ferme » DISPARAIT quand la capture revient, mais
//      une ERREUR DE DICTEE, elle, reste affichee (autre fait, autre bouton).
//   9. Apres la lecture d'une reponse, la dictee se REARME toute seule
//      (`apres-lecture`, 600 ms) des que la mesure est ouverte.
//
// Les commentaires sont en ASCII ; les chaines de l'interface sont copiees
// telles quelles (accents compris).
import { vi, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createVocalMic,
  micFailureIsRecoverable,
  micReopenDelay,
  shouldReopenVocalMic,
  MIC_REOPEN_BASE_MS,
  MIC_REOPEN_MAX_MS,
  MIC_OCCUPE,
} from "./vocal-mic.js";
import {
  decideVocalDictation,
  VOCAL_DICTATION_ARM,
  VOCAL_ARM_AFTER_READ_MS,
} from "./vocal-conversation.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");
const SUPER = lire("src/js/super-agent.js");

/** Corps d'une fonction de `super-agent.js` (jusqu'a l'accolade en colonne 3). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }", i);
  return src.slice(i, fin > -1 ? fin : undefined);
}

/**
 * Faux micro dont la capture peut etre PERDUE (evenement `ended` emis par le
 * systeme), avec des minuteries INJECTEES : la reprise est observable sans
 * attendre reellement. Aucune fenetre, aucune vraie API audio.
 */
function banc(options = {}) {
  const etat = {
    demandes: 0,
    echecs: options.echecs || [], // noms d'erreur a rendre, dans l'ordre
    minuteries: [], // { id, ms, cb }
    prochainId: 1,
    ecoutes: [], // historique de `onListening`
    pannes: [], // historique de `onFailure`
    stops: 0,
  };
  const pistes = [];
  function nouvellePiste() {
    const piste = {
      readyState: "live",
      listeners: {},
      stop() {
        this.readyState = "ended";
        etat.stops += 1;
        (this.listeners.ended || []).forEach((f) => f());
      },
      addEventListener(nom, f) {
        this.listeners[nom] = this.listeners[nom] || [];
        this.listeners[nom].push(f);
      },
      /** Le SYSTEME termine la piste (pas nous) : c'est le defaut rapporte. */
      terminerParLeSysteme() {
        this.readyState = "ended";
        (this.listeners.ended || []).forEach((f) => f());
      },
    };
    pistes.push(piste);
    return piste;
  }
  const analyseur = {
    fftSize: 1024,
    smoothingTimeConstant: 0,
    getFloatTimeDomainData(tampon) {
      for (let k = 0; k < tampon.length; k += 1) tampon[k] = 0.1;
    },
  };
  const contexte = {
    state: "running",
    createMediaStreamSource: () => ({ connect() {} }),
    createAnalyser: () => analyseur,
    close: () => Promise.resolve(),
  };
  const nav = {
    mediaDevices: {
      getUserMedia() {
        etat.demandes += 1;
        const echec = etat.echecs.length > 0 ? etat.echecs.shift() : null;
        if (echec) {
          const err = new Error("media");
          err.name = echec;
          return Promise.reject(err);
        }
        const piste = nouvellePiste();
        const flux = { getTracks: () => [piste] };
        return Promise.resolve(flux);
      },
    },
  };
  // Aucune image de mesure n'est jouee ici : la boucle est neutralisee, seul le
  // cycle ouverture / perte / reprise est observe.
  const micro = createVocalMic({
    navigator: nav,
    AudioContext: function Faux() {
      return contexte;
    },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout(cb, ms) {
      const id = etat.prochainId;
      etat.prochainId += 1;
      etat.minuteries.push({ id, ms, cb });
      return id;
    },
    clearTimeout(id) {
      const i = etat.minuteries.findIndex((m) => m.id === id);
      if (i > -1) etat.minuteries.splice(i, 1);
    },
    onListening: (v) => etat.ecoutes.push(v),
    onFailure: (m) => etat.pannes.push(m),
  });
  /** Fait sonner la premiere minuterie en attente (comme le temps qui passe). */
  async function sonner() {
    const m = etat.minuteries.shift();
    if (!m) return false;
    m.cb();
    // Laisse la promesse de `demander()` se resoudre.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    return true;
  }
  /** Fait sonner toutes les minuteries en attente, dans l'ordre. */
  async function sonnerTout(limite = 10) {
    let n = 0;
    while (n < limite && (await sonner())) n += 1;
    return n;
  }
  return { micro, etat, pistes, sonner, sonnerTout };
}

// ── 1. Les decisions sont PURES ────────────────────────────────────────────
describe("1. la reprise est une DECISION pure", () => {
  it("une cause passagere se reessaie, une cause definitive jamais", () => {
    // Passageres : le peripherique peut revenir tout seul.
    for (const cause of ["NotReadableError", "TrackStartError", "AbortError", "inconnue"]) {
      expect(micFailureIsRecoverable(cause), cause).toBe(true);
    }
    // Definitives : redemander serait inutile, ou malhonnete (permission).
    for (const cause of [
      "NotAllowedError",
      "SecurityError",
      "PermissionDeniedError",
      "NotFoundError",
      "DevicesNotFoundError",
      "OverconstrainedError",
      "",
    ]) {
      expect(micFailureIsRecoverable(cause), cause).toBe(false);
    }
  });

  it("le delai s'allonge puis PLAFONNE", () => {
    expect(micReopenDelay(0)).toBe(MIC_REOPEN_BASE_MS);
    expect(micReopenDelay(1)).toBeGreaterThan(micReopenDelay(0));
    expect(micReopenDelay(2)).toBeGreaterThan(micReopenDelay(1));
    expect(micReopenDelay(3)).toBeGreaterThan(micReopenDelay(2));
    // Plafond : plus jamais de tentative toutes les 400 ms pendant une heure.
    for (const essai of [4, 5, 20, 10_000]) {
      expect(micReopenDelay(essai)).toBe(MIC_REOPEN_MAX_MS);
    }
    // Bornes, meme sur une entree absurde.
    expect(micReopenDelay(-5)).toBe(MIC_REOPEN_BASE_MS);
    expect(micReopenDelay(NaN)).toBe(MIC_REOPEN_BASE_MS);
    expect(micReopenDelay(Infinity)).toBe(MIC_REOPEN_BASE_MS);
  });

  it("les quatre regles de `shouldReopenVocalMic`, dans l'ordre", () => {
    // 1. Sortie du mode : jamais de reprise, quoi qu'il arrive.
    expect(shouldReopenVocalMic({ ferme: true, gardeOuvert: true, actif: false, cause: "TrackStartError" })).toBe(false);
    // 2. Personne ne tient le micro : aucune reprise automatique.
    expect(shouldReopenVocalMic({ ferme: false, gardeOuvert: false, actif: false, cause: "TrackStartError" })).toBe(false);
    // 3. Il capte deja : rien a rouvrir.
    expect(shouldReopenVocalMic({ ferme: false, gardeOuvert: true, actif: true, cause: "" })).toBe(false);
    // 4. La cause decide.
    expect(shouldReopenVocalMic({ ferme: false, gardeOuvert: true, actif: false, cause: "NotReadableError" })).toBe(true);
    expect(shouldReopenVocalMic({ ferme: false, gardeOuvert: true, actif: false, cause: "NotAllowedError" })).toBe(false);
    // Aucun fait : aucune reprise (jamais un demarrage par accident).
    expect(shouldReopenVocalMic()).toBe(false);
  });
});

// ── 2. La capture perdue se rouvre TOUTE SEULE ─────────────────────────────
describe("2. une capture perdue se rouvre seule tant que l'ecran la tient", () => {
  it("piste terminee par le SYSTEME -> reouverture automatique, sans geste", async () => {
    const { micro, etat, pistes, sonner } = banc();
    micro.setKeepOpen(true);
    expect(await micro.demander()).toBe(true);
    expect(etat.demandes).toBe(1);
    expect(etat.ecoutes).toEqual([true]);

    // Le systeme termine la piste : casque debranche, peripherique change,
    // autre application qui prend le micro. Ce n'est PAS nous.
    pistes[0].terminerParLeSysteme();
    // La panne est DITE (message clair deja utilise par l'ecran)...
    expect(etat.pannes).toEqual([MIC_OCCUPE]);
    expect(etat.ecoutes).toEqual([true, false]);
    // ... et une reprise est REELLEMENT programmee.
    expect(etat.minuteries).toHaveLength(1);
    expect(etat.minuteries[0].ms).toBe(MIC_REOPEN_BASE_MS);

    // Aucune action de l'utilisateur : le temps passe.
    expect(await sonner()).toBe(true);
    expect(etat.demandes).toBe(2);
    expect(etat.ecoutes).toEqual([true, false, true]);
    expect(micro.estActif()).toBe(true);
    // Plus rien en attente : la capture est ouverte, donc plus rien a reprendre.
    expect(etat.minuteries).toHaveLength(0);
  });

  it("analyseur devenu muet -> meme reprise (aucun second chemin)", async () => {
    const { micro, etat } = banc();
    micro.setKeepOpen(true);
    await micro.demander();
    // La panne d'analyseur n'est atteignable qu'a l'image suivante : ici on
    // verifie le POINT UNIQUE, c'est-a-dire que toute panne de capture passe par
    // `panneCapture` (source) et non qu'un seul cas la programme.
    const src = lire("src/js/vocal-mic.js");
    expect(src).toContain("panneCapture(\"TrackStartError\")");
    // Les trois anciens appels nus ont disparu : `liberer(); surPanne(...)`.
    expect(src).not.toContain("liberer();\n      surPanne(");
    expect(src).not.toContain("liberer();\n            surPanne(");
    expect(etat.demandes).toBe(1);
  });

  it("SANS la garde de l'ecran, rien ne se rouvre (comportement d'avant intact)", async () => {
    const { micro, etat, pistes } = banc();
    // Aucun `setKeepOpen` : c'est l'ancien monde.
    await micro.demander();
    pistes[0].terminerParLeSysteme();
    expect(etat.pannes).toHaveLength(1);
    expect(etat.minuteries).toHaveLength(0);
    expect(etat.demandes).toBe(1);
    expect(micro.estActif()).toBe(false);
  });

  it("un REFUS n'est JAMAIS redemande (aucune boucle de permission)", async () => {
    const { micro, etat } = banc({ echecs: ["NotAllowedError"] });
    micro.setKeepOpen(true);
    expect(await micro.demander()).toBe(false);
    expect(etat.demandes).toBe(1);
    expect(etat.minuteries).toHaveLength(0);
    expect(etat.pannes).toHaveLength(1);
  });

  it("micro OCCUPE -> une reprise, puis le delai s'allonge", async () => {
    // Deux echecs passagers (une autre application tient le micro), puis succes.
    const { micro, etat, sonner } = banc({ echecs: ["NotReadableError", "NotReadableError"] });
    micro.setKeepOpen(true);
    expect(await micro.demander()).toBe(false);
    expect(etat.minuteries).toHaveLength(1);
    const premier = etat.minuteries[0].ms;
    await sonner(); // 2e demande : echec -> nouvelle reprise, delai PLUS LONG
    expect(etat.demandes).toBe(2);
    expect(etat.minuteries).toHaveLength(1);
    expect(etat.minuteries[0].ms).toBeGreaterThan(premier);
    await sonner(); // 3e demande : succes
    expect(etat.demandes).toBe(3);
    expect(micro.estActif()).toBe(true);
    expect(etat.minuteries).toHaveLength(0);
  });
});

// ── 3. La sortie du mode reste une DECISION ────────────────────────────────
describe("3. fermer() n'est jamais defait par une minuterie", () => {
  it("une reprise en attente est ANNULEE par la sortie du mode", async () => {
    const { micro, etat, pistes } = banc();
    micro.setKeepOpen(true);
    await micro.demander();
    pistes[0].terminerParLeSysteme();
    expect(etat.minuteries).toHaveLength(1);

    micro.setKeepOpen(false);
    expect(etat.minuteries).toHaveLength(0);
    micro.fermer();
    expect(etat.minuteries).toHaveLength(0);
    expect(etat.demandes).toBe(1);
    expect(micro.estActif()).toBe(false);
    // Et un appel ulterieur ne rouvre rien non plus.
    expect(await micro.demander()).toBe(false);
    expect(etat.demandes).toBe(1);
  });

  it("une perte APRES fermer() ne programme aucune reprise", async () => {
    const { micro, etat, pistes } = banc();
    micro.setKeepOpen(true);
    await micro.demander();
    const piste = pistes[0];
    micro.setKeepOpen(false);
    micro.fermer();
    // Une piste qui se termine apres coup ne rallume rien.
    piste.terminerParLeSysteme();
    expect(etat.minuteries).toHaveLength(0);
    expect(etat.demandes).toBe(1);
  });
});

// ── 4. Une seule capture a la fois ─────────────────────────────────────────
describe("4. aucune capture doublee", () => {
  it("deux demandes concurrentes ne lancent qu'une capture", async () => {
    const { micro, etat } = banc();
    micro.setKeepOpen(true);
    const [a, b] = await Promise.all([micro.demander(), micro.demander()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(etat.demandes).toBe(1);
  });
});

// ── 5. Le branchement est ecrit UNE fois, aux bons endroits ────────────────
describe("5. l'ecran pose et retire la garde, et n'arrete le micro qu'a la sortie", () => {
  it("la garde est posee a l'ENTREE du mode", () => {
    const src = SUPER;
    const creation = src.indexOf("vocalMic = createVocalMic({");
    const garde = src.indexOf("vocalMic.setKeepOpen(true);");
    // Demande de mesure
    const demande = src.indexOf('requestVocalMeasure("entree");');
    expect(creation).toBeGreaterThan(-1);
    expect(garde).toBeGreaterThan(creation);
    expect(demande).toBeGreaterThan(garde);
  });

  it("la garde est retiree JUSTE AVANT l'arret, a la sortie du mode", () => {
    const sortie = corpsFonction(SUPER, "function exitVocal()");
    const garde = sortie.indexOf("vocalMic.setKeepOpen(false);");
    const arret = sortie.indexOf("vocalMic.fermer();");
    expect(garde).toBeGreaterThan(-1);
    expect(arret).toBeGreaterThan(garde);
  });

  it("`vocalMic.fermer()` n'apparait QU'UNE fois dans tout l'ecran", () => {
    expect((SUPER.match(/vocalMic\.fermer\(\)/g) || [])).toHaveLength(1);
  });

  it("`setKeepOpen` n'est pose qu'a ces DEUX endroits", () => {
    expect((SUPER.match(/vocalMic\.setKeepOpen\(/g) || [])).toHaveLength(2);
  });
});

// ── 6. Ce qui reste affiche quand la capture revient ───────────────────────
describe("6. la phrase du micro disparait au retour, l'erreur de dictee reste", () => {
  it("`vocalSetListening(true)` retire la phrase du micro, garde l'erreur", () => {
    const corps = corpsFonction(SUPER, "function vocalSetListening(actif)");
    // La phrase du micro n'est retiree QUE lorsque la capture revient...
    expect(corps).toContain("} else if (vocalMicFerme) {");
    // ... et elle est remplacee par l'erreur de DICTEE (autre fait, autre bouton).
    expect(corps).toContain("vocalMicFerme = vocalDictationErreur;");
    // Une capture perdue vide toujours le niveau et la detection de parole.
    expect(corps).toContain("vocalMicCapte = false;");
    expect(corps).toContain("vocalClearLevel();");
  });

  it("une panne de dictee dont la cause est la capture ne VERROUILLE pas la dictee", () => {
    const corps = corpsFonction(SUPER, "function reportVoiceFailure(message, ecranMessage)");
    // Garde : mesure fermee ET phrase du micro deja posee -> on n'enregistre pas
    // une erreur qui survivrait au retour du micro (regle 6).
    expect(corps).toContain("if (vocalMicListening !== true && vocalMicFerme) return;");
    // Le chemin normal n'est pas touche.
    expect(corps).toContain("vocalMicFerme = vocalDictationErreur;");
    expect(corps).toContain("appendSystemMessage(messagesEl, texte);");
  });
});

// ── 7. Apres la lecture, l'ecoute repart seule ─────────────────────────────
describe("7. apres la lecture d'une reponse, la dictee se rearme seule", () => {
  const REPOS = {
    modeOuvert: true,
    projetSensible: false,
    pilotParle: false,
    reflechit: false,
    occupe: false,
    dicteeOuverte: false,
    arretManuel: false,
    sessionsVides: false,
    erreur: "",
    transcription: true,
    apresLecture: false,
    sensibiliteConnue: true,
    sensibiliteIndisponible: false,
    mesureOuverte: true,
  };

  it("mesure ouverte + fin de lecture -> armement apres 600 ms", () => {
    const d = decideVocalDictation({ ...REPOS, apresLecture: true });
    expect(d.action).toBe(VOCAL_DICTATION_ARM);
    expect(d.delai).toBe(VOCAL_ARM_AFTER_READ_MS);
  });

  it("mesure FERMEE -> pas d'armement : c'est la panne de mesure qui parle", () => {
    const d = decideVocalDictation({ ...REPOS, apresLecture: true, mesureOuverte: false });
    expect(d.action).not.toBe(VOCAL_DICTATION_ARM);
    expect(d.raison).toBe("mesure-fermee");
  });
});
