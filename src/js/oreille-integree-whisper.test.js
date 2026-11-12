// oreille-integree-whisper.test.js — VERROUS de l'OREILLE INTÉGRÉE
// (Whisper dans Pilot, `src-tauri/src/asr_whisper.rs`).
//
// L'ajout est ADDITIF et DÉSACTIVÉ par défaut. Ces verrous empêchent de le
// payer ailleurs, et ils échouent sur toute régression réelle :
//   1. le DÉFAUT ne change pas : clé absente, vide ou inconnue ⇒ le service de
//      voix local, exactement comme avant (mêmes phrases, même décision) ;
//   2. le moteur intégré est une AUTRE oreille, pas une autre dictée : il rend
//      un objet de la MÊME FORME qu'une session du navigateur, donc tout ce qui
//      décide (garde du nom, envoi sur silence, reprise en main, envoi
//      automatique) reste écrit une seule fois ;
//   3. UN SEUL micro : le nouveau moteur consomme le robinet du micro existant
//      (`setAudioTap`) et n'ouvre aucune capture ;
//   4. le repli est TOUJOURS dit, avec sa conséquence réelle (retour à un
//      service en ligne) — jamais un basculement silencieux ;
//   5. la fenêtre ne joint jamais un service : elle ne parle qu'aux commandes
//      Tauri, aucune adresse n'est écrite dans le module ;
//   6. rien n'est téléchargé sans un geste : l'état au repos ne prétend rien.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neutraliserSource, sliceSource } from "./source-slice.js";
import {
  DICTATION_ENGINE_BUILTIN,
  DICTATION_ENGINE_OPTIONS,
  DICTATION_ENGINE_SERVICE,
  LOCAL_DICTATION_ENGINE_KEY,
  dictationEngineLabel,
  dictationEngineRequested,
  integratedEarDownloadSentence,
  integratedEarFallbackSentence,
  normalizeDictationEngine,
  planLocalEar,
} from "./oreille-locale.js";
import {
  INTEGRATED_EAR_COMMANDS,
  INTEGRATED_EAR_EVENT,
  createIntegratedEar,
} from "./oreille-integree-moteur.js";
import { createLocalEar } from "./oreille-locale-moteur.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");

/** Lit un fichier du dépôt, fins de ligne normalisées (piège CI Windows). */
function lire(relatif) {
  return fs.readFileSync(path.join(RACINE, relatif), "utf8").replace(/\r\n/g, "\n");
}

const MOTEUR = lire("src/js/oreille-integree-moteur.js");
const SUPER = lire("src/js/super-agent.js");
const SETTINGS = lire("src/js/settings.js");
const RUST = lire("src-tauri/src/asr_whisper.rs");
const RUST_TELECHARGEMENT = lire("src-tauri/src/asr_whisper_download.rs");
const LIB = lire("src-tauri/src/lib.rs");

/** Un statut « disponible » du moteur intégré, de la forme rendue par le pont. */
const STATUT_PRET = Object.freeze({
  available: true,
  reason: "disponible",
  model_id: "ggml-large-v3-turbo-q8_0",
  model_label: "Whisper large-v3-turbo (q8_0)",
});

/** Un statut « disponible » du service de voix local (l'oreille d'avant). */
const STATUT_SERVICE_PRET = Object.freeze({
  available: true,
  reason: "disponible",
  model_id: "sherpa-parakeet-tdt-v3",
  model_label: "Parakeet TDT v3",
});

// ---------------------------------------------------------------------------
describe("1. Le DÉFAUT ne change pas : sans choix d'oreille, c'est le service", () => {
  it("toute valeur absente, vide ou inconnue retombe sur le service local", () => {
    for (const valeur of [undefined, null, "", "   ", 0, false, {}, [], "autre-chose", "cloud", "webkit"]) {
      expect(normalizeDictationEngine(valeur), `valeur ${String(valeur)}`).toBe(
        DICTATION_ENGINE_SERVICE,
      );
    }
    // La valeur écrite par l'écran pour le moteur intégré, elle, est reconnue —
    // y compris recopiée à la main (casse, accents, ponctuation tolérés).
    expect(normalizeDictationEngine(DICTATION_ENGINE_BUILTIN)).toBe(DICTATION_ENGINE_BUILTIN);
    expect(normalizeDictationEngine("  integre  ")).toBe(DICTATION_ENGINE_BUILTIN);
    expect(normalizeDictationEngine("INTÉGRÉ")).toBe(DICTATION_ENGINE_BUILTIN);
  });

  it("la configuration d'avant (clé absente) demande le service local", () => {
    expect(dictationEngineRequested({})).toBe(DICTATION_ENGINE_SERVICE);
    expect(dictationEngineRequested(null)).toBe(DICTATION_ENGINE_SERVICE);
    expect(dictationEngineRequested({ local_dictation: true })).toBe(DICTATION_ENGINE_SERVICE);
    // La clé existe sous son nom exact, une seule fois, dans le module partagé.
    expect(LOCAL_DICTATION_ENGINE_KEY).toBe("local_dictation_engine");
    expect(dictationEngineRequested({ [LOCAL_DICTATION_ENGINE_KEY]: "integre" })).toBe(
      DICTATION_ENGINE_BUILTIN,
    );
  });

  it("la décision du service est IDENTIQUE à celle d'avant (mêmes phrases)", () => {
    const plan = planLocalEar({ requested: true, status: STATUT_SERVICE_PRET });
    expect(plan.use).toBe(true);
    expect(plan.engine).toBe(DICTATION_ENGINE_SERVICE);
    expect(plan.modelLabel).toBe("Parakeet TDT v3");
    expect(plan.sentence).toContain("Dans l'écran Vocal");
    expect(plan.sentence).toContain("aucun son ne part vers Internet");
    expect(plan.fallback).toBe("");
    // Et sans la clé d'oreille du tout — le cas d'une configuration d'avant.
    const avant = planLocalEar({ requested: true, status: STATUT_SERVICE_PRET });
    expect(avant).toEqual(plan);
  });

  it("le repli du service est inchangé quand il ne peut pas servir", () => {
    const plan = planLocalEar({ requested: true, status: { available: false, reason: "service-absent" } });
    expect(plan.use).toBe(false);
    expect(plan.engine).toBe(DICTATION_ENGINE_SERVICE);
    expect(plan.fallback).toContain("Le service de voix local est absent");
    expect(plan.fallback).toContain("service en ligne");
  });

  it("case décochée ⇒ aucune oreille, aucun texte (comportement historique)", () => {
    for (const engine of [DICTATION_ENGINE_SERVICE, DICTATION_ENGINE_BUILTIN, "inconnue"]) {
      const plan = planLocalEar({ requested: false, status: STATUT_PRET, engine });
      expect(plan.use).toBe(false);
      expect(plan.reason).toBe("desactivee");
      expect(plan.sentence).toBe("");
      expect(plan.fallback).toBe("");
    }
  });

  it("les deux libellés du choix viennent de la source unique, jamais recopiés", () => {
    expect(DICTATION_ENGINE_OPTIONS.map((o) => o.value)).toEqual([
      DICTATION_ENGINE_SERVICE,
      DICTATION_ENGINE_BUILTIN,
    ]);
    expect(dictationEngineLabel(DICTATION_ENGINE_SERVICE)).toBe("Service de voix local (actuel)");
    expect(dictationEngineLabel(DICTATION_ENGINE_BUILTIN)).toBe("Moteur intégré (dans Pilot)");
    // Aucun libellé n'est écrit dans le HTML : ils sont posés par le module.
    const html = lire("index.html");
    expect(html).not.toContain("Service de voix local (actuel)");
    expect(html).not.toContain("Moteur intégré (dans Pilot)");
    expect(html).toContain('id="setting-local-dictation-engine"');
  });
});

// ---------------------------------------------------------------------------
describe("2. Le moteur intégré décide comme l'autre, et le repli est toujours dit", () => {
  it("disponible ⇒ il sert, et le modèle annoncé vient du pont", () => {
    const plan = planLocalEar({
      requested: true,
      status: STATUT_PRET,
      engine: DICTATION_ENGINE_BUILTIN,
    });
    expect(plan.use).toBe(true);
    expect(plan.engine).toBe(DICTATION_ENGINE_BUILTIN);
    expect(plan.reason).toBe("disponible");
    expect(plan.modelLabel).toBe("Whisper large-v3-turbo (q8_0)");
    expect(plan.sentence).toContain("moteur intégré");
    expect(plan.sentence).toContain("aucun son ne part vers Internet");
    expect(plan.fallback).toBe("");
  });

  it("une réponse `available: true` sans raison lisible suffit à servir", () => {
    const plan = planLocalEar({
      requested: true,
      status: { available: true },
      engine: DICTATION_ENGINE_BUILTIN,
    });
    expect(plan.use).toBe(true);
    expect(plan.reason).toBe("disponible");
  });

  it("CHAQUE panne a sa phrase, et la conséquence RÉELLE est toujours dite", () => {
    const raisons = [
      "disponible-mais-indisponible",
      "moteur-non-compile",
      "modele-absent",
      "modele-illisible",
      "moteur-occupe",
    ];
    for (const reason of raisons) {
      const phrase = integratedEarFallbackSentence(reason);
      expect(phrase.length, reason).toBeGreaterThan(30);
      // Le nom du coupable et la conséquence : jamais un code brut, jamais un
      // basculement silencieux vers un service en ligne.
      expect(phrase, reason).toMatch(/moteur/i);
      expect(phrase, reason).toContain("service en ligne");
    }
    // Chaque raison connue dit sa cause propre (pas une phrase générique).
    expect(integratedEarFallbackSentence("moteur-non-compile")).toContain("n'est pas compilé");
    expect(integratedEarFallbackSentence("modele-absent")).toContain("n'est pas installé");
    expect(integratedEarFallbackSentence("modele-illisible")).toContain("incomplet");
    expect(integratedEarFallbackSentence("moteur-occupe")).toContain("déjà");
  });

  it("un statut illisible ne fait JAMAIS croire que le moteur est prêt", () => {
    for (const status of [null, undefined, "oui", 3, {}, { available: "true" }]) {
      const plan = planLocalEar({
        requested: true,
        status,
        engine: DICTATION_ENGINE_BUILTIN,
      });
      expect(plan.use, `statut ${JSON.stringify(status)}`).toBe(false);
      expect(plan.fallback).toContain("service en ligne");
    }
  });

  it("le moteur intégré ne parle jamais du service de voix local comme du sien", () => {
    const plan = planLocalEar({
      requested: true,
      status: { available: false, reason: "modele-absent" },
      engine: DICTATION_ENGINE_BUILTIN,
    });
    expect(plan.fallback).toContain("moteur intégré");
    expect(plan.fallback).not.toContain("Le service de voix local");
  });
});

// ---------------------------------------------------------------------------
describe("3. Un SEUL contrat de session : la dictée ne connaît pas son oreille", () => {
  it("le moteur intégré rend la MÊME forme qu'une session du navigateur", () => {
    const rec = createIntegratedEar({ invoke: async () => null, listen: async () => () => {}, mic: null });
    const reference = createLocalEar({ invoke: async () => null, listen: async () => () => {}, mic: null });
    // Les membres que la dictée existante utilise : identiques, présents, du bon type.
    for (const cle of ["lang", "interimResults", "continuous"]) {
      expect(typeof rec[cle], cle).toBe(typeof reference[cle]);
    }
    for (const cle of ["start", "stop"]) {
      expect(typeof rec[cle], cle).toBe("function");
      expect(typeof reference[cle], cle).toBe("function");
    }
    // `onresult` / `onerror` / `onend` sont des propriétés assignables.
    for (const cle of ["onresult", "onerror", "onend"]) {
      expect(cle in rec, cle).toBe(true);
    }
    // La marque dit QUELLE oreille écoute (le service n'est pas le moteur).
    expect(rec.integratedEar).toBe(true);
    expect(reference.integratedEar).toBeUndefined();
  });

  it("la dictée fabrique l'oreille à UN SEUL endroit, sans recopier de règle", () => {
    const fabrique = sliceSource(SUPER, "function createDictationSession(SR) {", "\n  // ── UNE SEULE OREILLE À LA FOIS", 400);
    expect(fabrique).toContain("localEarPlan.use === true");
    expect(fabrique).toContain("createIntegratedEar({");
    expect(fabrique).toContain("createLocalEar({");
    // Le choix est fait sur le plan (une seule décision), jamais sur un statut
    // relu ici : aucune seconde règle de disponibilité dans la dictée.
    expect(fabrique).toContain("localEarPlan.engine === DICTATION_ENGINE_BUILTIN");
    expect(fabrique).not.toContain("available ===");
    expect(fabrique).not.toContain("reason ===");
    // Le repli reste dit par la voie existante.
    expect(fabrique).toContain("annoncerRepliLocal(");
  });

  it("le moteur intégré n'ouvre AUCUNE capture : il prend le robinet du micro", () => {
    expect(MOTEUR).toContain("setAudioTap");
    const code = neutraliserSource(MOTEUR);
    expect(code).not.toContain("getUserMedia");
    expect(code).not.toContain("AudioContext");
    expect(code).not.toContain("navigator.mediaDevices");
  });
});

// ---------------------------------------------------------------------------
describe("4. Le moteur intégré ne parle qu'aux commandes Tauri, sans adresse", () => {
  it("les quatre commandes sont nommées UNE fois et portent le préfixe du pont", () => {
    expect(INTEGRATED_EAR_COMMANDS).toEqual({
      start: "asr_whisper_start",
      send: "asr_whisper_send",
      stop: "asr_whisper_stop",
      cancel: "asr_whisper_cancel",
    });
    expect(INTEGRATED_EAR_EVENT).toBe("asr-whisper-transcript");
    // Aucune commande du service de voix local n'est employée par ce module.
    const code = neutraliserSource(MOTEUR);
    expect(code).not.toContain("asr_voicestudio");
    expect(code).not.toContain("tts_voicestudio");
  });

  it("aucune adresse, aucun `fetch`, aucun service joint directement", () => {
    const code = neutraliserSource(MOTEUR);
    for (const interdit of ["http://", "https://", "127.0.0.1", "localhost", "fetch(", "WebSocket"]) {
      expect(code, `le module code « ${interdit} »`).not.toContain(interdit);
    }
  });

  it("le pont Rust n'ouvre aucun port, ne lance aucun programme", () => {
    const code = neutraliserSource(RUST);
    for (const interdit of ["reqwest", "TcpListener", "TcpStream", "Command::new", "http://"]) {
      expect(code, `le module Rust code « ${interdit} »`).not.toContain(interdit);
    }
    // Le moteur est optionnel : sans la feature, le module dit pourquoi il ne
    // peut pas servir au lieu d'échouer à la compilation.
    expect(RUST).toContain('cfg!(feature = "whisper")');
    expect(RUST).toContain("moteur-non-compile");
  });

  it("les six commandes du moteur sont branchées dans lib.rs", () => {
    const handler = sliceSource(LIB, "tauri::generate_handler![", "]", 10_000);
    for (const nom of [
      "asr_whisper_status",
      "asr_whisper_start",
      "asr_whisper_send",
      "asr_whisper_stop",
      "asr_whisper_cancel",
      "asr_whisper_log",
    ]) {
      expect(handler, `commande ${nom} non branchée`).toContain(`asr_whisper::${nom}`);
    }
  });
});

// ---------------------------------------------------------------------------
describe("5. Le modèle s'installe sur un GESTE, jamais tout seul", () => {
  it("au repos, l'état ne prétend rien (aucun téléchargement fantôme)", () => {
    expect(integratedEarDownloadSentence(null)).toBe("");
    expect(integratedEarDownloadSentence(undefined)).toBe("");
    expect(integratedEarDownloadSentence({ running: false })).toBe("");
  });

  it("chaque étape du téléchargement a une phrase, et l'arrêt ne supprime rien", () => {
    const enCours = integratedEarDownloadSentence({
      running: true,
      percent: 41.6,
      bytes: 400_000_000,
      bytes_total: 833_000_000,
    });
    expect(enCours).toContain("42 %");
    expect(enCours).toContain("rien n'est supprimé");

    const annule = integratedEarDownloadSentence({ running: false, outcome: "cancelled" });
    expect(annule).toContain("reprendre");
    expect(annule).toContain("reste en place");

    expect(integratedEarDownloadSentence({ outcome: "ok" })).toContain("installé");
    expect(integratedEarDownloadSentence({ outcome: "error" })).toContain("échoué");
  });

  it("le pont de téléchargement reprend là où il s'est arrêté, sans rien effacer", () => {
    // `.part` puis reprise par `Range`, renommage à taille exacte, aucun `remove`.
    expect(RUST_TELECHARGEMENT).toContain('PART_SUFFIX');
    expect(RUST_TELECHARGEMENT).toContain("bytes=");
    expect(RUST_TELECHARGEMENT).toContain("PARTIAL_CONTENT");
    expect(RUST_TELECHARGEMENT).toContain("file_complete");
    const code = neutraliserSource(RUST_TELECHARGEMENT);
    expect(code).not.toContain("remove_file");
    expect(code).not.toContain("remove_dir");
    // Un seul transfert à la fois.
    expect(RUST_TELECHARGEMENT).toContain("DOWNLOADING");
    // Aucune demande automatique : les trois commandes existent, l'écran les
    // appelle sur un clic.
    expect(RUST_TELECHARGEMENT).toContain("pub async fn asr_whisper_download(");
    expect(RUST_TELECHARGEMENT).toContain("pub async fn asr_whisper_cancel_download(");
    expect(RUST_TELECHARGEMENT).toContain("pub async fn asr_whisper_download_state(");
  });

  it("l'écran n'installe que sur un clic, et l'état relu ne lance rien", () => {
    const relu = sliceSource(SETTINGS, "async function refreshIntegratedDownloadState()", "\n  }", 200);
    expect(relu).toContain('invoke("asr_whisper_download_state")');
    expect(relu).not.toContain('invoke("asr_whisper_download"');

    const clic = sliceSource(SETTINGS, "btnLocalDictationInstall.addEventListener", "});", 100);
    expect(clic).toContain('invoke("asr_whisper_download")');
  });
});

// ---------------------------------------------------------------------------
describe("6. Branchements : une clé additive, un contrôle, un écrivain", () => {
  it("la clé est ADDITIVE côté Rust : `#[serde(default)]`, défaut = service", () => {
    // Le champ, sa décoration et le défaut nommé — découpés par la garde
    // (`sliceSource`), donc faux bruyamment si une ancre bouge.
    const champ = sliceSource(LIB, "#[serde(default)]\n    local_dictation_engine: String,", "\n", 50);
    expect(champ).toContain("local_dictation_engine: String,");
    // Le défaut nommé rend le service de voix local : comportement d'avant.
    const defaut = sliceSource(LIB, "fn default_local_dictation_engine()", "\n", 40);
    expect(defaut).toContain('"voicestudio"');
    // Le défaut de la structure initialise le champ par cette fonction.
    const init = sliceSource(LIB, "local_dictation_engine: default_local_dictation_engine(),", "\n", 50);
    expect(init).toBeTruthy();
    // La case existante n'a pas été détournée : elle est toujours un booléen.
    const champCase = sliceSource(LIB, "local_dictation: false,", "\n", 10);
    expect(champCase).toContain("local_dictation: false,");
  });

  it("les Paramètres enregistrent la valeur par la source unique", () => {
    const sauvegarde = sliceSource(SETTINGS, "local_dictation_engine: normalizeDictationEngine(", "),", 60);
    expect(sauvegarde).toContain("selectLocalDictationEngine");
    // Les options sont posées depuis le module (aucun libellé recopié).
    const remplissage = sliceSource(SETTINGS, "function refreshLocalDictationEngine(", "\n  }", 200);
    expect(remplissage).toContain("DICTATION_ENGINE_OPTIONS");
    expect(remplissage).toContain("normalizeDictationEngine(");
  });

  it("la sonde choisit sa commande selon l'oreille, une seule décision ensuite", () => {
    const sonde = sliceSource(SETTINGS, "async function refreshLocalDictationStatus()", "\n  }", 200);
    expect(sonde).toContain('"asr_whisper_status"');
    expect(sonde).toContain('"asr_voicestudio_status"');
    // Aucune phrase composée ici : la décision est celle du module partagé.
    expect(sonde).toContain("refreshLocalDictationState(");
    const decision = sliceSource(SETTINGS, "function refreshLocalDictationState(", "\n  }", 200);
    expect(decision).toContain("planLocalEar(");
    expect(decision).toContain("engine:");
  });

  it("l'écran Vocal garde UNE seule décision et UNE seule sonde", () => {
    // Chaque calcul du plan passe par la MÊME fonction, et chaque calcul qui
    // peut ouvrir une oreille nomme l'oreille réglée : aucune seconde règle de
    // disponibilité n'existe dans le mode Vocal.
    const appels = SUPER.split("planLocalEar(").length - 1;
    expect(appels).toBeGreaterThanOrEqual(2);
    const avecOreille = SUPER.split("engine: localDictationEngine").length - 1;
    expect(avecOreille).toBe(2); // la sonde + la panne en cours d'écoute
    // Les deux ponts sont interrogés au même endroit (une seule sonde).
    const sonde = sliceSource(SUPER, "async function refreshLocalDictation()", "\n  }", 400);
    expect(sonde).toContain('"asr_whisper_status"');
    expect(sonde).toContain('"asr_voicestudio_status"');
    expect(sonde).toContain("dictationEngineRequested(cfg)");
    expect(sonde).toContain("engine: localDictationEngine");
  });

  it("la phrase qui nomme l'oreille réglée n'existe qu'une fois", () => {
    const phrase = sliceSource(SUPER, "function oreilleLocalePhrase()", "\n  }", 100);
    expect(phrase).toContain("DICTATION_ENGINE_BUILTIN");
    expect(phrase).toContain("Le moteur intégré de dictée");
    expect(phrase).toContain("Le service de voix local");
    const occurrences = SUPER.split("function oreilleLocalePhrase()").length - 1;
    expect(occurrences).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("7. Le moteur intégré rend le texte et DIT ses pannes", () => {
  /** Fabrique un faux pont Tauri qui enregistre les appels. */
  function fauxPont(session = { session_id: "s1", sample_rate: 16000, model_id: "m", model_label: "M" }) {
    const appels = [];
    let ecouteur = null;
    const invoke = async (commande, args) => {
      appels.push({ commande, args });
      if (commande === INTEGRATED_EAR_COMMANDS.start) return session;
      return null;
    };
    const listen = async (nom, rappel) => {
      appels.push({ commande: `listen:${nom}` });
      ecouteur = rappel;
      return () => {
        ecouteur = null;
      };
    };
    return {
      invoke,
      listen,
      appels,
      evenement: (payload) => ecouteur && ecouteur({ payload }),
      get ecoute() {
        return ecouteur !== null;
      },
    };
  }

  function fauxMicro() {
    const micro = { robinet: null, ouvertures: 0 };
    micro.setAudioTap = (rappel) => {
      micro.ouvertures += 1;
      micro.robinet = rappel;
      return true;
    };
    return micro;
  }

  it("`start` ouvre la session, branche le robinet et écoute l'évènement du pont", async () => {
    const pont = fauxPont();
    const micro = fauxMicro();
    const rec = createIntegratedEar({ ...pont, mic: micro });
    await rec.start();
    const commandes = pont.appels.map((a) => a.commande);
    expect(commandes).toContain(INTEGRATED_EAR_COMMANDS.start);
    expect(commandes).toContain(`listen:${INTEGRATED_EAR_EVENT}`);
    expect(micro.ouvertures).toBe(1);
    expect(typeof micro.robinet).toBe("function");
  });

  it("le texte du pont arrive dans la forme attendue par la dictée existante", async () => {
    const pont = fauxPont();
    const micro = fauxMicro();
    const rec = createIntegratedEar({ ...pont, mic: micro });
    const recus = [];
    rec.onresult = (e) => recus.push(e);
    await rec.start();
    pont.evenement({ session_id: "s1", kind: "partial", text: "bonjour" });
    pont.evenement({ session_id: "s1", kind: "final", text: "bonjour Nova" });
    expect(recus.length).toBe(2);
    const dernier = recus[recus.length - 1];
    expect(dernier.results[0].isFinal).toBe(true);
    expect(dernier.results[0][0].transcript).toContain("bonjour Nova");
    // Un évènement d'une AUTRE session ne touche pas cet écran.
    pont.evenement({ session_id: "autre", kind: "final", text: "intrus" });
    expect(recus[recus.length - 1].results[0][0].transcript).not.toContain("intrus");
  });

  it("une panne du pont est DITE, la session est abandonnée, le robinet refermé", async () => {
    const pont = fauxPont();
    const micro = fauxMicro();
    const rec = createIntegratedEar({ ...pont, mic: micro });
    const erreurs = [];
    let fins = 0;
    rec.onerror = (e) => erreurs.push(e);
    rec.onend = () => {
      fins += 1;
    };
    await rec.start();
    pont.evenement({ session_id: "s1", kind: "error", message: "Le modèle de dictée est absent." });
    expect(erreurs.length).toBe(1);
    expect(erreurs[0].local).toBe(true);
    expect(erreurs[0].message).toContain("modèle");
    expect(fins).toBe(1);
    expect(micro.robinet).toBeNull();
    expect(pont.appels.map((a) => a.commande)).toContain(INTEGRATED_EAR_COMMANDS.cancel);
  });

  it("`stop` envoie le reste du son AVANT de fermer la session", async () => {
    const pont = fauxPont();
    const micro = fauxMicro();
    const rec = createIntegratedEar({ ...pont, mic: micro });
    await rec.start();
    // 30 ms de son à 16 kHz : assez pour un morceau, pas assez pour deux.
    micro.robinet(new Float32Array(480).fill(0.2), 16000);
    await rec.stop();
    const commandes = pont.appels.map((a) => a.commande);
    const envois = commandes.filter((c) => c === INTEGRATED_EAR_COMMANDS.send);
    expect(envois.length).toBeGreaterThanOrEqual(1);
    // Le dernier morceau part avant l'arrêt : aucun mot perdu à la fermeture.
    expect(commandes.lastIndexOf(INTEGRATED_EAR_COMMANDS.send)).toBeLessThan(
      commandes.indexOf(INTEGRATED_EAR_COMMANDS.stop),
    );
  });

  it("sans micro, la panne est dite et rien n'est ouvert auprès du moteur", async () => {
    const pont = fauxPont();
    const rec = createIntegratedEar({ ...pont, mic: null });
    const erreurs = [];
    rec.onerror = (e) => erreurs.push(e);
    await rec.start();
    expect(erreurs.length).toBe(1);
    expect(erreurs[0].local).toBe(true);
    expect(pont.appels.map((a) => a.commande)).not.toContain(INTEGRATED_EAR_COMMANDS.start);
  });

  it("un robinet refusé est une panne dite, jamais une dictée muette", async () => {
    const pont = fauxPont();
    const micro = { setAudioTap: () => false };
    const rec = createIntegratedEar({ ...pont, mic: micro });
    const erreurs = [];
    rec.onerror = (e) => erreurs.push(e);
    await rec.start();
    expect(erreurs.length).toBe(1);
    expect(erreurs[0].message).toContain("son du micro");
  });
});
