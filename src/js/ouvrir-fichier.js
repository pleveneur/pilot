// ouvrir-fichier.js — SOURCE UNIQUE de la décision « l'Assistant ouvre un
// fichier » (tâche 394).
//
// L'Assistant ne modifie aucun fichier des projets, mais il doit pouvoir OUVRIR
// un fichier réel du disque — un fichier qu'un agent vient de produire, ou un
// fichier dont la conversation parle — pour le montrer à son propriétaire. Deux
// façons, décidées AUTOMATIQUEMENT selon le type (aucun réglage, aucune fenêtre
// de choix) :
//   1. Pilot SAIT afficher ce type (texte/code, Markdown, PDF, image, CSV) →
//      le fichier est ouvert DANS UN ONGLET de Pilot, par le mécanisme
//      d'ouverture qui existe déjà pour l'utilisateur (`TabsManager.openFile`) ;
//   2. Pilot NE RECONNAÎT PAS le type → le fichier est ouvert avec le PROGRAMME
//      PAR DÉFAUT du système, par la commande existante `open_in_browser`
//      (`open::that`, déjà utilisée par le Feedback et la prévisualisation).
//
// Ce module est PUR : aucun DOM, aucune I/O, aucun appel Tauri. Il ne fait que
// DÉCIDER (quel mode, et quand refuser) ; l'unique point d'action est
// `runSuperAgentOpenFile` (super-agent.js), et l'unique inspection du disque est
// la commande Rust `inspect_open_path` (`files.rs`).
//
// RÈGLE DE SÉCURITÉ (à ne pas casser) : on n'ouvre QUE un fichier EXISTANT, par
// l'un des deux modes ci-dessus. Aucune commande n'est jamais exécutée : un
// chemin qui ressemble à une commande est refusé net (règle 2 de
// `decideOpenFile`).

/** Sentinelle d'outil : titre d'un `input` de l'outil `open_file`
 *  (`pilot-assistant-actions.ts`). Pilot l'intercepte, ouvre le fichier et
 *  renvoie le résultat en JSON comme `value` de la réponse. */
export const OPEN_FILE_SENTINEL = "PILOT_ASSISTANT_OPEN_FILE::";

/** Mode « onglet de Pilot » (type que Pilot sait afficher). */
export const OPEN_FILE_MODE_TAB = "tab";
/** Mode « programme par défaut du système » (type que Pilot ne connaît pas). */
export const OPEN_FILE_MODE_SYSTEM = "system";

/** Motifs de refus (ordre de `decideOpenFile` = ordre ci-dessous). */
export const OPEN_FILE_REFUSAL = {
  EMPTY_PATH: "chemin-vide",
  COMMAND: "chemin-commande",
  RELATIVE: "chemin-non-absolu",
  OUTSIDE: "hors-perimetre",
  MISSING: "fichier-absent",
  DIRECTORY: "dossier",
  EMPTY_FILE: "fichier-vide",
  PANNE: "inspection-impossible",
};

/** Extensions d'image que Pilot affiche (mêmes valeurs que `tabs.js`, qui reste
 *  le point qui les TRAITE : ici on ne fait que décider). */
export const OPEN_FILE_IMAGE_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "tiff", "tif", "avif",
];

/** Extensions PDF (prévisualisation PDF.js). */
export const OPEN_FILE_PDF_EXTENSIONS = ["pdf"];

/** Extensions de tableau (prévisualisation CSV). */
export const OPEN_FILE_CSV_EXTENSIONS = ["csv", "tsv"];

/** Extensions de TEXTE que l'éditeur de Pilot affiche (lecture UTF-8 + coloration).
 *  Volontairement une LISTE BLANCHE : un binaire inconnu ne doit pas être lu comme
 *  du texte (la lecture échouerait) — il partira au programme par défaut. */
export const OPEN_FILE_TEXT_EXTENSIONS = [
  "md", "markdown", "mdx", "txt", "text", "rst", "adoc", "org", "tex",
  "json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "properties", "env",
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "vue", "svelte", "astro",
  "css", "scss", "sass", "less", "html", "htm", "xhtml", "xml", "xsl", "xslt", "svgz",
  "rs", "py", "pyi", "ipynb", "go", "java", "kt", "kts", "scala", "c", "h", "cc", "cpp", "cxx", "hpp", "hh", "cs", "fs", "rb", "php", "pl", "lua", "r", "dart", "swift", "m", "mm",
  "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd", "sql", "graphql", "gql",
  "log", "diff", "patch", "lock", "gitignore", "gitattributes", "editorconfig", "dockerignore",
];

/** Noms de fichiers SANS extension que Pilot affiche comme du texte. */
export const OPEN_FILE_TEXT_FILENAMES = [
  "makefile", "dockerfile", "procfile", "license", "licence", "readme",
  "changelog", "authors", "notice", "gemfile", "rakefile", "cmakelists.txt",
  // Noms en point : pas d'extension, mais lus comme du texte par l'éditeur.
  ".env", ".gitignore", ".gitattributes", ".gitmodules", ".editorconfig",
  ".dockerignore", ".npmrc", ".nvmrc",
];

/**
 * Dernier segment d'un chemin (« nom du fichier »), pour les messages.
 * @param {unknown} path
 * @returns {string}
 */
export function openFilePathTail(path) {
  const text = typeof path === "string" ? path : "";
  const parts = text.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text;
}

/**
 * Extension d'un chemin, en minuscules et sans point ("" si aucune).
 * @param {unknown} path
 * @returns {string}
 */
export function openFileExtension(path) {
  const tail = openFilePathTail(path);
  const dot = tail.lastIndexOf(".");
  if (dot <= 0 || dot === tail.length - 1) return "";
  return tail.slice(dot + 1).toLowerCase();
}

/**
 * DÉCISION PURE : quel MODE D'ONGLET Pilot peut afficher ce fichier ?
 *
 * @param {unknown} path
 * @returns {"edit"|"csv"|"pdf"|"image"|null} `null` quand Pilot ne sait pas
 *   afficher ce type (→ programme par défaut du système).
 */
export function pilotTabModeFor(path) {
  const ext = openFileExtension(path);
  const tail = openFilePathTail(path).toLowerCase();
  if (OPEN_FILE_PDF_EXTENSIONS.includes(ext)) return "pdf";
  if (OPEN_FILE_IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (OPEN_FILE_CSV_EXTENSIONS.includes(ext)) return "csv";
  if (ext && OPEN_FILE_TEXT_EXTENSIONS.includes(ext)) return "edit";
  // Fichier sans extension : uniquement les noms connus (Makefile, Dockerfile…).
  if (!ext && OPEN_FILE_TEXT_FILENAMES.includes(tail)) return "edit";
  return null;
}

/**
 * DÉCISION PURE : par quel mode ouvrir ce fichier ?
 * @param {unknown} path
 * @returns {"tab"|"system"}
 */
export function openFileModeFor(path) {
  return pilotTabModeFor(path) ? OPEN_FILE_MODE_TAB : OPEN_FILE_MODE_SYSTEM;
}

/** Débuts de chaîne qui trahissent une COMMANDE déguisée en chemin. */
const COMMAND_KEYWORDS = [
  "sudo", "cmd", "cmd.exe", "powershell", "pwsh", "bash", "sh", "zsh", "start",
  "open", "xdg-open", "explorer", "rm", "del", "erase", "mv", "move", "cp",
  "copy", "curl", "wget", "chmod", "chown", "git", "npm", "npx", "node",
  "python", "python3", "pip", "reg", "net", "sc", "kill", "taskkill",
];

/**
 * Vrai si le texte RESSEMBLE À UNE COMMANDE plutôt qu'à un chemin de fichier.
 * Aucune analyse parfaite n'est possible : mieux vaut refuser un cas douteux que
 * lancer quelque chose. Rien n'est jamais exécuté de toute façon (les deux modes
 * n'ouvrent qu'un fichier), mais un refus clair vaut mieux qu'un programme
 * système ouvert sur une chaîne incompréhensible.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function looksLikeCommand(text) {
  const raw = typeof text === "string" ? text : "";
  const value = raw.trim();
  if (!value) return false;
  // Retour à la ligne, enchaînement de commandes, redirections, substitution,
  // backticks, variables, expansion : jamais un chemin de fichier.
  if (/[\r\n]/.test(value)) return true;
  if (/[;&|<>`]/.test(value)) return true;
  if (value.includes("$(") || /\$\{/.test(value)) return true;
  if (/^\s*-/.test(value)) return true; // option en tête
  // Deux mots ou plus séparés par une espace, sans chemin qui ressemble à un
  // fichier (ex. « notepad.exe C:\x.txt ») : une commande avec argument.
  const head = value.split(/\s+/)[0].toLowerCase();
  if (COMMAND_KEYWORDS.includes(head)) return true;
  if (/\s/.test(value) && !/[\\/]/.test(head)) return true;
  return false;
}

/**
 * Forme comparable d'un chemin : séparateurs unifiés, casse et « / » final
 * ignorés (Windows ne distingue pas la casse ; sur macOS/Linux ce choix ne peut
 * que RESTREINDRE le périmètre, jamais l'élargir, puisque le fichier doit exister).
 * @param {unknown} path
 * @returns {string}
 */
export function normalizePathForCompare(path) {
  let value = typeof path === "string" ? path.trim() : "";
  value = value.replace(/[\\/]+/g, "/");
  value = value.replace(/\/+$/, "");
  return value.toLowerCase();
}

/**
 * Vrai si `path` est SOUS `root` (ou égal). Compare des chemins normalisés et
 * exige la frontière de dossier : `<root>-autre` n'est PAS sous `<root>`.
 * @param {unknown} path
 * @param {unknown} root
 * @returns {boolean}
 */
export function isUnderPathRoot(path, root) {
  const p = normalizePathForCompare(path);
  const r = normalizePathForCompare(root);
  if (!p || !r) return false;
  return p === r || p.startsWith(r + "/");
}

/**
 * Vrai si le chemin est dans AU MOINS UNE des racines autorisées (projets connus
 * ou espace de travail de l'Assistant).
 * @param {unknown} path
 * @param {unknown[]} roots
 * @returns {boolean}
 */
export function openFileIsInsideRoots(path, roots) {
  if (!Array.isArray(roots)) return false;
  return roots.some((root) => isUnderPathRoot(path, root));
}

/** Vrai si le chemin est ABSOLU (Windows `C:\…`/`C:/…`, POSIX `/…`, UNC `\\…`). */
export function isAbsoluteOpenPath(path) {
  const value = typeof path === "string" ? path.trim() : "";
  if (!value) return false;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.startsWith("\\\\")) return true;
  return value.startsWith("/");
}

/**
 * Résout un chemin relatif contre `cwd` (le dossier courant de l'appelant).
 * @returns {string|null} `null` si le chemin est relatif et qu'aucun `cwd` n'est
 *   disponible (on n'invente pas de dossier de travail).
 */
export function resolveOpenPath(path, cwd) {
  const value = typeof path === "string" ? path.trim() : "";
  if (!value) return null;
  if (isAbsoluteOpenPath(value)) return value;
  const base = typeof cwd === "string" ? cwd.trim() : "";
  if (!base || !isAbsoluteOpenPath(base)) return null;
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return base.replace(/[\\/]+$/, "") + sep + value.replace(/^[\\/]+/, "");
}

/**
 * Phrase de la conversation : ce qui a été ouvert ET comment.
 * @param {{path?:unknown, mode?:unknown}} result
 * @returns {string}
 */
export function openFileSentence(result) {
  const name = openFilePathTail(result && result.path);
  if (!name) return "";
  if (result && result.mode === OPEN_FILE_MODE_TAB) {
    return `📂 « ${name} » est ouvert dans un onglet de Pilot.`;
  }
  return `📂 « ${name} » est ouvert avec le programme par défaut de cet ordinateur.`;
}

/**
 * Message de refus (toujours nominal et sans rien lancer).
 * @param {string} reason
 * @param {string} path
 * @returns {string}
 */
function refusalMessage(reason, path) {
  const name = openFilePathTail(path) || String(path || "");
  switch (reason) {
    case OPEN_FILE_REFUSAL.EMPTY_PATH:
      return "Je n'ouvre rien : aucun chemin de fichier n'a été indiqué.";
    case OPEN_FILE_REFUSAL.COMMAND:
      return `Je n'ouvre que des fichiers : « ${name} » ressemble à une commande, donc je ne lance rien.`;
    case OPEN_FILE_REFUSAL.RELATIVE:
      return `Je n'ouvre pas « ${name} » : il faut un chemin absolu (ou un dossier de travail connu).`;
    case OPEN_FILE_REFUSAL.OUTSIDE:
      return `Je n'ouvre pas « ${name} » : il est hors des projets connus et de mon espace de travail.`;
    case OPEN_FILE_REFUSAL.MISSING:
      return `Je ne trouve pas « ${name} » : le fichier n'existe pas, je n'ouvre rien.`;
    case OPEN_FILE_REFUSAL.DIRECTORY:
      return `« ${name} » est un dossier, pas un fichier : je n'ouvre rien.`;
    case OPEN_FILE_REFUSAL.EMPTY_FILE:
      return `« ${name} » est vide : je n'ouvre rien.`;
    case OPEN_FILE_REFUSAL.PANNE:
      return `Je n'ai pas pu vérifier « ${name} » sur le disque : je n'ouvre rien.`;
    default:
      return `Je n'ouvre pas « ${name} ».`;
  }
}

/**
 * DÉCISION PURE d'ouverture d'un fichier. L'ordre des règles EST la spec.
 *
 * 1. chemin vide/blanc → refus `chemin-vide` (rien n'est ouvert) ;
 * 2. chemin qui ressemble à une commande → refus `chemin-commande` (jamais
 *    d'exécution) ;
 * 3. chemin relatif sans dossier de travail → refus `chemin-non-absolu` ;
 * 4. hors des racines autorisées (projets connus + espace de travail de
 *    l'Assistant) → refus `hors-perimetre` ;
 * 5. inspection indisponible → refus `inspection-impossible` ;
 * 6. fichier inexistant → refus `fichier-absent` ;
 * 7. dossier → refus `dossier` ;
 * 8. fichier vide → refus `fichier-vide` ;
 * 9. sinon → mode `tab` (onglet de Pilot, `tabMode` indique lequel) ou `system`
 *    (programme par défaut), décidé par `openFileModeFor`.
 *
 * @param {{path?:unknown, cwd?:unknown, roots?:unknown}} request
 * @param {{exists?:boolean, is_file?:boolean, isFile?:boolean, is_dir?:boolean, isDir?:boolean, size?:number}|null} inspection
 *   résultat de la commande Rust `inspect_open_path` (lue, jamais décidée ici).
 * @returns {{ok:true, path:string, mode:string, tabMode:string|null, message:string}
 *   | {ok:false, reason:string, path:string, message:string}}
 */
export function decideOpenFile(request, inspection) {
  const raw = request && request.path;
  const rawText = typeof raw === "string" ? raw.trim() : "";
  const refused = (reason, path) => ({
    ok: false,
    reason,
    path: typeof path === "string" ? path : "",
    message: refusalMessage(reason, path),
  });

  // 1. Rien à ouvrir.
  if (!rawText) return refused(OPEN_FILE_REFUSAL.EMPTY_PATH, "");

  // 2. Jamais de commande : on n'ouvre que des fichiers.
  if (looksLikeCommand(rawText)) return refused(OPEN_FILE_REFUSAL.COMMAND, rawText);

  // 3. Chemin absolu, ou relatif résolu contre le dossier de travail fourni.
  const path = resolveOpenPath(rawText, request && request.cwd);
  if (!path) return refused(OPEN_FILE_REFUSAL.RELATIVE, rawText);

  // 4. Périmètre : projets connus + espace de travail de l'Assistant.
  const roots = (request && request.roots) || [];
  if (!openFileIsInsideRoots(path, roots)) {
    return refused(OPEN_FILE_REFUSAL.OUTSIDE, path);
  }

  // 5. L'état du disque vient de l'appelant (aucune I/O ici).
  if (!inspection) return refused(OPEN_FILE_REFUSAL.PANNE, path);
  const exists = inspection.exists === true;
  const isFile = inspection.is_file === true || inspection.isFile === true;
  const isDir = inspection.is_dir === true || inspection.isDir === true;
  const size = Number.isFinite(inspection.size) ? inspection.size : 0;

  // 6. Fichier absent.
  if (!exists || !isFile) {
    // 7. Dossier (un chemin existant qui n'est pas un fichier).
    if (exists && isDir) return refused(OPEN_FILE_REFUSAL.DIRECTORY, path);
    return refused(OPEN_FILE_REFUSAL.MISSING, path);
  }

  // 8. Fichier vide.
  if (size <= 0) return refused(OPEN_FILE_REFUSAL.EMPTY_FILE, path);

  // 9. Ouverture : le mode décide du reste, jamais l'appelant.
  const tabMode = pilotTabModeFor(path);
  const mode = tabMode ? OPEN_FILE_MODE_TAB : OPEN_FILE_MODE_SYSTEM;
  return { ok: true, path, mode, tabMode, message: openFileSentence({ path, mode }) };
}
