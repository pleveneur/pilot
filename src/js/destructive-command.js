// destructive-command.js — GARDE-FOU DES COMMANDES DESTRUCTRICES (décision du
// propriétaire, 2026-11-20).
//
// FAIT MESURÉ, à l'origine de ce fichier : sur un modèle LOCAL, trois essais
// sur trois ont proposé une commande de suppression massive SANS demander
// d'accord. Rien n'a été exécuté, mais le défaut est réel : l'agent peut lancer
// un outil de commande (`bash` / `shell`) sans qu'aucune protection ne regarde
// ce qu'il y a dedans. Pilot protégeait l'ÉCRITURE de fichier (porte
// `pilot-edit-gate`), les fichiers RÉSERVÉS (`pilot-reserve-gate`) et
// l'ÉCRAN (`screen-guard.js`) — pas les commandes de la machine.
//
// Ce module est la SOURCE UNIQUE de la décision « cette commande est-elle
// manifestement destructrice ? ». Il ne décide JAMAIS qui confirme : il dit ce
// qu'il a reconnu, pourquoi c'est dangereux et ce qui arriverait si l'accord
// était donné. L'écran (onglet chat, Assistant 🧭, dialogue de secours) et
// l'extension `pilot-bash-guard.ts` ne font qu'appliquer sa réponse.
//
// CONTRAT D'IMPORT : module PUR, SANS AUCUN import (ni DOM, ni Tauri, ni autre
// module du projet). Il est embarqué tel quel par `agent_service.rs` et écrit
// À CÔTÉ de l'extension `pilot-bash-guard.ts`, qui l'importe par
// `./destructive-command.js` : la moindre dépendance casserait cet import et
// l'extension ne se chargerait plus (l'agent perdrait son garde-fou en
// silence). Même contrat que `regles-communes-assistants.js`.
//
// INDÉPENDANCE DU MODÈLE : rien ici ne lit la configuration, le modèle, le
// fournisseur ni la langue. La décision est la même pour tous les modèles —
// c'est ce qui rend la protection vérifiable.

/** Sentinelle machine de la porte (message `confirm` :
 *  `PILOT_BASH_GATE::<json>`). Une seule grammaire, jamais recopiée. */
export const BASH_GATE_SENTINEL = "PILOT_BASH_GATE::";

/** Outils de commande couverts (noms d'outils pi). */
export const SHELL_TOOL_NAMES = ["bash", "shell"];

/** Champs d'entrée qui peuvent porter la ligne de commande (mêmes clés que
 *  `toolCallCommand()` de `loop-detection.js`). */
export const SHELL_COMMAND_KEYS = ["command", "cmd", "commandLine", "script"];

/**
 * Les familles de destruction couvertes. `label` est le nom court montré en
 * tête du dialogue ; `why` explique le danger en français simple ; `consequence`
 * dit ce qui arriverait si l'accord était donné (exigence du propriétaire :
 * « ce qui se passe si vous acceptez »).
 */
export const DESTRUCTIVE_FAMILIES = {
  suppression_recursive: {
    label: "suppression récursive d'un dossier",
    why:
      "La suppression récursive efface un dossier ET tout son contenu, sans passer par la corbeille. " +
      "Rien n'est récupérable après coup, et un dossier mal choisi peut emporter le travail de plusieurs jours.",
    consequence: "Tous les fichiers et sous-dossiers visés seront supprimés définitivement.",
  },
  suppression_forcee: {
    label: "suppression forcée",
    why:
      "L'option « force » supprime même les fichiers protégés ou en lecture seule, et n'affiche " +
      "aucune demande de confirmation : tout part sans avertissement.",
    consequence: "Les fichiers visés seront supprimés définitivement, sans autre avertissement.",
  },
  disque: {
    label: "effacement direct d'un disque ou d'une partition",
    why:
      "Cette commande écrit directement sur un disque (ou écrase son contenu) en contournant les fichiers : " +
      "elle emporte le système, les autres logiciels et toutes les données du disque visé.",
    consequence: "Le disque ou la partition visé sera effacé ; l'ordinateur peut ne plus démarrer.",
  },
  formatage: {
    label: "formatage d'un disque ou d'une partition",
    why:
      "Le formatage efface la table des fichiers d'un disque ou d'une partition : tout ce qu'elle " +
      "contenait devient inaccessible, y compris ce qui n'appartient pas au projet.",
    consequence: "Le disque ou la partition visé sera reformaté : son contenu sera perdu.",
  },
  extinction: {
    label: "arrêt ou redémarrage de l'ordinateur",
    why:
      "Cette commande arrête ou redémarre la machine, donc aussi les autres logiciels ouverts, " +
      "les agents en cours de travail et les enregistrements non terminés.",
    consequence: "L'ordinateur s'arrêtera ou redémarrera : tout travail non enregistré sera perdu.",
  },
  droits_masse: {
    label: "changement massif de droits d'accès",
    why:
      "Cette commande change les droits d'un dossier ENTIER, récursivement : elle peut rendre des " +
      "fichiers illisibles pour leur propriétaire, ou ouvrir à tout le monde des données privées.",
    consequence:
      "Les droits de tous les fichiers visés seront modifiés ; revenir à l'état d'avant n'est pas garanti.",
  },
  git_push_force: {
    label: "envoi forcé qui écrase un dépôt",
    why:
      "Un envoi forcé (force push) remplace l'historique du dépôt distant, même s'il contient des " +
      "travaux qui ne sont pas sur cet ordinateur : ces commits n'y seront plus accessibles.",
    consequence:
      "Le dépôt distant perdra les commits qui ne sont pas présents ici, pour tous les postes.",
  },
  git_historique: {
    label: "nettoyage ou réécriture de l'historique git",
    why:
      "Cette commande réécrit, purge ou efface une partie de l'historique du dépôt (commits, " +
      "branches, stashs) : les éléments concernés ne sont plus récupérables par les moyens habituels.",
    consequence: "Des commits, une branche ou l'historique local seront perdus définitivement.",
  },
  hors_projet: {
    label: "écriture en dehors du projet ouvert",
    why:
      "Cette commande écrit, crée ou supprime un fichier EN DEHORS du projet ouvert : elle touche " +
      "à d'autres dossiers de l'ordinateur, qui n'ont rien à voir avec le travail demandé.",
    consequence: "Un fichier ou un dossier situé hors du projet sera créé, modifié ou supprimé.",
  },
};

/** Ordre de priorité quand plusieurs familles se reconnaissent dans la même
 *  commande (la plus grave d'abord — c'est elle qui est annoncée). */
export const FAMILY_PRIORITY = [
  "disque",
  "formatage",
  "suppression_recursive",
  "suppression_forcee",
  "droits_masse",
  "extinction",
  "git_push_force",
  "git_historique",
  "hors_projet",
];

// ── Emplacements système : écrire là est toujours hors du projet ────────────
// (chemins normalisés en minuscules, séparateur `/`, sans `/` final)
const SYSTEM_ROOTS = [
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/boot",
  "/lib",
  "/lib64",
  "/opt",
  "/proc",
  "/sys",
  "/root",
  "/dev",
  "/var/log",
  "/system",
  "/library",
  "/applications",
  "/private/etc",
  "c:/windows",
  "c:/program files",
  "c:/program files (x86)",
  "c:/programdata",
  "c:/$recycle.bin",
];

// ── Emplacements de travail temporaire : jamais signalés ────────────────────
const SCRATCH_ROOTS = ["/tmp", "/var/tmp", "/dev/shm", "c:/windows/temp"];

// Cibles de redirection qui ne sont pas des fichiers écrits.
const IGNORED_REDIRECT_TARGETS = /^(?:\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)|nul|&\d|\d|-\s*$|con)$/i;

/** Normalise une commande pour l'analyse (jamais pour l'affichage). */
function normalizeCommand(text) {
  return String(text == null ? "" : text)
    .replace(/\r\n?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Découpe une ligne de commande en segments indépendants (`&&`, `||`, `;`, `|`).
 *  Volontairement simple : l'analyse ne doit jamais lever sur une commande
 *  exotique, et un découpage approximatif ne peut que SUR-signaler (jamais
 *  laisser passer une commande destructrice). */
function segmentsOf(command) {
  return normalizeCommand(command)
    .split(/[;&|\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Dernier composant d'un chemin (nom du programme), en minuscules, sans `.exe`. */
function programName(token) {
  const cleaned = String(token || "").replace(/^["']|["']$/g, "");
  const parts = cleaned.split(/[\\/]/);
  const last = parts[parts.length - 1] || "";
  return last.toLowerCase().replace(/\.(exe|com|cmd|bat|ps1)$/i, "");
}

/** Mots qui précèdent la vraie commande (`sudo shutdown …`). */
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "nohup",
  "env",
  "time",
  "command",
  "exec",
  "runas",
  "start",
  "cmd",
  "powershell",
  "pwsh",
  "bash",
  "sh",
  "zsh",
  "call",
]);

/** Nom du programme réellement lancé par un segment. */
function commandWord(tokens) {
  for (const token of tokens) {
    const name = programName(token);
    if (!name) continue;
    if (WRAPPERS.has(name)) continue;
    return name;
  }
  return "";
}

/** Sous-commande git effective, en ignorant les options GLOBALES qui prennent une
 *  valeur (`git -C /chemin push --force`). Sans cela, `git -C … push --force`
 *  passait pour une sous-commande nommée `-c` et l'envoi forcé n'était pas vu. */
function gitSubcommand(tokens) {
  const VALUE_OPTS = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path)$/i;
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (VALUE_OPTS.test(t)) {
      i += 2;
      continue;
    }
    if (/^-/.test(t)) {
      i += 1;
      continue;
    }
    return { sub: String(t).toLowerCase(), rest: tokens.slice(i + 1) };
  }
  return { sub: "", rest: [] };
}

/** Vrai si l'un des jetons est un drapeau qui correspond à la forme donnée. */
function hasFlag(tokens, re) {
  return tokens.some((t) => re.test(String(t).replace(/^["']|["']$/g, "")));
}

/** Concaténation en minuscules des jetons (pour les tests de sous-chaînes). */
function joined(tokens) {
  return tokens.join(" ").toLowerCase();
}

/**
 * Normalise un chemin pour la comparaison (séparateurs, casse, `/` final).
 * @param {string} p
 * @returns {string}
 */
export function normalizePathForCompare(p) {
  const raw = String(p == null ? "" : p).replace(/^["']|["']$/g, "").trim();
  const withSlashes = raw.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const trimmed = withSlashes.length > 1 ? withSlashes.replace(/\/+$/, "") : withSlashes;
  return trimmed.toLowerCase();
}

/**
 * Vrai si `path` est `root` ou se trouve SOUS `root` (frontière de dossier
 * respectée : `/a/bc` n'est pas sous `/a/b`).
 * @param {string} path
 * @param {string} root
 * @returns {boolean}
 */
export function isPathUnderRoot(path, root) {
  const p = normalizePathForCompare(path);
  const r = normalizePathForCompare(root);
  if (!p || !r) return false;
  if (p === r) return true;
  return p.startsWith(r.endsWith("/") ? r : r + "/");
}

/** Vrai si la cible ressemble à un chemin absolu (ou relatif au domicile). */
function looksAbsolutePath(target) {
  const t = String(target || "").replace(/^["']|["']$/g, "");
  if (!t) return false;
  return (
    /^\//.test(t) || // Unix
    /^[a-zA-Z]:[\\/]/.test(t) || // Windows « C:\… »
    /^\\\\/.test(t) || // partage UNC
    /^~[\\/]?/.test(t) || // domicile
    /^%[a-z_]+%/i.test(t) || // %USERPROFILE%
    /^\$env:/i.test(t) ||
    /^\$(?:home|\{home\})/i.test(t)
  );
}

/**
 * Vrai si la cible est un emplacement de travail temporaire (jamais signalé).
 * @param {string} target
 * @returns {boolean}
 */
function isScratchTarget(target) {
  return SCRATCH_ROOTS.some((root) => isPathUnderRoot(target, root));
}

/**
 * Vrai si écrire sur `target` sort du projet ouvert.
 *  - chemin relatif → reste dans le dossier courant du projet : NON ;
 *  - emplacement temporaire → NON ;
 *  - racine du projet connue → tout chemin absolu hors de cette racine : OUI ;
 *  - racine inconnue → seuls les emplacements SYSTÈME sont signalés.
 * @param {string} target
 * @param {string} projectRoot
 * @returns {boolean}
 */
export function writesOutsideProject(target, projectRoot) {
  if (!looksAbsolutePath(target)) return false;
  if (isScratchTarget(target)) return false;
  const root = String(projectRoot || "").trim();
  if (root) return !isPathUnderRoot(target, root);
  const norm = normalizePathForCompare(target);
  return SYSTEM_ROOTS.some((sys) => norm === sys || norm.startsWith(sys + "/"));
}

/** Cibles de redirection d'un segment (`> f`, `>> f`, `2> f`). */
function redirectTargets(segment) {
  const targets = [];
  const re = /(?:\d?>>?)\s*([^\s]+)/g;
  let m;
  while ((m = re.exec(segment))) {
    const target = m[1];
    if (!target || IGNORED_REDIRECT_TARGETS.test(target)) continue;
    targets.push(target);
  }
  return targets;
}

/** Vrai si un jeton est un DRAPEAU (et non un chemin écrit). Le piège : sous
 *  Unix, un chemin absolu commence aussi par `/` (`rm /etc/hosts`) — le
 *  confondre avec un drapeau Windows (`/s`, `/q`) faisait disparaître la cible
 *  de l'analyse. Un drapeau Windows est court (1 à 2 lettres, éventuellement
 *  `:valeur`) ; « /etc » ou « /home/dev/x » sont donc bien des chemins. */
function isFlagToken(token) {
  const s = String(token == null ? "" : token).replace(/^["']|["']$/g, "");
  if (/^-/.test(s)) return true;
  return /^\/[A-Za-z]{1,2}(?::[A-Za-z]+)?$/.test(s);
}

/** Commandes dont TOUS les arguments sont des chemins écrits. */
const PATH_ARG_WRITERS = new Set([
  "rm",
  "rmdir",
  "rd",
  "del",
  "erase",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "chgrp",
  "truncate",
  "shred",
  "remove-item",
  "ri",
  "new-item",
  "set-content",
  "add-content",
  "out-file",
  "copy-item",
  "move-item",
  "clear-content",
  "takeown",
  "icacls",
]);

/** Commandes dont le DERNIER argument est la destination écrite. */
const LAST_ARG_WRITERS = new Set(["cp", "mv", "rsync", "ln", "install", "scp", "copy", "move", "xcopy", "robocopy"]);

/** Chemins écrits par un segment (hors redirections). */
function writtenPaths(segment) {
  const tokens = segment.split(/\s+/).filter(Boolean);
  const word = commandWord(tokens);
  const paths = [];
  if (!word) return paths;
  const args = tokens.filter((t) => t !== tokens[0]);
  if (PATH_ARG_WRITERS.has(word)) {
    for (const t of args) {
      if (isFlagToken(t)) continue;
      paths.push(t);
    }
  } else if (LAST_ARG_WRITERS.has(word) && args.length >= 2) {
    paths.push(args[args.length - 1]);
  } else if (word === "dd") {
    for (const t of args) {
      const m = /^of=(.+)$/i.exec(t);
      if (m) paths.push(m[1]);
    }
  } else if (word === "tee") {
    for (const t of args) if (!isFlagToken(t)) paths.push(t);
  }
  return paths;
}

/** Familles reconnues dans un segment (identifiants, pas encore triés). */
function familiesOfSegment(segment, projectRoot) {
  const found = new Set();
  const tokens = segment.split(/\s+/).filter(Boolean);
  const word = commandWord(tokens);
  const low = joined(tokens);

  // ── 1. Disque / partition / formatage ────────────────────────────────────
  if (word === "dd") {
    for (const t of tokens) {
      if (/^of=\/dev\//i.test(t) || /^of=\\\\\.\\physicaldrive/i.test(t)) found.add("disque");
    }
  }
  if (/^mkfs(\.|$)/.test(word) || word === "mkfs" || word === "wipefs") found.add("formatage");
  if (word === "diskpart" || word === "fdisk" || word === "parted" || word === "sgdisk" || word === "gdisk") {
    found.add("formatage");
  }
  if (/^diskutil$/i.test(word) && /\b(erase\w*|partitiondisk|zerodisk)\b/.test(low)) found.add("formatage");
  if (word === "format" || word === "format.com") found.add("formatage");
  // Écriture directe sur un disque brut par redirection (`> /dev/sda`).
  for (const target of redirectTargets(segment)) {
    if (/^\/dev\/(?:sd|hd|nvme|vd|disk|mmcblk|loop)/i.test(target)) found.add("disque");
    if (/^\\\\\.\\physicaldrive/i.test(target)) found.add("disque");
  }

  // ── 2. Suppression récursive / forcée ────────────────────────────────────
  const recursiveFlags = /^(?:-[a-z]*r[a-z]*|--recursive|\/s|-recurse|-r|-rf)$/i;
  const forcedFlags = /^(?:-[a-z]*f[a-z]*|--force|\/f|\/q|-force|-fo)$/i;
  const deletionWords = new Set(["rm", "rd", "rmdir", "del", "erase", "remove-item", "ri"]);
  if (deletionWords.has(word)) {
    // Viser la RACINE elle-même (`rm -rf /`, `del C:\`) n'est plus « un
    // dossier » : c'est le disque entier. Annoncé comme tel, la phrase est
    // juste et l'utilisateur comprend l'échelle (famille `disque`).
    const roots = tokens
      .slice(1)
      .filter((t) => /^(?:--no-preserve-root|\/|\/\*|[a-z]:[\\/]?|\\)$/i.test(String(t)));
    if (roots.length) found.add("disque");
    const flags = tokens.slice(1).filter((t) => /^[-/]/.test(t));
    if (flags.some((t) => recursiveFlags.test(t))) found.add("suppression_recursive");
    else if (flags.some((t) => forcedFlags.test(t))) found.add("suppression_forcee");
    else if (/\b-recurse\b|\/s\b/.test(low)) found.add("suppression_recursive");
  }
  if (word === "find" && hasFlag(tokens, /^-delete$/i)) found.add("suppression_recursive");

  // ── 3. Droits en masse ──────────────────────────────────────────────────
  if ((word === "chmod" || word === "chown" || word === "chgrp") && hasFlag(tokens, /^(?:-[a-z]*r[a-z]*|--recursive)$/i)) {
    found.add("droits_masse");
  }
  if (word === "icacls" && /\/(?:t|grant|reset)\b/.test(low) && /\/t\b/.test(low)) found.add("droits_masse");
  if (word === "takeown" && /\/r\b|\/s\b/.test(low)) found.add("droits_masse");
  if (word === "attrib" && /\/s\b/.test(low)) found.add("droits_masse");
  if (word === "set-acl") found.add("droits_masse");

  // ── 4. Arrêt / redémarrage ──────────────────────────────────────────────
  if (["shutdown", "reboot", "poweroff", "halt", "logoff", "restart-computer", "stop-computer"].includes(word)) {
    found.add("extinction");
  }
  if (word === "systemctl" && /\b(poweroff|reboot|halt|kexec|suspend)\b/.test(low)) found.add("extinction");
  if ((word === "init" || word === "telinit") && /\b(0|6)\b/.test(low)) found.add("extinction");
  if (word === "shutdown.exe") found.add("extinction");

  // ── 5. Git : envoi forcé / historique ───────────────────────────────────
  if (word === "git") {
    const { sub, rest } = gitSubcommand(tokens);
    const restLow = rest.join(" ").toLowerCase();
    if (sub === "push") {
      const forced =
        hasFlag(rest, /^--force$|^-f$|^--force-with-lease|^--mirror$/i) ||
        rest.some((t) => /^\+/.test(t)) ||
        /\s\+\S/.test(" " + restLow);
      if (forced) found.add("git_push_force");
      if (hasFlag(rest, /^--delete$/i) || /-d\b/.test(restLow)) found.add("git_historique");
    }
    if (sub === "reset" && hasFlag(rest, /^--hard$/i)) found.add("git_historique");
    if (sub === "filter-branch" || sub === "filter-repo") found.add("git_historique");
    if (sub === "reflog" && /\b(expire|delete)\b/.test(restLow)) found.add("git_historique");
    if (sub === "gc" && /--prune\s*(?:=|\s)\s*(?:now|all|0)/.test(restLow)) found.add("git_historique");
    if (sub === "clean" && hasFlag(rest, /^-[a-z]*f[a-z]*$/i)) found.add("git_historique");
    if (sub === "branch" && hasFlag(rest, /^-d$|^--delete$/i)) found.add("git_historique");
    if (sub === "stash" && /\b(drop|clear)\b/.test(restLow)) found.add("git_historique");
  }

  // ── 6. Écriture hors du projet ──────────────────────────────────────────
  const candidates = [...writtenPaths(segment), ...redirectTargets(segment)];
  for (const candidate of candidates) {
    if (writesOutsideProject(candidate, projectRoot)) {
      found.add("hors_projet");
      break;
    }
  }

  return found;
}

/**
 * ANALYSE UNE COMMANDE.
 *
 * @param {unknown} command - ligne de commande (texte brut).
 * @param {{projectRoot?: string}} [options] - racine du projet ouvert (le
 *   dossier de travail de la session). Sans elle, seuls les emplacements
 *   SYSTÈME comptent comme « hors projet ».
 * @returns {{dangerous: boolean, family: string, label: string, why: string,
 *   consequence: string, command: string}} `family` vaut "" quand la commande
 *   est ordinaire.
 */
export function analyzeDestructiveCommand(command, options) {
  const raw = typeof command === "string" ? command : "";
  const projectRoot = (options && options.projectRoot) || "";
  const result = { dangerous: false, family: "", label: "", why: "", consequence: "", command: normalizeCommand(raw) };
  if (!result.command) return result;

  const found = new Set();
  for (const segment of segmentsOf(raw)) {
    for (const family of familiesOfSegment(segment, projectRoot)) found.add(family);
  }
  const family = FAMILY_PRIORITY.find((f) => found.has(f));
  if (!family) return result;
  const info = DESTRUCTIVE_FAMILIES[family];
  return {
    ...result,
    dangerous: true,
    family,
    label: info.label,
    why: info.why,
    consequence: info.consequence,
  };
}

/**
 * Tête du dialogue : ce que l'utilisateur voit en premier.
 * @param {{label?: string}} finding
 * @returns {string}
 */
export function destructiveGateTitle(finding) {
  const label = (finding && finding.label) || "commande dangereuse";
  return `Commande dangereuse : ${label}`;
}

/**
 * Corps du dialogue en français simple — la commande, POURQUOI c'est dangereux,
 * et ce qui se passe si l'on accepte. Une seule composition : l'extension
 * (charge utile de la sentinelle) et les écrans (qui la relisent) utilisent ce
 * texte, jamais une seconde formulation.
 * @param {{command?: string, label?: string, why?: string, consequence?: string}} finding
 * @returns {string}
 */
export function destructiveCommandMessage(finding) {
  const f = finding || {};
  const lines = [];
  lines.push("L'agent veut lancer cette commande sur votre ordinateur :");
  lines.push("");
  const command = normalizeCommand(f.command);
  lines.push(command ? `    ${command}` : "    (commande vide)");
  lines.push("");
  if (f.why) lines.push(`Pourquoi c'est dangereux : ${f.why}`);
  if (f.consequence) lines.push(`Si vous acceptez : ${f.consequence}`);
  lines.push("");
  lines.push("Si vous refusez, la commande n'est pas lancée et l'ordinateur n'est pas touché.");
  return lines.join("\n");
}

/**
 * Charge utile JSON de la porte (portée par la sentinelle dans un `confirm`).
 * `title` porte le TEXTE LISIBLE COMPLET : si la demande atteint un chemin
 * d'affichage générique, le filet de sécurité des sentinelles
 * (`machine-sentinel.js`) y retrouve une phrase française, jamais un
 * identifiant machine.
 * @param {{tool?: string} & object} finding
 * @param {string} [toolName]
 * @returns {object}
 */
export function destructiveGatePayload(finding, toolName) {
  const f = finding || {};
  return {
    tool: toolName || "bash",
    family: f.family || "",
    label: f.label || "",
    command: normalizeCommand(f.command),
    why: f.why || "",
    consequence: f.consequence || "",
    title: destructiveCommandMessage(f),
  };
}

/**
 * Message de la sentinelle (`confirm`) : `PILOT_BASH_GATE::<json>`.
 * @param {object} finding
 * @param {string} [toolName]
 * @returns {string}
 */
export function destructiveGateSentinelMessage(finding, toolName) {
  return BASH_GATE_SENTINEL + JSON.stringify(destructiveGatePayload(finding, toolName));
}

/**
 * Vrai si un `confirm` porte la porte des commandes destructrices.
 * @param {unknown} message
 * @returns {boolean}
 */
export function isDestructiveGateMessage(message) {
  return typeof message === "string" && message.startsWith(BASH_GATE_SENTINEL);
}

/**
 * Relit la charge utile d'une sentinelle. Ne lève jamais : une charge utile
 * illisible rend `null` (l'appelant refuse alors, il n'autorise pas).
 * @param {unknown} message
 * @returns {object|null}
 */
export function parseDestructiveGateMessage(message) {
  if (!isDestructiveGateMessage(message)) return null;
  const raw = message.slice(BASH_GATE_SENTINEL.length);
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Ce que le moteur reçoit quand la commande n'est PAS autorisée. Français,
 * explicite, sans identifiant machine : le modèle comprend qu'il ne doit pas
 * réessayer en contournant.
 * @param {{command?: string, label?: string}} finding
 * @returns {string}
 */
export function destructiveGateRefusal(finding) {
  const f = finding || {};
  const command = normalizeCommand(f.command);
  const label = f.label || "commande dangereuse";
  return (
    `Commande REFUSÉE et NON exécutée (${label})` +
    (command ? ` : ${command}` : "") +
    ". Pilot demande toujours l'accord de l'utilisateur avant ce genre de commande, et cet accord " +
    "n'a pas été donné. N'essaie pas de la relancer sous une autre forme, ni par un autre outil : " +
    "explique à l'utilisateur ce que tu voulais faire, et laisse-le décider."
  );
}

/**
 * Décision « faut-il demander l'accord ? » à partir d'un couple outil/entrée —
 * point unique utilisé par l'extension. Tolère les entrées inconnues.
 * @param {unknown} toolName
 * @param {any} input
 * @param {string} [projectRoot]
 * @returns {{gated: boolean, finding: object}}
 */
export function planShellToolCall(toolName, input, projectRoot) {
  const tool = typeof toolName === "string" ? toolName : "";
  if (!SHELL_TOOL_NAMES.includes(tool)) return { gated: false, finding: null };
  const args = input && typeof input === "object" ? input : {};
  let command = "";
  for (const key of SHELL_COMMAND_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      command = value;
      break;
    }
  }
  if (!command) return { gated: false, finding: null };
  const finding = analyzeDestructiveCommand(command, { projectRoot: projectRoot || "" });
  return { gated: finding.dangerous, finding };
}
