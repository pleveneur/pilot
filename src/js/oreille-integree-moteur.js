// oreille-integree-moteur.js — L'OREILLE INTÉGRÉE : LE MOTEUR DE L'ÉCRAN
//
// Frère de `oreille-locale-moteur.js`, à la même place et de la même forme. La
// seule différence est QUI transcrit : ici, le moteur intégré à Pilot
// (`src-tauri/src/asr_whisper.rs`), sur un modèle présent sur le disque, sans
// port réseau et sans service à lancer. Ce module ne parle qu'aux commandes
// Tauri du moteur intégré et n'écoute qu'un seul évènement
// (`asr-whisper-transcript`). Il n'écrit ni adresse, ni chemin, ni requête.
//
// ── POURQUOI UN OBJET « FAUX MOTEUR DE RECONNAISSANCE » ─────────────────────
// La dictée existante (`startVoiceInput` dans `super-agent.js`) est verrouillée
// par une dizaine de tests (garde du nom, envoi sur silence, reprise en main, un
// seul envoi en fin de dictée, réarmement automatique). Ce module rend donc un
// objet de la MÊME FORME qu'une session de reconnaissance du navigateur
// (`start` / `stop` / `onresult` / `onerror` / `onend`, plus `lang`,
// `interimResults`, `continuous`). Tout ce qui décide reste écrit UNE seule
// fois, à l'endroit où il l'était déjà : seul le fournisseur du texte change.
//
// ── LE SON ─────────────────────────────────────────────────────────────────
// Ce module ne capture RIEN : il demande le robinet d'écoute au micro EXISTANT
// (`vocal-mic.js`, `setAudioTap`), qui lui rend les échantillons de l'unique
// flux déjà capté pour mesurer le niveau. Il les convertit au format du moteur
// (PCM 16 bits mono 16 kHz) et les envoie par morceaux de 100 ms.
//
// ── LES PANNES SONT DITES, JAMAIS AVALÉES ──────────────────────────────────
// Toute panne (moteur non compilé, modèle absent, session refusée, robinet
// impossible, morceau refusé) produit un `onerror` marqué `local: true` et
// porteur d'une phrase française : l'écran la lit (`localEarFailureMessage`) et
// l'affiche. Aucun retour silencieux : c'est `super-agent.js` qui décide de la
// suite, à la vue de cette phrase, et il le dit aussi.

import {
  LOCAL_EAR_CHUNK_BYTES,
  downsamplePcm,
  localEarText,
  pcm16Bytes,
  splitPcmChunks,
} from "./oreille-locale.js";

/** L'unique évènement écouté (nom fixé par le pont du moteur intégré). */
export const INTEGRATED_EAR_EVENT = "asr-whisper-transcript";

/**
 * Les commandes du moteur intégré, écrites UNE fois : elles sont employées par
 * ce module et vérifiées par les tests (aucune ne doit être recopiée ailleurs).
 */
export const INTEGRATED_EAR_COMMANDS = Object.freeze({
  start: "asr_whisper_start",
  send: "asr_whisper_send",
  stop: "asr_whisper_stop",
  cancel: "asr_whisper_cancel",
});

/**
 * Nombre maximal d'envois en vol : le robinet ne doit jamais bloquer la boucle
 * audio. Au-delà, un morceau est abandonné plutôt que de faire grossir une file
 * qui rendrait le texte en retard.
 */
export const INTEGRATED_EAR_MAX_INFLIGHT = 32;

/**
 * Événement synthétique, de la forme EXACTE attendue par la dictée existante
 * (`e.results[i].isFinal`, `e.results[i][0].transcript`). Le moteur rend un
 * texte COMPLET pour la dictée : un seul résultat, finalisé.
 * @param {string} texte texte reconnu depuis le début de la dictée
 * @returns {{results: Array<{isFinal: boolean, 0: {transcript: string}}>}}
 */
export function integratedEarResultEvent(texte) {
  const t = typeof texte === "string" ? texte : "";
  const resultat = [{ transcript: t }];
  resultat.isFinal = true;
  return { results: [resultat] };
}

/**
 * Crée une session de dictée sur le moteur intégré, de la forme d'une session de
 * reconnaissance du navigateur.
 *
 * @param {{
 *   invoke?: Function, listen?: Function,
 *   mic?: object|null,
 *   onModel?: Function
 * }} options
 * @returns {object} session (`start`, `stop`, `onresult`, `onerror`, `onend`)
 */
export function createIntegratedEar(options = {}) {
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
    // Marque lisible par l'appelant : c'est le moteur INTÉGRÉ (pas le service).
    integratedEar: true,
    start: () => demarrer(),
    stop: () => arreter(),
  };

  function emettreResultat() {
    const texte = localEarText({ finalise, provisoire });
    if (!texte) return;
    if (typeof rec.onresult !== "function") return;
    try {
      rec.onresult(integratedEarResultEvent(texte));
    } catch (_) {
      /* un écran qui échoue ne doit pas arrêter la session */
    }
  }

  /**
   * LA SEULE façon d'ABANDONNER une session auprès du moteur : la prévenir
   * (`asr_whisper_cancel`) pour qu'elle ne reste pas ouverte derrière nous.
   * Ne lève jamais : abandonner une session déjà finie n'est pas une erreur.
   *
   * @param {string} id session à abandonner
   * @returns {Promise<void>}
   */
  async function abandonnerSession(id) {
    const cible = typeof id === "string" ? id : "";
    if (!cible || !invoke) return;
    try {
      await invoke(INTEGRATED_EAR_COMMANDS.cancel, { sessionId: cible });
    } catch (_) {
      /* une session déjà refermée n'a rien à interrompre */
    }
  }

  /**
   * Une panne : le TEXTE DÉJÀ OBTENU est remis à l'écran, la session est
   * ABANDONNÉE auprès du moteur (jamais laissée ouverte), la panne est DITE, et
   * la fin d'écoute suit — exactement comme une erreur du moteur du navigateur.
   */
  function panner(message) {
    if (termine) return;
    termine = true;
    fermerRobinet();
    emettreResultat();
    const abandonnee = sessionId;
    sessionId = "";
    void abandonnerSession(abandonnee);
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
        /* la fin d'écoute ne doit jamais lever */
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

  /** Un morceau part au moteur. Jamais attendu par la boucle audio. */
  function envoyer(morceau) {
    if (!invoke || !sessionId) return null;
    if (enVol >= INTEGRATED_EAR_MAX_INFLIGHT) return null;
    enVol += 1;
    let promesse = null;
    try {
      promesse = invoke(INTEGRATED_EAR_COMMANDS.send, {
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
        // Le moteur refuse un morceau : la session ne prend plus de son. C'est
        // une panne dite, jamais un silence (l'écran affichera la phrase).
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

  /** Un évènement du moteur. Aucun autre texte n'entre dans la zone. */
  function surEvenement(payload) {
    const p = payload && typeof payload === "object" ? payload : null;
    if (!p || termine) return;
    // UNE SESSION N'ÉCOUTE QUE SA PROPRE SESSION (canal global : une session
    // périmée ne doit pas refermer l'écran de la session vivante).
    const origine = typeof p.session_id === "string" ? p.session_id : "";
    if (origine && sessionId && origine !== sessionId) return;
    const kind = typeof p.kind === "string" ? p.kind : "";
    if (kind === "partial") {
      provisoire = typeof p.text === "string" ? p.text : "";
      emettreResultat();
      return;
    }
    if (kind === "final") {
      const texte = typeof p.text === "string" ? p.text.trim() : "";
      if (texte) {
        finalise = [finalise.trim(), texte].filter((t) => t !== "").join(" ");
        provisoire = "";
        emettreResultat();
      }
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
      panner("la fenêtre ne peut pas joindre le moteur de dictée intégré");
      return;
    }
    if (!mic) {
      panner("le micro du mode Vocal n'est pas disponible pour le moteur de dictée intégré");
      return;
    }
    if (robinetOuvert) {
      panner("la dictée intégrée est déjà ouverte");
      return;
    }
    let session = null;
    try {
      // Le MODÈLE n'est jamais choisi ici : le moteur impose le sien.
      session = await invoke(INTEGRATED_EAR_COMMANDS.start, {});
    } catch (erreur) {
      panner(erreur && erreur.message ? erreur.message : erreur);
      return;
    }
    if (arrete) {
      // Arrêtée pendant l'ouverture : rien n'est gardé, rien n'est laissé ouvert.
      await abandonnerSession(session && session.session_id ? session.session_id : "");
      return;
    }
    sessionId = session && session.session_id ? session.session_id : "";
    tauxCible = session && Number(session.sample_rate) > 0 ? Number(session.sample_rate) : 0;
    if (!sessionId || !tauxCible) {
      panner("le moteur de dictée intégré n'a pas ouvert de session");
      return;
    }
    // Le modèle RÉELLEMENT employé, pour la phrase de l'écran.
    try {
      surModele({
        modelId: typeof session.model_id === "string" ? session.model_id : "",
        modelLabel: typeof session.model_label === "string" ? session.model_label : "",
      });
    } catch (_) {
      /* la phrase de modèle ne fait pas échouer la dictée */
    }
    try {
      unlisten = await listen(INTEGRATED_EAR_EVENT, (evenement) => {
        surEvenement(evenement && evenement.payload);
      });
    } catch (_) {
      unlisten = null;
    }
    if (typeof unlisten !== "function") {
      // Sans écoute, le texte ne reviendrait JAMAIS : mieux vaut le dire et ne
      // rien ouvrir que de laisser croire à une dictée qui ne rendra rien.
      await abandonnerSession(sessionId);
      sessionId = "";
      panner("la fenêtre ne peut pas écouter le moteur de dictée intégré");
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
      panner("le son du micro n'a pas pu être dirigé vers le moteur de dictée intégré");
    }
  }

  /**
   * Arrêt DEMANDÉ (envoi sur silence, bouton 🎙️, sortie du mode) : le robinet
   * est refermé, le moteur est prévenu — il transcrit alors le son reçu et rend
   * le texte par l'évènement `final`, puis la fin d'écoute par `ended`.
   */
  async function arreter() {
    if (arrete) return;
    arrete = true;
    fermerRobinet();
    if (!sessionId || termine) return;
    // Le reste du tampon part AVANT la fin du flux, et on attend qu'il soit
    // arrivé : sans cette attente, les derniers mots seraient perdus.
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
      await invoke(INTEGRATED_EAR_COMMANDS.stop, { sessionId });
    } catch (erreur) {
      panner(erreur && erreur.message ? erreur.message : erreur);
    }
  }

  return rec;
}
