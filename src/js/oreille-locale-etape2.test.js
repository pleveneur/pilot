// oreille-locale-etape2.test.js — VERROUS de l'oreille LOCALE, ÉTAPE 2 : l'écran
// est BRANCHÉ. La dictée du mode Vocal peut être transcrite sur cet ordinateur
// par le service de voix local, au lieu du moteur du navigateur (qui envoie la
// voix à un service en ligne).
//
// CE QUE CE FICHIER EMPÊCHE DE RÉGRESSER (c'est la mission, dans l'ordre) :
//   1. UN SEUL RÉGLAGE, UNE SEULE CLÉ (`local_dictation`). Une case à cocher,
//      un champ de configuration, aucune seconde source de vérité, et le
//      comportement historique intact quand elle est décochée.
//   2. LE MICRO NE BOUGE PAS : une seule capture dans tout le projet
//      (`vocal-mic.js`). L'oreille locale CONSOMME le son déjà capté ; elle
//      n'ouvre ni second flux, ni second `getUserMedia`.
//   3. LE MODÈLE EST CHOISI PAR LE PONT, jamais par l'écran, et il est AFFICHÉ
//      en une phrase simple (note de la case à cocher + infobulle du bouton
//      🎙️). Un meilleur modèle installé plus tard change la phrase, pas le code.
//   4. LE REPLI EST VISIBLE, JAMAIS SILENCIEUX : service absent, muet, sans
//      modèle français, dictée non prête, panne en cours d'écoute — chaque cas
//      a SA phrase, et cette phrase dit TOUJOURS que la voix repart vers un
//      SERVICE EN LIGNE. Basculer en silence est le défaut interdit, et les
//      verrous qui suivent échouent si le repli redevient muet.
//   5. LA LIGNE D'ÉTAT DIT LA VÉRITÉ, en français, sans jargon, et AUCUN nouvel
//      élément d'interface n'est créé (la ligne existe déjà).
//   6. AUCUN SECOND CHEMIN DE DICTÉE : le moteur local a la FORME d'une session
//      de reconnaissance du navigateur, donc la garde du nom, l'envoi sur
//      silence, la reprise en main et l'envoi automatique restent écrits UNE
//      fois (`super-agent.js`), et la garde du nom s'applique au texte local
//      comme au texte du navigateur.
//   7. LA PORTE DE L'ÉTAPE 1 RESTE LA SEULE : la fenêtre ne joint jamais le
//      service (aucune adresse, aucun `fetch`), et le module de l'étape 1 n'est
//      pas modifié.
//
// Les commentaires de ce fichier restent en ASCII quand ils citent du code ;
// les phrases vérifiées sont copiées telles quelles depuis les modules.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  LOCAL_DICTATION_KEY,
  LOCAL_EAR_CHUNK_BYTES,
  bestUnavailableModel,
  downsamplePcm,
  localDictationRequested,
  localEarFailureMessage,
  localEarFallbackSentence,
  localEarModelSentence,
  localEarReason,
  localEarStatusLine,
  localEarText,
  pcm16Bytes,
  planLocalEar,
  splitPcmChunks,
} from "./oreille-locale.js";
import { LOCAL_EAR_EVENT, createLocalEar, localEarResultEvent } from "./oreille-locale-moteur.js";
import { neutraliserSource, sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const SUPER = lire("src/js/super-agent.js");
const MOTEUR = lire("src/js/oreille-locale-moteur.js");
const DECISIONS = lire("src/js/oreille-locale.js");
const MIC = lire("src/js/vocal-mic.js");
const REGLAGES = lire("src/js/settings.js");
const HTML = lire("index.html");
const LIB = lire("src-tauri/src/lib.rs");
const PONT = lire("src-tauri/src/asr_voicestudio.rs");

/** Corps d'une fonction du module (jusqu'a la premiere accolade en colonne 3). */
function corpsFonction(src, entete) {
  const i = src.indexOf(entete);
  expect(i, `fonction absente : ${entete}`).toBeGreaterThan(-1);
  const fin = src.indexOf("\n  }\n", i);
  expect(fin, `fin de fonction introuvable : ${entete}`).toBeGreaterThan(i);
  return src.slice(i, fin + 4);
}

/** Réponse du pont pour un service disponible avec un modèle installé. */
const STATUT_PRET = {
  available: true,
  reason: "disponible",
  model_id: "sherpa-parakeet-tdt-v3",
  model_label: "Parakeet TDT v3 (français)",
  models: [
    {
      id: "sherpa-parakeet-tdt-v3",
      label: "Parakeet TDT v3 (français)",
      installed: true,
      recommended: true,
    },
    {
      id: "sherpa-whisper-small",
      label: "Whisper Small (français)",
      installed: false,
      recommended: true,
    },
  ],
};

// ---------------------------------------------------------------------------
describe("1. Un seul réglage, une seule clé, comportement historique intact", () => {
  it("la clé est unique et se lit par UNE fonction", () => {
    expect(LOCAL_DICTATION_KEY).toBe("local_dictation");
    expect(localDictationRequested(null)).toBe(false);
    expect(localDictationRequested({})).toBe(false);
    expect(localDictationRequested({ [LOCAL_DICTATION_KEY]: false })).toBe(false);
    expect(localDictationRequested({ [LOCAL_DICTATION_KEY]: true })).toBe(true);
    // Toute autre valeur qu'un `true` explicite garde le comportement d'avant.
    for (const valeur of ["true", 1, "oui", {}, []]) {
      expect(localDictationRequested({ [LOCAL_DICTATION_KEY]: valeur })).toBe(false);
    }
  });

  it("décochée : AUCUNE décision ne change (pas de phrase, pas de repli)", () => {
    const plan = planLocalEar({ requested: false, status: STATUT_PRET });
    expect(plan.use).toBe(false);
    expect(plan.reason).toBe("desactivee");
    expect(plan.sentence).toBe("");
    expect(plan.fallback).toBe("");
    // Et la ligne d'état du mode Vocal ne dit rien de plus qu'avant.
    expect(localEarStatusLine({ plan, nom: "Aurelia" })).toBe("");
  });

  it("la case existe UNE fois dans les Paramètres, à côté du réglage de la voix", () => {
    expect((HTML.match(/id="setting-local-dictation"/g) || []).length).toBe(1);
    const bloc = sliceSource(HTML, '<label for="setting-local-dictation"', "</label>", 40);
    expect(bloc).toContain('type="checkbox"');
    expect(bloc).toContain("Transcrire avec le service de voix local");
    // La note et la ligne d'état sont DÉCLARÉES (accessibles), pas inventées.
    expect(HTML).toContain('id="local-dictation-note"');
    expect(HTML).toContain('id="local-dictation-state"');
    expect(HTML).toContain('aria-describedby="local-dictation-note local-dictation-state"');
  });

  it("les Paramètres enregistrent et relisent CETTE clé, nulle part ailleurs", () => {
    // Un seul site d'écriture, et c'est la clé du module (jamais une chaîne
    // recopiée qui pourrait diverger).
    expect((REGLAGES.match(/local_dictation:/g) || []).length).toBe(1);
    expect(REGLAGES).toContain("local_dictation: chkLocalDictation ? chkLocalDictation.checked === true : false,");
    expect(REGLAGES).toContain("chkLocalDictation.checked = localDictationRequested(currentConfig)");
    // Le texte affiché vient du module partagé : aucun second libellé ici.
    expect(REGLAGES).toContain("localDictationStateEl.textContent = plan.use === true ? plan.sentence : plan.fallback;");
  });

  it("côté machine, la clé est ADDITIVE et vaut faux par défaut", () => {
    // Le champ est ADDITIF : absent d'un fichier ancien, il vaut faux.
    const ancre = "    local_dictation: bool,";
    const i = LIB.indexOf(ancre);
    expect(i, "champ local_dictation absent de AppConfig").toBeGreaterThan(-1);
    expect(LIB.slice(Math.max(0, i - 20), i)).toContain("#[serde(default)]");
    expect(LIB).toContain("local_dictation: false,");
    // Deux occurrences en tout : la declaration et le defaut. Aucune autre cle.
    expect((LIB.match(/local_dictation/g) || []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe("2. Le micro ne bouge pas : une seule capture, un seul robinet", () => {
  it("aucune seconde capture : un seul appel de capture dans tout le projet", () => {
    expect((MIC.match(/md\.getUserMedia\(/g) || []).length).toBe(1);
    // L'oreille locale ne capture RIEN : elle ne connaît ni le micro ni l'audio.
    const moteurNu = neutraliserSource(MOTEUR);
    for (const interdit of ["getUserMedia", "AudioContext", "createScriptProcessor", "createAnalyser"]) {
      expect(moteurNu, `le moteur ne doit pas capturer (${interdit})`).not.toContain(interdit);
    }
  });

  it("le robinet existe et rend les échantillons du flux DÉJÀ capté", () => {
    expect(MIC).toContain("function setAudioTap(fn)");
    expect(MIC).toContain("setAudioTap,");
    // Branché sur la MÊME source que la mesure du niveau : jamais un second flux.
    const branche = corpsFonction(MIC, "  function brancherRobinet() {");
    expect(branche).toContain("sourceFlux.connect(noeudRobinet)");
    // Muet : le robinet écoute, il ne fait rien sortir des haut-parleurs.
    expect(branche).toContain("muetRobinet.gain.value = 0");
  });

  it("la fenêtre ne joint JAMAIS le service : une seule porte, celle de l'étape 1", () => {
    const moteurNu = neutraliserSource(MOTEUR);
    for (const interdit of ["fetch(", "XMLHttpRequest", "127.0.0.1", "localhost", "/v1/audio"]) {
      expect(moteurNu, `le moteur ne doit pas joindre le service (${interdit})`).not.toContain(interdit);
    }
    // Il ne parle qu'aux commandes de l'étape 1 et à l'évènement de l'étape 1.
    for (const commande of [
      "asr_voicestudio_start",
      "asr_voicestudio_send",
      "asr_voicestudio_stop",
      "asr_voicestudio_cancel",
    ]) {
      expect(MOTEUR).toContain(`"${commande}"`);
    }
    expect(LOCAL_EAR_EVENT).toBe("asr-voicestudio-transcript");
    expect(PONT).toContain('pub const EVENT_TRANSCRIPT: &str = "asr-voicestudio-transcript"');
  });

  it("le son part au bon format : 16 kHz, PCM 16 bits, morceaux de 100 ms", () => {
    const douze = new Float32Array(4800).fill(0.5);
    const reduits = downsamplePcm(douze, 48000, 16000);
    expect(reduits.length).toBe(1600);
    const octets = pcm16Bytes(reduits);
    expect(octets.length).toBe(3200);
    // Petit-boutiste signé : 0.5 -> 0x4000 -> octets 00 40.
    expect([octets[0], octets[1]]).toEqual([0x00, 0x40]);
    const { morceaux, reste } = splitPcmChunks(octets, LOCAL_EAR_CHUNK_BYTES);
    expect(morceaux.length).toBe(1);
    expect(reste.length).toBe(0);
    // Un morceau incomplet n'est jamais envoyé : il reste pour la suite.
    const coupe = splitPcmChunks(octets.subarray(0, 1000), LOCAL_EAR_CHUNK_BYTES);
    expect(coupe.morceaux).toEqual([]);
    expect(coupe.reste.length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
describe("3. Le modèle est choisi par le pont et AFFICHÉ en une phrase", () => {
  it("le plan lit le modèle dans la réponse du service, il ne le choisit pas", () => {
    const plan = planLocalEar({ requested: true, status: STATUT_PRET });
    expect(plan.use).toBe(true);
    expect(plan.modelId).toBe("sherpa-parakeet-tdt-v3");
    expect(plan.modelLabel).toBe("Parakeet TDT v3 (français)");
    // La phrase est celle du module : le libellé RÉEL, en clair.
    expect(plan.sentence).toContain("Parakeet TDT v3 (français)");
    expect(plan.sentence).toContain("aucun son ne part vers Internet");
  });

  it("un meilleur modèle non installé est proposé, jamais installé", () => {
    const meilleur = bestUnavailableModel(STATUT_PRET);
    expect(meilleur && meilleur.id).toBe("sherpa-whisper-small");
    const phrase = localEarModelSentence(STATUT_PRET);
    expect(phrase).toContain("Whisper Small (français)");
    // Pilot ne télécharge rien et n'accepte aucune licence : c'est dit.
    expect(phrase).toContain("Pilot ne télécharge rien");
    expect(phrase).toContain("n'accepte aucune licence");
    // Aucun code n'écrit un identifiant de modèle : la phrase suit le service.
    const decisionsNu = neutraliserSource(DECISIONS);
    expect(decisionsNu).not.toContain("sherpa-");
  });

  it("le modèle employé est aussi dit sur l'écran Vocal (bouton 🎙️)", () => {
    const titre = corpsFonction(SUPER, "  function micTitleIdle() {");
    expect(titre).toContain("localEarPlan.modelLabel");
    expect(titre).toContain("localEarModele");
    expect(titre).toContain("transcription sur cet ordinateur avec « ${modele} »");
    // Et le modèle RÉELLEMENT ouvert est relevé à l'ouverture de la session.
    expect(SUPER).toContain("onModel: (modele) => {");
    expect(MOTEUR).toContain("model_label");
  });
});

// ---------------------------------------------------------------------------
describe("4. Le repli est VISIBLE, jamais silencieux", () => {
  it("chaque panne a SA phrase, et elle dit qu'on repart en ligne", () => {
    const raisons = [
      "service-absent",
      "service-muet",
      "aucun-modele-francais",
      "dictee-non-prete",
      "inconnue-du-futur",
    ];
    for (const raison of raisons) {
      const phrase = localEarFallbackSentence(raison);
      expect(phrase, `raison ${raison} muette`).not.toBe("");
      // Le point NON NÉGOCIABLE : la conséquence réelle est dite.
      expect(phrase, `raison ${raison} cache le retour en ligne`).toContain("service en ligne");
      expect(phrase).toContain("dicte autrement");
      // Jamais un code brut, jamais un identifiant technique.
      expect(phrase).not.toContain(raison);
      expect(phrase).not.toMatch(/sherpa-|_|-non-|http/i);
    }
    // Un état illisible ne vaut JAMAIS « disponible ».
    expect(localEarReason(null)).toBe("service-absent");
    expect(localEarReason({})).toBe("service-absent");
    expect(localEarReason({ available: false })).toBe("service-absent");
    expect(localEarReason({ reason: "service-muet" })).toBe("service-muet");
  });

  it("un service indisponible ne donne JAMAIS une dictée locale muette", () => {
    for (const raison of ["service-absent", "service-muet", "aucun-modele-francais", "dictee-non-prete"]) {
      const plan = planLocalEar({ requested: true, status: { available: false, reason: raison } });
      expect(plan.use).toBe(false);
      expect(plan.fallback).toBe(localEarFallbackSentence(raison));
      expect(plan.fallback).not.toBe("");
    }
  });

  it("le repli est ANNONCÉ par le chemin unique, hors du mode Vocal", () => {
    const repli = corpsFonction(SUPER, "  function annoncerRepliLocal(phrase) {");
    // Dit une seule fois (jamais en boucle), et seulement s'il y a une phrase.
    expect(repli).toContain("if (!texte) return;");
    expect(repli).toContain("if (localEarRepliAnnonce === texte) return;");
    expect(repli).toContain("localEarRepliAnnonce = texte;");
    // Hors du mode Vocal, la conversation est le seul endroit où lire la phrase.
    expect(repli).toContain("appendSystemMessage(messagesEl,");
    // Dans le mode Vocal, la ligne d'état parle : rien n'est ajouté à l'écran nu.
    expect(repli).toContain("if (vocalOverlay) return;");
  });

  it("le choix du fournisseur ANNONCE le repli avant de repartir en ligne", () => {
    const creation = corpsFonction(SUPER, "  function createDictationSession(SR) {");
    // Le repli du plan est dit AVANT le retour au moteur du navigateur.
    const iAnnonce = creation.indexOf("annoncerRepliLocal(localEarPlan && localEarPlan.fallback");
    const iLigne = creation.indexOf("return new SR();");
    expect(iAnnonce).toBeGreaterThan(-1);
    expect(iLigne).toBeGreaterThan(iAnnonce);
    // Sans le micro de l'écran, la phrase dit POURQUOI et où le son repart.
    const iSansMicro = creation.indexOf("if (!vocalMic) {");
    expect(iSansMicro).toBeGreaterThan(-1);
    expect(creation).toContain("hors du mode");
    expect(creation).toContain("service en ligne");
  });

  it("une panne PENDANT l'écoute est dite, et le retour en ligne est annoncé", () => {
    const phrase = localEarFailureMessage({ error: "local-ear", local: true, message: "socket fermée" });
    expect(phrase).not.toBe("");
    expect(phrase).toContain("s'est arrêté pendant la dictée");
    expect(phrase).toContain("Rien n'a été envoyé");
    // Le basculement est ANNONCÉ, pas subi en silence.
    expect(phrase).toContain("Je repasse à la dictée du navigateur");
    expect(phrase).toContain("service en ligne");
    // Une erreur du navigateur (donc non locale) n'emprunte PAS ce chemin.
    expect(localEarFailureMessage({ error: "not-allowed" })).toBe("");
    expect(localEarFailureMessage(null)).toBe("");
    // Le branchement est le PREMIER de `rec.onerror` : la phrase locale ne peut
    // pas être avalée par une branche générique.
    const erreur = sliceSource(SUPER, "    rec.onerror = (ev) => {", "    rec.onend = () => {");
    const iLocale = erreur.indexOf("localEarFailureMessage(ev)");
    expect(iLocale).toBeGreaterThan(-1);
    expect(erreur.indexOf("if (vocalOverlay)")).toBeGreaterThan(iLocale);
    // La décision est RECALCULÉE sans statut (donc « absent ») : l'écran ne
    // promet plus une oreille locale dont on n'a plus de preuve.
    expect(erreur).toContain("localEarStatus = null;");
    expect(erreur).toContain("planLocalEar({ requested: localDictationOn, status: null })");
    expect(erreur).toContain("reportVoiceFailure(phraseLocale, phraseLocale);");
  });

  it("l'écoute automatique ATTEND la réponse du pont au lieu de partir en ligne", () => {
    const demarrage = corpsFonction(SUPER, "  function startVoiceInput() {");
    expect(demarrage).toContain("if (localDictationOn && !localEarVerifie) return false;");
    // Et la ligne d'état dit qu'elle vérifie, plutôt que de laisser croire.
    expect(localEarStatusLine({ plan: planLocalEar({ requested: true, status: null }), verification: true }))
      .toBe("Je vérifie si la dictée locale peut servir…");
  });
});

// ---------------------------------------------------------------------------
describe("5. La ligne d'état dit la vérité, sans nouvel élément", () => {
  it("elle est écrite dans la ligne EXISTANTE, à sa place, une seule fois", () => {
    const ligne = corpsFonction(SUPER, "  function vocalStatusLine(state) {");
    expect(ligne).toContain("localEarStatusLine({");
    // La phrase n'écrase pas les états déjà verrouillés : elle vient après eux.
    expect(ligne.indexOf("if (demandesEnAttente.length > 0)")).toBeLessThan(
      ligne.indexOf("localEarStatusLine({"),
    );
    expect(ligne.indexOf("localEarStatusLine({")).toBeLessThan(
      ligne.indexOf("return vocalNameSentence(superAgentDisplayLabel());"),
    );
    // Elle n'est dite que si une dictée est réellement armée ou ouverte.
    expect(ligne).toContain("const oreilleArmee =");
    expect(ligne).toContain('raison === "au-repos"');
  });

  it("elle dit laquelle des deux oreilles écoute", () => {
    const pret = planLocalEar({ requested: true, status: STATUT_PRET });
    const absent = planLocalEar({ requested: true, status: null });
    expect(localEarStatusLine({ plan: pret })).toBe("J'écoute avec le service local.");
    expect(localEarStatusLine({ plan: absent })).toBe(
      "Le service local est absent : je dicte autrement.",
    );
    // Le nom reste la phrase de la garde (source unique), jamais recopiée ici.
    expect(localEarStatusLine({ plan: pret, nom: "Aurelia" })).toContain(
      "Dites « Aurelia » pour me parler.",
    );
    // Réveillée pour une phrase : la phrase du nom n'est pas redemandée.
    expect(localEarStatusLine({ plan: pret, nom: "" })).toBe("J'écoute avec le service local.");
  });

  it("aucun nouvel élément d'interface n'est créé pour l'oreille locale", () => {
    const overlay = corpsFonction(SUPER, "  function enterVocal(");
    for (const interdit of ["vocal-ear", "oreille-locale-", "local-ear-"]) {
      expect(overlay, `nouvel élément ${interdit}`).not.toContain(interdit);
    }
    // La case à cocher est DANS la section existante (onglet Assistant).
    const section = sliceSource(HTML, 'id="local-dictation-note"', "</div>", 40);
    expect(section).not.toContain("<h3");
    expect(section).not.toContain("settings-section");
  });
});

// ---------------------------------------------------------------------------
describe("6. Aucun second chemin de dictée : le moteur a la FORME du navigateur", () => {
  it("une seule construction de session, dans la voie de démarrage unique", () => {
    expect((SUPER.match(/new SR\(\)/g) || []).length).toBe(1);
    const demarrage = corpsFonction(SUPER, "  function startVoiceInput() {");
    // Le moteur du navigateur reste le repli, construit au même endroit.
    expect(demarrage).toContain("const SR = window.SpeechRecognition || window.webkitSpeechRecognition;");
    expect(demarrage).toContain("const rec = createDictationSession(SR);");
    expect(demarrage).toContain("rec.start();");
    // Aucun autre site ne crée une session : ni le geste, ni l'armement.
    const geste = corpsFonction(SUPER, "  function toggleVoiceInput() {");
    expect(geste).not.toContain("createDictationSession");
    const armement = corpsFonction(SUPER, "  function armVoiceInput() {");
    expect(armement).not.toContain("createDictationSession");
  });

  it("l'oreille locale n'est branchée QUE dans le choix du fournisseur", () => {
    expect((SUPER.match(/createLocalEar\(/g) || []).length).toBe(1);
    expect((SUPER.match(/= createDictationSession\(SR\)/g) || []).length).toBe(1);
  });

  it("le texte local entre par la MÊME porte que le texte du navigateur", () => {
    // La forme de l'évènement est celle qu'attend la dictée existante : un seul
    // résultat finalisé qui porte le texte déjà reconnu (le pont est cumulatif).
    const ev = localEarResultEvent("bonjour tout le monde");
    expect(ev.results.length).toBe(1);
    expect(ev.results[0].isFinal).toBe(true);
    expect(ev.results[0][0].transcript).toBe("bonjour tout le monde");
    // Et c'est bien ce que lit le gestionnaire UNIQUE.
    const resultat = sliceSource(SUPER, "    rec.onresult = (e) => {", "    rec.onerror = (ev) => {");
    expect(resultat).toContain("e.results.length");
    expect(resultat).toContain("if (r.isFinal) finals.push(r[0].transcript);");
  });

  it("la garde du nom s'applique AUSSI au texte local (aucune exception)", () => {
    const resultat = sliceSource(SUPER, "    rec.onresult = (e) => {", "    rec.onerror = (ev) => {");
    // Une seule garde, et elle est sur ce chemin : le fournisseur du texte n'y
    // change rien (aucun test sur `localEar` dans le gestionnaire).
    expect(resultat).toContain("vocalNameGateArmed({");
    expect(resultat).toContain("!mentionsAssistantName(transcript, nomAttendu)");
    expect(resultat).not.toContain("localEar");
    expect((SUPER.match(/decideVocalNameGate\(/g) || []).length + (SUPER.match(/vocalNameGateArmed\(/g) || []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe("7. Le moteur local, essayé pour de vrai (faux pont, faux micro)", () => {
  /** Un pont de test : enregistre les appels, laisse piloter les évènements. */
  function fauxPont() {
    const appels = [];
    let surEvenement = null;
    const invoke = (nom, args) => {
      appels.push({ nom, args });
      if (nom === "asr_voicestudio_start") {
        return Promise.resolve({
          session_id: "s1",
          sample_rate: 16000,
          model_id: "sherpa-parakeet-tdt-v3",
          model_label: "Parakeet TDT v3 (français)",
        });
      }
      return Promise.resolve(null);
    };
    const listen = (nom, cb) => {
      expect(nom).toBe(LOCAL_EAR_EVENT);
      surEvenement = cb;
      return Promise.resolve(() => {
        surEvenement = null;
      });
    };
    return {
      invoke,
      listen,
      appels,
      envoyer: (payload) => surEvenement && surEvenement({ payload }),
      ecouteBranchee: () => surEvenement !== null,
    };
  }

  /** Un micro de test : retient le robinet demandé, comme le vrai. */
  function fauxMicro() {
    const etat = { tap: null, taps: [] };
    return {
      etat,
      setAudioTap: (fn) => {
        etat.taps.push(typeof fn);
        etat.tap = fn;
        return fn !== null && typeof fn === "function";
      },
    };
  }

  const attendre = async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  /** Démarre une oreille locale prête à recevoir du son. */
  async function oreillePrete() {
    const pont = fauxPont();
    const micro = fauxMicro();
    const modeles = [];
    const rec = createLocalEar({
      invoke: pont.invoke,
      listen: pont.listen,
      mic: micro,
      onModel: (m) => modeles.push(m),
    });
    const vus = { resultats: [], erreurs: [], fins: 0 };
    rec.onresult = (ev) => vus.resultats.push(ev);
    rec.onerror = (ev) => vus.erreurs.push(ev);
    rec.onend = () => {
      vus.fins += 1;
    };
    rec.start();
    await attendre();
    return { pont, micro, rec, vus, modeles };
  }

  it("elle a la forme d'une session du navigateur et se présente comme locale", () => {
    const rec = createLocalEar({});
    expect(rec.localEar).toBe(true);
    expect(rec.lang).toBe("fr-FR");
    expect(typeof rec.start).toBe("function");
    expect(typeof rec.stop).toBe("function");
  });

  it("elle ouvre UNE session sans nommer de modèle, et se branche sur le micro existant", async () => {
    const { pont, micro, modeles } = await oreillePrete();
    const ouverture = pont.appels.filter((a) => a.nom === "asr_voicestudio_start");
    expect(ouverture.length).toBe(1);
    // Le modèle n'est jamais choisi par l'écran : le pont décide.
    expect(ouverture[0].args).toEqual({ model: null });
    // Le son vient du flux DÉJÀ capté : aucun second micro.
    expect(micro.etat.taps).toContain("function");
    expect(typeof micro.etat.tap).toBe("function");
    // Le modèle réellement ouvert est REMONTÉ pour l'affichage.
    expect(modeles).toEqual([{ modelId: "sherpa-parakeet-tdt-v3", modelLabel: "Parakeet TDT v3 (français)" }]);
  });

  it("le son part au pont en morceaux de 100 ms, jamais en un seul bloc", async () => {
    const { pont, micro } = await oreillePrete();
    // 1 seconde à 48 kHz -> 16 000 échantillons à 16 kHz -> 32 000 octets.
    micro.etat.tap(new Float32Array(48000).fill(0.1), 48000);
    await attendre();
    const envois = pont.appels.filter((a) => a.nom === "asr_voicestudio_send");
    expect(envois.length).toBe(10);
    for (const envoi of envois) {
      expect(envoi.args.sessionId).toBe("s1");
      expect(envoi.args.chunk.length).toBe(LOCAL_EAR_CHUNK_BYTES);
    }
  });

  it("le texte cumulatif arrive par le même évènement que le navigateur", async () => {
    const { pont, vus } = await oreillePrete();
    pont.envoyer({ kind: "partial", text: "bonjour" });
    expect(vus.resultats.length).toBe(1);
    expect(vus.resultats[0].results[0][0].transcript).toBe("bonjour");
    pont.envoyer({ kind: "final", text: "Bonjour tout le monde.", final_kind: "summary" });
    const dernier = vus.resultats[vus.resultats.length - 1];
    expect(dernier.results[0][0].transcript).toBe("Bonjour tout le monde.");
    pont.envoyer({ kind: "ended" });
    expect(vus.fins).toBe(1);
  });

  it("une panne du service est DITE et referme le robinet", async () => {
    const { pont, micro, vus } = await oreillePrete();
    pont.envoyer({ kind: "error", message: "le logiciel de voix a fermé la session" });
    expect(vus.erreurs.length).toBe(1);
    expect(vus.erreurs[0].local).toBe(true);
    expect(vus.erreurs[0].message).toContain("a fermé la session");
    expect(micro.etat.tap).toBe(null);
    expect(vus.fins).toBe(1);
  });

  it("une ouverture impossible est dite, jamais silencieuse", async () => {
    const vus = { erreurs: [], fins: 0 };
    const rec = createLocalEar({
      invoke: () => Promise.reject(new Error("le service de voix local ne répond pas")),
      listen: () => Promise.resolve(() => {}),
      mic: fauxMicro(),
    });
    rec.onerror = (ev) => vus.erreurs.push(ev);
    rec.onend = () => {
      vus.fins += 1;
    };
    rec.start();
    await attendre();
    expect(vus.erreurs.length).toBe(1);
    expect(vus.erreurs[0].local).toBe(true);
    expect(vus.erreurs[0].message).toContain("ne répond pas");
    expect(vus.fins).toBe(1);
    // La phrase rendue à l'écran est celle du module, avec la conséquence dite.
    expect(localEarFailureMessage(vus.erreurs[0])).toContain("service en ligne");
  });

  it("sans micro, elle refuse plutôt que de faire semblant d'écouter", async () => {
    const vus = { erreurs: [] };
    const rec = createLocalEar({
      invoke: () => Promise.resolve({ session_id: "s1", sample_rate: 16000 }),
      listen: () => Promise.resolve(() => {}),
      mic: null,
    });
    rec.onerror = (ev) => vus.erreurs.push(ev);
    rec.start();
    await attendre();
    expect(vus.erreurs.length).toBe(1);
    expect(vus.erreurs[0].message).toContain("micro");
  });

  it("l'arrêt prévient le pont et n'envoie plus de son", async () => {
    const { pont, micro, rec } = await oreillePrete();
    micro.etat.tap(new Float32Array(24000).fill(0.2), 48000);
    await attendre();
    const avant = pont.appels.filter((a) => a.nom === "asr_voicestudio_send").length;
    rec.stop();
    await attendre();
    expect(pont.appels.filter((a) => a.nom === "asr_voicestudio_stop").length).toBe(1);
    expect(micro.etat.tap).toBe(null);
    // Plus rien ne part après l'arrêt.
    micro.etat.tap && micro.etat.tap(new Float32Array(4800), 48000);
    await attendre();
    expect(pont.appels.filter((a) => a.nom === "asr_voicestudio_send").length).toBe(avant);
  });

  it("le texte rendu à la zone est celui du pont, jamais un second texte", () => {
    expect(localEarText({ finalise: "Bonjour", provisoire: "tout le monde" })).toBe(
      "Bonjour tout le monde",
    );
    expect(localEarText({ finalise: "", provisoire: "" })).toBe("");
    expect(localEarText({ finalise: "  Bonjour  ", provisoire: "  " })).toBe("Bonjour");
  });
});
