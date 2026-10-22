// deliverable-guard.js — GARDE-FOU DU LIVRABLE (défaut « l'agent rend un plan »).
//
// Défaut réel et reproductible (diagnostic `.pilot/rapports/rapport-diagnostic-agent-rend-un-plan.md`) :
// une demande d'ÉCRITURE confiée à un agent déclaré en LECTURE SEULE, à qui Pilot
// annonçait ensuite « tâche terminée » alors qu'aucun fichier n'existait.
//
// Ce module ferme ce trou aux DEUX extrémités, avec des fonctions PURES (aucune
// dépendance à l'UI, donc testables) :
//
//  1. REFUS AU LANCEMENT (`readOnlyWriteRefusalMessage`) : une demande qui
//     demande EXPLICITEMENT d'écrire/créer/modifier un fichier et qui ne vise
//     que des agents en lecture seule est refusée AVANT tout démarrage, avec un
//     message qui nomme l'agent, la raison et la sortie (choisir un agent qui
//     écrit). Le doute n'est JAMAIS un refus : sans ordre d'écriture ET sans
//     cible de fichier identifiables, la demande part comme avant.
//
//     Le refus ne repose PAS sur les mots employés mais sur ce que la demande
//     DEMANDE (défaut constaté en usage réel : des missions de LECTURE SEULE
//     étaient refusées à cause du verbe d'une phrase NÉGATIVE (« n'écrire aucun
//     rapport », « ne modifier aucun fichier »), d'une ÉTIQUELLE de verdict
//     (« À CORRIGER ») ou d'une citation de message de commit). Deux signaux
//     fiables seulement, dans cet ordre :
//       a. un livrable réellement attendu (`expected_files`) ;
//       b. un ORDRE d'écriture positif adressé à l'agent (impératif, base
//          verbale anglaise, ou infinitif gouverné par une formule de
//          consigne) ET une cible de fichier dans la MÊME proposition.
//  2. PREUVE DU LIVRABLE (`verifyExpectedFiles`) : quand la demande déclare les
//     fichiers réellement attendus sur disque (`expected_files`), Pilot vérifie
//     à la fin de la tâche que CHACUN existe. Absent ⇒ la tâche est rapportée en
//     ÉCHEC explicite nommant le fichier manquant (jamais « terminé »). Présent
//     ⇒ comportement inchangé, plus une confirmation. Sans fichiers déclarés,
//     RIEN ne change (rétrocompatibilité totale).
//
// Principe d'honnêteté : on ne suppose jamais ce que l'agent a fait. On dit ce
// qui manque et où on l'attendait, et rien de plus.

import { resolvePath } from "./orchestration.js";

/**
 * Normalise un texte pour l'analyse : minuscules, apostrophes typographiques
 * ramenées à l'apostrophe droite, espaces réduits. Les ACCENTS sont CONSERVÉS :
 * ils distinguent l'ORDRE de l'ÉTAT (« modifie » impératif n'est pas
 * « modifié » participe) — c'est ce qui rend le contrôle fiable.
 */
export function normalizeForMatch(text) {
  return String(text == null ? "" : text)
    .normalize("NFC")
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Découpe un texte en PROPOSITIONS. Un ordre et sa cible doivent se trouver dans
 * la MÊME proposition : un mot d'écriture isolé, ailleurs dans le texte, ne
 * prouve jamais une demande d'écriture (étiquette, citation, description).
 * Le point n'est un séparateur que s'il est suivi d'un blanc ou de la fin du
 * texte — un chemin comme `src/js/main.js` ou une version `0.4.39` reste intact.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSegments(text) {
  return String(text == null ? "" : text)
    .split(/\n+|;|!|\?|\.(?=\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── Détection du besoin d'ÉCRIRE (conservatrice, fondée sur un ORDRE) ───────
// Verbes qui demandent explicitement de PRODUIRE ou de MODIFIER un fichier.
// Volontairement limités : un mot absent ne peut pas provoquer un refus indu
// (« dans le doute on lance »). Sert de TRACE (champ `verb`), jamais de décision.
const WRITE_VERB_RE = new RegExp(
  "\\b(?:" +
    [
      // français
      "ecri(?:s|re|vez|t|vent|vant)",
      "cre(?:e|er|ez|ent|ant)",
      "modifi(?:e|er|ez|ent|ant|é|és)",
      "gener(?:e|er|ez|ent|ant|é)",
      "ajout(?:e|er|ez|ent|ant|é)",
      "enregistr(?:e|er|ez|ent|ant|é)",
      "remplac(?:e|er|ez|ent|ant|é)",
      "corrig(?:e|er|ez|ent|ant|é)",
      "implement(?:e|er|ez|ent|ant|é)",
      "mets? a jour",
      "mettre a jour",
      // anglais (une demande peut arriver dans la langue du modèle)
      "writ(?:e|es|ing)",
      "creat(?:e|es|ing)",
      "modif(?:y|ies|ying)",
      "edit(?:s|ing)?",
      "sav(?:e|es|ing)",
      "updat(?:e|es|ing)",
    ].join("|") +
    ")\\b"
);

// Cible de fichier : un chemin avec extension connue, ou le mot « fichier ».
const FILE_EXT_RE = new RegExp(
  "\\b[\\w./\\\\-]+\\.(?:" +
    [
      "markdown", "md", "txt", "jsonl", "json", "mjs", "cjs", "js", "tsx", "ts", "jsx",
      "css", "scss", "sass", "less", "html", "htm", "rs", "py", "rb", "go", "java",
      "kt", "kts", "cc", "cpp", "hpp", "cs", "php", "bash", "sh", "ps1", "bat", "cmd",
      "sql", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "xml", "svg", "vue",
      "svelte", "astro", "lock", "gradle", "swift", "dart", "lua", "pl", "csv", "xlsx",
      "pdf", "png", "c", "h",
    ].join("|") +
    ")\\b",
  "i"
);
const FILE_NOUN_RE = /\bfichiers?\b|\bfiles?\b/;
// Même motif, global : sert à RETIRER les chemins avant la recherche du verbe.
const FILE_EXT_GLOBAL_RE = new RegExp(FILE_EXT_RE.source, "gi");

/**
 * Retire les CHEMINS de fichier d'un texte. Un nom de fichier n'est jamais un
 * ordre : `corrige-guard.md` ne doit pas être lu comme l'impératif « corrige ».
 * @param {string} text
 * @returns {string}
 */
export function stripFileTargets(text) {
  return String(text || "").replace(FILE_EXT_GLOBAL_RE, " ");
}

// ── 1. Formes d'ORDRE : le seul signal fiable d'une demande d'écriture ─────
// Un mot du domaine de l'écriture ne prouve RIEN : il peut être une étiquette
// (« À CORRIGER »), un nom (« une correction »), un participe (« le fichier a
// été modifié »), la citation d'un message de commit ou un nom de fichier.
// Seule une forme d'ORDRE adressée à l'agent compte :
//   - impératif 2e personne en français (« écris », « modifie », « génère »…) ;
//   - base verbale en anglais (« write », « modify »…) ;
//   - infinitif GOUVERNÉ par une formule de consigne (« il faut écrire »,
//     « merci de créer », « tu dois modifier »…), ou placé en TÊTE de
//     proposition (liste de tâches : « - modifier src/js/main.js »).
// Les variantes accentuées sont tolérées, mais la DERNIÈRE lettre de chaque
// forme reste exacte : c'est elle qui sépare l'impératif du participe
// (« modifie » / « modifié », « écris » / « écrit »).
const ACCENT_CLASSES = {
  a: "[aàâä]",
  c: "[cç]",
  e: "[eéèêë]",
  i: "[iîï]",
  o: "[oôö]",
  u: "[uùûü]",
  y: "[yÿ]",
};

/** Rend un mot tolérant aux accents (« ecrire » accepte « écrire »). */
function accentTolerant(word) {
  return String(word).replace(/[aceiouy]/g, (ch) => ACCENT_CLASSES[ch]);
}

/** Tolérant aux accents SAUF la dernière lettre, qui reste exacte. */
function accentTolerantKeepingEnd(word) {
  const w = String(word);
  return accentTolerant(w.slice(0, -1)) + w.slice(-1);
}

/** Alternatives tolérantes aux accents (fin de chaque forme exacte). */
function orderAlternation(words) {
  return words.map(accentTolerantKeepingEnd).join("|");
}

// Un « \b » ne fonctionne pas devant une voyelle accentuée (é n'est pas un
// caractère de mot en JavaScript) : on borne par un séparateur explicite.
const WORD_START = "(?:^|[\\s,;:()\\[\\]{}\"'«»—–…-])";

const WRITE_ORDER_FR = [
  "ecris", "ecrivez", "cree", "creez", "modifie", "modifiez", "genere", "generez",
  "ajoute", "ajoutez", "enregistre", "enregistrez", "remplace", "remplacez",
  "corrige", "corrigez", "implemente", "implementez", "applique", "appliquez",
  "redige", "redigez", "produis", "produisez", "complete", "completez",
  "edite", "editez", "sauvegarde", "sauvegardez", "mets a jour", "mettez a jour",
];

// Anglais : base verbale (impératif). Aucun accent, formes exactes.
const WRITE_ORDER_EN = [
  "write", "create", "modify", "edit", "update", "add", "fix", "save",
  "implement", "apply", "generate", "replace", "patch", "refactor",
];

const WRITE_INFINITIVE_FR = [
  "ecrire", "creer", "modifier", "generer", "ajouter", "enregistrer",
  "remplacer", "corriger", "implementer", "appliquer", "rediger", "produire",
  "completer", "editer", "sauvegarder", "mettre a jour",
];

const WRITE_ORDER_RE = new RegExp(
  WORD_START + "(?:" + orderAlternation(WRITE_ORDER_FR) + "|" + WRITE_ORDER_EN.join("|") + ")\\b"
);
const WRITE_INFINITIVE_RE = new RegExp(WORD_START + "(?:" + orderAlternation(WRITE_INFINITIVE_FR) + ")\\b");

// Un impératif 2e personne et un présent 3e personne s'écrivent pareil
// (« il modifie » / « modifie »). Un sujet à la 3e personne devant le verbe =
// DESCRIPTION, pas un ordre adressé à l'agent.
const THIRD_PERSON_BEFORE =
  /(?:^|\s)(?:[a-zà-ÿ']*')?(?:il|elle|ils|elles|on|qui|ça|ca|cela|ceci|personne|chacun|agent|agents|codeur|assistant|planificateur|reviewer|script)\s+$/;

// Formules qui transforment un infinitif en CONSIGNE.
const ORDER_MARKERS = [
  "il faut", "il est demande de", "il est demande d'", "il est necessaire de",
  "tu dois", "vous devez", "tu devras", "vous devrez", "dois ", "devez ",
  "merci de", "merci d'", "veuillez", "je veux que", "je souhaite que",
  "commence par", "commencez par", "pense a", "pensez a",
  "fais en sorte de", "fais en sorte d'",
  "objectif", "consigne", "attendu", "tache", "mission",
].map((marker) => new RegExp(accentTolerant(marker), "g"));

/**
 * Formule de consigne devant l'infinitif ? Une QUESTION n'est jamais un ordre :
 * « dis-moi s'il faut modifier… » ne demande rien à l'agent.
 * @param {string} before - texte qui précède l'infinitif
 * @returns {boolean}
 */
function hasOrderMarkerBefore(before) {
  const tail = String(before || "").slice(-90);
  for (const re of ORDER_MARKERS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(tail)) !== null) {
      const prefix = tail.slice(Math.max(0, m.index - 4), m.index);
      // « s'il faut… », « si … » : hypothèse, pas une consigne.
      if (!/(?:^|\s)s'\s*$|\bsi\s+$/.test(prefix)) return true;
      if (m[0].length === 0) re.lastIndex += 1; // garde-fou anti-boucle
    }
  }
  return false;
}

/**
 * Le verbe d'écriture est-il employé comme ORDRE dans cette proposition ?
 * Aucune autre forme n'est acceptée : ni nom, ni participe, ni étiquette.
 * @param {string} segment - proposition normalisée (négations neutralisées)
 * @returns {string|null} la forme d'ordre trouvée, sinon null
 */
export function findWriteOrder(segment) {
  const text = String(segment || "");
  const imperative = text.match(WRITE_ORDER_RE);
  if (imperative) {
    // Le séparateur consommé devant le verbe fait partie du contexte examiné.
    const prefix = text.slice(0, imperative.index + 1);
    if (!THIRD_PERSON_BEFORE.test(prefix)) return imperative[0].trim();
  }
  const infinitive = text.match(WRITE_INFINITIVE_RE);
  if (!infinitive) return null;
  const before = text.slice(0, infinitive.index);
  const head = before.replace(/^[\s\-*•\d.)\]]+/, "");
  // Infinitif GOUVERNÉ par une consigne, ou en TÊTE de proposition (liste).
  if (hasOrderMarkerBefore(head) || !head) return infinitive[0].trim();
  return null;
}

// Négations : on neutralise ces segments AVANT l'analyse, pour ne jamais
// refuser « analyse le fichier sans rien modifier », « ne modifie pas ce
// fichier », « n'écrire aucun rapport », « ne modifier aucun fichier ».
// Neutraliser ne peut que rendre la détection PLUS tolérante.
const NEGATION_WRITE_WORDS = [
  "modifier", "ecrire", "editer", "toucher", "changer", "creer", "produire",
  "enregistrer", "sauvegarder", "ajouter", "corriger", "mettre",
];
const NEGATION_OBJECT_WORDS = [
  "modification", "ecriture", "fichier", "changement", "creation", "correction",
  "ajout", "edition", "sauvegarde", "rapport",
];

const NEGATION_PATTERNS = [
  // « sans (rien) écrire/modifier… » jusqu'à la fin de la proposition
  new RegExp(
    "\\bsans\\s+(?:rien\\s+)?(?:le\\s+|la\\s+|les\\s+|de\\s+|d'|du\\s+)?" +
      "(?:" + NEGATION_WRITE_WORDS.map(accentTolerantKeepingEnd).join("|") + ")" +
      "\\b[^.;!?\\n,]*",
    "g"
  ),
  // « ne … pas / jamais / rien / aucun / plus » et « n' … <négation> ».
  // La VIRGULE borne la portée de la négation : « ne modifie pas le code, puis
  // écris X » neutralise la négation SANS effacer l'ordre qui suit.
  /\b(?:ne|n')\s*[^.;!?\n,]{0,120}?\b(?:pas|jamais|rien|aucune?|nullement|plus)\b[^.;!?\n,]*/g,
  // « aucun fichier », « aucune écriture »… (pluriel compris)
  new RegExp(
    "\\baucun(?:e)?\\s+(?:" +
      NEGATION_OBJECT_WORDS.map((w) => accentTolerantKeepingEnd(w) + "s?").join("|") +
      ")\\b[^.;!?\\n,]*",
    "g"
  ),
  // « interdit de », « surtout pas », « abstiens-toi de »
  /\b(?:interdit|interdiction|surtout\s+pas|abstiens?-toi|abstenez-vous|s'abstenir)\b[^.;!?\n]*/g,
  // anglais
  /\bwithout\s+(?:modifying|writing|editing|creating|touching|changing)\b[^.;!?\n]*/g,
  /\b(?:do\s+not|don't|never)\s+(?:modify|write|edit|create|touch|change|add|update)\b[^.;!?\n]*/g,
  /\bno\s+(?:modifications?|changes?|writes?|files?)\b[^.;!?\n]*/g,
];

// Négations de FORME, ordre de FOND : « n'oublie pas de créer X » est un ordre
// d'écriture. Ces formules sont réécrites en consigne AVANT l'effacement des
// négations, sinon le garde-fou deviendrait permissif.
const FALSE_NEGATION_PATTERNS = [
  new RegExp(
    "\\b(?:" +
      ["n'oublie", "n'oubliez", "n'hesite", "n'hesitez", "ne manque", "ne manquez"]
        .map(accentTolerant)
        .join("|") +
      ")\\s+(?:pas|plus|surtout\\s+pas)\\s+(?:de\\s+|d'|a\\s+)",
    "g"
  ),
];

/**
 * Convertit les négations de forme qui portent en réalité un ORDRE.
 * @param {string} normalizedText
 * @returns {string}
 */
export function neutralizeFalseNegations(normalizedText) {
  let out = String(normalizedText || "");
  for (const re of FALSE_NEGATION_PATTERNS) out = out.replace(re, "il faut ");
  return out;
}

/** Retire (met à blanc) les segments négatifs d'un texte déjà normalisé. */
export function stripNegations(normalizedText) {
  let out = String(normalizedText || "");
  for (const re of NEGATION_PATTERNS) {
    out = out.replace(re, " ");
  }
  return out;
}

// Étiquettes et libellés : « à corriger », « à faire », « à compléter » sont des
// ÉTATS, pas des ordres. Seuls les mots de l'étiquette sont retirés : un vrai
// ordre qui suit dans la même proposition reste analysé.
const LABEL_WORDS = [
  "corriger", "faire", "modifier", "ecrire", "creer", "completer", "verifier",
  "relire", "traiter", "appliquer", "ajouter", "revoir", "reprendre", "refaire",
  "documenter", "sauvegarder",
];
const LABEL_PATTERN = new RegExp(
  "(?:^|\\s)" + accentTolerant("a") + "\\s+(?:" + LABEL_WORDS.map(accentTolerantKeepingEnd).join("|") + ")\\b",
  "g"
);

/** Retire les étiquettes de verdict/état d'un texte normalisé. */
export function stripLabels(normalizedText) {
  return String(normalizedText || "").replace(LABEL_PATTERN, " ");
}

// Citations : « … », " … ", “ … ”, ` … `. Un message de commit cité ou un nom
// de fichier cité n'est jamais un ordre adressé à l'agent. Les citations ne sont
// retirées que pour la recherche du VERBE : la CIBLE peut s'y trouver (un
// chemin entre accents graves reste une cible valable).
const QUOTED_PATTERNS = [/«[^»]*»/g, /"[^"]*"/g, /“[^”]*”/g, /`[^`]*`/g];

/**
 * Retire les passages CITÉS d'un texte (verbatim, message de commit…).
 * @param {string} text
 * @returns {string}
 */
export function stripQuoted(text) {
  let out = String(text || "");
  for (const re of QUOTED_PATTERNS) out = out.replace(re, " ");
  return out;
}

/**
 * Cible de fichier présente dans une proposition ?
 * @param {string} text
 * Cible de fichier présente dans une proposition ? La cible cherchée est celle
 * de l'ORDRE : on privilégie le premier chemin situé APRÈS le verbe, sinon le
 * premier chemin de la proposition (un chemin cité avant n'est pas la cible).
 * @param {string} text
 * @param {number} [fromIndex] - position du verbe dans `text`
 * @returns {{value: string, via: string}|null}
 */
function fileTargetIn(text, fromIndex = 0) {
  const source = String(text || "");
  const re = new RegExp(FILE_EXT_GLOBAL_RE.source, "gi");
  let first = null;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (!first) first = m[0];
    if (m.index >= fromIndex) return { value: m[0], via: "file-path" };
  }
  if (first) return { value: first, via: "file-path" };
  if (FILE_NOUN_RE.test(source)) return { value: "fichier", via: "file-noun" };
  return null;
}

/**
 * La demande demande-t-elle EXPLICITEMENT d'écrire/créer/modifier un fichier ?
 *
 * Conservateur par construction, et fondé sur ce que la mission DEMANDE, pas
 * sur les mots qu'elle contient. Deux signaux seulement :
 *  a. un livrable DÉCLARÉ (`expected_files`) — rien à interpréter ;
 *  b. un ORDRE d'écriture positif ET une cible de fichier dans la MÊME
 *     proposition, après neutralisation des négations, des étiquettes et des
 *     citations.
 * Un verbe d'écriture sans cible (ex. « écris un plan »), une phrase négative,
 * une étiquette (« À CORRIGER ») ou une citation ne déclenchent AUCUN refus.
 *
 * @param {string} taskText - texte de la demande (brut, avant enveloppe)
 * @param {{expectedFiles?: string[]}} [options]
 * @returns {{explicit: boolean, verb: string|null, target: string|null, via: string|null}}
 *   `via` : "expected_files" | "file-path" | "file-noun" | null (traçabilité).
 */
export function detectExplicitWriteRequest(taskText, options = {}) {
  const declared = normalizeExpectedFiles(options && options.expectedFiles);
  if (declared.length > 0) {
    return { explicit: true, verb: "livrable déclaré", target: declared[0], via: "expected_files" };
  }
  let ambiguousVerb = null;
  for (const raw of splitSegments(taskText)) {
    const segment = stripLabels(
      stripNegations(neutralizeFalseNegations(normalizeForMatch(raw)))
    ).trim();
    if (!segment) continue;
    // Verbe cherché hors des CHEMINS et des CITATIONS : un nom de fichier
    // (`corrige-guard.md`) ou un message de commit cité n'est pas un ordre.
    const forVerb = stripQuoted(stripFileTargets(segment));
    const order = findWriteOrder(forVerb);
    if (!order) {
      // Verbe d'écriture employé dans une autre forme (nom, participe, état) :
      // ce n'est pas un ordre. On le retient seulement pour la traçabilité.
      if (!ambiguousVerb) {
        const any = forVerb.match(WRITE_VERB_RE);
        if (any) ambiguousVerb = any[0];
      }
      continue;
    }
    // La cible cherchée est celle de l'ORDRE (« … puis écris docs/rapport.md »).
    const at = order ? segment.toLowerCase().indexOf(order) : -1;
    const target = fileTargetIn(segment, at >= 0 ? at + order.length : 0);
    if (!target) {
      // Ordre sans cible de fichier (ex. « écris un plan ») : AMBIGU → aucune
      // décision, la demande part comme aujourd'hui.
      if (!ambiguousVerb) ambiguousVerb = order;
      continue;
    }
    return { explicit: true, verb: order, target: target.value, via: target.via };
  }
  return { explicit: false, verb: ambiguousVerb, target: null, via: null };
}

/**
 * Message de REFUS (ou null) : la demande vise-t-elle une mission où TOUS les
 * agents sont en lecture seule en demandant explicitement d'écrire ?
 *
 * Tous les agents doivent être en lecture seule pour refuser : une mission qui
 * inclut un agent qui écrit reste légitime (c'est lui qui produira le fichier).
 *
 * @param {object} params
 * @param {string} params.tool - outil appelant (run_agents, run_assistant_agents…)
 * @param {Array<{id: string, name?: string, readonly?: boolean}>} params.agents
 * @param {string} params.task - demande brute
 * @param {string[]} [params.expectedFiles]
 * @returns {string|null}
 */
export function readOnlyWriteRefusalMessage({ tool, agents, task, expectedFiles } = {}) {
  const list = (agents || []).filter((a) => a && a.id);
  if (list.length === 0) return null;
  if (!list.every((a) => a.readonly === true)) return null;
  const detection = detectExplicitWriteRequest(task, { expectedFiles });
  if (!detection.explicit) return null;
  const names = list.map((a) => `« ${a.name || a.id} »`).join(", ");
  const subject =
    list.length === 1
      ? `L'agent ${names} est en LECTURE SEULE`
      : `Les agents ${names} sont en LECTURE SEULE`;
  const target =
    detection.via === "expected_files"
      ? `le livrable déclaré « ${detection.target} »`
      : detection.via === "file-noun"
        ? `un fichier (verbe « ${detection.verb} »)`
        : `le fichier « ${detection.target} » (verbe « ${detection.verb} »)`;
  const prefix = tool ? `${tool} : ` : "";
  return (
    `${prefix}la demande n'a PAS été lancée. ${subject} : ce rôle ne modifie aucun fichier ` +
    `(il analyse, planifie ou rend un avis), or la demande demande explicitement d'écrire ${target}. ` +
    `Choisissez un agent qui écrit (le codeur du projet, par exemple) et relancez la demande. ` +
    `Si aucun fichier n'est réellement attendu, reformulez la demande comme une tâche de lecture.`
  );
}

/**
 * Normalise la liste des fichiers attendus sur disque (chemins relatifs au
 * projet). Tolère un champ absent, une chaîne unique, des entrées vides ou des
 * doublons. Aucune invention : ce qui est fourni est conservé tel quel (espaces
 * de bord retirés).
 * @param {unknown} input
 * @returns {string[]}
 */
export function normalizeExpectedFiles(input) {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim();
    if (!value) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** Liste lisible « « a », « b » ». */
function quoteList(items) {
  return items.map((i) => `« ${i} »`).join(", ");
}

/**
 * Texte du verdict d'un livrable vérifié.
 * @param {{declared: string[], present: string[], missing: string[], unreadable: string[], base: string|null, skipped: boolean}} check
 * @returns {string} ligne à joindre au rapport ("" si rien à dire)
 */
export function deliverableVerdictText(check) {
  if (!check) return "";
  const declared = Array.isArray(check.declared) ? check.declared : [];
  if (declared.length === 0) return "";
  if (check.skipped) {
    return (
      `ℹ️ Livrable déclaré (${quoteList(declared)}) mais non vérifiable : aucun dossier de référence ` +
      `n'a été fourni. Vérifiez son existence à la main.`
    );
  }
  if ((check.missing || []).length > 0) {
    const plural = check.missing.length > 1;
    const where = check.base ? ` (cherché${plural ? "s" : ""} dans « ${check.base} »)` : "";
    return (
      `❌ LIVRABLE ABSENT : le${plural ? "s" : ""} fichier${plural ? "s" : ""} ${quoteList(check.missing)} ` +
      `n'existe${plural ? "nt" : ""} pas sur le disque${where}. La tâche n'est donc PAS terminée : ` +
      `le${plural ? "s" : ""} fichier${plural ? "s" : ""} déclaré${plural ? "s" : ""} comme attendu${plural ? "s" : ""} ` +
      `n'a${plural ? "ont" : ""} pas été produit${plural ? "s" : ""}.`
    );
  }
  const unreadable = check.unreadable || [];
  const unreadableNote = unreadable.length
    ? ` (vérification impossible pour ${quoteList(unreadable)} : sonde indisponible)`
    : "";
  return `✅ Livrable vérifié sur le disque : ${quoteList(check.present || declared)}${unreadableNote}.`;
}

/**
 * Joint le verdict du livrable à un texte de rapport.
 * @param {string} text
 * @param {object|null} check
 * @returns {string}
 */
export function appendDeliverableVerdict(text, check) {
  const verdict = deliverableVerdictText(check);
  const body = String(text == null ? "" : text);
  if (!verdict) return body;
  return body ? `${body}\n\n${verdict}` : verdict;
}

/**
 * Vérifie l'EXISTENCE des fichiers déclarés (I/O via `invokeFn`, fail-open sur
 * une erreur de sonde : un échec de vérification n'échoue jamais la tâche).
 * L'existence est le seul critère : un fichier déclaré EXISTANT mais vide est
 * conforme.
 *
 * @param {object} params
 * @param {unknown} params.declared - fichiers attendus (relatifs au projet)
 * @param {string|null} params.base - dossier de référence (projet / espace)
 * @param {Function} params.invokeFn - `invoke` Tauri (injection pour les tests)
 * @returns {Promise<{declared: string[], present: string[], missing: string[], unreadable: string[], base: string|null, skipped: boolean}>}
 */
export async function verifyExpectedFiles({ declared, base, invokeFn } = {}) {
  const files = normalizeExpectedFiles(declared);
  const rawBase = base == null ? "" : String(base).trim();
  // Dossiers NON utilisables comme référence : vide, marqueur interne de
  // l'espace assistant (`__assistant__`), ou projet courant inconnu (".").
  const usableBase = rawBase && rawBase !== "__assistant__" && rawBase !== "." ? rawBase : null;
  const result = {
    declared: files,
    present: [],
    missing: [],
    unreadable: [],
    base: usableBase,
    skipped: false,
  };
  if (files.length === 0) return result;
  if (!usableBase) {
    // Aucun dossier de référence : on ne peut pas trancher honnêtement → on le
    // dit, sans inventer un échec.
    result.skipped = true;
    return result;
  }
  for (const rel of files) {
    const abs = resolvePath(rel, usableBase);
    try {
      const exists = await invokeFn("file_exists", { path: abs });
      if (exists) result.present.push(rel);
      else result.missing.push(rel);
    } catch (_) {
      result.unreadable.push(rel);
    }
  }
  return result;
}

/**
 * La vérification rend-elle la mission EN ÉCHEC ? Seul un fichier déclaré
 * ABSENT le fait (jamais une sonde indisponible, jamais un dossier de référence
 * absent).
 * @param {object|null} check
 * @returns {boolean}
 */
export function deliverableFailed(check) {
  return !!(check && Array.isArray(check.missing) && check.missing.length > 0);
}
