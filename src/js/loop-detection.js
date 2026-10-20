// loop-detection.js — Détection de boucle dans la réflexion du modèle (issue #37).
//
// Un modèle IA peut tourner en boucle : un bloc de texte se répète à l'identique
// (sur une ou plusieurs lignes), gaspillant tokens et temps. Cette détection est
// pure (aucune dépendance DOM/navigateur) pour être testable en isolation et
// branchée à la fois sur le chat standard (agent-pi.js) et sur les sous-agents /
// multi-codeurs H2 (agents-bus.js). Le Mode Orchestration est explicitement
// exclu (cycle Réfléchir/Faire/Contrôler inchangé).
//
// Principe : on analyse les N dernières lignes du flux de réflexion streamé par
// le modèle. On recherche un bloc de lignes (normalisées) qui se répète à
// l'identique au moins `minRepeat` fois consécutivement et qui est suffisamment
// substantiel (`minBlockChars`) pour être un vrai bouclage plutôt qu'un artefact
// de mise en forme.
//
// Issue #62 : detectRepeatedBlock ne couvre pas les répétitions de MOTS (un
// même mot court répété en boucle, ou une séquence de caractères sans espaces
// comme "tooltooltool..."). detectRepeatedWord complète la détection sur ces
// cas, branchée aux mêmes points (agent-pi.js, agents-bus.js, super-agent.js).

/**
 * Normalise une ligne pour la comparaison : trim + collapse des espaces
 * multiples. Insensible aux variations mineures de mise en forme (espaces
 * multiples, indentations incohérentes) tout en restant fidèle au contenu.
 * @param {string} line
 * @returns {string}
 */
export function normalizeLoopLine(line) {
  if (typeof line !== "string") return "";
  return line.trim().replace(/\s+/g, " ");
}

/**
 * Détecte si le texte fourni (réflexion streamée) contient un bloc répété à
 * l'identique au moins `minRepeat` fois consécutivement, sur les `maxLines`
 * dernières lignes.
 *
 * @param {string} text - texte brut de la réflexion / streaming du modèle
 * @param {object} [options]
 * @param {number} [options.maxLines=40] - fenêtre : dernières lignes analysées
 * @param {number} [options.minBlockLines=1] - taille minimale d'un bloc (en lignes)
 * @param {number} [options.minBlockChars=150] - taille minimale du bloc répété (caractères)
 * @param {number} [options.minRepeat=3] - nb de répétitions identiques consécutives déclenchant la boucle
 * @returns {boolean} true si un bloc répété est détecté
 */
export function detectRepeatedBlock(text, options = {}) {
  const maxLines = options.maxLines ?? 40;
  const minBlockLines = options.minBlockLines ?? 1;
  const minBlockChars = options.minBlockChars ?? 150;
  const minRepeat = options.minRepeat ?? 3;

  if (!text || typeof text !== "string") return false;

  const lines = text.split("\n");
  const window = lines.slice(-maxLines);
  const norm = window.map(normalizeLoopLine);

  // Un bloc de `blockLines` lignes doit tenir `minRepeat` fois dans la fenêtre.
  const maxBlockLines = Math.floor(norm.length / minRepeat);
  if (maxBlockLines < minBlockLines) return false;

  for (let blockLines = minBlockLines; blockLines <= maxBlockLines; blockLines++) {
    for (let start = 0; start + blockLines * minRepeat <= norm.length; start++) {
      const block = norm.slice(start, start + blockLines);
      const key = block.join("\n").trim();
      if (key.length < minBlockChars) continue;

      // Compter les répétitions identiques CONSÉCUTIVES à partir de `start`.
      let count = 1;
      for (let i = start + blockLines; i + blockLines <= norm.length; i += blockLines) {
        if (norm.slice(i, i + blockLines).join("\n").trim() === key) {
          count++;
          if (count >= minRepeat) return true;
        } else {
          break;
        }
      }
    }
  }
  return false;
}

/**
 * Détecte une répétition de mots / séquences de caractères dans le texte
 * streamé (issue #62). Complète detectRepeatedBlock : celui-ci ne détecte que
 * des blocs de LIGNES répétés à l'identique et d'au moins `minBlockChars`
 * caractères. Ici on attrape les cas où le modèle émet un même mot court en
 * boucle ("tool tool tool ...") ou une séquence de caractères sans espaces
 * répétée en boucle ("tooltooltool...").
 *
 * Deux modes :
 *  a) un même mot répété consécutivement au moins `minWordRepeat` fois ;
 *  b) une séquence de caractères (token sans espace) suffisamment longue et
 *     périodique (motif minimal répété au moins `minSeqRepeat` fois).
 *
 * @param {string} text - texte brut de la réflexion / streaming du modèle
 * @param {object} [options]
 * @param {number} [options.minWordRepeat=8] - nb de répétitions consécutives d'un même mot
 * @param {number} [options.minSeqChars=12] - longueur minimale d'un token sans espace à tester
 * @param {number} [options.minSeqRepeat=3] - nb de répétitions minimales du motif périodique
 * @returns {boolean} true si une répétition de mots / séquence est détectée
 */
export function detectRepeatedWord(text, options = {}) {
  const minWordRepeat = options.minWordRepeat ?? 8;
  const minSeqChars = options.minSeqChars ?? 12;
  const minSeqRepeat = options.minSeqRepeat ?? 3;

  if (!text || typeof text !== "string") return false;

  const tokens = text.split(/\s+/).filter(Boolean);

  // (a) Même mot répété consécutivement.
  let run = 1;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1]) {
      run++;
      if (run >= minWordRepeat) return true;
    } else {
      run = 1;
    }
  }

  // (b) Séquence de caractères périodique sans espaces.
  for (const token of tokens) {
    if (token.length < minSeqChars) continue;
    const period = findSmallestPeriod(token);
    if (period > 0 && token.length / period >= minSeqRepeat) return true;
  }

  return false;
}

/**
 * Détecte une boucle de TOOL CALLS (issue #55) : un agent qui répète le même
 * appel d'outil (ex: la même commande bash) en boucle, sans streamer de texte.
 * Les détecteurs de texte (detectRepeatedBlock / detectRepeatedWord /
 * detectSemanticLoop) ne voient pas ce type de boucle car le modèle n'émet pas
 * de réflexion répétée — il enchaîne des appels d'outils identiques.
 *
 * @param {string[]} fingerprints - empreintes compactes des derniers tool calls
 * @param {object} [options]
 * @param {number} [options.minRepeat=3] - nb de tool calls identiques consécutifs déclenchant la boucle
 * @returns {boolean} true si une répétition de tool calls est détectée
 */
export function detectRepeatedToolCalls(fingerprints, options = {}) {
  const minRepeat = options.minRepeat ?? 3;
  if (!Array.isArray(fingerprints) || fingerprints.length < minRepeat) return false;
  let run = 1;
  for (let i = 1; i < fingerprints.length; i++) {
    if (fingerprints[i] === fingerprints[i - 1]) {
      run++;
      if (run >= minRepeat) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/**
 * Détecte une boucle d'ACTIONS de l'agent standard (lectures de fichiers,
 * recherches, commandes bash) : un agent qui répète la même action (relire le
 * même fichier, refaire la même recherche, relancer la même commande) avec un
 * texte différent. Complète les détecteurs de texte (detectRepeatedBlock /
 * detectRepeatedWord / detectSemanticLoop) et le détecteur de tool calls
 * CONSÉCUTIFS (detectRepeatedToolCalls) : ici on compte les occurrences de
 * chaque action dans une fenêtre glissante, sans exiger qu'elles soient
 * consécutives — l'agent peut intercaler d'autres actions entre deux répétitions
 * de la même action.
 *
 * @param {string[]} fingerprints - historique des dernières actions (empreintes)
 * @param {object} [options]
 * @param {number} [options.windowSize=20] - taille de la fenêtre analysée (dernières actions)
 * @param {number} [options.minRepeat=5] - nb d'occurrences d'une même action déclenchant la boucle
 * @returns {boolean} true si une action est répétée minRepeat fois dans la fenêtre
 */
export function detectRepeatedActions(fingerprints, options = {}) {
  const windowSize = options.windowSize ?? 20;
  const minRepeat = options.minRepeat ?? 5;
  if (!Array.isArray(fingerprints) || fingerprints.length < minRepeat) return false;
  const window = fingerprints.slice(-windowSize);
  const counts = new Map();
  for (const fp of window) {
    const c = (counts.get(fp) || 0) + 1;
    if (c >= minRepeat) return true;
    counts.set(fp, c);
  }
  return false;
}

/**
 * Construit une empreinte compacte d'un tool call pour la détection de boucle
 * (issue #55 / #10). Pour bash, la commande est l'essentiel ; sinon on sérialise
 * les arguments de façon stable. Partagé entre super-agent.js et agents-bus.js
 * pour que les requêtes DB (db_query/db_execute) produisent la même empreinte
 * quel que soit le canal qui les transporte.
 * @param {string} toolName
 * @param {object} args
 * @returns {string}
 */
export function buildToolLoopFingerprint(toolName, args) {
  const a = args || {};
  const command = a.command || a.cmd || "";
  if (command) return "tool::" + toolName + "::" + command;
  const path = a.path || a.file || "";
  if (path) {
    // Issue (faux positif) : l'outil read de pi accepte `path` + `offset` (ligne
    // de départ, 1-indexée) + `limit` pour lire un GROS fichier par morceaux à
    // des positions successives. Si on ne clé que sur le path, deux lectures du
    // même fichier à des offsets différents produisent la MÊME empreinte → un
    // agent qui parcourt un gros fichier se fait détecter à tort comme une
    // boucle d'actions. On différencie donc l'empreinte par offset (et limit si
    // présents). Quand offset est absent (lecture simple), on garde le
    // comportement historique (path seul) pour ne rien casser.
    if (a.offset !== undefined && a.offset !== null) {
      let fp = "tool::" + toolName + "::" + path + "::offset=" + a.offset;
      if (a.limit !== undefined && a.limit !== null) {
        fp += "::limit=" + a.limit;
      }
      return fp;
    }
    // P0-2 (faux positifs) : pour les outils de recherche (search/grep/find…),
    // clé sur la REQUÊTE (query/pattern/search/text) en plus du chemin : deux
    // recherches au même endroit avec des requêtes différentes ne sont pas une
    // boucle. Sans cela, deux recherches à la même racine produisaient la MÊME
    // empreinte (path seul) et déclenchaient un faux positif.
    // Correctif faux positif (session codeur tuée ~12 ms après le 3ᵉ `edit`) :
    // un `edit` (et tout outil d'écriture : write/create/patch…) n'était clé QUE
    // sur son chemin — le CONTENU écrit (oldText/newText) n'entrait pas dans
    // l'empreinte. Trois modifications DIFFÉRENTES du même fichier produisaient
    // donc trois empreintes IDENTIQUES → detectRepeatedToolCalls (minRepeat=3)
    // → arrêt automatique de l'agent en plein travail normal. On ajoute une
    // empreinte du contenu : trois écritures différentes ne sont plus une boucle,
    // trois écritures identiques le restent (vraie boucle).
    const writeContent = collectWriteContent(a);
    if (writeContent !== null) {
      return (
        "tool::" + toolName + "::" + path +
        "::content=" + writeContent.length + ":" + hashLoopContent(writeContent)
      );
    }
    const query = a.query || a.pattern || a.search || a.regex || "";
    if (query) {
      return "tool::" + toolName + "::" + path + "::query=" + query;
    }
    return "tool::" + toolName + "::" + path;
  }
  try {
    return "tool::" + toolName + "::" + JSON.stringify(a);
  } catch (_) {
    return "tool::" + toolName;
  }
}

// ── Empreinte de CONTENU des écritures (correctif faux positif de boucle) ──
//
// Un outil d'écriture (`edit`, `write`, `create`, `patch`…) reçoit le contenu
// qu'il écrit dans des champs dont les noms varient selon l'outil. On ne code
// donc AUCUNE liste d'outils en dur : la présence d'un de ces champs suffit à
// considérer l'appel comme une écriture (aucun outil de lecture/recherche ne
// porte ces champs).
const WRITE_CONTENT_KEYS = [
  "edits",
  "content",
  "newContent",
  "new_content",
  "newText",
  "new_text",
  "new_string",
  "oldText",
  "old_string",
  "patch",
  "diff",
  "text",
];
// Champs lus à l'intérieur d'un objet d'édition (`{oldText, newText}`,
// `{old_string, new_string}`…).
const WRITE_EDIT_VALUE_KEYS = ["oldText", "newText", "old_string", "new_string", "content", "text"];

/**
 * Extrait le contenu d'écriture d'un appel d'outil, sous forme d'une chaîne
 * stable (même appel → même chaîne, quel que soit le chemin qui la produit).
 * @param {object} args - arguments du tool call
 * @returns {string|null} null si l'appel ne porte aucun contenu d'écriture
 */
export function collectWriteContent(args) {
  const a = args || {};
  const parts = [];
  const push = (value) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string") { parts.push(value); return; }
    if (typeof value === "number" || typeof value === "boolean") { parts.push(String(value)); return; }
    if (Array.isArray(value)) { for (const item of value) push(item); return; }
    if (typeof value === "object") {
      for (const key of WRITE_EDIT_VALUE_KEYS) {
        if (Object.prototype.hasOwnProperty.call(value, key)) push(value[key]);
      }
    }
  };
  for (const key of WRITE_CONTENT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(a, key)) push(a[key]);
  }
  return parts.length ? parts.join("\u0000") : null;
}

/**
 * Empreinte compacte (16 caractères hexadécimaux = deux lanes 32 bits) d'un
 * contenu. Déterministe, sans dépendance externe : deux contenus différents
 * produisent deux empreintes différentes (collision négligeable), deux contenus
 * identiques la même.
 * @param {string} text
 * @returns {string}
 */
export function hashLoopContent(text) {
  const s = typeof text === "string" ? text : String(text ?? "");
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0xc2b2ae35 >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 8) | (i & 0xff)), 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Retourne le plus petit motif (période) tel que `str` soit une répétition
 * exacte de ce motif, ou 0 si `str` n'est pas périodique.
 * @param {string} str
 * @returns {number}
 */
function findSmallestPeriod(str) {
  const n = str.length;
  for (let p = 1; p <= n / 2; p++) {
    if (n % p !== 0) continue;
    const motif = str.slice(0, p);
    let ok = true;
    for (let i = p; i < n; i++) {
      if (str[i] !== motif[i % p]) {
        ok = false;
        break;
      }
    }
    if (ok) return p;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-recovery anti-boucle adaptatif (issue #37 étendue)
//
// Au lieu d'abandonner après 2 corrections, on escalade automatiquement à
// travers 4 stratégies puis, en dernier recours, on abandonne avec le message
// clair actuel. Les stratégies sont pilotées par le re-prompt (instructions
// d'échantillonnage explicites) car le protocole RPC de pi ne permet PAS de
// modifier température / top_p / pénalité par prompt (samplingParams est une
// config statique par modèle dans models.json). Le pilotage par le message est
// donc le mécanisme qui fonctionne réellement avec l'architecture actuelle.
//
// Niveaux d'escalade :
//   1. Troncature + pilotage : retirer la queue répétée et ordonner d'avancer.
//   2. Pénalité de répétition + température : ordonner plus de variété.
//   3. Échantillonnage déterministe : ordonner une réponse directe/définitive.
//   4. Élagage du contexte : ordonner de repartir d'un point propre.
//   5. Abandon : message clair (dernier recours).

/**
 * Nombre maximal de stratégies d'escalade (niveaux 1 à 4). Le niveau 5
 * (abandon) est déclenché quand ce seuil est atteint et qu'une boucle est
 * détectée à nouveau. Remplace l'ancien MAX_LOOP_CORRECTIONS=2.
 */
export const MAX_LOOP_ESCALATION = 4;

/**
 * Identifiants symboliques des niveaux d'escalade (pour lisibilité).
 */
export const LOOP_ESCALATION_LEVELS = {
  TRUNCATE_STEER: 1,
  PENALTY_TEMP: 2,
  DETERMINISTIC: 3,
  PRUNE_CONTEXT: 4,
  ABANDON: 5,
};

// Mots-outils (français + anglais) exclus du calcul de similarité sémantique :
// ils n'apportent pas de signal sur le contenu répété.
const LOOP_STOPWORDS = new Set([
  "le", "la", "les", "de", "des", "du", "un", "une", "et", "ou", "mais",
  "donc", "or", "ni", "car", "que", "qui", "quoi", "dans", "pour", "sur",
  "avec", "sans", "par", "en", "au", "aux", "ce", "cet", "cette", "ces",
  "je", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "se",
  "sa", "son", "ses", "mon", "ma", "mes", "ton", "ta", "tes", "notre",
  "votre", "leur", "leurs", "est", "sont", "a", "ont", "être", "avoir",
  "pas", "plus", "ne", "non", "oui", "si", "tout", "tous", "toute",
  "toutes", "comme", "aussi", "très", "bien", "alors", "puis", "après",
  "avant", "vers", "chez", "entre", "sous", "à", "the", "a", "an", "and",
  "or", "but", "for", "of", "to", "in", "on", "with", "without", "by",
  "at", "from", "is", "are", "was", "were", "be", "been", "have", "has",
  "had", "do", "does", "did", "not", "no", "yes", "it", "this", "that",
  "these", "those", "i", "you", "he", "she", "we", "they", "my", "your",
  "his", "her", "its", "our", "their", "as", "so", "then", "also", "very",
  "well", "will", "would", "can", "could", "should", "may", "might", "must",
]);

/**
 * Extrait les mots significatifs d'un texte (minuscules, longueur > 3, hors
 * mots-outils). Utilisé pour la similarité sémantique.
 * @param {string} text
 * @returns {string[]}
 */
function significantWords(text) {
  if (typeof text !== "string") return [];
  const words = text.toLowerCase().split(/[^a-zà-ÿ0-9]+/i).filter(Boolean);
  return words.filter((w) => w.length > 3 && !LOOP_STOPWORDS.has(w));
}

/**
 * Similarité de Jaccard entre deux ensembles de mots significatifs.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number} 0..1
 */
function jaccardSimilarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Détection sémantique de boucle : détecte les cas où le modèle répète les
 * MÊMES IDÉES avec des mots différents (pas seulement le texte identique, que
 * couvrent detectRepeatedBlock / detectRepeatedWord).
 *
 * Principe : on découpe le texte en blocs (paragraphes séparés par une ligne
 * vide), on prend les `maxBlocks` derniers, et on calcule la similarité de
 * Jaccard sur les mots significatifs entre blocs consécutifs. Si au moins
 * `minConsecutive` paires consécutives dépassent `threshold`, c'est une boucle
 * sémantique.
 *
 * @param {string} text - texte brut de la réflexion / streaming du modèle
 * @param {object} [options]
 * @param {number} [options.maxBlocks=6] - fenêtre : derniers blocs analysés
 * @param {number} [options.minBlockChars=80] - taille minimale d'un bloc (caractères)
 * @param {number} [options.threshold=0.6] - similarité Jaccard déclenchant la boucle
 * @param {number} [options.minConsecutive=2] - nb de paires consécutives similaires
 * @returns {boolean} true si une boucle sémantique est détectée
 */
export function detectSemanticLoop(text, options = {}) {
  const maxBlocks = options.maxBlocks ?? 6;
  const minBlockChars = options.minBlockChars ?? 80;
  const threshold = options.threshold ?? 0.6;
  const minConsecutive = options.minConsecutive ?? 2;

  if (!text || typeof text !== "string") return false;

  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length >= minBlockChars);
  const window = blocks.slice(-maxBlocks);
  if (window.length < minConsecutive + 1) return false;

  let run = 0;
  for (let i = 1; i < window.length; i++) {
    const sim = jaccardSimilarity(significantWords(window[i - 1]), significantWords(window[i]));
    if (sim >= threshold) {
      run++;
      if (run >= minConsecutive) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/**
 * Retourne la « queue répétée » du texte (le bloc qui se répète à l'identique
 * en fin de flux), pour permettre la troncature avant re-prompt (niveau 1).
 * Réutilise la même logique que detectRepeatedBlock mais renvoie le texte à
 * retirer au lieu d'un booléen. Retourne "" si aucune répétition.
 *
 * @param {string} text - texte brut de la réflexion / streaming du modèle
 * @param {object} [options] - mêmes options que detectRepeatedBlock
 * @returns {string} la queue répétée à tronquer (ou "")
 */
export function findRepeatedTail(text, options = {}) {
  const maxLines = options.maxLines ?? 40;
  const minBlockLines = options.minBlockLines ?? 1;
  const minBlockChars = options.minBlockChars ?? 150;
  const minRepeat = options.minRepeat ?? 3;

  if (!text || typeof text !== "string") return "";

  const lines = text.split("\n");
  const window = lines.slice(-maxLines);
  const norm = window.map(normalizeLoopLine);

  const maxBlockLines = Math.floor(norm.length / minRepeat);
  if (maxBlockLines < minBlockLines) return "";

  for (let blockLines = minBlockLines; blockLines <= maxBlockLines; blockLines++) {
    for (let start = 0; start + blockLines * minRepeat <= norm.length; start++) {
      const block = norm.slice(start, start + blockLines);
      const key = block.join("\n").trim();
      if (key.length < minBlockChars) continue;

      let count = 1;
      for (let i = start + blockLines; i + blockLines <= norm.length; i += blockLines) {
        if (norm.slice(i, i + blockLines).join("\n").trim() === key) count++;
        else break;
      }
      if (count >= minRepeat) {
        // La queue répétée va de `start` jusqu'à la fin de la fenêtre.
        return window.slice(start).join("\n");
      }
    }
  }
  return "";
}

/**
 * Construit le message de correction de boucle pour un niveau d'escalade
 * donné. Chaque niveau pilote explicitement le comportement d'échantillonnage
 * du modèle (le RPC de pi ne permettant pas de changer température / top_p /
 * pénalité par prompt, on le fait par instruction).
 *
 * @param {number} level - niveau d'escalade (1..4)
 * @param {object} [options]
 * @param {string} [options.repeatedTail] - queue répétée détectée (pour la troncature)
 * @returns {string} le message de correction à envoyer
 */
export function buildLoopCorrectionPrompt(level, options = {}) {
  const base =
    "Tu tournes en boucle : tu répètes le même contenu (parfois avec des mots différents). ";
  const tail = (options && options.repeatedTail) || "";
  const tailNote = tail
    ? " La partie répétée de ta sortie précédente est ignorée : ne la reprends pas. "
    : " ";

  switch (level) {
    case LOOP_ESCALATION_LEVELS.TRUNCATE_STEER:
      return (
        base +
        tailNote +
        "Arrête-toi immédiatement de répéter. Avance vers la conclusion de ta réponse de façon progressive et concise, sans revenir sur ce que tu as déjà dit."
      );
    case LOOP_ESCALATION_LEVELS.PENALTY_TEMP:
      return (
        base +
        tailNote +
        "Je modifie tes paramètres d'échantillonnage pour casser la boucle : répétition pénalisée et température légèrement haussée. Sois plus varié dans ton vocabulaire et avance directement vers la conclusion."
      );
    case LOOP_ESCALATION_LEVELS.DETERMINISTIC:
      return (
        base +
        tailNote +
        "Je passe en échantillonnage déterministe (température basse, top_p élevé). Produis une réponse structurée, directe et définitive, sans aucune redondance."
      );
    case LOOP_ESCALATION_LEVELS.PRUNE_CONTEXT:
      return (
        base +
        tailNote +
        "Je retire de ton contexte la partie qui boucle. Repars d'un point propre : résume en une phrase ce que tu as établi, puis conclus immédiatement."
      );
    default:
      return base + "Arrête-toi et conclus immédiatement.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Relance après détection d'une boucle d'ACTIONS (issue #110)
//
// Une boucle d'actions (relire le même fichier, relancer la même commande,
// refaire la même recherche) est détectée par detectRepeatedActions. Au lieu
// d'un arrêt définitif (comportement historique), on RELANCE l'agent avec un
// message de correction qui lui ordonne explicitement de CHANGER D'APPROCHE et
// de continuer le travail. Nombre maximal de relances : ACTION_LOOP_MAX_ESCALATION
// (au-delà, abandon définitif). L'escalade se fait par le message (le RPC pi ne
// permet pas de modifier les paramètres d'échantillonnage par prompt).

/**
 * Nombre maximal de relances avec correction pour une boucle d'actions.
 * Au-delà, on abandonne définitivement l'agent (voir agent_end).
 */
export const ACTION_LOOP_MAX_ESCALATION = 2;

/**
 * Construit le message de correction à envoyer à l'agent après une boucle
 * d'actions détectée. Le message ordonne de changer d'approche et de
 * continuer le travail, et devient plus explicite à chaque niveau d'escalade.
 *
 * @param {number} level - niveau d'escalade (1..ACTION_LOOP_MAX_ESCALATION)
 * @param {object} [options]
 * @returns {string} le message de correction à envoyer
 */
export function buildActionLoopCorrectionPrompt(level, options = {}) {
  const base =
    "Tu répètes les mêmes actions sans progresser : relire les mêmes fichiers, relancer les mêmes recherches ou commandes. ";
  switch (level) {
    case 1:
      return (
        base +
        "Arrête ce schéma immédiatement, change d'approche et continue le travail : identifie ce qui te bloque et passe à une action différente et concrète qui te fait réellement progresser vers l'objectif."
      );
    case 2:
      return (
        base +
        "C'est la deuxième fois que tu tournes en boucle d'actions. Change radicalement d'approche : analyse le problème sous un angle différent, consulte d'autres sources, reformule ta méthode, puis continue le travail jusqu'à compléter la tâche. Ne répète plus les mêmes actions."
      );
    default:
      return base + "Arrête ce schéma, change d'approche et continue le travail.";
  }
}

// ── Journal disque des arrêts AUTOMATIQUES d'agents (motif de l'arrêt) ──
//
// Un arrêt automatique (boucle détectée) n'était tracé que dans la console : le
// motif réel (« boucle d'outils » vs « boucle de réflexion ») était perdu, et
// aucune trace ne survivait à la session. Ces fonctions (PURES) produisent la
// ligne de journal ; l'écriture disque est faite par l'appelant (super-agent.js,
// agents-bus.js) avec les commandes IPC existantes — même emplacement que le
// journal des actions écran (`.pilot/screen-actions.log`).
export const AGENT_STOP_TRACE_RELATIVE_PATH = ".pilot/agent-stops.log";
export const AGENT_STOP_TRACE_MAX_CHARS = 256 * 1024;

/**
 * Assainit une valeur de champ : une seule ligne, espaces compactés, longueur
 * bornée (le journal doit rester lisible et parser sans ambiguïté).
 * @param {unknown} value
 * @param {number} [max=200]
 * @returns {string}
 */
function sanitizeTraceValue(value, max = 200) {
  const s = String(value === undefined || value === null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max - 3) + "..." : s;
}

/**
 * Construit une ligne du journal des arrêts automatiques (pure).
 * Format : `<RFC3339>  op=auto-stop  reason=…  detected=…  agent=…  project=…  uid=…`
 * (deux espaces entre champs, comme le journal des actions écran), suivi d'un
 * champ `detail=…` UNIQUEMENT quand l'appelant en fournit un (ex. libellés des
 * demandes abandonnées par le watchdog de file, RÈGLE 4). Les lignes sans
 * `detail` gardent exactement le format historique.
 * @param {object} entry
 * @param {string} entry.reason - cause de l'arrêt (ex: "loop-detection")
 * @param {string} [entry.detected] - détecteur déclenché (ex: "tool-calls", "text")
 * @param {string} [entry.agentId]
 * @param {string} [entry.projectPath]
 * @param {number|null} [entry.uid] - uid de session transmis à l'arrêt
 * @param {string} [entry.detail] - ce qui a été abandonné, nommé (optionnel)
 * @param {string} [entry.timestamp] - horodatage (défaut : maintenant)
 * @returns {string}
 */
export function buildAgentStopTraceLine(entry = {}) {
  const e = entry || {};
  const at = e.timestamp || new Date().toISOString();
  const uid = typeof e.uid === "number" && Number.isFinite(e.uid) && e.uid > 0 ? String(e.uid) : "none";
  const fields = [
    "op=auto-stop",
    "reason=" + (sanitizeTraceValue(e.reason, 60) || "unknown"),
    "detected=" + (sanitizeTraceValue(e.detected, 60) || "unknown"),
    "agent=" + (sanitizeTraceValue(e.agentId, 80) || "none"),
    "project=" + (sanitizeTraceValue(e.projectPath, 240) || "none"),
    "uid=" + uid,
  ];
  // `detail` (optionnel) : ce qui a été abandonné/perdu, nommé (libellés des
  // demandes en file). Sans lui, aucune ligne existante ne change de format.
  const detail = sanitizeTraceValue(e.detail, 400);
  if (detail) fields.push("detail=" + detail);
  return at + "  " + fields.join("  ");
}

/**
 * Ajoute une ligne à un journal existant et applique la rotation (cap en
 * caractères, on garde la FIN du journal — les arrêts les plus récents).
 * @param {string} existing - contenu actuel du journal ("" si absent)
 * @param {string} line - ligne à ajouter (sans saut de ligne)
 * @param {object} [options]
 * @param {number} [options.maxChars]
 * @returns {string} nouveau contenu du journal
 */
export function appendAgentStopTrace(existing, line, options = {}) {
  const maxChars = options.maxChars ?? AGENT_STOP_TRACE_MAX_CHARS;
  const prev = typeof existing === "string" ? existing : "";
  // La ligne est déjà assainie par `buildAgentStopTraceLine` (une seule ligne,
  // champs séparés par DEUX espaces — on ne collapse donc PAS les espaces ici).
  const entry = (typeof line === "string" ? line : "").replace(/[\r\n]+/g, " ").trim();
  if (!entry) return prev;
  const separator = prev && !prev.endsWith("\n") ? "\n" : "";
  let next = prev + separator + entry + "\n";
  if (next.length > maxChars) {
    const tail = next.slice(next.length - maxChars);
    const firstNewline = tail.indexOf("\n");
    next = firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail;
  }
  return next;
}

/**
 * Construit la commande IPC d'arrêt d'un agent pour un arrêt AUTOMATIQUE (pure).
 *
 * - uid de session connu → `stop_agent_process` avec `expectedUid` : c'est la
 *   commande dont la garde de propriété empêche de tuer la session d'une autre
 *   exécution (une session remplacée depuis le lancement est REFUSÉE) ;
 * - uid inconnu → `stop_agent_session` (chemin historique : il libère aussi
 *   l'activité du projet, issue #13 / tâche 335).
 *
 * @param {object} target
 * @param {string} [target.agentId]
 * @param {string|null} [target.projectPath]
 * @param {number|null} [target.uid]
 * @returns {{cmd: string, args: object, guarded: boolean}}
 */
export function buildAgentStopRequest({ agentId, projectPath, uid } = {}) {
  // La garde exige un uid ET un agent identifié (`stop_agent_process` prend un
  // `agent_id` obligatoire) : sans les deux, chemin historique.
  const valid =
    typeof uid === "number" && Number.isFinite(uid) && uid > 0 &&
    typeof agentId === "string" && agentId.length > 0;
  if (valid) {
    return {
      cmd: "stop_agent_process",
      args: { agentId, project: projectPath || null, expectedUid: uid },
      guarded: true,
    };
  }
  return {
    cmd: "stop_agent_session",
    args: { agentId: agentId || null, projectPath },
    guarded: false,
  };
}
