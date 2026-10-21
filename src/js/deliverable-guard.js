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
//     écrit). Le doute n'est JAMAIS un refus : sans verbe d'écriture ET sans
//     cible de fichier identifiables, la demande part comme avant.
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

/** Normalise un texte pour l'analyse : minuscules, sans accents, espaces réduits. */
export function normalizeForMatch(text) {
  return String(text == null ? "" : text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// ── Détection du besoin d'ÉCRIRE (conservatrice) ────────────────────────────
// Verbes qui demandent explicitement de PRODUIRE ou de MODIFIER un fichier.
// Volontairement limités : un mot absent ne peut pas provoquer un refus indu
// (« dans le doute on lance »).
const WRITE_VERB_RE = new RegExp(
  "\\b(?:" +
    [
      // français (formes normalisées : sans accents)
      "ecri(?:s|re|vez|t|vent|vant)",
      "cre(?:e|er|ez|ent|ant)",
      "modifi(?:e|er|ez|ent|ant)",
      "gener(?:e|er|ez|ent|ant)",
      "ajout(?:e|er|ez|ent|ant)",
      "enregistr(?:e|er|ez|ent|ant)",
      "remplac(?:e|er|ez|ent|ant)",
      "corrig(?:e|er|ez|ent|ant)",
      "implement(?:e|er|ez|ent|ant)",
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

// Négations : on neutralise ces segments AVANT l'analyse, pour ne jamais
// refuser « analyse le fichier sans rien modifier » ou « ne modifie pas ce
// fichier ». Neutraliser ne peut que rendre la détection PLUS tolérante.
const NEGATION_PATTERNS = [
  /\bsans\s+(?:rien\s+)?(?:le\s+|la\s+|les\s+|de\s+|d')?(?:modifier|ecrire|editer|toucher|changer|creer|produire|enregistrer|sauvegarder)\b[^.;\n]*/g,
  /\bne\s+[^.;\n]{0,80}?\bpas\b[^.;\n]*/g,
  /\bn'[^.;\n]{0,80}?\bpas\b[^.;\n]*/g,
  /\bne\s+jamais\b[^.;\n]*/g,
  /\baucun(?:e)?\s+(?:modification|ecriture|fichier)[^.;\n]*/g,
  /\bwithout\s+(?:modifying|writing|editing|creating|touching|changing)\b[^.;\n]*/g,
  /\bdo\s+not\s+(?:modify|write|edit|create|touch|change)\b[^.;\n]*/g,
];

/** Retire (met à blanc) les segments négatifs d'un texte déjà normalisé. */
export function stripNegations(normalizedText) {
  let out = String(normalizedText || "");
  for (const re of NEGATION_PATTERNS) {
    out = out.replace(re, " ");
  }
  return out;
}

/**
 * La demande demande-t-elle EXPLICITEMENT d'écrire/créer/modifier un fichier ?
 *
 * Conservateur par construction : il faut un VERBE d'écriture ET une CIBLE
 * identifiable (chemin de fichier ou mot « fichier »). Un livrable DÉCLARÉ
 * (`expected_files`) est en soi une demande d'écriture explicite : il n'y a rien
 * à interpréter.
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
  const cleaned = stripNegations(normalizeForMatch(taskText));
  if (!cleaned.trim()) return { explicit: false, verb: null, target: null, via: null };
  const verbMatch = cleaned.match(WRITE_VERB_RE);
  if (!verbMatch) return { explicit: false, verb: null, target: null, via: null };
  const fileMatch = cleaned.match(FILE_EXT_RE);
  if (fileMatch) {
    return { explicit: true, verb: verbMatch[0], target: fileMatch[0], via: "file-path" };
  }
  if (FILE_NOUN_RE.test(cleaned)) {
    return { explicit: true, verb: verbMatch[0], target: "fichier", via: "file-noun" };
  }
  // Verbe d'écriture sans cible de fichier (ex. « écris un plan ») : AMBIGU →
  // aucune décision, la demande part comme aujourd'hui.
  return { explicit: false, verb: verbMatch[0], target: null, via: null };
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
