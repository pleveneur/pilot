// telegram-messages.js — SOURCE UNIQUE des messages Telegram destinés au
// propriétaire (refonte « suivre deux projets en même temps »).
//
// Règle de contenu appliquée ici, et NULLE PART ailleurs :
//   1. UN message = UN projet. Le nom COURT du projet (nom de son dossier) est
//      en tête du message (`projectShortName`). Un évènement qui porterait deux
//      projets est REFUSÉ (aucun message) : deux projets = deux messages.
//   2. TROIS types, pas plus :
//        - « début » : une ligne — « MakeFilm : correction de l'autotest lancée » ;
//        - « fin »   : deux lignes maximum — « MakeFilm : livré » puis, si utile,
//          « À tester : … » ; un ÉCHEC tient en UNE ligne (ce qui a échoué) ;
//        - « alerte »: une ligne — ce qui bloque/demande une décision ET la
//          décision attendue. Aucune alerte sans action possible en face.
//      (plus « assistant » : la phrase reformulée de l'Assistant, préfixée du nom
//      du projet — même gabarit, même nettoyage.)
//   3. Ce qui N'EST PLUS jamais envoyé : étapes intermédiaires, « préparation »,
//      « mission relancée », accusés de réception, numéros de session/mission,
//      chemins de fichiers, noms de fonctions/modules, détails de tests (on garde
//      « tests OK » / « tests KO »), comptes de tests, empreintes, branches et
//      commits, et **aucune heure** (décision du propriétaire : un message dit ce
//      qui se passe, pas quand). Tout passe par `sanitizeOwnerText`.
//   3 bis. Aucun RÉCAPITULATIF périodique : ni bilan du soir, ni message à heure
//      fixe. Un message n'existe que pour un changement réel — garanti par la
//      liste FERMÉE des types (`TELEGRAM_MESSAGE_TYPES`) et par l'ABSENCE de
//      minuteur répétitif (`setInterval`) dans le branchement.
//   4. Un seul message par changement réel : une rafale d'évènements rapprochés
//      pour la même information donne UN envoi (`publishOwnerEvent`, fenêtre
//      `TELEGRAM_BURST_WINDOW_MS`).
//   5. Aucun message inutile : un évènement vide (ou réduit à du technique par le
//      nettoyage) ne produit AUCUN envoi — pas de message « néant ».
//   6. Heures calmes : rien entre 23 h et 7 h, sauf danger immédiat
//      (`isQuietHours`, `event.danger`). Ce qui tombe dans les heures calmes est
//      MIS DE CÔTÉ puis remis à l'heure du réveil (`flushHeldOwnerEvents`),
//      jamais perdu silencieusement.
//
// Le module est PUR côté formatage (aucune I/O, aucun accès Tauri) : l'envoi et
// l'horloge sont INJECTÉS (`setTelegramGateDeps`), donc testables sans réseau,
// sans Tauri et sans attente réelle.

/** Types de message autorisés (aucun autre n'est produit). */
export const TELEGRAM_MESSAGE_TYPES = Object.freeze({
  START: "start",
  END: "end",
  ALERT: "alert",
  ASSISTANT: "assistant",
});

/** Début des heures calmes (23 h, heure locale). */
export const QUIET_START_HOUR = 23;
/** Fin des heures calmes (7 h, heure locale). */
export const QUIET_END_HOUR = 7;

/** Fenêtre anti-rafale : deux messages rapprochés pour la même information = un seul. */
export const TELEGRAM_BURST_WINDOW_MS = 90_000;

/** Bornes de longueur (en caractères) : un message tient sur un écran de téléphone. */
export const MAX_START_CHARS = 110;
export const MAX_RESULT_CHARS = 110;
export const MAX_TESTABLE_CHARS = 110;
export const MAX_ALERT_CHARS = 150;
export const MAX_ASSISTANT_CHARS = 200;

/** Nombre maximal de messages mis de côté pendant les heures calmes. */
export const MAX_HELD_MESSAGES = 20;

// ── Nom court du projet — UNE SEULE fonction pour tout le projet ────────────

/**
 * Nom COURT affichable du projet : le nom de son DOSSIER. C'est la seule
 * fonction qui produit ce nom, et elle est utilisée par tous les gabarits.
 *
 * Tolérante aux séparateurs Windows (`\`) et POSIX (`/`), à la barre finale et à
 * une clé composite `chemin::agent`. Une valeur qui est déjà un nom nu est
 * rendue telle quelle. Une valeur qui contient DEUX chemins (deux projets) est
 * REFUSÉE (`""`) : un message ne parle jamais de deux projets.
 *
 * Fonction PURE.
 * @param {string} projectPath
 * @returns {string}
 */
export function projectShortName(projectPath) {
  const raw = String(projectPath ?? "").trim();
  if (!raw) return "";
  // Deux chemins distincts dans la même valeur → refus (jamais deux projets).
  const tokens = raw.split(/\s+/).filter(Boolean);
  const pathish = tokens.filter((t) => /[\\/]/.test(t) || /^[A-Za-z]:$/.test(t));
  if (pathish.length >= 2) return "";
  let value = raw.split("::")[0].trim();
  value = value.replace(/[\\/]+$/, "");
  if (!value) return "";
  const parts = value.split(/[\\/]+/).filter(Boolean);
  const name = (parts.length ? parts[parts.length - 1] : value).trim();
  // Un lecteur seul (« G: ») n'est pas un nom de projet.
  if (!name || /^[A-Za-z]:$/.test(name) || name === "." || name === "..") return "";
  return name;
}

// ── Nettoyage : tout ce qui n'a rien à faire sur un téléphone ──────────────

const CODE_EXTENSIONS =
  "js|mjs|cjs|ts|tsx|jsx|rs|json|jsonl|md|css|html|htm|py|toml|lock|yml|yaml|txt|sh|bat|ps1|sql|vue|svelte|go|java|kt|c|h|cpp|hpp|cs|rb|php|log|db|sqlite|sqlite3|ini|cfg|conf|env";

/** Forme d'une HEURE (source commune : retrait ET contrôles). */
const TIME_PATTERN_SOURCE =
  // 14:32, 9:15, 14:32:05, 9h15, 23 h 30
  "\\b(?:[01]?\\d|2[0-3])(?:\\s*[:hH]\\s*[0-5]\\d(?:\\s*[:hH]\\s*[0-5]\\d)?" +
  // 14h, 14 h, 9 heures, 9 heures 30, 9 h et demie
  "|\\s*[hH](?:eures?)?(?:\\s*(?:[0-5]\\d|et demie))?)";

/**
 * Retire toute HEURE d'un texte (« à 14:32 », « vers 9 h 15 », « livré à 18h »,
 * horodatage ISO). Décision du propriétaire : aucun message ne porte l'heure —
 * il est prévenu à l'instant, l'heure n'ajoute rien et alourdit la ligne. La
 * préposition qui précédait (« à », « vers », « depuis »…) part avec l'heure,
 * sinon la phrase resterait bancale. Fonction PURE.
 * @param {string} raw
 * @returns {string}
 */
export function stripTimeMentions(raw) {
  let t = String(raw ?? "");
  if (!t) return "";
  // Horodatage complet (2026-05-05T12:00:00) : il ne doit pas laisser « …T ».
  t = t.replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?\b/g, " ");
  // Heure précédée d'une préposition : la préposition part avec elle.
  t = t.replace(
    new RegExp(`(^|[\\s(])(?:[àa]|vers|d[èe]s|depuis|avant|apr[èe]s)\\s+${TIME_PATTERN_SOURCE}`, "gi"),
    "$1",
  );
  // Heure seule restante.
  t = t.replace(new RegExp(TIME_PATTERN_SOURCE, "g"), " ");
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Remplace toute mention de tests par le VERDICT seul : « tests OK » ou
 * « tests KO ». Les comptes, les noms de fichiers de tests et les détails
 * disparaissent (on garde seulement le résultat). Fonction PURE.
 * @param {string} text
 * @returns {string}
 */
export function normalizeTestMentions(text) {
  return String(text ?? "").replace(
    // « 12 tests », « 3/3 tests OK », « la suite de tests échoue », « tests: 12 réussis »
    /(?:\b\d+\s*(?:\/\s*\d+\s*)?)?\b(?:tests?|assertions?|specs?)\b[^.;\n!?]{0,50}/gi,
    (match) => (/ko\b|échec|echec|échou|echou|rouge|fail|erreur/i.test(match) ? "tests KO" : "tests OK"),
  );
}

/**
 * Retire d'un texte tout ce qui est technique, interne ou non pertinent pour le
 * propriétaire : blocs de code, chemins, noms de fichiers, noms de fonctions et
 * de modules, numéros de session/mission/run, empreintes, branches et commits,
 * comptes de tests, marqueurs Markdown. Espaces compactés, une seule ligne.
 * Fonction PURE.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeOwnerText(raw) {
  let t = String(raw ?? "");
  if (!t) return "";
  // Blocs de code et code inline.
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`[^`]*`/g, " ");
  // Liens et images Markdown : on garde le libellé.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // URL brutes.
  t = t.replace(/<?https?:\/\/\S+>?/gi, " ");
  // Heures : aucun message ne porte l'heure (décision du propriétaire).
  t = stripTimeMentions(t);
  // Mentions de tests → verdict seul (avant de toucher aux nombres).
  t = normalizeTestMentions(t);
  // Chemins Windows absolus (C:\…, C:/…).
  t = t.replace(/\b[A-Za-z]:[\\/][^\s,;:)]*/g, " ");
  // Chemins POSIX absolus (/home/…) et relatifs (./…, ../…).
  t = t.replace(/(^|[\s(])(?:\.{1,2}\/)[^\s,;:)]*/g, "$1");
  t = t.replace(/(^|[\s(])\/(?:[\w.\-]+\/)+[\w.\-]*/g, "$1");
  // Noms de modules/fichiers/fonctions annoncés explicitement : AVANT les chemins
  // et noms de fichiers, sinon le mot-clé (« fichier ») resterait orphelin. Le mot
  // SUIVANT n'est retiré que s'il a l'air TECHNIQUE (point, barre, souligné,
  // chiffre) : « ouvrir un fichier puis le refermer » reste une consigne normale.
  t = t.replace(
    /\b(?:module|fichier|fonction|function|m[ée]thode|class|classe)\s+[A-Za-z_][\w.:\\/-]*[.:\\/_\d][\w.:\\/-]*/gi,
    " ",
  );
  // Identifiant camelCase après ces mots-clés : motif SENSIBLE À LA CASSE (avec
  // le drapeau `/i`, `[A-Z]` ne distinguerait plus une majuscule).
  t = t.replace(
    /\b(?:module|fonction|function|m[ée]thode|class|classe)\s+[A-Za-z_]\w*[A-Z]\w*/g,
    " ",
  );
  // Chemins relatifs terminés par un fichier (« src/js/a.js ») : la dernière barre
  // doit précéder un nom de fichier, donc « et/ou » n'est jamais touché.
  t = t.replace(/\b[\w.\-]+(?:\/[\w.\-]+)*\/[\w\-]+\.\w+/g, " ");
  // Noms de fichiers à extension connue (y compris les fichiers de tests).
  t = t.replace(new RegExp(`\\b[\\w.\\-]+\\.(?:test\\.)?(?:${CODE_EXTENSIONS})\\b`, "gi"), " ");
  // Noms de fonctions (`foo()`) et identifiants techniques (snake_case).
  t = t.replace(/\b[\w$]+\(\)/g, " ");
  t = t.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, " ");
  // Numéros de session / de mission / de run (internes).
  t = t.replace(
    /\b(?:session|mission|run|t[âa]che)\s*(?:n[°o]\s*|#|num[ée]ro\s*)?\d+\b/gi,
    " ",
  );
  t = t.replace(/\b#\d+\b/g, " ");
  // Empreintes / identifiants hexadécimaux et UUID.
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ");
  t = t.replace(/\b[0-9a-f]{8,}\b/gi, " ");
  // Branches et commits.
  t = t.replace(/\b(?:branche|branch|commit|tag|merge)\s+[^\s,;)]+/gi, " ");
  // Marqueurs Markdown (titres, listes, citations, gras).
  t = t.replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  t = t.replace(/^[ \t]*(?:[-*+•]|\d+[.)])[ \t]+/gm, "");
  t = t.replace(/\*\*|__|>/g, " ");
  // Compactage : une seule ligne, pas d'espace avant la ponctuation.
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/\s+([.,;:!?])/g, "$1");
  return t.trim();
}

/** Coupe proprement (sur un mot) à `max` caractères, avec « … » si tronqué. */
function limit(text, max) {
  const t = String(text ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(1, max - 1));
  const at = cut.lastIndexOf(" ");
  return `${(at > 20 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/**
 * Retire une pastille d'état en tête (« ⚠️ », « ✅ », « ❌ »…) : nos gabarits
 * portent déjà le verdict (« livré » / « échec ») ou le marqueur d'alerte, une
 * seconde pastille serait un doublon visuel. Fonction PURE.
 * @param {string} text
 * @returns {string}
 */
function stripLeadingStatusEmoji(text) {
  let t = String(text ?? "").trim();
  for (let i = 0; i < 4; i += 1) {
    const next = t.replace(/^(?:⚠|✅|❌|🟢|🔴|🟡|⏱|♻|📋|🚨|🛑|💡|🔍|ℹ|🔧|📝)\uFE0F?\s*/u, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

/** Met la première lettre en minuscule (sauf acronyme ou emoji en tête). */
function lowerFirst(text) {
  const t = String(text ?? "");
  if (t.length < 2) return t;
  const first = t[0];
  const second = t[1];
  if (first !== first.toUpperCase() || first === second.toUpperCase()) return t;
  return first.toLowerCase() + t.slice(1);
}

/** Nom de projet exigé : sans lui, aucun message (jamais de tête vide). */
function requireProject(value) {
  return projectShortName(value);
}

// ── Les TROIS gabarits de message (+ la phrase de l'Assistant) ──────────────

/**
 * Message de DÉBUT : UNE ligne, nom du projet + ce qui commence.
 * Exemple : « MakeFilm : correction de l'autotest lancée ».
 * Renvoie `""` si le nom du projet manque ou si l'action est vide (nettoyage
 * compris) : aucun message inutile.
 * Fonction PURE.
 * @param {{project?: string, action?: string}} [event]
 * @returns {string}
 */
export function buildStartMessage(event = {}) {
  const project = requireProject(event.project);
  if (!project) return "";
  const action = stripLeadingStatusEmoji(limit(sanitizeOwnerText(event.action), MAX_START_CHARS));
  if (!action) return "";
  return `${project} : ${lowerFirst(action)}`;
}

/**
 * Message de FIN : deux lignes maximum.
 *   - succès : « MakeFilm : livré » (+ « — précision » si elle est utile) ;
 *   - échec : « MakeFilm : échec — ce qui a échoué » (UNE ligne) ;
 *   - deuxième ligne éventuelle : « À tester : … » (jamais sur un échec).
 * Fonction PURE.
 * @param {{project?: string, ok?: boolean, result?: string, testable?: string}} [event]
 * @returns {string}
 */
export function buildEndMessage(event = {}) {
  const project = requireProject(event.project);
  if (!project) return "";
  const ok = event.ok !== false;
  const detail = stripLeadingStatusEmoji(limit(sanitizeOwnerText(event.result), MAX_RESULT_CHARS));
  const verdict = ok ? "livré" : "échec";
  const head = detail ? `${project} : ${verdict} — ${detail}` : `${project} : ${verdict}`;
  if (!ok) return head; // un échec tient en UNE ligne
  const testable = stripLeadingStatusEmoji(limit(sanitizeOwnerText(event.testable), MAX_TESTABLE_CHARS));
  if (!testable) return head;
  return `${head}\nÀ tester : ${testable}`;
}

/**
 * Message d'ALERTE : UNE ligne — ce qui bloque/demande une décision ET la
 * décision attendue. Sans décision possible, AUCUNE alerte n'est produite
 * (`""`) : jamais de bruit qui n'appelle aucune action.
 * Fonction PURE.
 * @param {{project?: string, problem?: string, decision?: string}} [event]
 * @returns {string}
 */
export function buildAlertMessage(event = {}) {
  const project = requireProject(event.project);
  if (!project) return "";
  const problem = stripLeadingStatusEmoji(limit(sanitizeOwnerText(event.problem), MAX_ALERT_CHARS));
  const decision = stripLeadingStatusEmoji(limit(sanitizeOwnerText(event.decision), MAX_ALERT_CHARS));
  if (!problem || !decision) return "";
  return `⚠️ ${project} : ${problem} — à décider : ${decision}`;
}

/**
 * Phrase de l'ASSISTANT sur Telegram : nom du projet en tête, texte nettoyé et
 * borné (même gabarit que les autres types).
 * Fonction PURE.
 * @param {{project?: string, text?: string}} [event]
 * @returns {string}
 */
export function buildAssistantMessage(event = {}) {
  const project = requireProject(event.project);
  if (!project) return "";
  const text = limit(sanitizeOwnerText(event.text), MAX_ASSISTANT_CHARS);
  if (!text) return "";
  return `${project} : ${lowerFirst(text)}`;
}

/**
 * Texte du message d'un évènement, selon son type. C'est LE point de passage
 * unique : aucun appelant ne compose un message à la main.
 * Renvoie `""` quand l'évènement ne porte aucune information utile.
 * Fonction PURE.
 * @param {{type?: string}} [event]
 * @returns {string}
 */
export function buildOwnerMessage(event = {}) {
  switch (event.type) {
    case TELEGRAM_MESSAGE_TYPES.START:
      return buildStartMessage(event);
    case TELEGRAM_MESSAGE_TYPES.END:
      return buildEndMessage(event);
    case TELEGRAM_MESSAGE_TYPES.ALERT:
      return buildAlertMessage(event);
    case TELEGRAM_MESSAGE_TYPES.ASSISTANT:
      return buildAssistantMessage(event);
    default:
      return "";
  }
}

// ── Heures calmes ──────────────────────────────────────────────────────────

/**
 * Heures calmes : rien entre 23 h et 7 h (heure LOCALE du poste).
 * Fonction PURE.
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isQuietHours(nowMs = Date.now()) {
  const hour = new Date(nowMs).getHours();
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

/**
 * Millisecondes restantes avant la fin des heures calmes (0 si on n'y est pas).
 * Fonction PURE.
 * @param {number} [nowMs]
 * @returns {number}
 */
export function msUntilQuietEnd(nowMs = Date.now()) {
  if (!isQuietHours(nowMs)) return 0;
  const now = new Date(nowMs);
  const end = new Date(nowMs);
  end.setHours(QUIET_END_HOUR, 0, 0, 0);
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return end.getTime() - now.getTime();
}

/**
 * Faut-il envoyer MAINTENANT ? Oui hors heures calmes, ou si l'évènement est un
 * DANGER IMMÉDIAT (`danger: true`). Sinon, il est mis de côté jusqu'au réveil.
 * Fonction PURE.
 * @param {{danger?: boolean}} event
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function shouldDeliverNow(event = {}, nowMs = Date.now()) {
  if (!isQuietHours(nowMs)) return true;
  return event.danger === true;
}

// ── Anti-rafale (un seul message par changement réel) ───────────────────────

/** Forme comparable d'un message : minuscules, sans chiffres ni ponctuation. */
function comparableForm(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\d\s]+/g, "")
    .replace(/[.,;:!?…—–-]+/g, "");
}

/**
 * Vrai si ce message répète une information DÉJÀ envoyée dans la fenêtre
 * anti-rafale : soit exactement la même information, soit un message qui dit la
 * même chose en plus court/long (l'un contient l'autre), pour le même projet.
 * Fonction PURE.
 * @param {string} text
 * @param {string} project
 * @param {{norm: string, project: string, at: number}[]} recent
 * @param {number} nowMs
 * @param {number} [windowMs]
 * @returns {boolean}
 */
export function isDuplicateMessage(
  text,
  project,
  recent,
  nowMs,
  windowMs = TELEGRAM_BURST_WINDOW_MS,
) {
  const norm = comparableForm(text);
  if (!norm) return false;
  for (const entry of recent || []) {
    if (nowMs - entry.at > windowMs) continue;
    if (entry.project && project && entry.project !== project) continue;
    if (entry.norm === norm) return true;
    if (norm.length >= 8 && entry.norm.length >= 8) {
      if (entry.norm.includes(norm) || norm.includes(entry.norm)) return true;
    }
  }
  return false;
}

// ── Porte unique de publication (horloge et envoi INJECTÉS) ─────────────────

let gateDeps = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h),
  send: null, // (text) => void — fourni par le branchement (desktop-notify.js)
};

let recentMessages = [];
let heldMessages = [];
let quietTimer = null;

/**
 * Remplace les dépendances de la porte (TESTS : horloge et minuteurs factices ;
 * branchement : envoyeur réel). Champ absent = inchangé.
 * @param {{now?: () => number, setTimeout?: Function, clearTimeout?: Function, send?: Function|null}} deps
 */
export function setTelegramGateDeps(deps = {}) {
  gateDeps = { ...gateDeps, ...deps };
}

/** Envoyeur enregistré (le cas échéant). */
export function getTelegramGateSender() {
  return gateDeps.send || null;
}

/** Remet la porte à zéro (tests, arrêt) : aucun minuteur armé, rien de retenu. */
export function resetTelegramGate() {
  if (quietTimer != null) {
    try {
      gateDeps.clearTimeout(quietTimer);
    } catch (_) {
      /* minuteur déjà parti : sans conséquence */
    }
  }
  quietTimer = null;
  recentMessages = [];
  heldMessages = [];
}

/** Nombre de messages mis de côté (diagnostic / tests). */
export function heldOwnerMessageCount() {
  return heldMessages.length;
}

function safeSend(send, text) {
  if (typeof send !== "function") return false;
  try {
    const result = send(text);
    if (result && typeof result.catch === "function") result.catch(() => {});
    return true;
  } catch (_) {
    return false; // jamais visible : un échec d'avis ne perturbe rien
  }
}

function rememberMessage(text, project, nowMs) {
  recentMessages.push({ norm: comparableForm(text), project, at: nowMs });
  // On ne garde que la fenêtre utile (mémoire bornée).
  recentMessages = recentMessages.filter((e) => nowMs - e.at <= TELEGRAM_BURST_WINDOW_MS * 4);
}

function holdMessage(event, text, nowMs) {
  const project = projectShortName(event.project);
  // Une rafale pendant les heures calmes ne remplit pas la réserve.
  if (heldMessages.some((h) => h.norm === comparableForm(text))) return;
  heldMessages.push({ text, norm: comparableForm(text), project, danger: event.danger === true });
  if (heldMessages.length > MAX_HELD_MESSAGES) heldMessages.shift();
  armQuietFlush(nowMs);
}

function armQuietFlush(nowMs) {
  if (quietTimer != null) return;
  const delay = msUntilQuietEnd(nowMs);
  if (delay <= 0) return;
  quietTimer = gateDeps.setTimeout(() => {
    quietTimer = null;
    flushHeldOwnerEvents();
  }, delay + 1000);
}

/**
 * Publie un évènement par la porte UNIQUE : construit le message, élimine les
 * doublons de rafale, respecte les heures calmes, puis envoie.
 *
 * Statuts renvoyés :
 *   - `empty`   : rien d'utile → AUCUN envoi (pas de message « néant ») ;
 *   - `dropped` : même information déjà envoyée à l'instant → aucun envoi ;
 *   - `held`    : heures calmes (et pas de danger immédiat) → mis de côté ;
 *   - `sent`    : message envoyé.
 *
 * @param {object} event - { type, project, action?, ok?, result?, testable?, problem?, decision?, danger?, text? }
 * @param {{now?: () => number, send?: Function}} [deps]
 * @returns {{status: "empty"|"dropped"|"held"|"sent", text: string}}
 */
export function publishOwnerEvent(event = {}, deps = {}) {
  const text = buildOwnerMessage(event);
  if (!text) return { status: "empty", text: "" };
  return publishOwnerText(text, { project: event.project, danger: event.danger, ...deps });
}

/**
 * Message TRIVIAL : accusé de réception, « tout va bien », politesse. Il ne
 * change rien pour le propriétaire : il n'est JAMAIS envoyé. Fonction PURE.
 * @param {string} text
 * @returns {boolean}
 */
export function isTrivialMessage(text) {
  const t = String(text ?? "").trim();
  if (!t) return true;
  return /^(?:ok|okay|d'accord|bien re[cç]u|re[cç]u|compris|not[ée]|parfait|merci|super|nickel|tout va bien|rien [àa] signaler|en cours|en pr[ée]paration)\s*[.!…]*$/i.test(
    t,
  );
}

/**
 * Même porte que `publishOwnerEvent`, pour un texte DÉJÀ construit par un
 * gabarit de ce module (utilisé par le relais différé de l'Assistant) :
 * anti-rafale, heures calmes, puis envoi.
 * @param {string} text - message déjà produit par un gabarit.
 * @param {{project?: string, danger?: boolean, now?: () => number, send?: Function}} [deps]
 * @returns {{status: "empty"|"dropped"|"held"|"sent", text: string}}
 */
export function publishOwnerText(text, deps = {}) {
  const message = String(text ?? "").trim();
  if (!message || isTrivialMessage(message)) return { status: "empty", text: "" };
  const event = { project: deps.project, danger: deps.danger === true };
  const nowMs = (deps.now || gateDeps.now)();
  const project = projectShortName(deps.project);
  if (isDuplicateMessage(message, project, recentMessages, nowMs)) {
    return { status: "dropped", text: message };
  }
  if (!shouldDeliverNow(event, nowMs)) {
    holdMessage(event, message, nowMs);
    return { status: "held", text: message };
  }
  rememberMessage(message, project, nowMs);
  safeSend(deps.send || gateDeps.send, message);
  return { status: "sent", text: message };
}

/**
 * Remet à l'heure du réveil les messages mis de côté pendant les heures calmes.
 * Ne fait rien tant qu'on est encore dans la plage 23 h → 7 h.
 * @param {number} [nowMs]
 * @param {Function} [send]
 * @returns {string[]} textes effectivement envoyés
 */
export function flushHeldOwnerEvents(nowMs = gateDeps.now(), send = gateDeps.send) {
  if (isQuietHours(nowMs)) return [];
  const pending = heldMessages;
  heldMessages = [];
  const sent = [];
  for (const entry of pending) {
    if (isDuplicateMessage(entry.text, entry.project, recentMessages, nowMs)) continue;
    rememberMessage(entry.text, entry.project, nowMs);
    if (safeSend(send, entry.text)) sent.push(entry.text);
  }
  return sent;
}
