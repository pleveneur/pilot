// oreille-locale-moteur.js — L'OREILLE LOCALE, ÉTAPE 2 : LE MOTEUR DE L'ÉCRAN
//
// Ce module branche la dictée du mode Vocal sur le pont machine de l'étape 1
// (`src-tauri/src/asr_voicestudio.rs`). Il ne joint JAMAIS le service de voix :
// il ne parle qu'aux commandes Tauri de l'étape 1 et n'écoute qu'un seul
// évènement (`asr-voicestudio-transcript`). C'est la règle tenue par
// `oreille-locale-etape1.test.js`, et elle reste vraie ici : aucune adresse,
// aucun chemin, aucune requête n'est écrite dans ce fichier.
//
// ── POURQUOI UN OBJET « FAUX MOTEUR DE RECONNAISSANCE » ─────────────────────
// La dictée existante (`startVoiceInput` dans `super-agent.js`) est verrouillée
// par une dizaine de tests (garde du nom, envoi sur silence, reprise en main,
// un seul envoi en fin de dictée, réarmement automatique). Plutôt que d'écrire
// un SECOND chemin de dictée — ce que la mission interdit —, ce module rend un
// objet de la MÊME FORME qu'une session de reconnaissance du navigateur
// (`start` / `stop` / `onresult` / `onerror` / `onend`, plus `lang`,
// `interimResults`, `continuous`). Tout ce qui décide (garde du nom, silence,
// envoi, plafond des sessions vides) reste donc écrit UNE seule fois, à
// l'endroit où il l'était déjà : seul le fournisseur du texte change.
//
// ── LE SON ─────────────────────────────────────────────────────────────────
// Ce module ne capture RIEN : il demande le robinet d'écoute au micro EXISTANT
// (`vocal-mic.js`, `setAudioTap`), qui lui rend les échantillons de l'unique
// flux déjà capté pour mesurer le niveau. Il les convertit au format du pont
// (PCM 16 bits mono 16 kHz) et les envoie par morceaux de 100 ms.
//
// ── LES PANNES SONT DITES, JAMAIS AVALÉES ──────────────────────────────────
// Toute panne (service disparu, session refusée, robinet impossible, morceau
// refusé) produit un `onerror` marqué `local: true` et porteur d'une phrase
// française : l'écran la lit (`localEarFailureMessage`) et l'affiche. Aucun
// retour silencieux vers le moteur du navigateur : c'est `super-agent.js` qui
// décide de la suite, à la vue de cette phrase, et il le dit aussi.

import {
  LOCAL_EAR_CHUNK_BYTES,
  downsamplePcm,
  localEarText,
  pcm16Bytes,
  splitPcmChunks,
} from "./oreille-locale.js";

/** L'unique évènement écouté (nom fixé par le pont, étape 1). */
export const LOCAL_EAR_EVENT = "asr-voicestudio-transcript";

/**
 * Nombre maximal d'envois en vol : le robinet ne doit jamais bloquer la boucle
 * audio. Au-delà, un morceau est abandonné (et c'est dit une fois) plutôt que de
 * faire grossir une file qui rendrait le texte en retard.
 */
export const LOCAL_EAR_MAX_INFLIGHT = 32;

/**
 * Événement synthétique, de la forme EXACTE attendue par la dictée existante
 * (`e.results[i].isFinal`, `e.results[i][0].transcript`). Le pont rend un texte
 * CUMULATIF : un seul résultat, finalisé, qui porte tout ce qui a été dit.
 * @param {string} texte texte reconnu depuis le début de la dictée
 * @returns {{results: Array<{isFinal: boolean, 0: {transcript: string}}>}}
 */
export function localEarResultEvent(texte) {
  const t = typeof texte === "string" ? texte : "";
  const resultat = [{ transcript: t }];
  resultat.isFinal = true;
  return { results: [resultat] };
}

/**
 * Crée une session de dictée locale, de la forme d'une session de reconnaissance
 * du navigateur.
 *
 * @param {{
 *   invoke?: Function, listen?: Function,
 *   mic?: object|null,
 *   onModel?: Function
 * }} options
 * @returns {object} session (`start`, `stop`, `onresult`, `onerror`, `onend`)
 */
export function createLocalEar(options = {}) {
  const invoke = typeof options.invoke === "function" ? options.invoke : null;
  const listen = typeof options.listen === "function" ? options.listen : null;
  const mic = options.mic && typeof options.mic.setAudioTap === "function" ? options.mic : null;
  const surModele = typeof options.onModel === "function" ? options.onModel : () => {};

  let sessionId = "";
  let tauxCible = 0;
  let tampon = new Uint8Array(0);
  let finalise = "";
  let provisoire = "";
  let arrete = false;
  let termine = false;
  let robinetOuvert = false;
  let enVol = 0;
  let abandonSignale = false;
  let unlisten = null;

  const rec = {
    lang: "fr-FR",
    interimResults: true,
    continuous: true,
    onresult: null,
    onerror: null,
    onend: null,
    // Marque lisible par l'appelant : ce n'est pas le moteur du navigateur.
    localEar: true,
    start: () => demarrer(),
    stop: () => arreter(),
  };

  function emettreResultat() {
    const texte = localEarText({ finalise, provisoire });
    if (!texte) return;
    if (typeof rec.onresult !== "function") return;
    try {
      rec.onresult(localEarResultEvent(texte));
    } catch (_) {
      /* un écran qui échoue ne doit pas arrêter la session */
    }
  }

  /**
   * Une panne : elle est DITE (une seule fois), la session est refermée, et la
   * fin d'écoute suit — exactement comme une erreur du moteur du navigateur.
   */
  function panner(message) {
    if (termine) return;
    termine = true;
    fermerRobinet();
    const phrase = String(message == null ? "" : message).trim();
    try {
      if (typeof rec.onerror === "function") {
        rec.onerror({ error: "local-ear", local: true, message: phrase });
      }
    } catch (_) {
      /* la phrase a été remise : l'écran ne peut plus la perdre */
    }
    finir();
  }

  function finir() {
    termine = true;
    if (unlisten) {
      try {
        unlisten();
      } catch (_) {
        /* une écoute déjà retirée n'a rien à retirer */
      }
      unlisten = null;
    }
    sessionId = "";
    if (typeof rec.onend === "function") {
      try {
        rec.onend();
      } catch (_) {
        /* idem : la fin d'écoute ne doit jamais lever */
      }
    }
  }

  function fermerRobinet() {
    if (!robinetOuvert) return;
    robinetOuvert = false;
    try {
      if (mic) mic.setAudioTap(null);
    } catch (_) {
      /* le micro peut déjà être fermé (sortie du mode) */
    }
  }

  /** Un morceau part au pont. Jamais attendu par la boucle audio. */
  function envoyer(morceau) {
    if (!invoke || !sessionId) return null;
    if (enVol >= LOCAL_EAR_MAX_INFLIGHT) {
      if (!abandonSignale) {
        abandonSignale = true;
      }
      return null;
    }
    enVol += 1;
    let promesse = null;
    try {
      promesse = invoke("asr_voicestudio_send", {
        sessionId,
        chunk: Array.from(morceau),
      });
    } catch (_) {
      promesse = null;
    }
    if (!promesse || typeof promesse.then !== "function") {
      enVol -= 1;
      return null;
    }
    const suivi = promesse
      .catch((erreur) => {
        // Le pont refuse un morceau : la session ne prend plus de son. C'est une
        // panne dite, jamais un silence (l'écran affichera la phrase).
        panner(erreur && erreur.message ? erreur.message : erreur);
      })
      .finally(() => {
        enVol = Math.max(0, enVol - 1);
      });
    return suivi;
  }

  /** Le robinet : les échantillons du micro DÉJÀ capté, convertis et découpés. */
  function surSon(echantillons, tauxSource) {
    if (termine || arrete || !sessionId) return;
    const cible = tauxCible || 0;
    if (!cible) return;
    const reduits = downsamplePcm(echantillons, tauxSource, cible);
    if (!reduits.length) return;
    const octets = pcm16Bytes(reduits);
    const fusion = new Uint8Array(tampon.length + octets.length);
    fusion.set(tampon, 0);
    fusion.set(octets, tampon.length);
    const { morceaux, reste } = splitPcmChunks(fusion, LOCAL_EAR_CHUNK_BYTES);
    tampon = reste;
    for (const morceau of morceaux) envoyer(morceau);
  }

  /** Un évènement du pont. Aucun autre texte n'entre dans la zone. */
  function surEvenement(payload) {
    const p = payload && typeof payload === "object" ? payload : null;
    if (!p || termine) return;
    const kind = typeof p.kind === "string" ? p.kind : "";
    if (kind === "partial") {
      provisoire = typeof p.text === "string" ? p.text : "";
      emettreResultat();
      return;
    }
    if (kind === "final") {
      // Un morceau finalisé s'ajoute ; le provisoire qu'il remplace disparaît.
      const texte = typeof p.text === "string" ? p.text.trim() : "";
      if (texte) {
        finalise = [finalise.trim(), texte].filter((t) => t !== "").join(" ");
        provisoire = "";
        emettreResultat();
      }
      // `summary` = le texte FINAL de la session : le pont va fermer, la fin
      // d'écoute est décidée par `ended` (aucun doublon possible).
      if (p.final_kind === "summary") provisoire = "";
      return;
    }
    if (kind === "error") {
      panner(p.message);
      return;
    }
    if (kind === "ended") {
      finir();
    }
  }

  async function demarrer() {
    if (termine) return;
    if (!invoke || !listen) {
      panner("la fenêtre ne peut pas joindre le pont de dictée locale");
      return;
    }
    if (!mic) {
      panner("le micro du mode Vocal n'est pas disponible pour la dictée locale");
      return;
    }
    if (robinetOuvert) {
      // Déjà ouverte : le robinet du micro est la seule source de son.
      panner("la dictée locale est déjà ouverte");
      return;
    }
    let session = null;
    try {
      session = await invoke("asr_voicestudio_start", { model: null });
    } catch (erreur) {
      panner(erreur && erreur.message ? erreur.message : erreur);
      return;
    }
    if (arrete) {
      // Arrêtée pendant l'ouverture : rien n'est gardé, rien n'est laissé ouvert.
      const ouverte = session && session.session_id ? session.session_id : "";
      if (ouverte) {
        try {
          await invoke("asr_voicestudio_cancel", { sessionId: ouverte });
        } catch (_) {
          /* une session déjà refermée n'a rien à interrompre */
        }
      }
      return;
    }
    sessionId = session && session.session_id ? session.session_id : "";
    tauxCible = session && Number(session.sample_rate) > 0 ? Number(session.sample_rate) : 0;
    if (!sessionId || !tauxCible) {
      panner("le pont de dictée locale n'a pas ouvert de session");
      return;
    }
    // Le modèle RÉELLEMENT ouvert, pour la phrase de l'écran (jamais choisi ici).
    try {
      surModele({
        modelId: typeof session.model_id === "string" ? session.model_id : "",
        modelLabel: typeof session.model_label === "string" ? session.model_label : "",
      });
    } catch (_) {
      /* la phrase de modèle ne fait pas échouer la dictée */
    }
    try {
      unlisten = await listen(LOCAL_EAR_EVENT, (evenement) => {
        surEvenement(evenement && evenement.payload);
      });
    } catch (_) {
      unlisten = null;
    }
    if (typeof unlisten !== "function") {
      // Sans écoute, le texte ne reviendrait JAMAIS : mieux vaut le dire et ne
      // rien ouvrir que de laisser croire à une dictée qui ne rendra rien.
      try {
        await invoke("asr_voicestudio_cancel", { sessionId });
      } catch (_) {
        /* idem */
      }
      sessionId = "";
      panner("la fenêtre ne peut pas écouter la dictée locale");
      return;
    }
    robinetOuvert = true;
    let branche = false;
    try {
      branche = mic.setAudioTap(surSon) === true;
    } catch (_) {
      branche = false;
    }
    if (!branche) {
      panner("le son du micro n'a pas pu être dirigé vers la dictée locale");
    }
  }

  /**
   * Arrêt DEMANDÉ (envoi sur silence, bouton 🎙️, sortie du mode) : le robinet
   * est refermé, le pont est prévenu — il rend alors le texte final, qui arrive
   * par l'évènement `final` avant la fin d'écoute.
   */
  async function arreter() {
    if (arrete) return;
    arrete = true;
    fermerRobinet();
    if (!sessionId || termine) return;
    // Le reste du tampon part AVANT la fin du flux, et on attend qu'il soit
    // arrivé : sans cette attente, le pont pourrait fermer la session avant le
    // dernier morceau et les derniers mots prononcés seraient perdus.
    if (tampon.length > 0) {
      const dernier = tampon;
      tampon = new Uint8Array(0);
      const envoi = envoyer(dernier);
      if (envoi) {
        try {
          await envoi;
        } catch (_) {
          /* la panne est déjà dite par `envoyer` */
        }
      }
    }
    try {
      await invoke("asr_voicestudio_stop", { sessionId });
    } catch (erreur) {
      panner(erreur && erreur.message ? erreur.message : erreur);
    }
  }

  return rec;
}
