// character-voices.js — LA VOIX PROPRE AU PERSONNAGE ACTIF (Présences).
//
// Décision du propriétaire : un personnage actif (nom + portrait lus par
// `assistant-persona.js`, déposés par Présences) peut avoir SA voix de lecture
// à voix haute. Ce module porte les DEUX règles qui vont avec, à UN SEUL
// endroit :
//
//   1. QUI PARLE, ET AVEC QUELLE VOIX (`voiceForCharacter`) : le personnage
//      actif lit avec la voix qui lui est attribuée SI elle existe et SI elle
//      est utilisable ; sinon il lit avec la voix GÉNÉRALE (`read_aloud_voice`,
//      le seul champ historique). Aucune lecture n'échoue jamais à cause de ce
//      choix : ce n'est qu'une valeur de plus, la lecture et ses replis restent
//      entièrement dans `read-aloud.js`.
//   2. QUAND LE RÉGLAGE EXISTE À L'ÉCRAN (`characterVoiceRow`) : la ligne
//      « voix du personnage » n'apparaît QUE si un personnage est actif. Sans
//      personnage, la section « Lecture des réponses » est exactement celle
//      d'aujourd'hui : aucune ligne, aucun champ vide, aucun message, aucune
//      explication — le service des personnages n'est pas installé ou pas
//      activé, l'utilisateur n'a rien à en savoir.
//
// La grammaire des valeurs acceptées est CELLE DÉJÀ GÉRÉE, et elle n'est pas
// recopiée ici : voix du système (identité stable), `local:piper` /
// `local:piper:<modèle>` (`isLocalVoiceChoice`) et
// `local:voicestudio:<profil>` (`isVoiceStudioChoice`).
//
// Rien n'est lu du disque, aucune API de la fenêtre n'est appelée : les
// fonctions sont PURES (ou reçoivent ce qui manque), donc testables sous Node.
// Le seul point qui DÉCIDE est ici ; il est branché à UN SEUL endroit dans
// `read-aloud.js` (`resolveReadingVoice`).

import { isLocalVoiceChoice } from "./local-voice.js";
import { isVoiceStudioChoice } from "./voicestudio-voice.js";

/**
 * Clé du champ de configuration qui mémorise les voix des personnages
 * (`nom du personnage` → valeur de voix). UN seul champ, à côté du champ
 * général (`read_aloud_voice`) ; absent d'une ancienne configuration ⇒ objet
 * vide. Le nom est volontairement hors de la famille `read_aloud_*` : les
 * gardes existantes vérifient qu'UN SEUL champ gouverne la voix de lecture, et
 * ce champ-ci n'est pas un second réglage de voix — c'est une ASSIGNATION de
 * voix au personnage, qui ne peut jamais remplacer la voix générale.
 */
export const CHARACTER_VOICES_KEY = "character_voices";

/**
 * Libellé du premier choix de la ligne du personnage : ne rien choisir signifie
 * « comme tout le monde », donc la voix générale — jamais « automatique », qui
 * voudrait dire autre chose pour un personnage.
 */
export const CHARACTER_VOICE_INHERIT_LABEL = "Comme la voix de lecture ci-dessus";

/** Longueur maximale du nom d'un personnage retenu comme clé. */
export const CHARACTER_NAME_MAX = 60;

/**
 * Nom de personnage utilisable comme clé : espaces réduits, contrôles retirés,
 * longueur bornée. Une chaîne vide signifie « aucun personnage actif ».
 * @param {string} [raw]
 * @returns {string}
 */
export function normalizeCharacterName(raw) {
  return String(raw == null ? "" : raw)
    // Contrôles et sauts de ligne : un nom tient sur une ligne.
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHARACTER_NAME_MAX)
    .trim();
}

/**
 * Vrai si la valeur est une voix RÉELLEMENT utilisable par la lecture : la même
 * grammaire que le réglage général. Une valeur vide (ou une valeur locale
 * inconnue) n'en est pas une : elle signifie « pas de voix propre ».
 * @param {string} [raw]
 * @returns {boolean}
 */
export function isUsableVoiceValue(raw) {
  const value = String(raw == null ? "" : raw).trim();
  if (!value) return false;
  if (isLocalVoiceChoice(value)) return true; // local:piper / local:piper:<modèle>
  if (isVoiceStudioChoice(value)) return true; // local:voicestudio:<profil>
  // Toute autre valeur `local:…` désigne un moteur que Pilot ne sait pas lire :
  // elle n'est jamais retenue (le réglage retombe sur la voix générale).
  if (value.startsWith("local:")) return false;
  return true; // voix du système : son identité stable
}

/**
 * Objet de configuration normalisé : clé = nom du personnage (normalisé),
 * valeur = voix utilisable. Toute entrée inutilisable est IGNORÉE (jamais une
 * valeur inventée, jamais une exception sur une configuration abîmée).
 * @param {object|null|undefined} raw
 * @returns {Object<string, string>}
 */
export function normalizeCharacterVoices(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [cle, valeur] of Object.entries(raw)) {
    const name = normalizeCharacterName(cle);
    if (!name) continue;
    const voice = String(valeur == null ? "" : valeur).trim();
    if (!isUsableVoiceValue(voice)) continue;
    out[name] = voice;
  }
  return out;
}

/**
 * Voix attribuée à un personnage, telle qu'elle est mémorisée (`""` s'il n'en a
 * pas). La recherche est exacte, puis insensible à la casse : un nom dont la
 * casse a changé côté Présences ne fait pas perdre la voix choisie.
 * @param {Object<string, string>|null|undefined} characterVoices
 * @param {string} [characterName]
 * @returns {string}
 */
export function storedVoiceForCharacter(characterVoices, characterName) {
  const map = normalizeCharacterVoices(characterVoices);
  const name = normalizeCharacterName(characterName);
  if (!name) return "";
  if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
  const lower = name.toLowerCase();
  for (const [cle, valeur] of Object.entries(map)) {
    if (cle.toLowerCase() === lower) return valeur;
  }
  return "";
}

/**
 * LA décision « quelle voix pour cette lecture ? ».
 *
 * Ordre, et c'est tout :
 *   1. aucun personnage actif ⇒ voix générale (comportement historique) ;
 *   2. personnage sans voix attribuée (ou voix inutilisable) ⇒ voix générale ;
 *   3. voix attribuée mais qui n'existe plus sur cette machine (modèle local
 *      absent, profil imité retiré, voix du système désinstallée) ⇒ voix
 *      générale — la lecture ne s'arrête jamais pour autant, et les replis du
 *      module de lecture (voix locale puis voix du système) restent intacts ;
 *   4. sinon ⇒ la voix du personnage.
 *
 * `isAvailable` est fourni par l'appelant (le module de lecture sait, lui, ce
 * qui existe sur cette machine). Il est facultatif : par défaut toute voix
 * utilisable est retenue, ce qui laisse les replis habituels faire leur travail.
 * @param {string} [characterName] nom du personnage ACTIF (vide = aucun)
 * @param {string} [generalVoice] voix générale (`read_aloud_voice`)
 * @param {Object<string, string>|null|undefined} characterVoices
 * @param {(voice: string) => boolean} [isAvailable]
 * @returns {string}
 */
export function voiceForCharacter(
  characterName,
  generalVoice,
  characterVoices,
  isAvailable,
) {
  const general = String(generalVoice == null ? "" : generalVoice).trim();
  const name = normalizeCharacterName(characterName);
  if (!name) return general;
  const own = storedVoiceForCharacter(characterVoices, name);
  if (!isUsableVoiceValue(own)) return general;
  const available = typeof isAvailable === "function" ? isAvailable : () => true;
  try {
    if (!available(own)) return general;
  } catch (_) {
    // Un contrôle d'existence qui échoue ne prive pas le personnage de sa voix :
    // les replis de la lecture restent là pour ça.
  }
  return own;
}

/**
 * Enregistre (ou retire) la voix d'UN personnage, sans toucher aux autres.
 * Une valeur vide, « automatique » ou inutilisable RETIRE l'entrée : le
 * personnage repasse sur la voix générale (aucune entrée vide conservée).
 * @param {Object<string, string>|null|undefined} characterVoices
 * @param {string} characterName
 * @param {string} voice
 * @returns {Object<string, string>} nouvel objet (l'argument n'est pas modifié)
 */
export function withCharacterVoice(characterVoices, characterName, voice) {
  const next = { ...normalizeCharacterVoices(characterVoices) };
  const name = normalizeCharacterName(characterName);
  if (!name) return next;
  const value = String(voice == null ? "" : voice).trim();
  // Retirer une entrée écrite avec une autre casse : une seule entrée par
  // personnage, jamais deux clés pour le même nom.
  const lower = name.toLowerCase();
  for (const cle of Object.keys(next)) {
    if (cle === name || cle.toLowerCase() === lower) delete next[cle];
  }
  if (!isUsableVoiceValue(value)) return next;
  next[name] = value;
  return next;
}

/**
 * Liste des choix de la ligne « voix du personnage » : le même catalogue que le
 * sélecteur général (AUCUNE seconde liste de voix dans l'application), avec un
 * premier choix qui signifie « la voix de lecture ci-dessus ».
 * @param {{value: string, label: string}[]} baseOptions options du réglage général
 * @returns {{value: string, label: string}[]}
 */
export function characterVoiceOptions(baseOptions) {
  const rest = (Array.isArray(baseOptions) ? baseOptions : [])
    .filter((opt) => opt && String(opt.value == null ? "" : opt.value) !== "")
    .map((opt) => ({
      value: String(opt.value == null ? "" : opt.value),
      label: String(opt.label == null ? "" : opt.label),
    }));
  return [{ value: "", label: CHARACTER_VOICE_INHERIT_LABEL }, ...rest];
}

/**
 * Ce que l'écran doit faire de la ligne « voix du personnage ».
 * @param {string} [characterName] personnage ACTIF (vide = aucun)
 * @param {Object<string, string>|null|undefined} characterVoices
 * @param {{value: string, label: string}[]} [baseOptions] options du réglage général
 * @returns {{visible: boolean, label: string, value: string, options: {value: string, label: string}[]}}
 *   `visible` FAUX ⇒ la ligne n'apparaît pas du tout (aucune ligne vide, aucun
 *   message) et rien n'a de sens à l'écran.
 */
export function characterVoiceRow(characterName, characterVoices, baseOptions) {
  const name = normalizeCharacterName(characterName);
  if (!name) return { visible: false, label: "", value: "", options: [] };
  return {
    visible: true,
    label: `Voix de ${name} :`,
    value: storedVoiceForCharacter(characterVoices, name),
    options: characterVoiceOptions(baseOptions),
  };
}
