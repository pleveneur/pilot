// fin-de-session-perimee-ne-rearme-pas.test.js — LA DICTÉE NE COUPE PLUS.
//
// CE QUE CE FICHIER EMPÊCHE DE REVENIR (rapport
// `docs/rapports/RAPPORT-diagnostic-coupure-dictee-locale.md`, § 0 et § 4) :
//
//   la fenêtre ouvrait une session de dictée NEUVE à chaque réarmement sans
//   jamais fermer la précédente, parce qu'une fin appartenant à une session
//   PÉRIMÉE la remettait « au repos ». Le pont appliquait alors sa règle (« une
//   seule dictée à la fois : la précédente est refermée ») et le texte déjà
//   reconnu de la session vivante n'arrivait plus. Trois fins vides instantanées
//   atteignaient le plafond, qui affichait « La dictée n'a pas fonctionné :
//   écrivez votre demande. ».
//
// Trois verrous, dans l'ordre du défaut :
//   1. IDENTITÉ — une fin/erreur/résultat d'une session REMPLACÉE ne touche plus
//      l'état de l'écran, et ne déclenche aucun réarmement (`session-dictee.js`,
//      appliqué aux trois gestionnaires de `super-agent.js`).
//   2. ORDRE — la session précédente est CLOSE par son propre chemin d'arrêt
//      AVANT que la suivante existe : le pont n'a plus jamais à la refermer
//      lui-même, donc son texte déjà reconnu n'est plus jeté.
//   3. CANAL — le canal du pont est GLOBAL : une oreille ignore les évènements
//      d'une AUTRE session (`oreille-locale-moteur.js`), sinon la fin d'une
//      session remplacée refermait l'écran de la session vivante.
//   4. TRACE — chaque fin d'écoute laisse une ligne (raison, jeton, durée,
//      longueur du texte) dans le journal du pont, qui était muet.
//
// Le pont de test applique la règle RÉELLE d'`asr_voicestudio.rs` : `start`
// referme lui-même la session encore ouverte (et son texte est alors perdu),
// `stop` demande le texte final, qui arrive par l'évènement `final` puis
// `ended`. Les oreilles sont les VRAIES (`createLocalEar`), les décisions aussi
// (`session-dictee.js`). Seule la fenêtre est réduite ici à ses décisions ; son
// branchement réel est vérifié sur le source au § 5.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DICTATION_ALREADY_OPEN,
  DICTATION_OPENED,
  DICTATION_REPLACED,
  createDictationSessionRegistry,
  dictationEndLogLine,
  dictationSessionStillCurrent,
  dictationTextStillAccepted,
  startDictationSession,
} from "./session-dictee.js";
import { LOCAL_EAR_EVENT, createLocalEar } from "./oreille-locale-moteur.js";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const SUPER = lire("src/js/super-agent.js");
const MOTEUR = lire("src/js/oreille-locale-moteur.js");

/** Laisse tourner les promesses en chaîne (aucune horloge, aucun délai réel). */
const attendre = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

/**
 * LE PONT, avec sa règle RÉELLE (`asr_voicestudio.rs`) :
 *   - `asr_voicestudio_start` : une seule dictée à la fois — une session encore
 *     ouverte est refermée PAR LE PONT, et ce qu'elle avait reconnu n'est
 *     jamais rendu (aucun `final`). C'est le « session précédente refermée » du
 *     journal, et c'est ce qui jetait le texte.
 *   - `asr_voicestudio_stop` : fermeture PROPRE — le texte final arrive par
 *     l'évènement `final` (`summary`), puis `ended`.
 *   - `asr_voicestudio_cancel` : rien n'est gardé (abandon).
 */
function pontRealiste() {
  const sessions = [];
  const ecouteurs = new Set();
  const appels = [];
  const etat = { refermeesParLePont: 0, interrompues: 0 };
  // Les évènements arrivent par le canal, donc APRÈS le retour de la commande :
  // c'est le décalage réel qui ouvrait la fenêtre du « remplacement ».
  const emettre = (payload) => {
    queueMicrotask(() => {
      for (const cb of [...ecouteurs]) cb({ payload });
    });
  };
  const ouvertes = () => sessions.filter((s) => !s.fermee);
  const invoke = (nom, args) => {
    appels.push({ nom, args });
    if (nom === "asr_voicestudio_start") {
      for (const s of ouvertes()) {
        s.fermee = true;
        s.texte = "";
        etat.refermeesParLePont += 1;
        emettre({ session_id: s.id, kind: "ended" });
      }
      const session = { id: "s" + (sessions.length + 1), fermee: false, texte: "" };
      sessions.push(session);
      return Promise.resolve({
        session_id: session.id,
        sample_rate: 16000,
        model_id: "sherpa-parakeet-tdt-v3",
        model_label: "Parakeet TDT v3 (français)",
      });
    }
    if (nom === "asr_voicestudio_stop") {
      const session = sessions.find((s) => s.id === args.sessionId);
      if (session && !session.fermee) {
        session.fermee = true;
        if (session.texte) {
          emettre({ session_id: session.id, kind: "final", text: session.texte, final_kind: "summary" });
        }
        emettre({ session_id: session.id, kind: "ended" });
      }
      return Promise.resolve(null);
    }
    if (nom === "asr_voicestudio_cancel") {
      const session = sessions.find((s) => s.id === args.sessionId);
      if (session && !session.fermee) {
        session.fermee = true;
        session.texte = "";
        etat.interrompues += 1;
      }
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  };
  const listen = (nom, cb) => {
    if (nom !== LOCAL_EAR_EVENT) throw new Error("écoute inattendue : " + nom);
    ecouteurs.add(cb);
    return Promise.resolve(() => {
      ecouteurs.delete(cb);
    });
  };
  return {
    invoke,
    listen,
    appels,
    sessions,
    etat,
    ouvertes,
    emettre,
    /** Le service dicte ce qu'il reconnaît (texte CUMULATIF, comme le vrai). */
    dicter: (texte) => {
      const session = ouvertes()[0];
      if (!session) return;
      session.texte = texte;
      emettre({ session_id: session.id, kind: "partial", text: texte });
    },
  };
}

/** Un micro de test : retient le robinet, comme le vrai. */
function fauxMicro() {
  const etat = { tap: null };
  return {
    etat,
    setAudioTap: (fn) => {
      etat.tap = fn;
      return fn !== null;
    },
  };
}

/**
 * LA FENÊTRE, réduite à ses DÉCISIONS (le branchement réel est vérifié au § 5) :
 * un registre de sessions, l'état « une dictée est ouverte », et les gardes
 * d'identité posées là où `super-agent.js` les pose (résultat, fin d'écoute).
 * Ce qui arrive à l'écran est recueilli : `recus` (la zone de saisie),
 * `fins` (les fins d'écoute réellement traitées), `perimees` (ce qui a été
 * refusé, et ne doit donc jamais toucher l'état).
 */
function fenetreDictee(pont, micro) {
  const registre = createDictationSessionRegistry();
  const etat = {
    actif: false,
    rec: null,
    recus: [],
    fins: [],
    jetons: [],
    finsPerimees: 0,
    texteRefuse: 0,
  };

  function ouvrir() {
    const ouverture = startDictationSession(registre, {
      active: etat.actif === true,
      previous: etat.rec,
      // Le chemin d'arrêt EXISTANT : `stopVoiceInput()` côté écran.
      stopPrevious: (precedente) => {
        try {
          precedente.stop();
        } catch (_) {
          return false;
        }
        return true;
      },
    });
    // Comme la source : une dictée déjà ouverte ne fabrique rien du tout.
    if (!ouverture.ouverte) return { ouverture, jeton: ouverture.jeton, rec: etat.rec };
    const jeton = ouverture.jeton;
    const courante = () => dictationSessionStillCurrent(registre, jeton);
    const texteAccepte = () => dictationTextStillAccepted(registre, jeton);
    const rec = createLocalEar({ invoke: pont.invoke, listen: pont.listen, mic: micro });
    rec.onresult = (ev) => {
      // Le texte d'une session remplacée est reçu ; celui d'une session plus
      // ancienne ne l'est pas.
      if (!texteAccepte()) {
        etat.texteRefuse += 1;
        return;
      }
      etat.recus.push(ev.results[0][0].transcript);
    };
    rec.onend = () => {
      if (!courante()) {
        etat.finsPerimees += 1;
        return;
      }
      etat.actif = false;
      etat.rec = null;
      etat.fins.push(jeton);
    };
    etat.rec = rec;
    etat.actif = true;
    etat.jetons.push(jeton);
    rec.start();
    return { ouverture, jeton, rec };
  }

  /** L'arrêt d'écoute de l'écran (`stopVoiceInput`) : l'oreille reste désignée. */
  function arreter() {
    etat.actif = false;
    if (etat.rec) {
      try {
        etat.rec.stop();
      } catch (_) {
        /* déjà arrêtée */
      }
    }
  }

  return { registre, etat, ouvrir, arreter };
}

// ── 1. L'identité de la session ────────────────────────────────────────────
describe("1. une fin venue d'une session REMPLACÉE ne remet pas l'écran au repos", () => {
  it("la garde d'identité refuse tout jeton qui n'est pas celui de la session courante", () => {
    const registre = createDictationSessionRegistry();
    const jeton = registre.ouvrir();
    expect(dictationSessionStillCurrent(registre, jeton)).toBe(true);
    // Une fin de la session d'AVANT : refusée (c'était exactement le défaut).
    expect(dictationSessionStillCurrent(registre, jeton - 1)).toBe(false);
    expect(dictationSessionStillCurrent(registre, 0)).toBe(false);
    expect(dictationSessionStillCurrent(registre, null)).toBe(false);
    expect(dictationSessionStillCurrent(registre, "abc")).toBe(false);
    // Un registre absent ne fait jamais lever une fin d'écoute : elle est ignorée.
    expect(dictationSessionStillCurrent(null, 1)).toBe(false);
    expect(dictationSessionStillCurrent({}, 1)).toBe(false);
  });

  it("le jeton ne se réutilise jamais : une session révolue ne redevient pas courante", () => {
    const registre = createDictationSessionRegistry();
    const premier = registre.ouvrir();
    const deuxieme = registre.ouvrir();
    const troisieme = registre.ouvrir();
    expect(new Set([premier, deuxieme, troisieme]).size).toBe(3);
    expect(troisieme).toBeGreaterThan(deuxieme);
    expect(deuxieme).toBeGreaterThan(premier);
    // La première et la deuxième sont périmées, définitivement.
    expect(dictationSessionStillCurrent(registre, premier)).toBe(false);
    expect(dictationSessionStillCurrent(registre, deuxieme)).toBe(false);
    expect(dictationSessionStillCurrent(registre, troisieme)).toBe(true);
    expect(registre.total()).toBe(3);
  });

  it("le réarmement ne rouvre RIEN tant qu'une dictée est ouverte", () => {
    const registre = createDictationSessionRegistry();
    const premier = startDictationSession(registre, { active: false, previous: null });
    expect(premier.ouverte).toBe(true);
    expect(premier.raison).toBe(DICTATION_OPENED);
    // L'écran croit la dictée ouverte : aucune session n'est rouverte.
    let arrets = 0;
    const second = startDictationSession(registre, {
      active: true,
      previous: {
        stop: () => {
          arrets += 1;
        },
      },
      stopPrevious: (rec) => {
        rec.stop();
        return true;
      },
    });
    expect(second.ouverte).toBe(false);
    expect(second.raison).toBe(DICTATION_ALREADY_OPEN);
    expect(second.jeton).toBe(premier.jeton);
    expect(registre.total()).toBe(1);
    // Une dictée ouverte n'est jamais refermée par une tentative d'ouverture.
    expect(arrets).toBe(0);
  });
});

// ── 2. L'ordre : clore AVANT d'ouvrir ──────────────────────────────────────
describe("2. la session précédente est CLOSE avant que la suivante n'existe", () => {
  it("pendant sa fermeture, la session précédente est encore celle qui tient la dictée", () => {
    const registre = createDictationSessionRegistry();
    const a = startDictationSession(registre, { active: false, previous: null });
    let vuPendantLaFermeture = null;
    const b = startDictationSession(registre, {
      active: false,
      previous: { stop: () => {} },
      // L'arrêt est demandé ALORS QUE le registre nomme encore l'ancienne
      // session : c'est ce qui fait que son texte final, rendu par l'arrêt,
      // appartient encore à la dictée en cours.
      stopPrevious: (rec) => {
        rec.stop();
        vuPendantLaFermeture = registre.courante();
        return true;
      },
    });
    expect(vuPendantLaFermeture).toBe(a.jeton);
    expect(b.raison).toBe(DICTATION_REPLACED);
    // C'est SEULEMENT après la fermeture que le jeton avance.
    expect(registre.courante()).toBe(b.jeton);
    expect(b.jeton).toBeGreaterThan(a.jeton);
  });

  it("la session précédente est close par son propre arrêt AVANT l'ouverture de la suivante", async () => {
    const pont = pontRealiste();
    const micro = fauxMicro();
    const f = fenetreDictee(pont, micro);

    // 1. Une dictée s'ouvre (session s1 au pont).
    const a = f.ouvrir();
    await attendre();
    expect(a.ouverture.raison).toBe(DICTATION_OPENED);
    expect(pont.ouvertes().length).toBe(1);

    // 2. L'écran reçoit déjà du texte (il l'écrit dans sa zone, en direct).
    pont.dicter("bonjour tout le monde");
    await attendre();
    expect(f.etat.recus).toEqual(["bonjour tout le monde"]);

    // 3. Arrêt d'écoute puis réarmement IMMÉDIAT (l'arrêt du moteur est une
    //    promesse : c'est la fenêtre réelle du remplacement). La précédente est
    //    CLOSE d'abord, et son texte final, qui arrive pendant ce temps, est reçu.
    f.arreter();
    const b = f.ouvrir();
    await attendre();
    expect(b.ouverture.ouverte).toBe(true);
    expect(b.ouverture.raison).toBe(DICTATION_REPLACED);
    expect(b.ouverture.precedenteFermee).toBe(true);
    expect(b.jeton).toBeGreaterThan(a.jeton);

    // L'ORDRE, sur les appels réellement partis au pont : stop AVANT start.
    const cycle = pont.appels
      .filter((x) => x.nom === "asr_voicestudio_start" || x.nom === "asr_voicestudio_stop")
      .map((x) => x.nom.replace("asr_voicestudio_", ""));
    expect(cycle).toEqual(["start", "stop", "start"]);
    expect(pont.appels.find((x) => x.nom === "asr_voicestudio_stop").args.sessionId).toBe("s1");
    // Le pont n'a RIEN eu à refermer : aucune session vivante n'a été laissée.
    expect(pont.etat.refermeesParLePont).toBe(0);
    expect(pont.etat.interrompues).toBe(0);
    // Une seule session vivante à la fin, et le texte de la précédente n'a pas
    // été refusé (il a été prononcé : il appartient à la dictée).
    expect(pont.ouvertes().length).toBe(1);
    // La fin de la session REMPLACÉE est bien arrivée, et elle a bien été
    // REFUSÉE : c'est la garde d'identité (elle n'a pas remis l'écran au repos,
    // donc elle n'a pas armé de réarmement). Le texte, lui, n'est pas refusé.
    expect(f.etat.finsPerimees).toBe(1);
    expect(f.etat.actif).toBe(true);
    expect(f.etat.texteRefuse).toBe(0);
  });

  it("le texte déjà reconnu de la session close proprement n'est pas jeté", async () => {
    const pont = pontRealiste();
    const micro = fauxMicro();
    const f = fenetreDictee(pont, micro);

    f.ouvrir();
    await attendre();
    // Le texte reconnu jusqu'ici est dans la zone, et le service en garde la trace.
    pont.dicter("il était une fois");
    await attendre();

    // Les derniers mots ne sont QUE dans le texte final du service : le pont ne
    // les a pas encore rendus quand l'écran réarme.
    pont.sessions[0].texte = "il était une fois un petit robot";

    // Remplacement dans la fenêtre réelle : l'arrêt part, puis l'écran rouvre.
    f.arreter();
    f.ouvrir();
    await attendre();

    // Rien n'est jeté : le texte final est ARRIVÉ à l'écran, et il n'a pas été
    // refusé comme périmé (c'est ce que l'ordre « clore puis ouvrir » garantit).
    expect(f.etat.recus).toContain("il était une fois un petit robot");
    expect(f.etat.texteRefuse).toBe(0);
    expect(pont.etat.refermeesParLePont).toBe(0);
    expect(pont.sessions[0].texte).toBe("il était une fois un petit robot");
  });

  it("le pont n'a jamais à refermer une session que l'écran a déjà close", async () => {
    const pont = pontRealiste();
    const micro = fauxMicro();
    const f = fenetreDictee(pont, micro);

    // Quatre dictées d'affilée, chacune close puis remplacée par la suivante.
    for (let i = 1; i <= 4; i += 1) {
      f.ouvrir();
      await attendre();
      pont.dicter("phrase " + i);
      await attendre();
      f.arreter();
      f.ouvrir();
      await attendre();
    }
    await attendre();

    // Le compteur du journal du pont resterait à ZÉRO : plus aucune cascade.
    expect(pont.etat.refermeesParLePont).toBe(0);
    expect(pont.etat.interrompues).toBe(0);
    expect(pont.ouvertes().length).toBe(1);
    // Une fin périmée par remplacement, refusée : aucune n'a fermé l'écran.
    expect(f.etat.finsPerimees).toBe(4);
    expect(f.etat.actif).toBe(true);
    // Chaque phrase reconnue est arrivée à l'écran.
    for (let i = 1; i <= 4; i += 1) expect(f.etat.recus).toContain("phrase " + i);
  });
});

// ── 3. La cascade : une fin ÉTRANGÈRE ne ferme pas la session vivante ──────
describe("3. le canal du pont est global : une oreille n'écoute que SA session", () => {
  it("une oreille n'écoute que sa propre session (canal global du pont)", async () => {
    const pont = pontRealiste();
    const micro = fauxMicro();
    const f = fenetreDictee(pont, micro);
    f.ouvrir();
    await attendre();
    expect(pont.sessions[0].id).toBe("s1");
    pont.dicter("à moi");
    await attendre();
    f.etat.recus.length = 0;

    // La fin d'une AUTRE session (une oreille d'avant, une session remplacée)
    // ne ferme pas cette oreille-ci, et ne lui donne aucun texte.
    pont.emettre({ session_id: "s0", kind: "final", text: "un autre texte", final_kind: "summary" });
    pont.emettre({ session_id: "s0", kind: "ended" });
    await attendre();
    expect(f.etat.fins).toEqual([]);
    expect(f.etat.finsPerimees).toBe(0);
    expect(f.etat.recus).toEqual([]);
    expect(f.etat.actif).toBe(true);

    // Sa propre fin, elle, la ferme (comportement inchangé).
    pont.emettre({ session_id: "s1", kind: "ended" });
    await attendre();
    expect(f.etat.fins.length).toBe(1);
  });

  it("la cascade du diagnostic ne peut plus partir : ni réarmement, ni texte jeté", async () => {
    const pont = pontRealiste();
    const micro = fauxMicro();
    const f = fenetreDictee(pont, micro);
    f.ouvrir();
    await attendre();
    pont.dicter("la phrase que je dicte");
    await attendre();

    // LE DÉCLENCHEUR RÉEL : le pont émet la fin d'une session qui n'est pas la
    // nôtre (c'est ce qu'il faisait en refermant lui-même une session laissée
    // ouverte). Elle est ignorée : l'écran reste en écoute.
    pont.emettre({ session_id: "s0", kind: "ended" });
    await attendre();
    expect(f.etat.actif).toBe(true);
    expect(f.etat.fins).toEqual([]);

    // Un réarmement tenté à cet instant ne rouvre rien : une seule session vit.
    const rearmement = f.ouvrir();
    await attendre();
    expect(rearmement.ouverture.raison).toBe(DICTATION_ALREADY_OPEN);
    expect(f.registre.total()).toBe(1);
    expect(pont.sessions.length).toBe(1);
    expect(pont.etat.refermeesParLePont).toBe(0);

    // Le texte reconnu est intact : rien n'a été jeté ni écrasé.
    expect(f.etat.recus).toEqual(["la phrase que je dicte"]);
  });
});

// ── 4. La trace de la fin d'écoute ─────────────────────────────────────────
describe("4. chaque fin d'écoute laisse une trace exploitable", () => {
  it("le journal de la fin d'écoute dit la raison, la durée et la longueur du texte", () => {
    const ligne = dictationEndLogLine({
      raison: "texte-vide",
      jeton: 7,
      dureeMs: 1234.6,
      longueurTexte: 42,
    });
    expect(ligne).toContain("raison=texte-vide");
    expect(ligne).toContain("jeton=7");
    expect(ligne).toContain("duree_ms=1235");
    expect(ligne).toContain("texte_caracteres=42");
    expect(ligne).toContain("session=courante");
    // Une fin PÉRIMÉE est dite comme telle : c'est ce qui manquait au journal.
    expect(dictationEndLogLine({ raison: "fin-perimee", jeton: 3, perimee: true })).toContain(
      "session=perimee",
    );
    // Jamais de texte reconnu, jamais de valeur inventée : une ligne reste lisible.
    const vide = dictationEndLogLine(null);
    expect(vide).toContain("raison=inconnue");
    expect(vide).toContain("jeton=0");
    expect(vide).toContain("texte_caracteres=0");
    // Le canal est la commande EXISTANTE du pont, appelée d'un seul endroit.
    expect((SUPER.match(/void invoke\("asr_voicestudio_log"/g) || []).length).toBe(1);
  });
});

// ── 5. Le branchement dans la fenêtre (source) ─────────────────────────────
describe("5. l'écran applique cette garde, et n'ouvre qu'une oreille à la fois", () => {
  it("l'écran applique la garde dans les trois gestionnaires (source)", () => {
    const resultat = sliceSource(SUPER, "    rec.onresult = (e) => {", "    rec.onerror = (ev) => {", 100);
    const erreur = sliceSource(SUPER, "    rec.onerror = (ev) => {", "    rec.onend = () => {", 100);
    const fin = sliceSource(SUPER, "    rec.onend = () => {", "      const arretDemande = voiceStopVoulu;", 100);
    // Le TEXTE de la session remplacée est encore reçu ; l'ÉTAT, jamais.
    expect(resultat).toContain("if (!dicteeTexteAccepte()) return;");
    for (const bloc of [erreur, fin]) expect(bloc).toContain("if (!dicteeCourante())");
    // Dans la fin d'écoute, la garde passe AVANT tout effet : la session périmée
    // ne remet pas `voiceActive` au repos et ne compte pas dans le plafond.
    expect(fin.indexOf("if (!dicteeCourante())")).toBeLessThan(
      fin.indexOf("const wasActive = voiceActive;"),
    );
    // Dans l'erreur, la garde passe avant la remise au repos.
    expect(erreur.indexOf("if (!dicteeCourante())")).toBeLessThan(
      erreur.indexOf("voiceActive = false; voiceRec = null;"),
    );
    // Dans le résultat, aucun texte n'est écrit avant la garde.
    expect(resultat.indexOf("if (!dicteeTexteAccepte())")).toBeLessThan(
      resultat.indexOf("finalText = "),
    );
    // Un seul chemin d'ouverture : la session est décidée AVANT d'être fabriquée.
    const demarrage = sliceSource(SUPER, "    if (voiceActive) return true;", "    const debutSession = Date.now();", 100);
    expect(demarrage).toContain("startDictationSession(dicteeSessions, {");
    expect(demarrage).toContain("previous: voiceRec,");
    expect(demarrage).toContain("stopPrevious: (precedente) => fermerOreilleDictee(precedente),");
    expect(demarrage).toContain("const dicteeJeton = ouverture.jeton;");
    const fabrique = sliceSource(SUPER, "function startVoiceInput()", "\n  }\n", 40);
    expect(fabrique.indexOf("startDictationSession(")).toBeLessThan(
      fabrique.indexOf("= createDictationSession(SR)"),
    );
    // La fermeture passe par le chemin d'arrêt EXISTANT, jamais par un abandon.
    const fermeture = sliceSource(SUPER, "  function fermerOreilleDictee(rec) {", "\n  }\n", 40);
    expect(fermeture).toContain("stopVoiceInput();");
    expect(fermeture).toContain("rec.stop();");
    expect(fermeture).not.toContain("asr_voicestudio_cancel");
    // Une seule voie de démarrage, une seule oreille fabriquée (inchangé).
    expect((SUPER.match(/new SR\(\)/g) || []).length).toBe(1);
    expect((SUPER.match(/= createDictationSession\(SR\)/g) || []).length).toBe(1);
    expect((SUPER.match(/if \(!dicteeCourante\(\)\)/g) || []).length).toBe(2);
    expect((SUPER.match(/if \(!dicteeTexteAccepte\(\)\)/g) || []).length).toBe(1);
    // Le filtre de session du moteur est là, et il est le seul.
    expect(MOTEUR).toContain("if (origine && sessionId && origine !== sessionId) return;");
  });
});
