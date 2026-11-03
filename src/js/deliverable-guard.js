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
//          consigne) ET une cible de fichier dans la MÊME proposition, cette
//          cible étant le COMPLÉMENT de l'ORDRE (donc dans sa portée).
//
//     Correction d'un FAUX POSITIF constaté en usage réel (deux refus successifs
//     sur une mission d'ANALYSE en lecture seule : « Ajoute les familles qui
//     manquent… », puis « Complète avec les familles que le propriétaire n'a pas
//     citées… ») : la cible doit être ce que l'ORDRE demande de PRODUIRE. Un
//     fichier simplement MENTIONNÉ dans la phrase (« en te fondant sur les
//     fichiers du projet », « dans le fichier où se trouve la demande », « puis
//     ajoute … à ta réponse ») est une ENTRÉE de lecture, pas une sortie
//     attendue : il ne fonde aucun refus.
//
//     Second FAUX POSITIF corrigé (mêmes missions de lecture seule, refusées
//     encore) : le simple NOM « fichier » n'était pas distingué d'une SORTIE.
//     « Écris ta réponse dans le chat : liste les fichiers concernés », « Rédige
//     ton analyse des fichiers du projet », « Complète ton analyse avec les
//     fichiers que tu as lus » étaient refusées. Deux règles les séparent :
//       a. le nom « fichier » ne compte que s'il est le COMPLÉMENT DIRECT de
//          l'ordre (« écris un fichier de synthèse ») — un fichier rencontré
//          après une préposition ou un autre nom est une ENTRÉE de lecture ;
//       b. une DESTINATION « réponse / conversation / chat / message » ferme la
//          portée de l'ordre : ce qui suit qualifie la RÉPONSE, jamais un
//          fichier.
//  2. PREUVE DU LIVRABLE (`verifyExpectedFiles`) : quand la demande déclare les
//     fichiers réellement attendus sur disque (`expected_files`), Pilot vérifie
//     à la fin de la tâche que CHACUN existe, n'est pas VIDE (0 octet) et a
//     CHANGÉ depuis le lancement de la mission (taille et/ou date relevées
//     AVANT le travail par `captureDeliverableState`). Absent, vide ou inchangé
//     ⇒ la tâche est rapportée en ÉCHEC explicite nommant le fichier fautif
//     (jamais « terminé »). Un fichier vide ou déjà là avant la mission ne peut
//     plus tenir le rôle de livrable (trou C3).
//  3. DÉCLARATION OBLIGATOIRE (`undeclaredWriteRefusalMessage`) : une demande
//     qui ORDONNE d'écrire un fichier sans déclarer de livrable est refusée au
//     lancement, en nommant le fichier réclamé et le paramètre à renseigner
//     (trou C2 : la liste était facultative, donc la preuve n'avait rien à
//     vérifier). Même détection que le refus lecture seule, aucune décision
//     dans le doute.
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
// Même motif, global : sert à RETIRER les chemins avant la recherche du verbe.
const FILE_EXT_GLOBAL_RE = new RegExp(FILE_EXT_RE.source, "gi");

// (Historique) L'ancienne regle du nom « fichier » (`FILE_NOUN_RE`, supprimee le
// 2026-11-14) testait le mot N'IMPORTE OU dans la portee : des missions de
// lecture seule etaient donc refusees (« complete ton analyse avec les fichiers
// que tu as lus »). Elle n'est plus lue : la regle est desormais
// `FILE_NOUN_HEAD_RE` (le nom doit etre le COMPLEMENT DIRECT de l'ordre),
// cf. `fileTargetIn`.

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

// Déterminants et quantifiants qui peuvent précéder le nom « fichier » quand il
// est le COMPLÉMENT DIRECT de l'ordre (« écris un fichier », « crée les deux
// fichiers »). Au-delà de cette tête de complément, le nom est une ENTRÉE de
// lecture, pas une sortie (cf. `fileTargetIn`).
const FILE_NOUN_DETERMINERS = [
  "le", "la", "les", "l'", "un", "une", "des", "du", "de", "d'", "ce", "cet",
  "cette", "ces", "ton", "ta", "tes", "son", "sa", "ses", "mon", "ma", "mes",
  "notre", "nos", "votre", "vos", "leur", "leurs", "nouveau", "nouvel",
  "nouvelle", "nouveaux", "nouvelles", "premier", "premiere", "second",
  "seconde", "deuxieme", "troisieme", "petit", "petite", "grand", "grande",
  "seul", "seule", "unique", "meme", "memes", "autre", "autres", "deux",
  "trois", "quatre", "cinq", "plusieurs",
];
const FILE_NOUN_HEAD_RE = new RegExp(
  "^\\s*(?:(?:" +
    FILE_NOUN_DETERMINERS.map(accentTolerant).join("|") +
    ")\\s+)*(?:fichiers?|files?)\\b"
);

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
 * Masque les CHEMINS de fichier par des espaces de MÊME LONGUEUR : les index
 * restent alignés sur le texte d'origine (la position du verbe trouvée sur le
 * texte masqué vaut donc aussi pour le segment réel, où la cible doit rester
 * visible).
 * @param {string} text
 * @returns {string}
 */
export function maskFileTargets(text) {
  return String(text || "").replace(FILE_EXT_GLOBAL_RE, (m) => " ".repeat(m.length));
}

/**
 * Masque les passages CITÉS par des espaces de même longueur (mêmes raisons).
 * @param {string} text
 * @returns {string}
 */
export function maskQuoted(text) {
  let out = String(text || "");
  for (const re of QUOTED_PATTERNS) {
    out = out.replace(new RegExp(re.source, "g"), (m) => " ".repeat(m.length));
  }
  return out;
}

// ── Destinations qui ne sont PAS un fichier ────────────────────────────────
// Un ordre peut demander de rendre quelque chose DANS LA RÉPONSE : c'est une
// tâche de lecture (le résultat vit dans le message de l'agent), pas une
// écriture sur disque. Ces formules ferment la portée de l'ordre.
const RESPONSE_TARGET_RE = new RegExp(
  // Bornage par un séparateur explicite : un « \b » ne fonctionne pas devant une
  // voyelle accentuée (« à ta réponse »), é n'est pas un caractère de mot.
  WORD_START +
    "(?:" +
    [
      "dans ta reponse",
      "a ta reponse",
      "dans la reponse",
      "reponse finale",
      "dans ton message",
      "message de fin",
      "dans ta conversation",
      "dans la conversation",
      "dans le chat",
    ]
      .map(accentTolerant)
      .join("|") +
    ")\\b"
);

// ── PORTÉE d'un ordre : jusqu'où va ce qu'il demande ───────────────────────
// Une proposition peut contenir plusieurs clauses : « Ajoute les familles qui
// manquent (voir le fichier .pilot/demande.md) » n'ordonne pas d'écrire le
// fichier cité, elle dit où LIRE. La cible d'écriture n'est donc cherchée que
// dans le COMPLÉMENT de l'ordre : après le verbe, et jusqu'à la première
// frontière de clause (virgule, coordination, subordonnée, gérondif, renvoi à
// une source).
const SCOPE_BREAK_RES = [
  /[,;]/,
  new RegExp(
    "\\b(?:" +
      [
        "puis", "ensuite", "et", "mais", "car", "parce", "puisque", "afin",
        "pour", "sans", "selon", "quand", "lorsque", "lorsqu'", "si", "qui",
        "que", "qu'", "ou",
      ]
        .map(accentTolerant)
        .join("|") +
      ")\\b"
  ),
  // Gérondif : « en te fondant sur … », « en t'appuyant sur … », « en lisant … ».
  /\ben\s+(?:\S+ant\b|te\b|t'|vous\b|se\b|s')/,
  new RegExp(
    "\\b(?:" +
      ["d'apres", "a partir", "sur la base", "dans le cadre", "au vu"]
        .map(accentTolerant)
        .join("|") +
      ")\\b"
  ),
  // Destination = la RÉPONSE de l'agent : « écris ta réponse dans le chat »,
  // « rends ton avis dans ta réponse finale »… Tout ce qui suit qualifie la
  // RÉPONSE, pas un fichier : la portée de l'ordre s'arrête là. Un fichier cité
  // après est une ENTRÉE de lecture (« liste les fichiers concernés »).
  RESPONSE_TARGET_RE,
];

/**
 * Fin de la PORTÉE d'un ordre : première frontière de clause située après le
 * verbe (recherche faite dans un texte DÉJÀ masqué, donc de même longueur que
 * le segment). Une virgule isolée juste après le verbe (« Écris, dans
 * docs/x.md, … ») n'ouvre pas une autre clause : elle est franchie.
 * @param {string} maskedText - segment masqué (chemins et citations)
 * @param {number} from - position de fin du verbe
 * @returns {number} index de fin de portée
 */
export function orderScopeEnd(maskedText, from) {
  const source = String(maskedText || "");
  let start = Math.max(0, Math.min(from, source.length));
  for (let guard = 0; guard < 8; guard += 1) {
    const tail = source.slice(start);
    let end = source.length;
    for (const re of SCOPE_BREAK_RES) {
      const m = re.exec(tail);
      if (m && start + m.index < end) end = start + m.index;
    }
    if (end === source.length) return end;
    if (source[end] === "," && !source.slice(start, end).trim()) {
      start = end + 1; // virgule encadrant le complément : on continue
      continue;
    }
    return end;
  }
  return source.length;
}

/**
 * Cible de fichier DANS LA PORTÉE d'un ordre (son complément) : un chemin avec
 * extension connue, ou le mot « fichier ». Chercher la cible ici — et pas
 * n'importe où dans la proposition — est ce qui distingue une SORTIE attendue
 * d'une simple mention (« les fichiers du projet », « le fichier où se trouve
 * la demande »).
 * @param {string} scope
 * @returns {{value: string, via: string}|null}
 */
function fileTargetIn(scope) {
  const source = String(scope || "");
  const path = new RegExp(FILE_EXT_GLOBAL_RE.source, "i").exec(source);
  if (path) return { value: path[0], via: "file-path" };
  // Le NOM « fichier » ne compte que s'il est le COMPLÉMENT DIRECT de l'ordre
  // (« écris un fichier de synthèse », « crée le nouveau fichier de config »).
  // Un fichier rencontré plus loin, après une préposition ou un autre nom
  // (« avec les fichiers que tu as lus », « sur les fichiers du projet », « ton
  // analyse des fichiers »), est une ENTRÉE de lecture : il ne fonde aucun refus.
  if (FILE_NOUN_HEAD_RE.test(source)) return { value: "fichier", via: "file-noun" };
  return null;
}

/**
 * La demande demande-t-elle EXPLICITEMENT d'écrire/créer/modifier un fichier ?
 *
 * Conservateur par construction, et fondé sur ce que la mission DEMANDE, pas
 * sur les mots qu'elle contient. Deux signaux seulement :
 *  a. un livrable DÉCLARÉ (`expected_files`) — rien à interpréter ;
 *  b. un ORDRE d'écriture positif ET une cible de fichier qui est le
 *     COMPLÉMENT de cet ordre (dans sa portée), après neutralisation des
 *     négations, des étiquettes et des citations.
 * Un verbe d'écriture sans cible en sortie (ex. « écris un plan », « ajoute
 * cette famille à ta réponse »), un fichier simplement mentionné ailleurs dans
 * la phrase (« en te fondant sur les fichiers du projet »), une phrase négative,
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
    // Le masquage conserve la LONGUEUR : les positions restent celles du segment.
    const masked = maskQuoted(maskFileTargets(segment));
    const order = findWriteOrder(masked);
    if (!order) {
      // Verbe d'écriture employé dans une autre forme (nom, participe, état) :
      // ce n'est pas un ordre. On le retient seulement pour la traçabilité.
      if (!ambiguousVerb) {
        const any = masked.match(WRITE_VERB_RE);
        if (any) ambiguousVerb = any[0];
      }
      continue;
    }
    // La cible doit être la SORTIE de l'ORDRE : on la cherche dans son
    // complément (portée après le verbe), jamais ailleurs dans la proposition
    // (« Ajoute les familles qui manquent (voir le fichier …) »,
    // « … puis ajoute les familles à ta réponse »).
    const at = masked.indexOf(order);
    const verbEnd = at >= 0 ? at + order.length : 0;
    const scope =
      at >= 0 ? segment.slice(verbEnd, orderScopeEnd(masked, verbEnd)) : segment.slice(verbEnd);
    const target = fileTargetIn(scope);
    if (!target) {
      // Ordre sans cible de fichier en sortie (ex. « écris un plan », « complète
      // ta réponse ») : AMBIGU → aucune décision, la demande part comme avant.
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
        ? `un fichier du projet (ordre « ${detection.verb} », sans nom de fichier précisé)`
        : `le fichier « ${detection.target} » (ordre « ${detection.verb} »)`;
  const prefix = tool ? `${tool} : ` : "";
  return (
    `${prefix}la demande n'a PAS été lancée. ${subject} : ce rôle ne modifie aucun fichier ` +
    `(il analyse, planifie ou rend un avis), or la demande lui ordonne de produire un fichier en sortie : ${target}. ` +
    `Choisissez un agent qui écrit (le codeur du projet, par exemple) et relancez la demande. ` +
    `Si aucun fichier n'est réellement attendu, reformulez la demande comme une tâche de lecture : ` +
    `l'analyse se rend dans la réponse de l'agent (« rends ton analyse dans ta réponse »), sans réclamer de fichier en sortie.`
  );
}

/**
 * Message de REFUS (ou null) : la demande ordonne d'ÉCRIRE un fichier mais
 * AUCUN livrable n'est déclaré (`expected_files` vide).
 *
 * C'est le trou C2 du rapport `RAPPORT-voies-de-contournement-livraison.md` : la
 * liste des fichiers attendus était FACULTATIVE, donc la preuve du livrable
 * (existence + non-vide + changement depuis le lancement) n'avait rien à
 * vérifier. Elle devient OBLIGATOIRE dès que la demande exige un fichier :
 * le refus nomme le fichier que la demande réclame et la façon de le déclarer.
 *
 * Le doute n'est JAMAIS un refus : sans ordre d'écriture ET sans cible de
 * fichier identifiables (même détection que `readOnlyWriteRefusalMessage`, les
 * deux décisions viennent de `detectExplicitWriteRequest`), la demande part
 * comme avant.
 *
 * @param {object} params
 * @param {string} [params.tool] - outil appelant (run_agents, delegate_to_coder…)
 * @param {string} params.task - demande brute
 * @param {string[]} [params.expectedFiles] - livrables déjà déclarés
 * @returns {string|null}
 */
export function undeclaredWriteRefusalMessage({ tool, task, expectedFiles } = {}) {
  const declared = normalizeExpectedFiles(expectedFiles);
  if (declared.length > 0) return null;
  const detection = detectExplicitWriteRequest(task, { expectedFiles: declared });
  if (!detection.explicit) return null;
  const prefix = tool ? `${tool} : ` : "";
  const target =
    detection.via === "file-noun"
      ? `un fichier du projet (ordre « ${detection.verb} », sans nom de fichier précisé)`
      : `le fichier « ${detection.target} » (ordre « ${detection.verb} »)`;
  return (
    `${prefix}la demande n'a PAS été lancée : elle exige la production d'un fichier — ${target} — ` +
    `mais aucun livrable n'est déclaré. Sans cette liste, Pilot ne peut pas vérifier à la fin du ` +
    `travail que le fichier existe, qu'il n'est pas vide et qu'il a bien changé depuis le lancement : ` +
    `n'importe quelle annonce « terminé » resterait donc invérifiable. ` +
    `Relancez la demande en déclarant les fichiers attendus (paramètre \`expected_files\`, chemins ` +
    `relatifs au projet, par exemple « ${detection.target || "docs/plan.md"} »). ` +
    `Si aucun fichier n'est réellement attendu, reformulez la demande comme une tâche de lecture : ` +
    `l'analyse se rend dans la réponse de l'agent, sans réclamer de fichier en sortie.`
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
 * @param {{declared: string[], present: string[], missing: string[], empty?: string[], unproven?: string[], unreadable: string[], base: string|null, skipped: boolean}} check
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
  // C3 : un fichier PRÉSENT mais sans contenu ne prouve rien.
  if ((check.empty || []).length > 0) {
    return (
      `❌ LIVRABLE VIDE : le fichier ${quoteList(check.empty)} existe sur le disque mais ne contient ` +
      `RIEN (0 octet). Un fichier vide ne peut pas tenir le rôle de livrable : la tâche n'est donc ` +
      `PAS terminée. Produisez son contenu, puis relancez la vérification.`
    );
  }
  // C3 (suite) : un fichier présent mais INCHANGÉ depuis le lancement de la
  // mission n'est pas une preuve de travail — il pouvait déjà être là.
  if ((check.unproven || []).length > 0) {
    return (
      `❌ LIVRABLE NON PROUVÉ : le fichier ${quoteList(check.unproven)} était déjà là au lancement ` +
      `de la mission et n'a pas changé depuis (même taille, même date de modification). Rien ne ` +
      `prouve que cette mission l'a produit : la tâche n'est donc PAS terminée.`
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
 * Relève l'état d'UN fichier déclaré : absent, présent (taille + date), ou
 * inconnu (sonde en panne). Aucune exception ne remonte : une panne de sonde
 * donne `{ exists: null }`, que la vérification traite en « non prouvable »
 * SANS faire échouer la mission (fail-open, règle historique conservée).
 *
 * Utilise les sondes EXISTANTES (`file_exists`, `get_file_size`, `file_mtime`) :
 * aucun second mécanisme de lecture du disque n'est créé.
 * @param {Function} invokeFn - `invoke` Tauri (injection pour les tests)
 * @param {string} abs - chemin absolu
 * @returns {Promise<{exists: boolean|null, size: number|null, mtime: number|null}>}
 */
async function probeDeclaredFile(invokeFn, abs) {
  let exists = null;
  try {
    exists = await invokeFn("file_exists", { path: abs });
  } catch (_) {
    return { exists: null, size: null, mtime: null };
  }
  if (exists !== true) return { exists: false, size: null, mtime: null };
  let size = null;
  try {
    const raw = await invokeFn("get_file_size", { path: abs });
    size = Number.isFinite(Number(raw)) ? Number(raw) : null;
  } catch (_) {
    size = null;
  }
  let mtime = null;
  try {
    const raw = await invokeFn("file_mtime", { path: abs });
    mtime = Number.isFinite(Number(raw)) ? Number(raw) : null;
  } catch (_) {
    mtime = null;
  }
  return { exists: true, size, mtime };
}

/**
 * ÉTAT DE DÉPART des fichiers déclarés, relevé AVANT le travail de la mission
 * (C3). Sans cet état, la vérification de fin ne peut pas distinguer « le
 * fichier a été produit par la mission » de « le fichier était déjà là ».
 *
 * Fail-open : une panne de relevé rend `null` (la vérification le dit et ne fait
 * pas échouer la mission).
 * @param {object} params
 * @param {unknown} params.declared
 * @param {string|null} params.base
 * @param {Function} params.invokeFn
 * @returns {Promise<{base: string|null, files: Record<string, {exists: boolean|null, size: number|null, mtime: number|null}>}|null>}
 */
export async function captureDeliverableState({ declared, base, invokeFn } = {}) {
  const files = normalizeExpectedFiles(declared);
  const rawBase = base == null ? "" : String(base).trim();
  const usableBase = rawBase && rawBase !== "__assistant__" && rawBase !== "." ? rawBase : null;
  if (files.length === 0 || !usableBase || typeof invokeFn !== "function") return null;
  const state = {};
  try {
    for (const rel of files) {
      state[rel] = await probeDeclaredFile(invokeFn, resolvePath(rel, usableBase));
    }
  } catch (_) {
    return null;
  }
  return { base: usableBase, files: state };
}

/**
 * Le fichier a-t-il CHANGÉ depuis le relevé de départ ? Pur.
 * Vrai quand le fichier n'existait pas au lancement (il a donc été créé) ou
 * quand sa taille ou sa date diffèrent. `false` = état identique ⇒ rien ne
 * prouve que la mission l'a produit.
 * @param {{exists: boolean|null, size: number|null, mtime: number|null}|null|undefined} before
 * @param {{exists: boolean|null, size: number|null, mtime: number|null}} after
 * @returns {boolean}
 */
export function fileChangedSince(before, after) {
  if (!after || after.exists !== true) return false;
  if (!before) return true;
  if (before.exists === false) return true; // créé pendant la mission
  if (before.exists !== true) return true; // relevé de départ inconnu : on ne condamne pas
  const sizeKnown = Number.isFinite(before.size) && Number.isFinite(after.size);
  if (sizeKnown && before.size !== after.size) return true;
  const mtimeKnown = Number.isFinite(before.mtime) && Number.isFinite(after.mtime);
  if (mtimeKnown && before.mtime !== after.mtime) return true;
  if (!sizeKnown && !mtimeKnown) return true; // aucune mesure comparable : ne pas condamner
  return false;
}

/**
 * Vérifie les fichiers déclarés : ils doivent EXISTER, ne pas être VIDES, et
 * avoir CHANGÉ depuis le lancement de la mission (C3 — un fichier présent mais
 * vide ou déjà là avant la mission ne prouve aucun travail).
 *
 * Fail-open conservé : une sonde indisponible ne fait jamais échouer la mission
 * (`unreadable`), et une panne du relevé de départ (`baseline === null`) n'est
 * pas imputée à l'agent.
 * @param {object} params
 * @param {unknown} params.declared - fichiers attendus (relatifs au projet)
 * @param {string|null} params.base - dossier de référence (projet / espace)
 * @param {Function} params.invokeFn - `invoke` Tauri (injection pour les tests)
 * @param {{files?: Record<string, object>}|null} [params.baseline] - état relevé au lancement
 *   (`undefined` = jamais relevé ⇒ aucun fichier ne peut être prouvé)
 * @returns {Promise<{declared: string[], present: string[], missing: string[], empty: string[], unproven: string[], unreadable: string[], base: string|null, skipped: boolean}>}
 */
export async function verifyExpectedFiles({ declared, base, invokeFn, baseline } = {}) {
  const files = normalizeExpectedFiles(declared);
  const rawBase = base == null ? "" : String(base).trim();
  // Dossiers NON utilisables comme référence : vide, marqueur interne de
  // l'espace assistant (`__assistant__`), ou projet courant inconnu (".").
  const usableBase = rawBase && rawBase !== "__assistant__" && rawBase !== "." ? rawBase : null;
  const result = {
    declared: files,
    present: [],
    missing: [],
    empty: [],
    unproven: [],
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
  // `undefined` = l'appelant n'a jamais relevé l'état de départ : la production
  // n'est alors PROUVABLE pour aucun fichier. `null` = le relevé a échoué : on
  // ne condamne pas la mission (fail-open).
  const baselineMissing = baseline === undefined;
  const baselineBroken = baseline === null;
  const before = baseline && typeof baseline === "object" && baseline.files ? baseline.files : {};
  for (const rel of files) {
    const abs = resolvePath(rel, usableBase);
    let after;
    try {
      after = await probeDeclaredFile(invokeFn, abs);
    } catch (_) {
      after = { exists: null, size: null, mtime: null };
    }
    if (after.exists === null) {
      // Sonde indisponible : jamais un échec de mission (règle historique).
      result.unreadable.push(rel);
      continue;
    }
    if (after.exists !== true) {
      result.missing.push(rel);
      continue;
    }
    if (after.size === 0) {
      // C3 : présent mais VIDE ⇒ jamais conforme.
      result.empty.push(rel);
      continue;
    }
    if (baselineMissing) {
      // Aucun état de départ fourni : la production n'est pas prouvée.
      result.unproven.push(rel);
      continue;
    }
    if (!baselineBroken && !fileChangedSince(before[rel], after)) {
      // C3 (suite) : présent mais identique à l'état de départ ⇒ pas produit ici.
      result.unproven.push(rel);
      continue;
    }
    result.present.push(rel);
  }
  return result;
}

/**
 * La vérification rend-elle la mission EN ÉCHEC ? Trois cas seulement : fichier
 * déclaré ABSENT, fichier VIDE, ou fichier INCHANGÉ depuis le lancement (C3).
 * Jamais une sonde indisponible, jamais un dossier de référence absent.
 * @param {object|null} check
 * @returns {boolean}
 */
export function deliverableFailed(check) {
  if (!check) return false;
  return ["missing", "empty", "unproven"].some(
    (key) => Array.isArray(check[key]) && check[key].length > 0
  );
}
