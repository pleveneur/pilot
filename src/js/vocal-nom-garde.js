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
// ── LES SEPT RÈGLES, DANS L'ORDRE (c'est la spécification) ─────────────────
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
//   5. **L'écoute est LIBRE** (`ecouteLibre === true`) : le compte à rebours de
//      silence (`VOCAL_ECOUTE_LIBRE_MS`, 20 s) n'est pas arrivé à son terme, la
//      garde n'est donc **pas armée** et la phrase passe **sans nom**
//      (`ecoute-libre`). C'est le cas NORMAL, celui de tous les jours (voir la
//      « VEILLE » ci-dessous).
//   6. La garde est ARMÉE : le nom est-il **entendu** ? Oui ⇒ `nom-entendu` (la
//      phrase part par le chemin d'envoi existant).
//   7. Un **mot de réveil** réglé est-il entendu ? Oui ⇒ `mot-reveil` (même
//      chemin d'envoi). Non ⇒ `nom-absent` ⇒ la phrase est **jetée**.
// Un nom **inutilisable** (vide, ou entièrement composé de caractères que la
// comparaison ne sait pas lire) fait **laisser passer** (`nom-inutilisable`) :
// une garde qui ne sait pas reconnaître son nom ne doit pas murer l'écran. Cette
// règle ne vaut que si **aucun mot de réveil utilisable** n'est réglé : un mot de
// réveil lisible suffit à fonder le refus.
//
// ── LES MOTS DE RÉVEIL (réglage unique, `vocal_wake_words`) ─────────────────
// Décision du propriétaire : à côté de son nom, l'écran Vocal obéit à des MOTS
// DE RÉVEIL libres (« hey bonjour, allô »). Le réglage est UN champ texte, UNE clé,
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
//
// ── LA VEILLE : 20 SECONDES DE SILENCE (décision du propriétaire) ──────────
// « Dès qu'on arrive en mode vocal, l'assistant écoute ce qu'on dit. Au bout
// d'un moment donné (20 s) sans parler, le wakeword se met en place. »
// Le compte à rebours vit dans une SEULE constante (`VOCAL_ECOUTE_LIBRE_MS`),
// et la décision d'armer la garde à son terme dans une SEULE fonction
// (`decideVocalVeille`). Tant que le compte n'est pas échu, `ecouteLibre` vaut
// vrai ⇒ aucune phrase n'a besoin du nom. Une fois armée, la garde est un état
// STABLE : elle ne se lève que par le nom, un mot de réveil, ou le geste de
// secours — et c'est ce même événement qui fait repartir le compte.
//
// CE QUE LA VEILLE MESURE : l'ABSENCE DE CONVERSATION, pas l'absence de parole
// du propriétaire. Deux faits que l'écran connaît déjà SUSPENDENT donc le
// compte (`vocalVeilleSuspendue`) : Pilot PARLE (`pilotParle`, il lit sa
// réponse) et Pilot TRAVAILLE (`travaille`, le tour de l'assistant est en
// cours). Pendant ces deux périodes, le compte ne tourne pas du tout ; à leur
// fin il repart de zéro (application : `vocalSyncVeilleSuspension` de
// `super-agent.js`). Sans cette règle, un tour de 120 s ou une lecture longue
// laissait le compte s'épuiser en pleine conversation : la veille s'armait au
// milieu du tour, l'écran ne l'affichait pas, et la phrase suivante du
// propriétaire était jetée sans message.
//
// ── « ARRÊTE D'ÉCOUTER » (nouveau, décision du propriétaire) ───────────────
// « Je veux aussi pouvoir dire à l'assistant d'arrêter d'écouter, donc il doit
// pouvoir lui-même se mettre en mode attente du wakeword. »
// La reconnaissance est **STRICTE** : la phrase normalisée ENTIÈRE doit être
// égale à l'une des `VOCAL_STOP_FORMULAS` (courte liste, unique). Une phrase
// ordinaire qui contient ces mots par hasard ne coupe **jamais** l'écoute : dans
// le doute, on continue d'écouter (`pas-formule`). Une fois en veille, la
// formule n'a plus d'effet (`deja-en-veille`) : rien ne se passe, aucun message.
//
// « STRICTE » ne veut pas dire « au caractère près » : la reconnaissance
// vocale française ne rend pas toujours la même graphie. La comparaison passe
// donc par une clé (`stopFormulaKey`) qui absorbe TROIS écarts de
// transcription, et trois seulement :
//   - les frontières de mots (apostrophes et espaces) : « arrête d'écouter »,
//     « arrête découter » et « arrêtedécouter » sont la même demande ;
//   - la finale du verbe (`-er`, `-ez`, `-es`) : « arrêtez d'écouter »,
//     « arrêtes d'écouter » et « arrêter d'écouter » valent « arrête
//     d'écouter » — c'est l'hésitation la plus fréquente du français ;
//   - une formule de politesse en fin de phrase (« s'il te plaît », « s'il
//     vous plaît », « stp », « svp », « merci »).
// AUCUN mot supplémentaire n'est toléré : « arrête d'écouter la radio »,
// « silence, le dossier est vide » ou « écoute, j'ai une idée » ne coupent
// rien. La tolérance ne peut donc pas transformer une phrase ordinaire en
// ordre : elle ne fait que reconnaître une même demande écrite autrement.

/** Le nom est absent (ou l'écran ne garde pas la phrase) : la phrase est jetée. */
export const VOCAL_GATE_JETER = "jeter";
/** La phrase peut suivre le chemin normal (envoi, ou conservation par l'usager). */
export const VOCAL_GATE_LAISSER = "laisser";

/** En dessous de cette longueur, la comparaison « au son » est trop grossière. */
export const VOCAL_GATE_MIN_KEY = 3;

/** La clé de configuration des mots de réveil (additive, défaut vide). */
export const VOCAL_WAKE_WORDS_KEY = "vocal_wake_words";

/**
 * LE COMPTE À REBOURS DE SILENCE avant la mise en veille : 20 secondes
 * (décision du propriétaire). **Seule valeur du dépôt** : elle est importée par
 * l'écran (`super-agent.js`) et n'est jamais recopiée ailleurs. Toute parole
 * détectée remet le compte à zéro, donc rien n'est exigé tant que l'utilisateur
 * parle régulièrement.
 */
export const VOCAL_ECOUTE_LIBRE_MS = 20000;

/**
 * LES FORMULES D'ARRÊT — **la seule liste**, courte et en français courant.
 *
 * La comparaison porte sur la phrase **normalisée ENTIÈRE** (`foldSpoken`) :
 * casse, accents, ponctuation et espaces multiples sont ignorés, mais AUCUN mot
 * supplémentaire n'est toléré. « Silence, le dossier est vide » ne coupe donc
 * rien : c'est le « dans le doute on continue d'écouter » de la décision.
 * Ajouter une formule se fait ICI, nulle part ailleurs.
 */
export const VOCAL_STOP_FORMULAS = Object.freeze([
  "arrête d'écouter",
  "arrête l'écoute",
  "arrêtez d'écouter",
  "arrêtez l'écoute",
  "arrêter d'écouter",
  "arrête d'écouter s'il te plaît",
  "arrête d'écouter s'il vous plaît",
  "stoppe l'écoute",
  "stop l'écoute",
  "cesse d'écouter",
  "n'écoute plus",
  "ne m'écoute plus",
  "ne m'écoutez plus",
  "tais-toi",
  "taisez-vous",
  "silence",
  "au repos",
  "tu peux te reposer",
  "mets-toi en veille",
  "mode veille",
]);

/** La phrase demande RÉELLEMENT l'arrêt de l'écoute. */
export const VOCAL_STOP_ARRETER = "arreter";
/** La phrase ne demande rien : on continue d'écouter (ou on l'est déjà). */
export const VOCAL_STOP_RIEN = "rien";

/**
 * Les formules d'arrêt, sous leur forme comparable — construite UNE fois, à la
 * première utilisation (elle dépend de `foldSpoken`, défini plus bas).
 */
let vocalStopKeys = null;
function vocalStopKeySet() {
  if (!vocalStopKeys) {
    vocalStopKeys = new Set(VOCAL_STOP_FORMULAS.map((formule) => stopFormulaKey(formule)));
  }
  return vocalStopKeys;
}

/**
 * Les formules de politesse qui peuvent suivre une formule d'arrêt, en fin de
 * phrase uniquement (mots déjà repliés par `foldSpoken`). Données, pas de règle
 * cachée : la liste est courte et se lit.
 */
const STOP_POLITENESS = Object.freeze([
  Object.freeze(["s", "il", "te", "plait"]),
  Object.freeze(["s", "il", "vous", "plait"]),
  Object.freeze(["stp"]),
  Object.freeze(["svp"]),
  Object.freeze(["merci"]),
  Object.freeze(["merci", "beaucoup"]),
]);

/**
 * Retire une (ou plusieurs) formule(s) de politesse en FIN de phrase. PURE.
 * Ne retire jamais le dernier mot utile : « merci » seul reste « merci ».
 * @param {string[]} mots mots repliés
 * @returns {string[]} mots sans la politesse finale
 */
function sansPolitesseFinale(mots) {
  let suite = mots.slice();
  let retire = true;
  while (retire) {
    retire = false;
    for (const formule of STOP_POLITENESS) {
      const n = formule.length;
      if (suite.length <= n) continue;
      const fin = suite.slice(suite.length - n);
      if (formule.every((mot, i) => fin[i] === mot)) {
        suite = suite.slice(0, suite.length - n);
        retire = true;
        break;
      }
    }
  }
  return suite;
}

/**
 * LA CLÉ COMPARABLE d'une formule d'arrêt entendue.
 *
 * Elle absorbe les trois écarts de transcription décrits en tête de fichier, et
 * rien d'autre : frontières de mots ignorées (concaténation sans espaces),
 * finale de verbe ramenée à `-e` (`-er`, `-ez`, `-es`), politesse finale
 * retirée. Aucun mot en plus n'est toléré : la clé d'une phrase de dix mots
 * reste longue et ne peut pas égaler une formule.
 *
 * PURE, ne lève jamais : une valeur absente donne la chaîne vide.
 * @param {unknown} texte phrase transcrite
 * @returns {string} clé comparable
 */
export function stopFormulaKey(texte) {
  const mots = foldSpoken(texte).split(" ").filter(Boolean);
  if (!mots.length) return "";
  return sansPolitesseFinale(mots)
    .map((mot) => mot.replace(/(er|ez|es)$/, "e"))
    .join("");
}

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

/**
 * La phrase est-elle EXACTEMENT une formule d'arrêt ?
 *
 * Comparaison sur la phrase **entière** normalisée (voir `VOCAL_STOP_FORMULAS`) :
 * aucun mot en plus, aucun mot en moins, aucune recherche « au milieu d'un
 * discours ». PURE, ne lève jamais.
 * @param {unknown} texte phrase transcrite
 * @returns {boolean}
 */
export function isVocalStopFormula(texte) {
  const cle = stopFormulaKey(texte);
  if (!cle) return false;
  return vocalStopKeySet().has(cle);
}

/**
 * LA DÉCISION de l'arrêt demandé à la voix : la phrase met-elle l'écran en
 * veille ?
 *
 * L'ordre des règles est la spécification :
 *   1. hors de l'écran Vocal ⇒ rien (`hors-mode`) ;
 *   2. pas de texte ⇒ rien (`sans-texte`) ;
 *   3. la phrase n'est pas EXACTEMENT une formule d'arrêt ⇒ rien
 *      (`pas-formule`) : c'est ici que « Silence, le dossier est vide » est
 *      écarté, et c'est voulu ;
 *   4. déjà en veille ⇒ rien (`deja-en-veille`), aucun message ;
 *   5. sinon ⇒ `VOCAL_STOP_ARRETER`.
 * PURE, ne lève jamais.
 * @param {{modeOuvert?: boolean, texte?: string, veilleArmee?: boolean}} [etats]
 * @returns {{action: string, raison: string}}
 */
export function decideVocalStopListening(etats) {
  const e = etats || {};
  const rien = (raison) => ({ action: VOCAL_STOP_RIEN, raison });
  if (e.modeOuvert !== true) return rien("hors-mode");
  const texte = String(e.texte == null ? "" : e.texte).trim();
  if (!texte) return rien("sans-texte");
  if (!isVocalStopFormula(texte)) return rien("pas-formule");
  if (e.veilleArmee === true) return rien("deja-en-veille");
  return { action: VOCAL_STOP_ARRETER, raison: "arret" };
}

/**
 * LA DÉCISION de la veille : le compte à rebours de silence doit-il armer la
 * garde MAINTENANT ?
 *
 * Utilisée à l'échéance du minuteur (l'écran repasse la durée réellement
 * écoulée), et testable seule. L'ordre des règles est la spécification :
 *   1. hors de l'écran Vocal ⇒ non (`hors-mode`) ;
 *   2. déjà en veille ⇒ non (`deja-en-veille`) : l'état est stable ;
 *   3. un réveil d'une phrase est en attente ⇒ non (`reveil`) : un geste
 *      explicite vient de demander l'écoute ;
 *   4. **Pilot PARLE** (`pilotParle`) ⇒ non (`pilot-parle`) : une lecture à
 *      voix haute est de la conversation, pas du silence ;
 *   5. **Pilot TRAVAILLE** (`travaille`) ⇒ non (`assistant-travaille`) : le
 *      tour de l'assistant est en cours, l'utilisateur attend sa réponse (un
 *      tour peut durer 120 s, une lecture n'est pas bornée) ;
 *   6. la durée écoulée n'atteint pas le délai ⇒ non (`silence-court`) ;
 *   7. sinon ⇒ oui (`silence-atteint`).
 * Les règles 4 et 5 sont les faits que l'écran connaît DÉJÀ (état de parole et
 * état de travail) : ni seuil nouveau, ni réglage, et les deux champs sont
 * ABSENTS du comportement d'avant ⇒ un appelant qui ne les passe pas garde
 * exactement l'ancienne décision.
 * PURE, ne lève jamais.
 * @param {{modeOuvert?: boolean, reveil?: boolean, veilleArmee?: boolean, pilotParle?: boolean, travaille?: boolean, ecouleMs?: number, delaiMs?: number}} [etats]
 * @returns {{armer: boolean, raison: string}}
 */
export function decideVocalVeille(etats) {
  const e = etats || {};
  const non = (raison) => ({ armer: false, raison });
  if (e.modeOuvert !== true) return non("hors-mode");
  if (e.veilleArmee === true) return non("deja-en-veille");
  if (e.reveil === true) return non("reveil");
  // Le silence mesuré n'est PAS un silence de conversation : Pilot parle.
  if (e.pilotParle === true) return non("pilot-parle");
  // Ni une absence de conversation : le tour de l'assistant est en cours.
  if (e.travaille === true) return non("assistant-travaille");
  const delai = Number.isFinite(e.delaiMs) && e.delaiMs > 0 ? e.delaiMs : VOCAL_ECOUTE_LIBRE_MS;
  const ecoule = Number.isFinite(e.ecouleMs) ? Math.max(0, e.ecouleMs) : 0;
  if (ecoule < delai) return non("silence-court");
  return { armer: true, raison: "silence-atteint" };
}

/**
 * LE COMPTE DE VEILLE DOIT-IL ÊTRE SUSPENDU ?
 *
 * Les deux faits que l'écran connaît DÉJÀ, et eux seuls :
 *   - `pilotParle` : Pilot lit sa réponse à voix haute (`vocalSpeaking`) ;
 *   - `travaille` : le tour de l'assistant est en cours (`reflectingActive`).
 * Pendant l'un ou l'autre, l'écran n'est pas silencieux : il ne faut donc pas
 * mesurer l'absence de parole du propriétaire. C'est la même décision que les
 * règles 4 et 5 de `decideVocalVeille`, exposée séparément pour que
 * l'application sache quand ANNULER le compte et quand le RELANCER — sans
 * qu'aucune règle ne soit réécrite dans l'écran.
 * PURE, ne lève jamais.
 * @param {{pilotParle?: boolean, travaille?: boolean}} [etats]
 * @returns {boolean}
 */
export function vocalVeilleSuspendue(etats) {
  const e = etats || {};
  return e.pilotParle === true || e.travaille === true;
}

/**
 * UN TEXTE TRANSCRIT COMPTE-T-IL COMME UNE PAROLE POUR LE COMPTE DE VEILLE ?
 *
 * LE DÉFAUT CORRIGÉ (transcription LOCALE active : la veille de 20 s ne s'arme
 * JAMAIS). Le compte à rebours repart à chaque TEXTE rendu par le moteur. Avec
 * l'oreille du navigateur, une pièce silencieuse ne rend rien (et la session se
 * ferme d'elle-même : `no-speech`). Avec l'oreille LOCALE, le service transcrit
 * la pièce EN CONTINU — micro armé et silence compris (le commentaire de
 * `onresult` dans super-agent.js le dit déjà, correctif « la barre du bas ne
 * s'efface plus ») : chaque texte rendu remettait le compte à zéro AVANT son
 * terme, et l'écran restait à l'écoute indéfiniment.
 *
 * La règle est celle que l'écran applique déjà partout : une parole DÉTECTÉE
 * est une parole que le MICRO A MESURÉE (`vocalMicCapte`, deux seuils,
 * hystérésis). Un texte rendu alors que le micro mesure et n'entend AUCUNE voix
 * n'est donc pas une parole : il ne tient pas l'écran éveillé.
 *
 * FAIL-OPEN, et c'est voulu : quand aucune mesure n'est ouverte, on ne prive
 * jamais un vrai mot de son effet (rien ne permet de le contredire).
 * PURE, ne lève jamais.
 * @param {{microMesure?: boolean, voixMesuree?: boolean}} [etats]
 * @returns {boolean} vrai si ce texte doit remettre le compte à zéro
 */
export function texteCompteCommeParole(etats) {
  const e = etats || {};
  if (e.microMesure !== true) return true;
  return e.voixMesuree === true;
}

/**
 * LA SÉCURITÉ DU COMPTE DE VEILLE : sa réévaluation périodique (1 seconde).
 *
 * Le compte n'existe que sous la forme d'UN minuteur unique, que plusieurs chemins
 * annulent avant son terme (suspension pendant la lecture ou le tour, sortie du
 * mode, mot reçu). Rien ne garantit qu'un événement ULTÉRIEUR le recrée : avec
 * l'oreille du navigateur, chaque fin de session de reconnaissance (`no-speech`,
 * quelques secondes) réapplique l'état et le relance ; avec l'oreille LOCALE, la
 * session ne se ferme JAMAIS d'elle-même (le pont n'envoie la fin de flux que
 * si Pilot la demande) — après le dernier signe de vie, plus rien ne réévalue la
 * veille, le compte reste perdu et l'écran reste à l'écoute indéfiniment.
 *
 * Ce réexamen ne décide RIEN de nouveau : il rejoue la MÊME décision pure
 * (`decideVocalVeille`) avec le MÊME délai (`VOCAL_ECOUTE_LIBRE_MS`) et le MÊME
 * repère. Il ne touche jamais un compte en cours : il ne fait que recréer le
 * compte perdu. Aucun second état, aucune seconde règle, aucun second seuil.
 */
export const VOCAL_VEILLE_REEXAMEN_MS = 1000;

/** Découpe un texte en mots repliés (jamais de mot vide). */
function wordsOf(texte) {
  const plie = foldSpoken(texte);
  return plie ? plie.split(" ") : [];
}

/**
 * Les mots de réveil d'une saisie libre, nettoyés et dédoublonnés.
 *
 * Une saisie = un champ texte : la virgule (ou le point-virgule, ou le saut de
 * ligne) sépare deux mots, et un mot peut contenir des espaces (« hey bonjour »).
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
 *      coupé en plusieurs mots par la reconnaissance (le nom peut arriver en deux
 *      morceaux).
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
 * LA PHRASE de la ligne d'état quand l'utilisateur a demandé l'arrêt à la voix.
 *
 * UNE seule phrase : elle accuse réception ET dit quoi faire, sur la ligne qui
 * existe déjà. Elle n'est composée qu'ici, et n'est dite qu'une fois (la ligne
 * reste tant que la veille dure) : aucun message répété à chaque silence.
 * @param {unknown} nom nom attendu, tel qu'il doit être dit
 * @returns {string}
 */
export function vocalVeilleSentence(nom) {
  const affiche = String(nom == null ? "" : nom).replace(/\s+/g, " ").trim();
  if (!affiche) return "Je me mets en veille — dites mon nom pour me parler.";
  return `Je me mets en veille — dites « ${affiche} » pour me parler.`;
}

/**
 * LA DÉCISION : que fait-on de cette phrase ?
 *
 * L'ORDRE des règles est la spécification (voir l'en-tête) : il se teste tel
 * quel. Aucune règle ne consulte le micro, la transcription ni le réseau.
 * @param {{modeOuvert?: boolean, texte?: string, nom?: string, motsDeReveil?: string|string[], repriseMain?: boolean, reveil?: boolean, ecouteLibre?: boolean}} [etats]
 * @returns {{action: string, raison: string, consommeReveil: boolean}}
 *   `action` : `VOCAL_GATE_LAISSER` ou `VOCAL_GATE_JETER` ;
 *   `raison` : `hors-mode`, `sans-texte`, `reprise-main`, `reveil`,
 *   `ecoute-libre`, `nom-entendu`, `mot-reveil`, `nom-inutilisable`,
 *   `nom-absent`.
 *   `ecouteLibre` **absent** = la garde est ARMÉE (comportement du §6quater) :
 *   un appelant qui ne suit pas le silence garde donc exactement l'ancien
 *   comportement.
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
  // 5. L'ÉCOUTE LIBRE (le compte à rebours de silence n'est pas échu) : le nom
  //    n'est pas exigé. C'est le cas normal, celui de tous les jours.
  if (e.ecouteLibre === true) return laisser("ecoute-libre");
  // 6. Le nom de l'assistante est TOUJOURS accepté : le réglage des mots de
  //    réveil s'ajoute à lui, il ne le remplace jamais.
  if (mentionsAssistantName(texte, nom)) return laisser("nom-entendu");
  // 7. Un mot de réveil réglé, n'importe où dans la phrase — un seul suffit.
  if (mentionsWakeWord(texte, reveils)) return laisser("mot-reveil");
  // L'EXCEPTION (fail-open) : un nom qu'on ne sait pas lire ne peut pas fonder
  // un refus — mais seulement s'il n'y a AUCUN mot de réveil utilisable.
  if (wordsOf(nom).length === 0 && reveils.length === 0) return laisser("nom-inutilisable");
  return { action: VOCAL_GATE_JETER, raison: "nom-absent", consommeReveil: false };
}

/**
 * LA PHRASE de la ligne d'état quand la garde est ARMÉE : elle dit lequel des
 * deux états est actif, en une phrase simple, sur la ligne qui existe déjà —
 * aucun nouvel élément d'interface, aucun réglage.
 *
 * L'autre état (réveillé pour une phrase) est dit par la phrase EXISTANTE du
 * repos (« Je vous écoute. »), qui n'est pas recopiée ici. Celle de l'ATTENTE
 * DEMANDÉE À LA VOIX (une seule phrase, accusé et consigne ensemble) vit dans
 * `vocalVeilleSentence`.
 * @param {unknown} nom nom attendu, tel qu'il doit être dit
 * @returns {string} `Dites « nom » pour me parler.`
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
 * @param {{modeOuvert?: boolean, nom?: string, motsDeReveil?: string|string[], reveil?: boolean, ecouteLibre?: boolean}} [etats]
 * @returns {boolean}
 */
export function vocalNameGateArmed(etats) {
  const e = etats || {};
  if (e.modeOuvert !== true) return false;
  if (e.reveil === true) return false;
  // L'ÉCOUTE LIBRE (compte à rebours de silence non échu) : la garde n'est pas
  // armée, la phrase passe sans nom (cas normal).
  if (e.ecouteLibre === true) return false;
  if (wordsOf(e.nom).length > 0) return true;
  return wakeWordsFrom(e.motsDeReveil).length > 0;
}

/**
 * L'ÉTAT AFFICHÉ de l'écran, une fois la veille ARMÉE.
 *
 * LA VEILLE N'ÉCOUTE PLUS (décision du propriétaire, 2026-11-16) : l'écran de
 * l'écran Vocal ne dit plus « Je vous écoute » quand la veille est armée — par
 * les 20 s de silence comme par l'ordre d'arrêt, c'est le MÊME état. Les deux
 * entrées produisent donc exactement le même affichage, et il n'y a rien à
 * distinguer ailleurs.
 *
 * Ce que la fonction fait, et rien de plus : l'état « écoute » (le rond qui
 * écoute) devient le REPOS. Elle ne touche ni à ce que le micro fait, ni au halo
 * de parole, ni à la réflexion : une phrase en cours de lecture
 * (`speaking`) ou une réponse en cours (`thinking`) garde sa phrase, comme
 * avant. Hors veille, l'état est rendu À L'IDENTIQUE : aucun appelant existant
 * ne voit de différence.
 *
 * PURE, sans DOM ni minuterie. Le choix de la PHRASE reste à
 * `vocalStatusLine` (`vocalVeilleSentence` / `vocalNameSentence`) : ici on ne
 * décide que du fait « est-ce que l'écran écoute ? ».
 * @param {{veilleArmee?: boolean, etat?: string}} [etats]
 * @returns {string} état à afficher
 */
export function vocalEtatAffiche(etats) {
  const e = etats || {};
  const etat = typeof e.etat === "string" && e.etat ? e.etat : "idle";
  if (e.veilleArmee !== true) return etat;
  return etat === "listening" ? "idle" : etat;
}

/**
 * LA CLASSE DE LA VEILLE, posée sur l'overlay de l'écran Vocal.
 *
 * LE DÉFAUT CORRIGÉ (constat du propriétaire) : quand la veille s'armait, RIEN
 * à l'écran ne le disait. Le bas s'efface au repos bien avant que les 20 s de
 * silence ne soient échues ; la ligne d'état — la seule qui demande le nom —
 * partait donc avec lui, et l'objet lumineux retombait sur le repos ordinaire.
 * On ne pouvait deviner qu'en parlant que l'écran attendait un nom.
 *
 * Ce que cette classe commande, et rien de plus : la ligne d'état RESTE
 * VISIBLE malgré l'effacement du bas (§2.6), et le cercle prend l'aspect de
 * l'attente (anneau pointillé, aucune respiration) au lieu de celui du repos.
 * La PHASE et le texte ne sont pas ici : la ligne garde sa phrase
 * (`vocalStatusLine` → `vocalNameSentence` / `vocalVeilleSentence`) et son nom
 * vient de `superAgentDisplayLabel()`, comme avant.
 *
 * Elle ne retient aucun minuteur, ne change aucun seuil (les 20 s, les deux
 * seuils de voix et la garde du nom sont intacts) et ne rouvre rien : hors
 * veille la classe est absente, donc l'écran est EXACTEMENT celui d'avant.
 */
export const VOCAL_VEILLE_CLASS = "vocal-veille";
