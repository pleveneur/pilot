// personnage-fige-dans-le-texte.js — LES PASSAGES QUI FIGENT UN PERSONNAGE DANS
// UN TEXTE D'INSTRUCTIONS, ET LE GESTE QUI LES RETIRE.
//
// Défaut constaté (tâche 416, vérification indépendante du 2026-11-16) : le
// mécanisme livré empêche désormais qu'un personnage se fige dans les textes
// LIVRÉS avec Pilot, mais il ne pouvait rien contre le texte d'instructions
// DURABLE déjà écrit sur le poste (`super_agent_prompt`, réglé par le
// propriétaire). Ce texte-là continuait de nommer un personnage absent («
// Sylvie »), d'imposer un genre (« J'écris et je parle au FÉMININ »), une voix
// (« voix féminine », « pas une voix neutre d'outil ») et un ton de personnage
// — alors qu'aucun personnage n'était actif. Aucun mécanisme ne le signalait.
//
// Ce module tient les DEUX décisions, et rien d'autre (pures : aucun DOM, aucun
// import Tauri, aucun accès disque, aucun état) :
//
//   1. VOIR — `findFrozenPersonaSigns` énumère les passages qui figent un
//      personnage, un genre, une voix ou un ton. Chaque passage est nommé en
//      français simple (`frozenPersonaSentence` / `frozenPersonaNotice`).
//
//   2. RETIRER — `cleanFrozenPersonaText` rend une copie nettoyée. Le retrait
//      est CIBLÉ : seules les déclarations de personnage partent (la phrase
//      entière quand elle impose un genre, une voix ou un ton ; la seule
//      occurrence du nom quand il est écrit en dur). Tout le reste du texte est
//      rendu à l'identique — les règles de travail, la lecture seule, la
//      sécurité, le style général ne sont JAMAIS touchés. Un prénom en tête de
//      texte devient la référence `{nom}`, seule forme qui suit le personnage
//      actif (sinon le nom réglé, sinon « Assistant »).
//
// Aucun nettoyage AUTOMATIQUE : ce module ne fait que proposer un texte ; c'est
// le geste explicite du propriétaire (bouton « Nettoyer ce texte » des Options)
// qui l'applique, et l'enregistrement passe par le chemin dédié du prompt, qui
// conserve l'ancienne version dans `prompt-history.md`.

/**
 * Familles de passages figés. Les valeurs servent de clés (stables) ; les
 * libellés français vivent dans `FROZEN_PERSONA_MESSAGES`.
 */
export const FROZEN_PERSONA_KINDS = Object.freeze({
  NAME: "nom",
  GENDER: "genre",
  VOICE: "voix",
  TONE: "ton",
});

/** Ce que chaque famille veut dire, en français simple (une ligne par famille). */
export const FROZEN_PERSONA_MESSAGES = Object.freeze({
  nom: "un prénom de personnage écrit en dur",
  genre: "un genre imposé",
  voix: "une voix imposée",
  ton: "un ton de personnage imposé",
});

/** Ordre d'énumération stable (l'ordre des règles EST la lecture du signalement). */
const KIND_ORDER = [
  FROZEN_PERSONA_KINDS.NAME,
  FROZEN_PERSONA_KINDS.GENDER,
  FROZEN_PERSONA_KINDS.VOICE,
  FROZEN_PERSONA_KINDS.TONE,
];

/**
 * Mots entre guillemets qui sont des NOMS DE PRODUITS ou des termes techniques,
 * jamais un prénom de personnage. Sans cette liste, « Pilot », « GDS » ou
 * « Présences » entre guillemets seraient signalés à tort : un faux signalement
 * ferait perdre confiance dans l'avertissement (et pousserait à nettoyer des
 * passages légitimes).
 */
export const QUOTED_WORD_NEVER_A_NAME = Object.freeze([
  "pilot", "pi", "gds", "github", "gitlab", "présences", "presences", "laya",
  "mcp", "api", "json", "sql", "pdf", "markdown", "vitest", "rust", "node",
  "windows", "macos", "linux", "docker", "postgres", "postgresql", "ssh",
  "agent", "agents", "assistant", "personnage", "personnages", "prénom",
  "nom", "voix", "genre", "tauri", "vite", "npm", "cargo", "excel", "word",
]);

/** Un genre déclaré POUR L'ASSISTANT (« au féminin », « au masculin »). */
const GENDER_RE = /\bau\s+(?:f[ée]minin|masculin)\b/iu;

/** Une voix déclarée : « voix féminine », « voix masculine », « voix neutre ». */
const VOICE_RE = /\bvoix\s+(?:f[ée]minine|masculine|neutre|douce|grave|aigu[eë]?)\b/iu;

/** Une voix possédée, qui ne peut être que celle d'un personnage. */
const OWN_VOICE_RE = /\b(?:ma|sa|ta)\s+voix\b/iu;

/** Un ton de personnage déclaré (« Ton chaleureux, posé… »). */
const TONE_RE = new RegExp(
  "\\bton\\s+(?:chaleureux|chaleureuse|pos[ée]e?|doux|douce|ferme|calme" +
    "|s[ée]duisant[e]?|enjou[ée]e?|maternel|maternelle|paternaliste)\\b",
  "iu"
);

/** Un mot entre guillemets, potentiellement un prénom : « Sylvie », "Nova". */
const QUOTED_WORD_RE = /[«"“]\s*([A-ZÀ-ÖØ-Þ][\p{L}\p{M}'’\-]{1,24})\s*[»"”]/gu;

/** Un prénom (ou un pseudo) en TÊTE de texte, suivi d'une virgule. */
const LEADING_NAME_RE = /^(\s*)([A-ZÀ-ÖØ-Þ][\p{L}\p{M}'’\-]{1,24})(\s*,\s)/u;

/** Un groupe entre parenthèses (les apartés de date et de réglage). */
const PARENTHESIS_RE = /\(([^()]*)\)/g;

const NAME_TOKEN = "{nom}";

function isStopword(word) {
  const w = String(word || "").toLowerCase();
  return QUOTED_WORD_NEVER_A_NAME.includes(w);
}

/**
 * Découpe une ligne en phrases EN CONSERVANT l'espace final de chacune : les
 * morceaux recollés à l'identique reproduisent la ligne d'origine au caractère
 * près. Une fin de phrase est une ponctuation forte suivie d'une espace.
 */
function splitSentences(line) {
  const out = [];
  const re = /[.!?…]+["»”)]*\s+/g;
  let start = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    const end = m.index + m[0].length;
    out.push(line.slice(start, end));
    start = end;
  }
  out.push(line.slice(start));
  return out;
}

/** Familles repérées DANS un fragment (sans regarder les parenthèses). */
function markersOf(fragment) {
  const found = [];
  const quoted = new RegExp(QUOTED_WORD_RE.source, QUOTED_WORD_RE.flags);
  let m;
  let hasName = false;
  while ((m = quoted.exec(fragment)) !== null) {
    if (!isStopword(m[1])) hasName = true;
  }
  if (hasName) found.push(FROZEN_PERSONA_KINDS.NAME);
  if (GENDER_RE.test(fragment)) found.push(FROZEN_PERSONA_KINDS.GENDER);
  if (VOICE_RE.test(fragment) || OWN_VOICE_RE.test(fragment)) {
    found.push(FROZEN_PERSONA_KINDS.VOICE);
  }
  if (TONE_RE.test(fragment)) found.push(FROZEN_PERSONA_KINDS.TONE);
  return found;
}

/** Le prénom écrit en dur en tête du texte, s'il y en a un. */
function leadingNameOf(text) {
  const m = typeof text === "string" ? LEADING_NAME_RE.exec(text) : null;
  if (!m) return "";
  return isStopword(m[2]) ? "" : m[2];
}

function sortKinds(kinds) {
  return KIND_ORDER.filter((k) => kinds.includes(k));
}

function excerptOf(text) {
  const one = String(text || "").replace(/\s+/g, " ").trim();
  return one.length > 72 ? `${one.slice(0, 71)}…` : one;
}

/**
 * Les passages du texte qui figent un personnage, un genre, une voix ou un ton.
 *
 * @param {string} text - le texte d'instructions tel qu'il est en vigueur
 * @returns {Array<{kind: string, sentence: string}>} passages, dans l'ordre du
 *   texte, une entrée par famille et par phrase (jamais de doublon)
 */
export function findFrozenPersonaSigns(text) {
  const src = typeof text === "string" ? text : "";
  if (src.trim() === "") return [];
  const signs = [];
  const seen = new Set();
  const push = (kind, sentence) => {
    const key = `${kind}\u0000${sentence}`;
    if (seen.has(key)) return;
    seen.add(key);
    signs.push({ kind, sentence });
  };

  const leading = leadingNameOf(src);
  if (leading) push(FROZEN_PERSONA_KINDS.NAME, leading);

  for (const line of src.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    for (const sentence of splitSentences(line)) {
      if (sentence.trim() === "") continue;
      // Les parenthèses sont des apartés (date, réglage, voix d'origine) : un
      // marqueur qui s'y trouve sera RETIRÉ avec l'aparté, jamais avec la
      // phrase qui porte la consigne.
      const parens = [];
      let rest = sentence.replace(new RegExp(PARENTHESIS_RE.source, "g"), (m, inner) => {
        parens.push(inner);
        return " ";
      });
      for (const inner of parens) {
        for (const kind of markersOf(inner)) push(kind, sentence);
      }
      for (const kind of markersOf(rest)) push(kind, sentence);
    }
  }
  return signs;
}

/**
 * Vrai si le texte contient au moins un passage qui fige un personnage.
 * @param {string} text
 * @returns {boolean}
 */
export function textFreezesAPersona(text) {
  return findFrozenPersonaSigns(text).length > 0;
}

function joinFrench(items) {
  const list = items.filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} et ${list[list.length - 1]}`;
}

/**
 * Le signalement affiché dans les Options, en français simple. `null` quand le
 * texte ne fige personne (aucun encart, aucun message).
 *
 * @param {Array<{kind: string, sentence: string}>} signs - sortie de findFrozenPersonaSigns
 * @returns {string|null}
 */
export function frozenPersonaNotice(signs) {
  const list = Array.isArray(signs) ? signs : [];
  if (list.length === 0) return null;
  const families = sortKinds([...new Set(list.map((s) => s.kind))]).map(
    (k) => FROZEN_PERSONA_MESSAGES[k] || k
  );
  const constat =
    families.length === 1
      ? `Ce texte fige un personnage : ${families[0]}.`
      : `Ce texte fige un personnage : ${joinFrench(families)}.`;
  const geste =
    "« Nettoyer ce texte » retire ces passages et ne garde que {nom} pour le nom : " +
    "le reste de vos consignes est conservé, et la version actuelle reste dans " +
    "l'historique des versions. Rien n'est appliqué tant que vous n'enregistrez pas.";
  return `${constat} ${geste}`;
}

/**
 * Le texte nettoyé : seules les déclarations de personnage sont retirées.
 *
 * Règles (dans cet ordre, pour une phrase) :
 *   1. une phrase qui impose un GENRE, une VOIX ou un TON part ENTIÈRE — c'est
 *      une déclaration sur le personnage, pas une consigne de travail ;
 *   2. un aparté entre parenthèses qui contient l'un de ces marqueurs part
 *      (les dates et réglages nus, eux, restent) ;
 *   3. une occurrence du nom entre guillemets part SEULE, le reste de la phrase
 *      est conservé (« il m'appelle par mon prénom (« Sylvie ») » → « il
 *      m'appelle par mon prénom ») ;
 *   4. un prénom en tête de texte devient `{nom}`.
 *
 * @param {string} text
 * @returns {{text: string, changed: boolean, removals: Array<{kind: string, sentence: string}>}}
 */
export function cleanFrozenPersonaText(text) {
  const src = typeof text === "string" ? text : "";
  const unchanged = { text: src, changed: false, removals: [] };
  if (src.trim() === "") return unchanged;

  const removals = [];
  const seen = new Set();
  const noteRemoval = (kind, sentence) => {
    const key = `${kind}\u0000${sentence}`;
    if (seen.has(key)) return;
    seen.add(key);
    removals.push({ kind, sentence });
  };

  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);

  const cleanedLines = lines.map((line) => {
    if (line.trim() === "") return line;
    const kept = [];
    for (const sentence of splitSentences(line)) {
      const parens = [];
      const bare = sentence.replace(new RegExp(PARENTHESIS_RE.source, "g"), (m, inner) => {
        parens.push(inner);
        return " ";
      });
      const bareKinds = markersOf(bare);
      const dropsWholeSentence = bareKinds.some(
        (k) =>
          k === FROZEN_PERSONA_KINDS.GENDER ||
          k === FROZEN_PERSONA_KINDS.VOICE ||
          k === FROZEN_PERSONA_KINDS.TONE
      );
      if (dropsWholeSentence) {
        for (const kind of bareKinds) noteRemoval(kind, sentence);
        continue;
      }
      // Apartés : retirés seulement s'ils portent un marqueur de personnage.
      // L'ESPACE QUI PRÉCÈDE part avec l'aparté : sinon « Pilot (…) . »
      // laisserait une espace avant le point, et la typographie française du
      // reste du texte (espace avant « : », « ; », « ») ne doit JAMAIS être
      // retouchée.
      let out = sentence.replace(/([ \t]*)\(([^()]*)\)/g, (m, pre, inner) => {
        const kinds = markersOf(inner);
        if (kinds.length === 0) return m;
        for (const kind of kinds) noteRemoval(kind, sentence);
        return "";
      });
      // Nom entre guillemets : seule l'occurrence part (l'espace qui la précède
      // aussi, et un groupe devenu vide disparaît : « mon prénom (« Sylvie ») »
      // → « mon prénom »).
      let nameRemoved = false;
      out = out.replace(/([ \t]*)[«"“]\s*([A-ZÀ-ÖØ-Þ][\p{L}\p{M}'’\-]{1,24})\s*[»"”]/gu, (m, pre, word) => {
        if (isStopword(word)) return m;
        nameRemoved = true;
        return "";
      });
      if (nameRemoved) {
        noteRemoval(FROZEN_PERSONA_KINDS.NAME, sentence);
        out = out.replace(/[ \t]*\([ \t]*\)/g, "");
      }
      kept.push(out);
    }
    return kept.join("");
  });

  let out = cleanedLines.join(eol);

  // Prénom en tête de texte : remplacé par la SEULE forme qui suit le
  // personnage actif (sinon le nom réglé, sinon « Assistant »).
  if (leadingNameOf(out)) {
    out = out.replace(LEADING_NAME_RE, (m, pre, word, post) => {
      if (isStopword(word)) return m;
      noteRemoval(FROZEN_PERSONA_KINDS.NAME, word);
      return `${pre}${NAME_TOKEN}${post}`;
    });
  }

  // AUCUN passage figé : le texte est rendu À L'IDENTIQUE (jamais de
  // reformatage silencieux d'un texte sain).
  if (removals.length === 0) return unchanged;

  // Mise en forme MINIMALE : un retrait ne doit pas laisser de double espace ni
  // d'espace en fin de ligne. Aucune autre ponctuation n'est retouchée (les
  // espaces françaises avant « : », « ; » et « » restent celles du propriétaire).
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(new RegExp(`(?:${eol === "\r\n" ? "\r\\n" : "\\n"}[ \\t]*){3,}`, "g"), eol + eol);

  return { text: out, changed: out !== src, removals };
}

/**
 * Résumé court du nettoyage, pour le retour affiché après le geste (« 3
 * passages retirés »). Jamais un message quand rien n'a été retiré.
 *
 * @param {{changed: boolean, removals: Array<{kind: string}>}} result
 * @returns {string}
 */
export function frozenPersonaCleanSummary(result) {
  const removals = result && Array.isArray(result.removals) ? result.removals : [];
  if (!result || !result.changed || removals.length === 0) {
    return "Aucun passage à retirer dans ce texte.";
  }
  const families = sortKinds([...new Set(removals.map((r) => r.kind))]).map(
    (k) => FROZEN_PERSONA_MESSAGES[k] || k
  );
  const n = removals.length;
  return n === 1
    ? `1 passage retiré (${families[0]}). Relisez, puis enregistrez.`
    : `${n} passages retirés (${joinFrench(families)}). Relisez, puis enregistrez.`;
}

export { excerptOf as frozenPersonaExcerpt };
