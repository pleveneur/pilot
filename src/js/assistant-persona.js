// assistant-persona.js — SOURCE UNIQUE du NOM et du PORTRAIT du personnage
// actif de l'Assistant (onglet 🧭).
//
// Le projet « Présences » dépose, quand un personnage est activé, deux fichiers
// dans un dossier que Pilot se contente de LIRE :
//
//   <dossier de données de Pilot>/.pilot/portrait/nom.txt       (le nom)
//   <dossier de données de Pilot>/.pilot/portrait/portrait.png  (l'image)
//
// Contrat (fixé par la demande, non modifiable ici) :
//   - fichier ABSENT = aucun personnage actif → l'Assistant garde son nom et son
//     icône habituels (DEFAULT_ASSISTANT_NAME / DEFAULT_ASSISTANT_ICON). L'absence
//     n'est PAS une panne : aucune erreur, aucun message, aucune trace console ;
//   - Pilot ne fait que LIRE : ce module n'écrit pas un octet, ne crée ni le
//     dossier ni les fichiers, ne les nettoie jamais ;
//   - la LECTURE est faite côté Rust (`read_assistant_persona`, src-tauri/src/
//     persona.rs) : c'est le seul côté qui connaît le dossier de données de
//     l'application (`app_data_dir()`), et le Rust résout les chemins pour les
//     trois plateformes. Ce module ne fait que RECEVOIR et AFFICHER ;
//   - l'état vit en MÉMOIRE seulement : aucun réglage nouveau, aucune
//     persistance. Une relecture suffit à changer de personnage.
//
// Ce que ce module ne fait PAS : aucun DOM (il ne décide que de valeurs que
// super-agent.js et tabs.js appliquent), aucune écriture, aucun second mécanisme
// de nom (le nom réglé dans ⚙️ → Assistant reste le repli).

import { invoke } from "@tauri-apps/api/core";

/** Sous-dossier du dossier de données de Pilot où Présences dépose. */
export const PERSONA_DIR = ".pilot";
/** Dossier du personnage actif. */
export const PERSONA_SUBDIR = "portrait";
/** Fichier du NOM affiché. */
export const PERSONA_NAME_FILE = "nom.txt";
/** Fichier de l'IMAGE affichée. */
export const PERSONA_IMAGE_FILE = "portrait.png";
/** Nom habituel de l'Assistant quand aucun personnage n'est actif. */
export const DEFAULT_ASSISTANT_NAME = "Assistant";
/** Icône habituelle de l'Assistant quand aucun portrait n'est disponible. */
export const DEFAULT_ASSISTANT_ICON = "🧭";
/** Longueur maximale du nom retenu (même borne que le Rust). */
export const PERSONA_NAME_MAX_CHARS = 60;
/** Taille maximale d'un portrait affichable (8 Mio, même borne que le Rust). */
export const PERSONA_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Chemin du dossier, tel que le contrat le nomme (documentation et tests). */
export const PERSONA_DIR_LABEL = `${PERSONA_DIR}/${PERSONA_SUBDIR}`;

/**
 * Chemin logique du dossier du personnage, à partir du dossier de données.
 * Fonction PURE : aucune entrée/sortie (la lecture réelle est côté Rust).
 * @param {string} appDataDir - dossier de données de l'application
 * @returns {string} `<appDataDir>/.pilot/portrait` (séparateurs normalisés)
 */
export function personaDirFor(appDataDir) {
  const base = String(appDataDir == null ? "" : appDataDir).replace(/[\\/]+$/, "");
  if (!base) return PERSONA_DIR_LABEL;
  return `${base.replace(/\\/g, "/")}/${PERSONA_DIR}/${PERSONA_SUBDIR}`;
}

/**
 * Normalise le nom lu dans `nom.txt` : première ligne non vide, espaces rognés,
 * caractères de contrôle retirés, longueur bornée.
 * @param {unknown} raw - contenu brut (ou valeur quelconque)
 * @returns {string} nom utilisable, ou `""` si rien de lisible
 */
export function normalizePersonaName(raw) {
  if (typeof raw !== "string") return "";
  const premiere = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (!premiere) return "";
  // Retrait des caractères de contrôle (U+0000–U+001F, U+007F) : un nom n'en
  // porte pas. Accents, émojis et ponctuation sont conservés.
  const propre = Array.from(premiere)
    .filter((c) => {
      const code = c.codePointAt(0) || 0;
      return !(code < 0x20 || code === 0x7f);
    })
    .join("")
    .trim();
  if (!propre) return "";
  return Array.from(propre).slice(0, PERSONA_NAME_MAX_CHARS).join("").trim();
}

/**
 * Valide une image prête à afficher : uniquement un `data:image/…;base64,…`
 * borné (aucun chemin de fichier, aucune URL distante) ; tout le reste → `""`,
 * c'est-à-dire « repli sur l'icône habituelle ».
 * @param {unknown} raw
 * @returns {string} `data:` URL utilisable, ou `""`
 */
export function personaPortraitSrc(raw) {
  if (typeof raw !== "string") return "";
  const src = raw.trim();
  if (!src.startsWith("data:image/")) return "";
  const virgule = src.indexOf(";base64,");
  if (virgule < "data:image/".length) return "";
  const corps = src.slice(virgule + ";base64,".length);
  if (!corps) return "";
  // Borne de taille : même plafond que le Rust (4/3 pour le base64).
  const maxChars = Math.ceil((PERSONA_IMAGE_MAX_BYTES * 4) / 3) + 64;
  if (corps.length > maxChars) return "";
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(corps)) return "";
  return src;
}

/**
 * Nom RÉELLEMENT affiché pour l'Assistant — fonction PURE, règle unique de
 * priorité (aucun second mécanisme ailleurs) :
 *
 *   1. nom du PERSONNAGE ACTIF (Présences, `nom.txt`) s'il existe ;
 *   2. sinon le nom réglé dans ⚙️ → Assistant → Nom ;
 *   3. sinon le nom habituel.
 *
 * @param {unknown} character - nom du personnage actif (`""` si aucun)
 * @param {unknown} configured - nom réglé dans les paramètres
 * @returns {string} nom affichable, jamais vide
 */
export function personaDisplayName(character, configured) {
  const personnage = typeof character === "string" ? character.trim() : "";
  if (personnage) return personnage;
  const regle = typeof configured === "string" ? configured.trim() : "";
  return regle || DEFAULT_ASSISTANT_NAME;
}

/**
 * Normalise la réponse de la commande Rust (`{name, portrait}`) en état sûr.
 * Ne lève JAMAIS : une valeur absente ou d'une autre forme donne le repli.
 * @param {unknown} payload
 * @returns {{name: string, portrait: string}}
 */
export function normalizePersona(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    name: normalizePersonaName(source.name),
    portrait: personaPortraitSrc(source.portrait),
  };
}

/** État courant (mémoire seulement). */
let personaState = { name: "", portrait: "" };

/** Copie de l'état courant (jamais la référence interne). */
export function getAssistantPersona() {
  return { name: personaState.name, portrait: personaState.portrait };
}

/** Portrait affichable, ou `""` (icône habituelle). */
export function getAssistantPortrait() {
  return personaState.portrait;
}

/** Nom du personnage actif, ou `""` (aucun personnage). */
export function getAssistantPersonaName() {
  return personaState.name;
}

/**
 * Fixe l'état (utilisé par la relecture et par les tests). Ne lève jamais.
 * @param {unknown} payload - `{name, portrait}` (forme Rust)
 * @returns {{name: string, portrait: string}} état retenu
 */
export function setAssistantPersona(payload) {
  personaState = normalizePersona(payload);
  return getAssistantPersona();
}

/** Oublie le personnage (retour au nom et à l'icône habituels). */
export function resetAssistantPersona() {
  personaState = { name: "", portrait: "" };
  return getAssistantPersona();
}

/**
 * Relit le personnage actif auprès du socle Rust.
 *
 * **Fail-open** : toute erreur (commande absente, dossier non résoluble, disque,
 * IPC) laisse « aucun personnage actif » — donc le nom et l'icône habituels. Une
 * panne n'est pas une absence de personnage, et aucune des deux ne se voit dans
 * la conversation ni dans la console.
 *
 * @param {{invoke?: (cmd: string) => Promise<unknown>}} [deps] injection (tests)
 * @returns {Promise<{name: string, portrait: string}>} état retenu
 */
export async function refreshAssistantPersona(deps = {}) {
  const call = deps && typeof deps.invoke === "function" ? deps.invoke : invoke;
  let payload = null;
  try {
    payload = await call("read_assistant_persona");
  } catch (_) {
    payload = null; // repli silencieux : aucun personnage actif
  }
  return setAssistantPersona(payload);
}
