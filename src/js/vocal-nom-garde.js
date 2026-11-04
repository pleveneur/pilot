// vocal-nom-garde.js — L'ÉCRAN VOCAL N'OBÉIT QU'À SON NOM
//
// Décision du propriétaire : « dans le mode vocal, l'assistante ne doit rien
// faire tant que son nom n'a pas été prononcé ». Le micro reste ouvert,
// l'écoute continue (l'écran continue de mesurer, de s'animer, de se réarmer),
// mais une phrase qui ne contient PAS le nom **ne déclenche rien** : elle n'est
// ni envoyée, ni conservée dans la zone de saisie, ni affichée, et il n'y a
// aucun message répété.
//
// CE MODULE NE CONTIENT QUE DES DÉCISIONS PURES. Aucun DOM, aucun minuteur,
// aucune API audio, aucune transcription, aucun import Tauri : il se teste seul.
// L'application des décisions vit à UN SEUL endroit (`src/js/super-agent.js` :
// `rec.onresult`, `rec.onend` et `vocalStatusLine`) — aucun second envoi, aucun
// second moteur n'est créé ici.
//
// ── LES SIX RÈGLES, DANS L'ORDRE (c'est la spécification) ───────────────────
//   1. **Hors de l'écran Vocal** (`modeOuvert !== true`) : rien ne change. Le
//      chat de l'agent π, la barre de l'onglet 🧭 hors mode et le web distant ne
//      passent pas par cette garde — leur comportement est celui d'avant.
//   2. **Aucun texte** : il n'y a rien à garder ni à jeter (`sans-texte`).
//   3. **Reprise en main** (l'utilisateur a tapé pendant l'écoute) : sa saisie
//      prime et le texte dicté n'est pas utilisé (`reprise-main`). C'est la même
//      règle qu'avant : la saisie **clavier** n'est jamais filtrée par un nom.
//   4. **Réveillé pour une phrase** (le bouton « Réveiller <Nom> » existant, ou
//      n'importe quel geste 🎙️) : la phrase suivante part **sans** exiger le
//      nom (`reveil`). Le réveil est CONSOMMÉ (`consommeReveil`) : il vaut pour
//      une phrase, jamais pour la session entière — l'écran se réarme tout seul
//      après chaque réponse, et c'est le nom qui rouvre l'envoi.
//   5. Le nom est-il **entendu** ? Oui ⇒ `nom-entendu` (la phrase part par le
//      chemin d'envoi existant).
//   6. Un **mot de réveil** réglé est-il entendu ? Oui ⇒ `mot-reveil` (même
//      chemin d'envoi). Non ⇒ `nom-absent` ⇒ la phrase est **jetée**.
// Un nom **inutilisable** (vide, ou entièrement composé de caractères que la
// comparaison ne sait pas lire) fait **laisser passer** (`nom-inutilisable`) :
// une garde qui ne sait pas reconnaître son nom ne doit pas murer l'écran. Cette
// règle ne vaut que si **aucun mot de réveil utilisable** n'est réglé : un mot de
// réveil lisible suffit à fonder le refus.
//
// ── LES MOTS DE RÉVEIL (réglage unique, `vocal_wake_words`) ─────────────────
// Décision du propriétaire : à côté de son nom, l'écran Vocal obéit à des MOTS
// DE RÉVEIL libres (« Nova, hey Nova »). Le réglage est UN champ texte, UNE clé,
// de défaut **vide** : tant qu'il est vide, le comportement est **exactement**
// celui d'avant (le nom seul). Rempli, une phrase est acceptée dès qu'elle
// contient **au moins un** des mots saisis, avec la **même** tolérance que le
// nom (`mentionsAssistantName`, donc casse/accents/ponctuation et les seules
// variantes évidentes de prononciation). Le **nom de l'assistante reste
// toujours accepté en plus** : le réglage s'ajoute, il ne remplace pas. Un mot
// de réveil inutilisable (vide, ou fait uniquement de ponctuation) est ignoré.
//
// ── LA COMPARAISON, ET POURQUOI ELLE EST ÉTROITE ────────────────────────────
// Tolérante sur ce que la reconnaissance vocale ne restitue jamais à
// l'identique : **casse**, **accents** (NFC/NFD), **ponctuation**, espaces
// multiples. Puis, et seulement en second recours, un **très petit** nombre de
// variantes de prononciation ÉVIDENTES (`phoneticKey`) :
//   - `ph` → `f` (« Sophie » / « Sofie »),
//   - `qu` → `k`, `y` → `i` (« Yann » / « Iann »),
//   - consonne finale muette du français (`t d s x p z`) : « Bernard » /
//     « Bernar ».
// Rien d'autre : **aucune** distance d'édition, **aucun** dictionnaire de
// prénoms, **aucune** approximation supplémentaire, et surtout **pas** de
// réduction des lettres doublées : elle faisait basculer des mots français
// ordinaires sur un prénom (« bonne année » sur « Anne »), c'est-à-dire un
// déclenchement sans le nom — exactement ce que cette garde doit empêcher.
// En cas de doute, l'étroit l'emporte : un nom mal transcrit ne sera donc pas
// reconnu (voir le rapport, `docs/rapports/RAPPORT-garde-du-nom-ecran-vocal.md`),
// et c'est assumé.
//
// Le nom peut se trouver **n'importe où** dans la phrase (début, milieu, fin) :
// toute la phrase est parcourue, et rien n'est exigé au début.
//
// Le nom attendu ne vient PAS d'ici : il est FOURNI par l'appelant, qui le lit à
// la SEULE source existante (`superAgentDisplayLabel()` → personnage actif, sinon
// nom réglé, sinon nom habituel). Aucune deuxième règle de nom n'est écrite ici.

/** Le nom est absent (ou l'écran ne garde pas la phrase) : la phrase est jetée. */
export const VOCAL_GATE_JETER = "jeter";
/** La phrase peut suivre le chemin normal (envoi, ou conservation par l'usager). */
export const VOCAL_GATE_LAISSER = "laisser";

/** En dessous de cette longueur, la comparaison « au son » est trop grossière. */
export const VOCAL_GATE_MIN_KEY = 3;

/** La clé de configuration des mots de réveil (additive, défaut vide). */
export const VOCAL_WAKE_WORDS_KEY = "vocal_wake_words";

/** Ce qui sépare deux mots de réveil dans le champ unique. */
export const VOCAL_WAKE_SEPARATORS = /[,;\n]+/;

const DIACRITICS = /[\u0300-\u036f]/g;

/**
 * Forme comparable d'un texte parlé : casse, accents, ponctuation et espaces
 * multiples ignorés. Les apostrophes séparent les mots (« l'assistant » →
 * « l assistant ») comme le fait déjà la reconnaissance.
 *
 * PURE. Ne lève jamais : une valeur absente donne une chaîne vide.
 * @param {unknown} texte
 * @returns {string} texte replié, séparé par des espaces simples
 */
export function foldSpoken(texte) {
  return String(texte == null ? "" : texte)
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/['`\u2019]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Forme « au son » d'UN mot : les seules variantes ÉVIDENTES de prononciation
 * (voir l'en-tête). C'est une fonction PURE et volontairement pauvre.
 * @param {string} mot mot déjà replié (`foldSpoken`)
 * @returns {string} clé comparable
 */
export function phoneticKey(mot) {
  let m = String(mot == null ? "" : mot);
  if (!m) return "";
  m = m.replace(/ph/g, "f").replace(/qu/g, "k").replace(/y/g, "i");
  // Consonne finale muette du français (`t d s x p z`), une seule fois.
  m = m.replace(/[tdsxpz]$/, "");
  return m;
}

/** Découpe un texte en mots repliés (jamais de mot vide). */
function wordsOf(texte) {
  const plie = foldSpoken(texte);
  return plie ? plie.split(" ") : [];
}

/**
 * Les mots de réveil d'une saisie libre, nettoyés et dédoublonnés.
 *
 * Une saisie = un champ texte : la virgule (ou le point-virgule, ou le saut de
 * ligne) sépare deux mots, et un mot peut contenir des espaces (« hey Nova »).
 * Les entrées vides et les doublons (même à la casse ou aux accents près) sont
 * ignorés, l'ordre saisi est conservé. PURE, ne lève jamais.
 * @param {unknown} saisie texte du réglage, ou liste de mots
 * @returns {string[]} mots de réveil utilisables (jamais vides)
 */
export function wakeWordsFrom(saisie) {
  const morceaux = Array.isArray(saisie)
    ? saisie
    : String(saisie == null ? "" : saisie).split(VOCAL_WAKE_SEPARATORS);
  const vus = new Set();
  const mots = [];
  for (const morceau of morceaux) {
    const mot = String(morceau == null ? "" : morceau).replace(/\s+/g, " ").trim();
    const cle = foldSpoken(mot);
    if (!cle || vus.has(cle)) continue;
    vus.add(cle);
    mots.push(mot);
  }
  return mots;
}

/**
 * La forme MÉMORISÉE d'une saisie de mots de réveil : les mots retenus, joints
 * par « , ». Une seule normalisation pour l'écriture et pour la relecture, donc
 * jamais deux textes pour le même réglage. PURE.
 * @param {unknown} saisie
 * @returns {string}
 */
export function wakeWordsText(saisie) {
  return wakeWordsFrom(saisie).join(", ");
}

/**
 * Un des mots de réveil est-il prononcé **quelque part** dans la phrase ?
 *
 * La comparaison est CELLE DU NOM (`mentionsAssistantName`) : même tolérance
 * (casse, accents, ponctuation, variantes évidentes, mot coupé en deux) et même
 * étroitesse. PURE, ne lève jamais.
 * @param {unknown} phrase texte transcrit (ou saisi) à examiner
 * @param {unknown} motsDeReveil texte du réglage, ou liste de mots
 * @returns {boolean} vrai si au moins un mot de réveil est entendu
 */
export function mentionsWakeWord(phrase, motsDeReveil) {
  const mots = wakeWordsFrom(motsDeReveil);
  if (mots.length === 0) return false;
  const texte = String(phrase == null ? "" : phrase);
  for (const mot of mots) {
    if (mentionsAssistantName(texte, mot)) return true;
  }
  return false;
}

/** Clés « au son » d'une liste de mots, dans l'ordre. */
function keysOf(words) {
  return words.map((mot) => phoneticKey(mot));
}

/**
 * Le nom est-il prononcé **quelque part** dans la phrase ?
 *
 * Deux niveaux, et l'étroit d'abord :
 *   1. **exact** : la suite de mots repliés du nom apparaît telle quelle
 *      (« nova », « marie claire ») ;
 *   2. **au son** : la même suite, comparée par `phoneticKey`, et seulement si
 *      la clé fait au moins `VOCAL_GATE_MIN_KEY` caractères. Le nom peut y être
 *      coupé en plusieurs mots par la reconnaissance (« no va » pour « Nova »).
 *
 * PURE. Ne lève jamais.
 * @param {unknown} phrase texte transcrit (ou saisi) à examiner
 * @param {unknown} nom nom attendu, tel qu'il doit être dit
 * @returns {boolean} vrai si le nom est entendu
 */
export function mentionsAssistantName(phrase, nom) {
  const nomMots = wordsOf(nom);
  const mots = wordsOf(phrase);
  if (nomMots.length === 0 || mots.length === 0) return false;

  // 1. Exactement, mots pour mots, n'importe où dans la phrase.
  const cible = nomMots.join(" ");
  for (let i = 0; i + nomMots.length <= mots.length; i++) {
    if (mots.slice(i, i + nomMots.length).join(" ") === cible) return true;
  }

  // 2. Au son, sur une fenêtre un peu plus large (le nom peut être coupé en
  //    deux par la reconnaissance) : jamais plus de deux mots en plus.
  const nomCle = keysOf(nomMots).join("");
  if (nomCle.length < VOCAL_GATE_MIN_KEY) return false;
  const cles = keysOf(mots);
  const fenetre = nomMots.length + 2;
  for (let i = 0; i < cles.length; i++) {
    let acc = "";
    for (let j = i; j < cles.length && j - i < fenetre; j++) {
      acc += cles[j];
      if (acc.length > nomCle.length) break;
      if (acc === nomCle && acc.length >= VOCAL_GATE_MIN_KEY) return true;
    }
  }
  return false;
}

/**
 * LA DÉCISION : que fait-on de cette phrase ?
 *
 * L'ORDRE des règles est la spécification (voir l'en-tête) : il se teste tel
 * quel. Aucune règle ne consulte le micro, la transcription ni le réseau.
 * @param {{modeOuvert?: boolean, texte?: string, nom?: string, motsDeReveil?: string|string[], repriseMain?: boolean, reveil?: boolean}} [etats]
 * @returns {{action: string, raison: string, consommeReveil: boolean}}
 *   `action` : `VOCAL_GATE_LAISSER` ou `VOCAL_GATE_JETER` ;
 *   `raison` : `hors-mode`, `sans-texte`, `reprise-main`, `reveil`,
 *   `nom-entendu`, `mot-reveil`, `nom-inutilisable`, `nom-absent`.
 */
export function decideVocalNameGate(etats) {
  const e = etats || {};
  const texte = String(e.texte == null ? "" : e.texte).trim();
  const nom = String(e.nom == null ? "" : e.nom).trim();
  // Mot de réveil (réglage unique) : lu UNE fois, jamais recopié ailleurs.
  const reveils = wakeWordsFrom(e.motsDeReveil);
  const laisser = (raison, consommeReveil) => ({
    action: VOCAL_GATE_LAISSER,
    raison,
    consommeReveil: consommeReveil === true,
  });

  // 1. Hors de l'écran Vocal : le comportement d'avant, intact.
  if (e.modeOuvert !== true) return laisser("hors-mode");
  // 2. Rien à garder, rien à jeter.
  if (!texte) return laisser("sans-texte");
  // 3. La saisie clavier prime : le texte dicté n'est de toute façon pas envoyé.
  if (e.repriseMain === true) return laisser("reprise-main");
  // 4. Réveillé (bouton « Réveiller », geste 🎙️) : une phrase, pas une session.
  if (e.reveil === true) return laisser("reveil", true);
  // 5. Le nom de l'assistante est TOUJOURS accepté : le réglage des mots de
  //    réveil s'ajoute à lui, il ne le remplace jamais.
  if (mentionsAssistantName(texte, nom)) return laisser("nom-entendu");
  // 6. Un mot de réveil réglé, n'importe où dans la phrase — un seul suffit.
  if (mentionsWakeWord(texte, reveils)) return laisser("mot-reveil");
  // 7. Un nom qu'on ne sait pas lire ne peut pas fonder un refus — mais
  //    seulement s'il n'y a AUCUN mot de réveil utilisable pour le faire.
  if (wordsOf(nom).length === 0 && reveils.length === 0) return laisser("nom-inutilisable");
  return { action: VOCAL_GATE_JETER, raison: "nom-absent", consommeReveil: false };
}

/**
 * LA PHRASE de la ligne d'état quand la garde est ARMÉE : elle dit lequel des
 * deux états est actif, en une phrase simple, sur la ligne qui existe déjà —
 * aucun nouvel élément d'interface, aucun réglage.
 *
 * L'autre état (réveillé pour une phrase) est dit par la phrase EXISTANTE du
 * repos (« Je vous écoute. »), qui n'est pas recopiée ici.
 * @param {unknown} nom nom attendu, tel qu'il doit être dit
 * @returns {string} `Dites « Nova » pour me parler.`
 */
export function vocalNameSentence(nom) {
  const affiche = String(nom == null ? "" : nom).replace(/\s+/g, " ").trim();
  if (!affiche) return "Dites mon nom pour me parler.";
  return `Dites « ${affiche} » pour me parler.`;
}

/**
 * La garde du nom est-elle ARMÉE (l'écran n'acceptera rien sans le nom) ?
 *
 * Sert au CHEMIN DES RÉSULTATS INTERMÉDIAIRES : tant que le nom n'est pas
 * entendu, rien ne s'écrit dans la zone et aucun mot ne repousse l'échéance du
 * silence (donc rien ne part). La décision, elle, reste celle de
 * `decideVocalNameGate` : cette fonction ne fait que la résumer.
 * Un MOT DE RÉVEIL utilisable garde la garde armée même quand le nom est
 * illisible : c'est lui qui fonde le refus, et sans lui la règle du fail-open
 * laisserait tout passer (comportement d'avant, intact).
 * @param {{modeOuvert?: boolean, nom?: string, motsDeReveil?: string|string[], reveil?: boolean}} [etats]
 * @returns {boolean}
 */
export function vocalNameGateArmed(etats) {
  const e = etats || {};
  if (e.modeOuvert !== true) return false;
  if (e.reveil === true) return false;
  if (wordsOf(e.nom).length > 0) return true;
  return wakeWordsFrom(e.motsDeReveil).length > 0;
}
