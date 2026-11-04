// oreille-locale.js — L'OREILLE LOCALE, ÉTAPE 2 : LES DÉCISIONS DE L'ÉCRAN
//
// But de l'étape 2 : la dictée du mode Vocal peut être transcrite **sur cet
// ordinateur** par le logiciel de voix local (le pont machine de l'étape 1,
// `src-tauri/src/asr_voicestudio.rs`), au lieu du moteur du navigateur qui
// envoie la voix à un service en ligne.
//
// CE MODULE NE CONTIENT QUE DES DÉCISIONS PURES. Aucun DOM, aucun import Tauri,
// aucun appel réseau, aucune API audio, aucun minuteur : il se teste seul. Il ne
// connaît NI l'adresse du service, NI ses chemins, NI la façon de l'appeler — la
// fenêtre ne joint jamais le service de voix directement (règle tenue par
// `oreille-locale-etape1.test.js`), elle ne parle qu'aux commandes de l'étape 1.
// L'application des décisions vit à UN SEUL endroit (`src/js/super-agent.js`).
//
// ── LES CINQ RÈGLES DE CETTE ÉTAPE, DANS L'ORDRE (c'est la spécification) ───
//   1. **Un seul réglage, une seule clé** : `local_dictation` (`true` =
//      transcrire avec le service local). Absent ou `false` ⇒ le comportement
//      historique est inchangé, à la lettre : même moteur du navigateur, même
//      langue, même envoi automatique en fin de dictée.
//   2. **Le micro ne bouge pas** : ce module ne capture rien. Il ne fait que
//      décider *qui consomme* un son déjà capté par `vocal-mic.js`.
//   3. **Le modèle est choisi par le pont, jamais par l'écran** : l'écran ne
//      nomme aucun modèle, n'en préfère aucun, n'en télécharge aucun. Il LIT ce
//      que le service a répondu (`status.model_label`) et le DIT en une phrase.
//      Si l'utilisateur installe ou autorise un meilleur modèle plus tard, la
//      même phrase annoncera le nouveau modèle : aucun changement de code.
//   4. **Le repli est VISIBLE, jamais silencieux** : service absent, muet, sans
//      modèle français, dictée non prête, panne en cours d'écoute — chaque cas a
//      SA phrase, qui dit aussi que la voix repart vers le moteur du navigateur
//      (donc vers un service en ligne). Basculer sans le dire est interdit, et
//      c'est ce que verrouille `oreille-locale-etape2.test.js`.
//   5. **La ligne d'état dit la vérité** : « J'écoute avec le service local »
//      quand il sert, « Le service local est absent : je dicte autrement »
//      quand il ne sert pas. Aucun nouvel élément d'interface : cette phrase
//      prend place dans la ligne d'état EXISTANTE du mode Vocal, et la phrase
//      du modèle dans la note EXISTANTE de la case à cocher.

// La phrase du NOM appartient à la garde du nom (étape précédente, verrouillée
// par ses propres tests) : elle est IMPORTÉE, jamais recopiée, et le nom lui est
// passé par l'écran (aucune seconde règle de nom ici).
import { vocalNameSentence } from "./vocal-nom-garde.js";

/** La clé unique du réglage (côté Rust : `AppConfig.local_dictation`). */
export const LOCAL_DICTATION_KEY = "local_dictation";

/**
 * Taille d'un morceau de son envoyé au pont : 100 ms à 16 kHz mono 16 bits
 * (le pont plafonne à ~0,5 s par morceau ; 100 ms donne du texte plus tôt).
 */
export const LOCAL_EAR_CHUNK_BYTES = 3200;

/**
 * Le réglage demande-t-il la transcription locale ? Seul `true` l'active : une
 * valeur absente, nulle, ou écrite en texte dans le fichier de configuration ne
 * change rien au comportement historique.
 * @param {object|null|undefined} config configuration lue (`get_config`)
 * @returns {boolean}
 */
export function localDictationRequested(config) {
  return !!(config && config[LOCAL_DICTATION_KEY] === true);
}

/**
 * La raison, en code stable, pour laquelle l'oreille locale ne peut pas servir.
 * Un état illisible ou absent vaut « pas joignable » : on ne fait jamais
 * semblant d'avoir une oreille locale quand on n'en a pas la preuve.
 * @param {object|null|undefined} status réponse de `asr_voicestudio_status`
 * @returns {string}
 */
export function localEarReason(status) {
  if (!status || typeof status !== "object") return "service-absent";
  const raison = typeof status.reason === "string" ? status.reason.trim() : "";
  if (raison) return raison;
  return status.available === true ? "disponible" : "service-absent";
}

/**
 * LA décision : la dictée passe-t-elle par le service local, et sinon pourquoi ?
 *
 * @param {{requested?: boolean, status?: object|null}} etats
 * @returns {{use: boolean, reason: string, modelId: string, modelLabel: string,
 *            sentence: string, fallback: string}}
 */
export function planLocalEar(etats = {}) {
  const e = etats && typeof etats === "object" ? etats : {};
  if (e.requested !== true) {
    return {
      use: false,
      reason: "desactivee",
      modelId: "",
      modelLabel: "",
      sentence: "",
      fallback: "",
    };
  }
  const status = e.status && typeof e.status === "object" ? e.status : null;
  const reason = localEarReason(status);
  const available = reason === "disponible" && status && status.available === true;
  if (!available) {
    return {
      use: false,
      reason,
      modelId: "",
      modelLabel: "",
      sentence: "",
      fallback: localEarFallbackSentence(reason),
    };
  }
  return {
    use: true,
    reason: "disponible",
    modelId: typeof status.model_id === "string" ? status.model_id : "",
    modelLabel: typeof status.model_label === "string" ? status.model_label.trim() : "",
    sentence: localEarModelSentence(status),
    fallback: "",
  };
}

/**
 * Ce que l'utilisateur doit comprendre quand l'oreille locale ne peut pas servir.
 * UNE phrase par raison, en français, sans code et sans jargon — et qui dit
 * TOUJOURS la conséquence réelle : la voix repart vers le moteur du navigateur.
 * @param {string} reason code stable rendu par le pont
 * @returns {string}
 */
export function localEarFallbackSentence(reason) {
  const consequence =
    "Je dicte autrement : la voix repart vers la dictée du navigateur, " +
    "donc vers un service en ligne.";
  switch (String(reason == null ? "" : reason)) {
    case "service-absent":
      return `Le service de voix local est absent (il n'est pas lancé sur cet ordinateur). ${consequence}`;
    case "service-muet":
      return `Le service de voix local ne répond pas. ${consequence}`;
    case "aucun-modele-francais":
      return `Le service de voix local n'a aucun modèle de dictée en français. ${consequence}`;
    case "dictee-non-prete":
      return `La dictée n'est pas prête dans le service de voix local. ${consequence}`;
    default:
      return `La dictée locale n'est pas disponible sur cet ordinateur. ${consequence}`;
  }
}

/**
 * La phrase qui nomme le modèle réellement employé — et, s'il y en a un
 * meilleur qui n'est pas utilisable, ce qu'il faudrait faire pour en profiter.
 *
 * Le modèle n'est PAS choisi ici : il est lu dans la réponse du service
 * (`model_label`). Si l'utilisateur installe ou autorise mieux dans le logiciel
 * de voix, cette même phrase annoncera le nouveau modèle sans toucher au code.
 * @param {object|null|undefined} status réponse de `asr_voicestudio_status`
 * @returns {string}
 */
export function localEarModelSentence(status) {
  const s = status && typeof status === "object" ? status : null;
  const label = s && typeof s.model_label === "string" ? s.model_label.trim() : "";
  // Le PÉRIMÈTRE est dit : l'oreille locale sert la dictée de l'écran Vocal (le
  // micro de l'application y est ouvert). Ailleurs, la dictée reste celle du
  // navigateur — et l'écran le dit au lieu de le laisser croire.
  const base = label
    ? `Dans l'écran Vocal, la dictée se fait sur cet ordinateur avec « ${label} » : aucun son ne part vers Internet.`
    : "Dans l'écran Vocal, la dictée se fait sur cet ordinateur : aucun son ne part vers Internet.";
  const meilleur = bestUnavailableModel(s);
  if (!meilleur) return base;
  const nom = meilleur.label || meilleur.id || "";
  const modele = nom ? `le modèle « ${nom} »` : "un autre modèle";
  return (
    `${base} Une qualité supérieure est possible : installez ${modele} dans le logiciel de ` +
    "voix, ou acceptez sa licence — Pilot ne télécharge rien et n'accepte aucune licence " +
    "à votre place."
  );
}

/**
 * Le meilleur modèle français que le service décrit mais qui ne peut pas servir
 * maintenant (`installed === false`). Sert UNIQUEMENT à la phrase de qualité :
 * aucun choix n'est fait ici, et rien n'est décidé sur un doute.
 * @param {object|null|undefined} status
 * @returns {object|null}
 */
export function bestUnavailableModel(status) {
  const liste = status && Array.isArray(status.models) ? status.models : [];
  const candidats = liste.filter(
    (m) => m && typeof m === "object" && m.installed !== true && m.recommended === true,
  );
  return candidats.length > 0 ? candidats[0] : null;
}

/**
 * LA ligne d'état du mode Vocal (une seule ligne, celle qui existe déjà).
 *
 * Rien n'est dit quand le réglage est inactif : l'écran reste exactement celui
 * d'avant. Quand il est actif, la ligne dit laquelle des deux oreilles écoute —
 * et la phrase du NOM reste la MÊME, composée depuis la source unique
 * (`vocalNameSentence`, importée ici) : le nom n'est jamais recopié, et
 * l'appelant ne compose aucune phrase (il passe le nom, pas un texte).
 *
 * @param {{plan?: object, nom?: string, verification?: boolean}} etats
 * @returns {string} la phrase à afficher, ou "" (aucune ligne à changer)
 */
export function localEarStatusLine(etats = {}) {
  const e = etats && typeof etats === "object" ? etats : {};
  const plan = e.plan && typeof e.plan === "object" ? e.plan : null;
  if (!plan) return "";
  if (plan.reason === "desactivee") return "";
  // RÉGLAGE ACTIF, RÉPONSE DU SERVICE PAS ENCORE ARRIVÉE : on ne prétend rien.
  // L'écran dit qu'il vérifie — et l'écoute automatique attend cette réponse :
  // ouvrir l'oreille du navigateur pendant la vérification serait basculer en
  // ligne sans le dire.
  if (e.verification === true) return "Je vérifie si la dictée locale peut servir…";
  if (plan.use === true) {
    const nom = typeof e.nom === "string" ? e.nom.trim() : "";
    // La phrase du nom vient du module de la GARDE (source unique) : jamais un
    // second texte, jamais une seconde règle de nom.
    const phraseNom = nom ? vocalNameSentence(nom) : "";
    return phraseNom
      ? `J'écoute avec le service local. ${phraseNom}`
      : "J'écoute avec le service local.";
  }
  return "Le service local est absent : je dicte autrement.";
}

/**
 * La phrase d'une panne SURVENUE PENDANT l'écoute (le service s'arrête, la
 * session se ferme, le son ne part plus). Elle est dite à l'écran, une fois,
 * par le chemin de message déjà existant : ce n'est jamais un silence.
 *
 * @param {{message?: string, error?: string}|null|undefined} evenement
 * @returns {string} la phrase, ou "" si ce n'est pas une panne locale
 */
export function localEarFailureMessage(evenement) {
  const ev = evenement && typeof evenement === "object" ? evenement : null;
  if (!ev || ev.local !== true) return "";
  const detail = typeof ev.message === "string" ? ev.message.replace(/\s+/g, " ").trim() : "";
  const fin = detail ? ` (${detail})` : "";
  return (
    `Le service de voix local s'est arrêté pendant la dictée${fin}. ` +
    "Rien n'a été envoyé. Je repasse à la dictée du navigateur, donc à un service en ligne."
  );
}

/**
 * Réduction du nombre d'échantillons : le pont attend 16 kHz mono, le micro
 * donne ce que le matériel donne (48 kHz en général). Chaque échantillon de
 * sortie est la MOYENNE des échantillons d'entrée qu'il couvre (filtre
 * passe-bas élémentaire : sans lui, la parole devient sifflante).
 *
 * @param {Float32Array|number[]} samples échantillons [-1, 1]
 * @param {number} sourceRate taux du micro (Hz)
 * @param {number} targetRate taux attendu (Hz)
 * @returns {Float32Array}
 */
export function downsamplePcm(samples, sourceRate, targetRate) {
  const entree = samples && typeof samples.length === "number" ? samples : [];
  const source = Number(sourceRate) > 0 ? Number(sourceRate) : 0;
  const cible = Number(targetRate) > 0 ? Number(targetRate) : 0;
  if (!entree.length) return new Float32Array(0);
  if (!source || !cible || cible >= source) return Float32Array.from(entree);
  const pas = source / cible;
  const sortie = new Float32Array(Math.max(1, Math.floor(entree.length / pas)));
  for (let i = 0; i < sortie.length; i += 1) {
    const debut = Math.floor(i * pas);
    const fin = Math.max(debut + 1, Math.min(entree.length, Math.floor((i + 1) * pas)));
    let somme = 0;
    let n = 0;
    for (let j = debut; j < fin; j += 1) {
      const v = Number(entree[j]);
      if (Number.isFinite(v)) {
        somme += v;
        n += 1;
      }
    }
    sortie[i] = n > 0 ? somme / n : 0;
  }
  return sortie;
}

/**
 * PCM 16 bits signé, petit-boutiste : le format exact attendu par le pont.
 * Un échantillon hors bornes est ÉCARTELÉ (jamais enroulé : un enroulement
 * produirait un bruit sec, pas une saturation).
 * @param {Float32Array|number[]} samples échantillons [-1, 1]
 * @returns {Uint8Array}
 */
export function pcm16Bytes(samples) {
  const entree = samples && typeof samples.length === "number" ? samples : [];
  const octets = new Uint8Array(entree.length * 2);
  for (let i = 0; i < entree.length; i += 1) {
    let v = Number(entree[i]);
    if (!Number.isFinite(v)) v = 0;
    const borne = Math.max(-1, Math.min(1, v));
    const entier = borne < 0 ? Math.round(borne * 0x8000) : Math.round(borne * 0x7fff);
    octets[i * 2] = entier & 0xff;
    octets[i * 2 + 1] = (entier >> 8) & 0xff;
  }
  return octets;
}

/**
 * Découpe ce qui reste dans le tampon en morceaux de taille fixe, sans jamais
 * perdre d'octet : un morceau incomplet reste pour l'appel suivant (le son
 * envoyé doit être contigu, sinon le service entend des clics).
 * @param {Uint8Array} tampon octets en attente
 * @param {number} taille taille d'un morceau (octets)
 * @returns {{morceaux: Uint8Array[], reste: Uint8Array}}
 */
export function splitPcmChunks(tampon, taille = LOCAL_EAR_CHUNK_BYTES) {
  const source = tampon instanceof Uint8Array ? tampon : new Uint8Array(0);
  const bloc = Number(taille) > 0 ? Math.floor(Number(taille)) : LOCAL_EAR_CHUNK_BYTES;
  const morceaux = [];
  let debut = 0;
  while (source.length - debut >= bloc) {
    morceaux.push(source.slice(debut, debut + bloc));
    debut += bloc;
  }
  return { morceaux, reste: source.slice(debut) };
}

/**
 * Le texte à écrire dans la zone, à partir de ce que le pont a déjà rendu.
 * Les morceaux finalisés s'ajoutent, le provisoire remplace : c'est la même
 * règle que la dictée du navigateur (aucun second texte, aucune concaténation
 * qui doublerait les mots déjà figés).
 * @param {{finalise?: string, provisoire?: string}} etat
 * @returns {string}
 */
export function localEarText(etat = {}) {
  const e = etat && typeof etat === "object" ? etat : {};
  const fini = typeof e.finalise === "string" ? e.finalise : "";
  const courant = typeof e.provisoire === "string" ? e.provisoire : "";
  const joint = [fini.trim(), courant.trim()].filter((t) => t !== "").join(" ");
  return joint.replace(/\s+/g, " ").trim();
}
