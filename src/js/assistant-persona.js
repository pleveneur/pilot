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
// ── RÈGLE DE PRIORITÉ (le Rust en est l'autorité, `src-tauri/src/persona.rs`) ──
//   a. le premier dépôt PERSONNEL qui existe (dossier désigné par Présences, puis
//      `<dossier personnel>/.pilot/portrait`) fait autorité et ferme la recherche :
//      un dossier qui existe a « parlé », même vide ;
//   b. « Aucun personnage » dans `nom.txt` est une DÉCLARATION D'ABSENCE, jamais un
//      nom : elle donne le nom réglé (ou « Assistant »), et aucune image ;
//   c. le dépôt historique de Pilot (`<app_data_dir>/.pilot/portrait`) ne fournit
//      que le nom, JAMAIS son image : une vieille image résiduelle ne peut plus
//      réapparaître. Pilot ne la supprime pas, il l'ignore.
//
// ── MISE À JOUR SANS REDÉMARRER ──
// Le personnage est relu au démarrage, à l'ouverture de l'onglet 🧭, au retour de
// focus ET — c'est ce qui manquait — dès que son EMPREINTE change sur le disque
// (`createPersonaWatcher` : date + taille des deux fichiers, contenu jamais lu).
// Une activation ou une désactivation dans Présences se voit donc en quelques
// secondes, y compris quand la fenêtre ne perd jamais le focus (écran Vocal).
// Ce détecteur ne lit pas le personnage : il dit seulement QUAND relire, par le
// mécanisme existant (`refreshAssistantPersona`).
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

/**
 * Phrases par lesquelles Présences déclare qu'il n'y a AUCUN personnage actif
 * (elle les écrit dans `nom.txt`). Mêmes valeurs que le Rust
 * (`PERSONA_NO_CHARACTER_MARKERS`) : ce n'est pas un nom, c'est une déclaration
 * d'absence. La comparaison ignore la casse et les accents.
 */
export const PERSONA_NO_CHARACTER_MARKERS = [
  "aucun personnage",
  "aucun personnage actif",
  "pas de personnage",
  "no character",
];

/** Commande Rust de l'empreinte légère du personnage (date + taille des fichiers). */
export const PERSONA_STAMP_COMMAND = "read_assistant_persona_stamp";

/** Intervalle de comparaison de l'empreinte (aucun réglage utilisateur). */
export const PERSONA_WATCH_MS = 2000;

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
 * Vrai si le contenu de `nom.txt` est la DÉCLARATION EXPLICITE d'une absence de
 * personnage (« Aucun personnage », casse et accents indifférents). Fonction
 * PURE. Le Rust fait la même reconnaissance (`declares_no_character`) : ici elle
 * protège l'affichage d'une valeur qui aurait échappé au socle.
 * @param {unknown} raw - contenu brut (ou valeur quelconque)
 * @returns {boolean}
 */
export function isNoCharacterDeclaration(raw) {
  if (typeof raw !== "string") return false;
  const premiere = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (!premiere) return false;
  const plat = Array.from(premiere)
    .filter((c) => {
      const code = c.codePointAt(0) || 0;
      return !(code < 0x20 || code === 0x7f);
    })
    .join("")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const compact = plat
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replace(/[.!…;:\s]+$/, "");
  return PERSONA_NO_CHARACTER_MARKERS.includes(compact);
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
  // « Aucun personnage » est la phrase par laquelle Présences dit qu'il n'y a
  // pas de personnage : ce n'est pas un nom, et elle ne doit jamais s'afficher
  // dans l'onglet. Même reconnaissance que le Rust.
  if (isNoCharacterDeclaration(propre)) return "";
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
 * Lecture en cours (promesse partagee). Deux surfaces relisent le personnage
 * sur le MEME evenement — l'onglet 🧭 et la liste des agents (main.js) — et le
 * portrait pese plusieurs Mo : une seule lecture disque par evenement.
 * La promesse est oubliee des qu'elle est reglee, donc deux lectures
 * SUCCESSIVES (changer de personnage) lisent bien deux fois.
 */
let refreshInFlight = null;

/** Lit la commande Rust, pannes comprises (aucune exception vers l'appelant). */
async function readPersona(call) {
  try {
    return await call("read_assistant_persona");
  } catch (_) {
    return null; // repli silencieux : aucun personnage actif
  }
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
  const injected = deps && typeof deps.invoke === "function" ? deps.invoke : null;
  // Appelant de test : sa lecture lui appartient, jamais partagee avec une
  // autre (sinon deux scenarios de test pourraient se voler leur reponse).
  if (injected) return setAssistantPersona(await readPersona(injected));
  if (!refreshInFlight) {
    refreshInFlight = readPersona(invoke).finally(() => {
      refreshInFlight = null;
    });
  }
  return setAssistantPersona(await refreshInFlight);
}

// ── Détecteur de CHANGEMENT du personnage (activation / désactivation) ──────
//
// L'état du personnage n'était relu qu'au démarrage, à l'ouverture de l'onglet 🧭
// et au retour de focus de la fenêtre. Le propriétaire qui reste dans Pilot
// (écran Vocal, « Assistant seul ») ne déclenche AUCUN de ces trois moments :
// activer ou désactiver un personnage dans Présences ne changeait donc rien à
// l'écran tant que Pilot n'avait pas redémarré (photo encore affichée, nom de
// l'onglet figé).
//
// Ce n'est PAS une seconde lecture du personnage : on compare une empreinte
// LÉGÈRE (date + taille de `nom.txt` et `portrait.png`, contenu jamais lu) et,
// quand elle change, on relit le personnage par le mécanisme EXISTANT
// (`refreshAssistantPersona` → `refreshAssistantPersonaAndApply`). Aucune
// image n'est relue, ni même lue, tant que rien n'a changé.
//
// Pourquoi une comparaison et pas un minuteur qui relit : une `data:` URL de
// portrait pèse plusieurs mégaoctets ; la relire toutes les deux secondes
// coûterait cher pour rien.

/**
 * Crée le détecteur de changement du personnage.
 *
 * Fail-open de bout en bout : une commande absente, une réponse d'une autre
 * forme ou une panne d'IPC laisse simplement l'affichage tel quel (aucune
 * exception, aucun message, aucune trace console). Un seul intervalle à la fois,
 * et jamais deux comparaisons simultanées.
 *
 * @param {{
 *   onChange?: (empreinte: string) => void,
 *   invoke?: (cmd: string) => Promise<unknown>,
 *   intervalMs?: number,
 *   setInterval?: Function,
 *   clearInterval?: Function,
 * }} [deps] injections (tests) ; par défaut : la commande Rust réelle
 * @returns {{start: Function, stop: Function, isRunning: Function, tick: Function,
 *            getReference: () => string|null, getChanges: () => number}}
 */
export function createPersonaWatcher(deps = {}) {
  const invokeFn = typeof deps.invoke === "function" ? deps.invoke : invoke;
  const onChange = typeof deps.onChange === "function" ? deps.onChange : () => {};
  const intervalMs =
    Number.isFinite(deps.intervalMs) && deps.intervalMs > 0
      ? Number(deps.intervalMs)
      : PERSONA_WATCH_MS;
  const setIntervalFn =
    typeof deps.setInterval === "function" ? deps.setInterval : setInterval;
  const clearIntervalFn =
    typeof deps.clearInterval === "function" ? deps.clearInterval : clearInterval;
  let timer = null;
  // Empreinte de référence : `null` tant que la première comparaison n'a pas eu
  // lieu (le premier tick ne declenche donc aucune relecture : l'etat vient
  // d'etre lu au demarrage).
  let reference = null;
  let comparing = false;
  let changes = 0;

  /** Compare l'empreinte courante à la référence. Vrai si elle a changé. */
  async function tick() {
    if (comparing) return false;
    comparing = true;
    try {
      let empreinte;
      try {
        empreinte = await invokeFn(PERSONA_STAMP_COMMAND);
      } catch (_) {
        return false; // socle absent : on ne conclut rien
      }
      const valeur = typeof empreinte === "string" ? empreinte : "";
      if (reference === null) {
        reference = valeur;
        return false;
      }
      if (valeur === reference) return false;
      reference = valeur;
      changes += 1;
      try {
        onChange(valeur);
      } catch (_) {
        /* l'affichage ne doit jamais casser le détecteur */
      }
      return true;
    } finally {
      comparing = false;
    }
  }

  return {
    start() {
      if (timer !== null) return; // idempotent : un seul intervalle
      timer = setIntervalFn(() => {
        tick();
      }, intervalMs);
      // Un minuteur ne doit pas retenir un processus de test en vie.
      if (timer && typeof timer.unref === "function") timer.unref();
    },
    stop() {
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
    },
    isRunning() {
      return timer !== null;
    },
    tick,
    getReference() {
      return reference;
    },
    getChanges() {
      return changes;
    },
  };
}

/** Détecteur unique de l'application (aucun second minuteur, aucun réglage). */
let assistantPersonaWatch = null;

/**
 * Démarre le détecteur (idempotent) : `onChange` doit relire ET réappliquer le
 * personnage par le chemin existant.
 * @param {Parameters<typeof createPersonaWatcher>[0]} [deps]
 */
export function startAssistantPersonaWatch(deps = {}) {
  if (!assistantPersonaWatch) assistantPersonaWatch = createPersonaWatcher(deps);
  assistantPersonaWatch.start();
  return assistantPersonaWatch;
}

/** Arrête le détecteur (aucun intervalle ne survit à l'appel). */
export function stopAssistantPersonaWatch() {
  if (assistantPersonaWatch) assistantPersonaWatch.stop();
  return assistantPersonaWatch;
}

/** Détecteur courant (tests et arrêt), ou `null` s'il n'a jamais démarré. */
export function getAssistantPersonaWatch() {
  return assistantPersonaWatch;
}
