// session-dictee.js — UNE SEULE OREILLE À LA FOIS, ET UNE SEULE PORTE DE FIN.
//
// Défaut corrigé (rapport `docs/rapports/RAPPORT-diagnostic-coupure-dictee-locale.md`,
// § 0 et § 4) : la dictée locale « marchait un moment, puis coupait ». La cause
// n'était ni le service de voix, ni le pont : elle était dans la fenêtre.
//
//   1. une fin d'écoute appartenant à une session PÉRIMÉE remettait la fenêtre
//      « au repos » (`voiceActive = false`), alors que la session locale, elle,
//      était TOUJOURS ouverte au pont ;
//   2. le réarmement (350-400 ms) appelait donc `startVoiceInput`, qui
//      fabriquait une **oreille neuve, donc une session neuve au pont**, sans
//      jamais fermer la précédente ;
//   3. le pont appliquait sa règle (« une seule dictée à la fois : la précédente
//      est refermée », `asr_voicestudio.rs`) : il refermait la première et son
//      texte déjà reconnu n'arrivait plus ;
//   4. trois fins vides instantanées atteignaient le plafond, qui affiche
//      « La dictée n'a pas fonctionné : écrivez votre demande. ».
//
// Ce module porte les DEUX décisions qui manquaient, pures et sans DOM :
//   - l'IDENTITÉ d'une session de dictée (un jeton monotone, jamais réutilisé) :
//     une fin, une erreur ou un résultat d'une session REMPLACÉE ne touchent
//     plus l'état de la fenêtre ;
//   - l'ORDRE d'ouverture : la session précédente est CLOSE par son propre
//     chemin d'arrêt AVANT que la nouvelle existe (jamais laissée ouverte pour
//     que le pont la referme lui-même en jetant son texte).
//
// Aucune I/O, aucun import Tauri, aucune horloge : tout est décidable en test.

// ── Ce que rend une ouverture ───────────────────────────────────────────────
/** Ouverture normale : aucune session précédente à fermer. */
export const DICTATION_OPENED = "ouverte";
/** Une dictée est déjà ouverte : rien n'est rouvert (idempotence). */
export const DICTATION_ALREADY_OPEN = "deja-ouverte";
/** Ouverture qui a dû CLORE la session précédente d'abord. */
export const DICTATION_REPLACED = "remplacee";
/** Appel sans registre : aucune session n'est ouverte (jamais d'exception). */
export const DICTATION_NO_REGISTRY = "sans-registre";

/**
 * LE REGISTRE DES SESSIONS DE DICTÉE : il ne connaît qu'un fait, l'identité de
 * la session qui tient la dictée MAINTENANT.
 *
 * Le jeton est MONOTONE et jamais réutilisé : une session révolue ne peut donc
 * pas redevenir « courante » par hasard, même après des milliers de dictées.
 *
 * @returns {{
 *   ouvrir: () => number,
 *   courante: () => number,
 *   derniereFermee: () => number,
 *   total: () => number,
 * }} registre (fermé : aucun autre accès, aucun état exporté)
 */
export function createDictationSessionRegistry() {
  let ouvertes = 0;
  let courante = 0;
  let fermee = 0;
  return {
    /** Ouvre une session et rend son jeton (jamais 0, jamais réutilisé). */
    ouvrir() {
      if (courante > 0) fermee = courante;
      ouvertes += 1;
      courante = ouvertes;
      return courante;
    },
    /** Le jeton de la session qui tient la dictée (`0` = aucune). */
    courante() {
      return courante;
    },
    /**
     * La session que la dernière ouverture a REMPLACÉE (`0` = aucune).
     *
     * Elle n'est plus « courante » — elle ne touche donc plus à l'ÉTAT — mais
     * c'est la seule dont le texte est encore reçu : son arrêt est asynchrone,
     * et le texte déjà reconnu qu'elle rend ne doit pas être jeté (c'était le
     * défaut : le pont refermait la session et son texte disparaissait).
     */
    derniereFermee() {
      return fermee;
    },
    /** Combien de sessions ont été ouvertes depuis le début (diagnostic). */
    total() {
      return ouvertes;
    },
  };
}

/**
 * CETTE SESSION EST-ELLE CELLE QUI TIENT LA DICTÉE ?
 *
 * C'est la garde qui manquait : une fin, une erreur ou un résultat qui porte un
 * AUTRE jeton vient d'une session révolue (remplacée, arrêtée, abandonnée) et ne
 * doit RIEN changer à l'état de la fenêtre — sinon elle remet la dictée « au
 * repos » alors qu'une session est encore ouverte au pont, et le réarmement
 * suivant en ouvre une troisième.
 *
 * Un registre absent ou illisible rend `false` : dans le doute, on ne touche à
 * rien (aucune exception ne remonte d'une fin d'écoute).
 *
 * @param {object} registre registre rendu par `createDictationSessionRegistry`
 * @param {number} jeton jeton porté par l'évènement
 * @returns {boolean}
 */
export function dictationSessionStillCurrent(registre, jeton) {
  if (!registre || typeof registre.courante !== "function") return false;
  const attendu = Number(jeton);
  if (!Number.isFinite(attendu) || attendu <= 0) return false;
  return registre.courante() === attendu;
}

/**
 * LE TEXTE DE CETTE SESSION EST-IL ENCORE REÇU ?
 *
 * Même règle que ci-dessus, avec UNE seule exception, et c'est elle qui empêche
 * de jeter des mots déjà reconnus : la session que la dernière ouverture vient
 * de REMPLACER rend son texte final de façon ASYNCHRONE (son arrêt est une
 * promesse). Ce texte appartient à la dictée, il a déjà été prononcé, et le
 * refuser reviendrait à l'effacer — c'est exactement ce que faisait le pont
 * (« session précédente refermée »).
 *
 * Une seule session bénéficie de cette réception : celle qu'on vient de fermer,
 * jamais une session plus ancienne (aucune chaîne, donc aucun texte périmé qui
 * pourrait écraser la dictée en cours). Et rien d'autre n'est reçu d'elle : ni
 * fin d'écoute, ni erreur — l'ÉTAT reste protégé par
 * `dictationSessionStillCurrent`.
 *
 * @param {object} registre registre rendu par `createDictationSessionRegistry`
 * @param {number} jeton jeton de la session qui a produit le texte
 * @returns {boolean}
 */
export function dictationTextStillAccepted(registre, jeton) {
  if (dictationSessionStillCurrent(registre, jeton)) return true;
  if (!registre || typeof registre.derniereFermee !== "function") return false;
  const attendu = Number(jeton);
  if (!Number.isFinite(attendu) || attendu <= 0) return false;
  const derniere = Number(registre.derniereFermee());
  return Number.isFinite(derniere) && derniere > 0 && derniere === attendu;
}

/**
 * OUVRE la session de dictée de ce démarrage — et CLOSE la précédente AVANT.
 *
 * L'ordre est la règle, et c'est tout le correctif : `stopPrevious` est appelé
 * alors que le registre nomme encore l'ancienne session. Son arrêt passe donc
 * par le chemin d'arrêt EXISTANT (`rec.stop()`), et ce qu'il a déjà reconnu
 * arrive encore à un écran qui l'accepte. Ouvrir d'abord aurait rendu la
 * précédente « périmée » : son texte aurait été refusé, et le pont l'aurait
 * refermée lui-même (c'est le défaut observé : « session précédente refermée »
 * dans le journal du pont).
 *
 * Rien n'est ouvert si une dictée est déjà ouverte (`active === true`).
 *
 * @param {object} registre registre de `createDictationSessionRegistry`
 * @param {{
 *   active?: boolean,
 *   previous?: object|null,
 *   stopPrevious?: (previous: object) => boolean,
 * }} options
 * @returns {{
 *   ouverte: boolean,
 *   jeton: number,
 *   precedenteFermee: boolean,
 *   raison: string,
 * }} décision (le jeton est celui de la session qui tient la dictée en sortie)
 */
export function startDictationSession(registre, options) {
  const o = options && typeof options === "object" ? options : {};
  if (!registre || typeof registre.ouvrir !== "function") {
    return {
      ouverte: false,
      jeton: 0,
      precedenteFermee: false,
      raison: DICTATION_NO_REGISTRY,
    };
  }
  if (o.active === true) {
    // Une dictée est déjà ouverte : on ne rouvre rien (idempotence).
    return {
      ouverte: false,
      jeton: registre.courante(),
      precedenteFermee: false,
      raison: DICTATION_ALREADY_OPEN,
    };
  }
  const precedente = o.previous || null;
  let precedenteFermee = false;
  if (precedente && typeof o.stopPrevious === "function") {
    // AVANT l'ouverture : le jeton n'a pas encore bougé.
    try {
      precedenteFermee = o.stopPrevious(precedente) !== false;
    } catch (_) {
      // Un moteur déjà arrêté n'empêche pas la nouvelle dictée de s'ouvrir.
      precedenteFermee = false;
    }
  }
  const jeton = registre.ouvrir();
  return {
    ouverte: true,
    jeton,
    precedenteFermee,
    raison: precedenteFermee ? DICTATION_REPLACED : DICTATION_OPENED,
  };
}

/**
 * LA LIGNE DE JOURNAL d'une fin d'écoute (demande du rapport, § 5 point 1) :
 * raison, jeton, durée mesurée et LONGUEUR du texte reconnu — jamais le texte
 * lui-même. Elle est écrite dans le journal du pont (`asr_voicestudio_log`,
 * commande existante), qui ne disait jusqu'ici ni la raison d'une fin, ni
 * l'identité de la session.
 *
 * Une fin PÉRIMÉE est dite comme telle : c'est précisément ce qui manquait pour
 * prouver, dans le journal, la chaîne décrite par le diagnostic.
 *
 * @param {{
 *   raison?: string,
 *   jeton?: number,
 *   perimee?: boolean,
 *   dureeMs?: number,
 *   longueurTexte?: number,
 * }} fin
 * @returns {string} une ligne, toujours non vide
 */
export function dictationEndLogLine(fin) {
  const f = fin && typeof fin === "object" ? fin : {};
  const raison = typeof f.raison === "string" && f.raison.trim() !== "" ? f.raison.trim() : "inconnue";
  const jeton = Number(f.jeton);
  const duree = Number(f.dureeMs);
  const longueur = Number(f.longueurTexte);
  const morceaux = [
    "fin d'écoute",
    "raison=" + raison,
    "jeton=" + (Number.isFinite(jeton) && jeton > 0 ? Math.round(jeton) : 0),
  ];
  morceaux.push("session=" + (f.perimee === true ? "perimee" : "courante"));
  morceaux.push("duree_ms=" + (Number.isFinite(duree) && duree >= 0 ? Math.round(duree) : 0));
  morceaux.push("texte_caracteres=" + (Number.isFinite(longueur) && longueur > 0 ? Math.round(longueur) : 0));
  return "🎙️ " + morceaux.join(" ");
}
