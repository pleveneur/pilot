// abandon-ecoute-prevenir-le-service.test.js — VERROUS de l'ABANDON d'une écoute
// locale : une dictée abandonnée PRÉVIENT le pont du service de voix local,
// exactement comme un arrêt normal, et le texte déjà obtenu n'est plus jeté.
//
// DÉFAUT CORRIGÉ (docs/rapports/RAPPORT-diagnostic-erreurs-dictee-locale.md) :
// après trois dictées locales réussies, la fenêtre a rouvert l'écoute huit fois
// en dix-neuf secondes. Sept ouvertures ont été ABANDONNÉES SANS PRÉVENIR le
// pont : la session restait vivante côté service, c'est la tentative SUIVANTE
// qui la refermait (`asr_voicestudio_start` interrompt la précédente), et le
// texte qu'elle avait déjà reconnu était alors jeté. Et la phrase affichée
// accusait « le service de voix local s'est arrêté » alors qu'il était sain.
//
// CE QUE CE FICHIER EMPÊCHE DE RÉGRESSER (dans l'ordre de la mission) :
//   1. L'ABANDON PRÉVIENT LE SERVICE, par la MÊME fonction que l'arrêt normal
//      (un seul `invoke("asr_voicestudio_cancel", …)` dans tout le module).
//   2. LE TEXTE DÉJÀ OBTENU EST REMIS À L'ÉCRAN avant que la session soit
//      abandonnée : la tentative suivante ne jette plus rien.
//   3. LA PHRASE D'UNE PANNE N'ACCUSE PLUS LE SERVICE : elle dit ce qui est
//      prouvé (la dictée locale s'est arrêtée) et laisse la cause réelle au
//      détail rendu par le pont.
//
// Les commentaires restent en ASCII quand ils citent du code ; les phrases
// vérifiées sont copiées telles quelles depuis les modules.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { localEarFailureMessage } from "./oreille-locale.js";
import { LOCAL_EAR_EVENT, createLocalEar } from "./oreille-locale-moteur.js";
import { sliceSource } from "./source-slice.js";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (rel) => readFileSync(join(ICI, "..", "..", rel), "utf8").replace(/\r\n/g, "\n");

const MOTEUR = lire("src/js/oreille-locale-moteur.js");
const SUPER = lire("src/js/super-agent.js");

const attendre = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

/**
 * Un pont de test qui se comporte comme le VRAI sur le point qui compte : une
 * session abandonnée sans être prévenue RESTE OUVERTE, et c'est le `start`
 * suivant qui la referme — en jetant le texte qu'elle avait déjà reconnu.
 */
function fauxPont() {
  const appels = [];
  const jetes = []; // texte perdu parce qu'une session était encore ouverte
  let enVie = null;
  let texteEnVie = "";
  let numero = 0;
  let surEvenement = null;
  let envoiEchoue = null;

  const invoke = (nom, args) => {
    const a = args || {};
    appels.push({ nom, args: a });
    if (nom === "asr_voicestudio_start") {
      if (enVie) {
        jetes.push({ session: enVie, texte: texteEnVie });
        enVie = null;
        texteEnVie = "";
      }
      numero += 1;
      enVie = `s${numero}`;
      texteEnVie = "";
      return Promise.resolve({
        session_id: enVie,
        sample_rate: 16000,
        model_id: "sherpa-parakeet-tdt-v3",
        model_label: "Parakeet TDT v3 (français)",
      });
    }
    if (nom === "asr_voicestudio_send") {
      if (envoiEchoue) return Promise.reject(new Error(envoiEchoue));
      return Promise.resolve(null);
    }
    if (nom === "asr_voicestudio_cancel") {
      // Interrompre une session déjà finie n'est pas une erreur (vrai pont).
      if (enVie === a.sessionId) {
        enVie = null;
        texteEnVie = "";
      }
      return Promise.resolve(null);
    }
    if (nom === "asr_voicestudio_stop") {
      if (enVie === a.sessionId) enVie = null;
      return Promise.resolve(null);
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
    jetes,
    sessionEnVie: () => enVie,
    texteEnVie: () => texteEnVie,
    // Le service reconnaît un mot : c'est le pont qui pousse le partiel/final.
    reconnaitre: (texte, kind = "partial") => {
      texteEnVie = texte;
      if (surEvenement) surEvenement({ payload: { kind, text: texte } });
    },
    annoncerPanne: (message) => {
      if (surEvenement) surEvenement({ payload: { kind: "error", message } });
    },
    faireEchouerLesEnvois: (message) => {
      envoiEchoue = message;
    },
    nb: (nom) => appels.filter((x) => x.nom === nom).length,
  };
}

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

/** Démarre une oreille locale prête, en gardant l'ORDRE des évènements reçus. */
async function oreillePrete() {
  const pont = fauxPont();
  const micro = fauxMicro();
  const ordre = [];
  const vus = { resultats: [], erreurs: [], fins: 0 };
  const rec = createLocalEar({
    invoke: pont.invoke,
    listen: pont.listen,
    mic: micro,
    onModel: () => {},
  });
  rec.onresult = (ev) => {
    ordre.push("resultat");
    vus.resultats.push(ev);
  };
  rec.onerror = (ev) => {
    ordre.push("erreur");
    vus.erreurs.push(ev);
  };
  rec.onend = () => {
    ordre.push("fin");
    vus.fins += 1;
  };
  rec.start();
  await attendre();
  return { pont, micro, rec, vus, ordre };
}

/** Un morceau de son de 100 ms : le pont reçoit un envoi, jamais zéro. */
const unMorceauDeSon = (micro) => micro.etat.tap(new Float32Array(4800).fill(0.1), 48000);

// ---------------------------------------------------------------------------
describe("1. L'abandon prévient le pont, comme l'arrêt normal", () => {
  it("une panne d'envoi interrompt la session auprès du pont, une seule fois", async () => {
    const { pont, micro, vus } = await oreillePrete();
    pont.faireEchouerLesEnvois("le son ne part plus vers le service local");
    unMorceauDeSon(micro);
    await attendre();
    // La panne est dite (jamais un silence)…
    expect(vus.erreurs.length).toBe(1);
    // …et la session est ABANDONNÉE auprès du pont : c'est LE correctif.
    expect(pont.nb("asr_voicestudio_cancel")).toBe(1);
    const annulation = pont.appels.filter((a) => a.nom === "asr_voicestudio_cancel")[0];
    expect(annulation.args.sessionId).toBe("s1");
    // Rien n'est resté ouvert derrière nous.
    expect(pont.sessionEnVie()).toBe(null);
    // Le robinet du micro est refermé : plus aucun son ne part vers personne.
    expect(micro.etat.tap).toBe(null);
  });

  it("une erreur annoncée par le pont abandonne la session de la même façon", async () => {
    const { pont, micro, vus } = await oreillePrete();
    unMorceauDeSon(micro);
    await attendre();
    pont.annoncerPanne("la session de dictée local a été fermée");
    await attendre();
    expect(vus.erreurs.length).toBe(1);
    expect(pont.nb("asr_voicestudio_cancel")).toBe(1);
    expect(pont.sessionEnVie()).toBe(null);
  });

  it("l'arrêt NORMAL garde son propre chemin (stop, jamais cancel)", async () => {
    const { pont, micro, rec } = await oreillePrete();
    unMorceauDeSon(micro);
    await attendre();
    rec.stop();
    await attendre();
    expect(pont.nb("asr_voicestudio_stop")).toBe(1);
    expect(pont.nb("asr_voicestudio_cancel")).toBe(0);
  });

  it("un abandon tardif ne casse rien : interrompre une session finie n'est pas une erreur", async () => {
    const { pont, micro } = await oreillePrete();
    unMorceauDeSon(micro);
    await attendre();
    pont.annoncerPanne("panne");
    await attendre();
    // Une seconde panne du même moteur ne redit rien et ne réabandonne rien.
    pont.annoncerPanne("panne");
    await attendre();
    expect(pont.nb("asr_voicestudio_cancel")).toBe(1);
  });

  it("il n'y a qu'UNE seule façon d'abandonner dans tout le module", () => {
    // Un seul appelant de l'interruption : la fonction partagée. Deux logiques
    // parallèles (celle de l'abandon et celle des refus de démarrage) étaient
    // exactement ce que la mission interdisait.
    expect((MOTEUR.match(/invoke\(\s*"asr_voicestudio_cancel"/g) || []).length).toBe(1);
    expect((MOTEUR.match(/async function abandonnerSession\(/g) || []).length).toBe(1);
    // L'abandon (la panne) ne recopie pas l'appel : il passe par la fonction.
    const panne = sliceSource(MOTEUR, "  function panner(message) {", "  function finir() {");
    expect(panne).toContain("abandonnerSession(");
    expect(panne).not.toContain("asr_voicestudio_cancel");
    // Et les refus de démarrage passent par elle aussi.
    const demarrage = sliceSource(MOTEUR, "  async function demarrer() {", "  async function arreter() {");
    expect(demarrage).toContain("abandonnerSession(");
    expect(demarrage).not.toContain("asr_voicestudio_cancel");
  });
});

// ---------------------------------------------------------------------------
describe("2. Le texte déjà obtenu n'est plus jeté", () => {
  it("le texte reconnu est remis à l'écran AVANT la panne, et avant l'abandon", async () => {
    const { pont, micro, vus, ordre } = await oreillePrete();
    pont.reconnaitre("bonjour tout le monde", "partial");
    await attendre();
    expect(vus.resultats.length).toBe(1);
    // La panne survient APRÈS : le texte déjà reconnu ne doit pas disparaître.
    pont.faireEchouerLesEnvois("le son ne part plus vers le service local");
    unMorceauDeSon(micro);
    await attendre();
    // Le texte est remis une dernière fois, AVANT que la panne soit dite.
    expect(vus.resultats.length).toBe(2);
    expect(vus.resultats[1].results[0][0].transcript).toBe("bonjour tout le monde");
    expect(ordre).toEqual(["resultat", "resultat", "erreur", "fin"]);
  });

  it("le texte final du pont est lui aussi remis avant l'abandon", async () => {
    const { pont, micro, vus } = await oreillePrete();
    pont.reconnaitre("phrase entière", "final");
    unMorceauDeSon(micro);
    await attendre();
    pont.annoncerPanne("la session de dictée local a été fermée");
    await attendre();
    const textes = vus.resultats.map((r) => r.results[0][0].transcript);
    expect(textes).toContain("phrase entière");
    // Remis au moins deux fois : par le résultat, puis par l'abandon.
    expect(textes.filter((t) => t === "phrase entière").length).toBe(2);
  });

  it("la tentative SUIVANTE ne jette plus aucun texte : la session a été refermée", async () => {
    const { pont, micro } = await oreillePrete();
    pont.reconnaitre("un mot déjà obtenu", "final");
    unMorceauDeSon(micro);
    await attendre();
    pont.annoncerPanne("panne");
    await attendre();
    // Deuxième tentative, comme les huit réouvertures du diagnostic.
    const seconde = createLocalEar({ invoke: pont.invoke, listen: pont.listen, mic: fauxMicro() });
    seconde.onresult = () => {};
    seconde.onerror = () => {};
    seconde.onend = () => {};
    seconde.start();
    await attendre();
    expect(pont.jetes).toEqual([]);
    // Et la deuxième session est bien la suivante, pas la première réutilisée.
    expect(pont.sessionEnVie()).toBe("s2");
  });

  it("une panne SANS texte n'invente aucun résultat", async () => {
    const { pont, micro, vus } = await oreillePrete();
    pont.faireEchouerLesEnvois("le son ne part plus");
    unMorceauDeSon(micro);
    await attendre();
    expect(vus.resultats).toEqual([]);
    expect(vus.erreurs.length).toBe(1);
    expect(pont.nb("asr_voicestudio_cancel")).toBe(1);
  });

  it("l'écran garde ce texte : la branche de panne n'efface pas la zone de saisie", () => {
    // Le moteur remet le texte par la porte UNIQUE (`onresult`) ; encore faut-il
    // que la branche d'erreur de l'écran ne l'efface pas en revenant au texte
    // d'avant la dictée — sinon le texte serait jeté une seconde fois.
    const branche = sliceSource(
      SUPER,
      "      const phraseLocale = localEarFailureMessage(ev);",
      "      if (vocalOverlay) {",
    );
    expect(branche).toContain("reportVoiceFailure(phraseLocale, phraseLocale);");
    expect(branche).not.toContain("inputEl.value");
  });
});

// ---------------------------------------------------------------------------
describe("3. La phrase d'une panne n'accuse plus un service sain", () => {
  it("elle dit ce qui est prouvé : la dictée locale s'est arrêtée", () => {
    const phrase = localEarFailureMessage({
      error: "local-ear",
      local: true,
      message: "le son du micro n'a pas pu être dirigé vers la dictée locale",
    });
    expect(phrase).toContain("La dictée locale s'est arrêtée pendant l'écoute");
    // L'accusation gratuite a disparu : le service peut être parfaitement sain.
    expect(phrase).not.toContain("service de voix local s'est arrêté");
    // La cause réelle est DITE, telle que le pont la donne.
    expect(phrase).toContain("le son du micro n'a pas pu être dirigé vers la dictée locale");
    expect(phrase).toContain("Rien n'a été envoyé");
    // Le basculement reste annoncé, jamais silencieux.
    expect(phrase).toContain("Je repasse à la dictée du navigateur");
    expect(phrase).toContain("service en ligne");
  });

  it("quand le service est VRAIMENT en cause, c'est le détail qui le nomme", () => {
    const phrase = localEarFailureMessage({
      error: "local-ear",
      local: true,
      message: "le service de voix local ne répond pas",
    });
    // La phrase cadre, le détail accuse — à bon escient, cette fois.
    expect(phrase).toContain("La dictée locale s'est arrêtée pendant l'écoute");
    expect(phrase).toContain("(le service de voix local ne répond pas)");
  });

  it("une panne sans détail ne fabrique pas de cause", () => {
    const phrase = localEarFailureMessage({ error: "local-ear", local: true, message: "  " });
    expect(phrase).toContain("La dictée locale s'est arrêtée pendant l'écoute.");
    expect(phrase).not.toContain("()");
  });

  it("une erreur qui n'est pas locale n'emprunte pas ce chemin", () => {
    expect(localEarFailureMessage({ error: "not-allowed" })).toBe("");
    expect(localEarFailureMessage({ error: "no-speech" })).toBe("");
    expect(localEarFailureMessage(null)).toBe("");
    expect(localEarFailureMessage(undefined)).toBe("");
  });
});
