#!/usr/bin/env node
// gds-reload.js — Rechargement SÛR et répétable du conteneur GDS (refonte GDS).
//
// OBJET : une seule commande, lisible, qui enchaîne dans l'ordre :
//   1. contrôle des prérequis (logiciel de conteneurs, fichier de composition, .env) ;
//   2. SAUVEGARDE datée des volumes d'état (base, dépôts git, clefs d'hôte) ;
//   3. reconstruction de l'image locale ;
//   4. recréation du conteneur en CONSERVANT les volumes nommés ;
//   5. attente que le service réponde (/api/gds/health) ;
//   6. compte rendu final (ce qui a été fait, où est la sauvegarde, le service répond-il).
//
// USAGE (depuis la racine du projet) :
//   npm run gds:reload                 # rechargement complet (sauvegarde incluse)
//   npm run gds:image                  # reconstruction de l'image SEULE (service intact)
//   node scripts/gds-reload.js --help
//
// SÉCURITÉ (non contournable par accident) :
//   - ce script ne supprime JAMAIS les volumes : aucun « down -v », « volume rm »,
//     « volume prune » n'est construit, et tout argument de ce genre est REFUSÉ ;
//   - si la sauvegarde échoue, la chaîne s'ARRÊTE : aucune reconstruction, aucune
//     recréation (les données restent dans les volumes, intacts) ;
//   - aucun secret n'est lu, affiché ni journalisé (le fichier `.env` n'est jamais
//     ouvert ; seule sa présence est vérifiée).
//
// Référence: docs/gds-server-setup.md §9, docs/gds-guide-mise-en-place.md partie 4.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
// Toutes les commandes `docker compose` tournent DANS ce dossier : c'est là que
// vivent le fichier de composition et le `.env` du serveur.
export const COMPOSE_DIR = path.join(REPO_ROOT, "gds-server");
export const COMPOSE_FILE = path.join(COMPOSE_DIR, "docker-compose.yml");
export const ENV_FILE = path.join(COMPOSE_DIR, ".env");
export const BACKUP_ROOT = path.join(COMPOSE_DIR, "backups");

// Nom de projet Compose figé dans `gds-server/docker-compose.yml` (`name: pilot-gds`) :
// les volumes réels s'appellent donc `pilot-gds_<nom>`.
export const PROJECT = "pilot-gds";
export const IMAGE = "pilot-gds:local";
// Volumes qui PORTENT DE L'ÉTAT : à sauvegarder avant toute manipulation.
// (`supervisor` ne contient que des journaux : ni sauvegardé, ni nécessaire.)
export const STATE_VOLUMES = ["pgdata", "repos", "ssh-host-keys"];

export const DEFAULT_HTTP_PORT = 8080;
export const DEFAULT_HEALTH_TIMEOUT_S = 240;

// Signatures d'une intention DESTRUCTIVE : refus explicite avec explication.
const DESTRUCTIVE_HINTS = [
  /^-v$/,
  /^--volumes?$/,
  /^down$/,
  /^rm$/,
  /^prune$/,
  /^volume$/,
  /^-rf$/,
  /^--force$/,
  /^--purge$/,
];

// ── Partie PURE (testée sans Docker : scripts/gds-reload.test.js) ─────────────

/** Message de refus d'un argument, avec explication adaptée. */
export function refuseMessage(arg) {
  const base = `Argument refusé : « ${arg} ».`;
  if (DESTRUCTIVE_HINTS.some((re) => re.test(arg))) {
    return (
      `${base}\n` +
      "Ce script ne supprime JAMAIS les volumes ni les données : aucun « down -v »,\n" +
      "« volume rm », « volume prune » ou « rm » n'est accepté.\n" +
      "Supprimer les volumes effacerait sans retour la base (comptes, suivi), les\n" +
      "dépôts git et les clefs d'hôte. Pour cela, il n'existe pas de commande\n" +
      "automatique : voir « gestes dangereux » (docs/gds-guide-mise-en-place.md, partie 6)."
    );
  }
  return (
    `${base} Seuls les arguments --image-only, --backup-dir <chemin>,\n` +
    "--timeout <secondes> et --help sont acceptés."
  );
}

/** Analyse les arguments. Retourne `{ ok:true, opts }` ou `{ ok:false, error }`. */
export function parseArgs(argv) {
  const opts = { mode: "reload", backupDir: null, timeoutS: DEFAULT_HEALTH_TIMEOUT_S, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--image-only") {
      opts.mode = "image-only";
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--backup-dir" || arg === "--timeout") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `Argument refusé : « ${arg} » attend une valeur.` };
      }
      if (arg === "--backup-dir") {
        opts.backupDir = value;
      } else {
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          return { ok: false, error: "Argument refusé : --timeout attend un nombre de secondes > 0." };
        }
        opts.timeoutS = seconds;
      }
      continue;
    }
    return { ok: false, error: refuseMessage(arg) };
  }
  return { ok: true, opts };
}

/**
 * Enchaînement des étapes, par mode. `image-only` ne touche NI à la sauvegarde,
 * NI au conteneur en service.
 */
export function planSteps(mode) {
  return mode === "image-only"
    ? ["precheck", "build", "report"]
    : ["precheck", "backup", "build", "recreate", "health", "report"];
}

function compose(...args) {
  return { label: `docker compose ${args.join(" ")}`, cmd: "docker", args: ["compose", ...args] };
}

/** Recrée le conteneur en CONSERVANT les volumes nommés (`up -d`, jamais `-v`). */
export function buildRecreateCommand() {
  return compose("up", "-d");
}

/** Reconstruit l'image locale, sans toucher au conteneur qui tourne. */
export function buildImageCommand() {
  return compose("build");
}

/** Arrêt propre : nécessaire pour une sauvegarde cohérente de la base. */
export function buildStopCommand() {
  return compose("stop");
}

/** Sauvegarde d'un volume d'état en lecture seule (`:ro`) vers un fichier daté. */
export function buildVolumeBackupCommand(volume, backupDir, image = IMAGE) {
  const volumeName = `${PROJECT}_${volume}`;
  return {
    label: `sauvegarde du volume ${volumeName} → ${path.join(backupDir, `${volume}.tgz`)}`,
    cmd: "docker",
    args: [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/data:ro`,
      "-v",
      `${backupDir}:/backup`,
      image,
      "tar",
      "czf",
      `/backup/${volume}.tgz`,
      "-C",
      "/data",
      ".",
    ],
  };
}

/**
 * Filet de sécurité : vérifie qu'AUCUNE commande construite n'est destructive.
 * Retourne `null` si tout est sûr, sinon le message expliquant le refus.
 */
export function assertCommandsSafe(commands) {
  for (const command of commands) {
    const args = command.args;
    const label = command.label || `${command.cmd} ${args.join(" ")}`;
    if (args.includes("down") && (args.includes("-v") || args.includes("--volumes"))) {
      return `Commande destructrice refusée : « ${label} » supprimerait les volumes (données perdues).`;
    }
    if (args.includes("--volumes")) {
      return `Commande destructrice refusée : « ${label} » porte l'option --volumes (données perdues).`;
    }
    if (args[0] === "volume" && (args.includes("rm") || args.includes("prune"))) {
      return `Commande destructrice refusée : « ${label} » supprimerait un ou plusieurs volumes.`;
    }
    if (args.includes("prune")) {
      return `Commande destructrice refusée : « ${label} » élaguerait des ressources (volumes possibles).`;
    }
    if (args.includes("rm") && (args.includes("-rf") || args.includes("-r"))) {
      return `Commande destructrice refusée : « ${label} » supprimerait des fichiers.`;
    }
  }
  return null;
}

/** Lit le port HTTP publié dans le texte d'un `.env` (sans jamais l'afficher). */
export function parseHttpPort(envText, fallback = DEFAULT_HTTP_PORT) {
  const match = /^\s*GDS_HOST_HTTP_PORT\s*=\s*(\d+)\s*$/m.exec(envText || "");
  return match ? Number(match[1]) : fallback;
}

/**
 * Adresse à interroger pour la santé : l'adresse d'écoute HTTP si elle est
 * renseignée et joignable depuis le poste, sinon la boucle locale.
 */
export function parseHttpHost(envText, fallback = "127.0.0.1") {
  const match = /^\s*GDS_HTTP_BIND_ADDR\s*=\s*(\S+)\s*$/m.exec(envText || "");
  const host = match ? match[1] : "";
  return !host || host === "0.0.0.0" ? fallback : host;
}

/** URL de santé, construite depuis le `.env` (port et adresse d'écoute). */
export function buildHealthUrl(envText) {
  return `http://${parseHttpHost(envText)}:${parseHttpPort(envText)}/api/gds/health`;
}

/** Horodatage stable, utilisable comme nom de dossier (ex: 2026-01-31T09-05-00). */
export function timestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Compte rendu final, en clair, pour le propriétaire. */
export function formatReport(result) {
  const lines = [];
  lines.push("");
  lines.push("═══ Rechargement GDS — compte rendu ═══");
  lines.push(`Mode ................ : ${result.mode === "image-only" ? "image SEULE (service intact)" : "rechargement complet"}`);
  lines.push(`Étapes .............. : ${result.steps.join(" → ")}`);
  if (result.backupDir) {
    const size = result.backupFiles.map((f) => `${f.name} (${formatBytes(f.size)})`).join(", ");
    lines.push(`Sauvegarde .......... : ${result.backupDir}`);
    lines.push(`Fichiers sauvegardés  : ${size}`);
  } else {
    lines.push(`Sauvegarde .......... : aucune (${result.backupSkippedReason})`);
  }
  lines.push(`Image ............... : ${result.image} reconstruite`);
  lines.push(
    result.containerTouched
      ? `Conteneur ........... : recréé (volumes nommés CONSERVÉS)`
      : `Conteneur ........... : NON touché (le service continue de tourner)`,
  );
  lines.push(
    result.healthUrl
      ? `Service ............. : ${result.healthOk ? "RÉPOND" : "NE RÉPOND PAS"} (${result.healthUrl})`
      : `Service ............. : non testé (reconstruction seule)`,
  );
  lines.push(`Durée ............... : ${result.elapsedS.toFixed(1)} s`);
  lines.push(`Données ............. : volumes intacts (aucune suppression de volume n'est possible ici)`);
  lines.push("═══════════════════════════════════════");
  return lines.join("\n");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "vide";
  const units = ["o", "Ko", "Mo", "Go"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function helpText() {
  return `Rechargement sûr du conteneur GDS (image locale, volumes nommés conservés).

Usage (depuis la racine du projet) :
  npm run gds:reload                 rechargement complet : sauvegarde datée, puis
                                     reconstruction de l'image, puis recréation du
                                     conteneur, puis attente de /api/gds/health
  npm run gds:image                  reconstruction de l'image SEULE, sans toucher
                                     au conteneur en service
  node scripts/gds-reload.js --image-only
  node scripts/gds-reload.js --backup-dir <chemin>   (défaut : gds-server/backups)
  node scripts/gds-reload.js --timeout <secondes>    (défaut : ${DEFAULT_HEALTH_TIMEOUT_S})

Ce que le script ne fera JAMAIS : supprimer un volume, « down -v », « prune ».
La sauvegarde est OBLIGATOIRE : si elle échoue, rien n'est reconstruit et rien
n'est recréé. L'équivalent manuel, étape par étape, est décrit dans
docs/gds-server-setup.md §9 (et docs/gds-guide-mise-en-place.md, partie 4).`;
}

// ── Partie IMPURE (exécution ; jamais lancée par les tests) ───────────────────

function capture(cmd, args, cwd) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ok: res.status === 0, out: (res.stdout || "").trim(), err: (res.stderr || "").trim() };
}

function run(command) {
  console.log(`\n▶ ${command.label}`);
  const res = spawnSync(command.cmd, command.args, { cwd: command.cwd, stdio: "inherit" });
  return res.status === 0;
}

function volumesPresent() {
  const res = capture("docker", ["volume", "ls", "-q", "--filter", `name=^${PROJECT}_pgdata$`]);
  return res.ok && res.out.length > 0;
}

function readEnvText() {
  try {
    return fs.readFileSync(ENV_FILE, "utf8");
  } catch {
    return "";
  }
}

async function waitForHealth(url, timeoutS) {
  const deadline = Date.now() + timeoutS * 1000;
  process.stdout.write(`\n▶ attente de ${url} (max ${timeoutS} s)`);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        process.stdout.write(" → répond\n");
        return true;
      }
    } catch {
      // service pas encore prêt : on réessaie
    }
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  process.stdout.write(" → pas de réponse\n");
  return false;
}

function precheck() {
  const problems = [];
  if (!capture("docker", ["--version"]).ok) {
    problems.push("le logiciel de conteneurs `docker` est introuvable dans le PATH");
  } else if (!capture("docker", ["compose", "version"]).ok) {
    problems.push("la commande `docker compose` (Compose v2) est indisponible");
  }
  if (!fs.existsSync(COMPOSE_FILE)) {
    problems.push(`fichier de composition absent : ${COMPOSE_FILE}`);
  }
  if (!fs.existsSync(ENV_FILE)) {
    problems.push(`fichier de configuration absent : ${ENV_FILE} (copiez gds-server/.env.example)`);
  }
  return problems;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`\n✖ ${parsed.error}\n`);
    process.exit(2);
  }
  const { opts } = parsed;
  if (opts.help) {
    console.log(helpText());
    return;
  }

  const startedAt = Date.now();
  const steps = planSteps(opts.mode);
  const backupDir = path.resolve(opts.backupDir || path.join(BACKUP_ROOT, timestamp()));
  const result = {
    mode: opts.mode,
    steps,
    backupDir: null,
    backupFiles: [],
    backupSkippedReason: "",
    image: IMAGE,
    containerTouched: opts.mode !== "image-only",
    healthUrl: "",
    healthOk: false,
    elapsedS: 0,
  };

  // Garde AVANT toute exécution : aucune commande de la chaîne n'est destructive.
  const planned = opts.mode === "image-only"
    ? [buildImageCommand()]
    : [
        buildStopCommand(),
        ...STATE_VOLUMES.map((v) => buildVolumeBackupCommand(v, backupDir)),
        buildImageCommand(),
        buildRecreateCommand(),
      ];
  const unsafe = assertCommandsSafe(planned);
  if (unsafe) {
    console.error(`\n✖ ${unsafe}\n`);
    process.exit(3);
  }

  // 1. Prérequis
  const problems = precheck();
  if (problems.length > 0) {
    console.error("\n✖ Prérequis manquants :");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("");
    process.exit(1);
  }
  console.log("✔ Prérequis : docker, docker compose, docker-compose.yml et .env présents");

  // 2. Sauvegarde (mode complet seulement)
  if (opts.mode !== "image-only") {
    if (!volumesPresent()) {
      result.backupSkippedReason = "aucun serveur installé (les volumes n'existent pas encore)";
      console.log(`\nℹ ${result.backupSkippedReason} → rien à sauvegarder`);
    } else {
      console.log("\n▶ arrêt propre le temps de la sauvegarde (volumes CONSERVÉS)");
      if (!run({ ...buildStopCommand(), cwd: COMPOSE_DIR })) {
        console.error("\n✖ L'arrêt propre a échoué : ARRÊT. Rien n'a été reconstruit ni recréé.\n");
        process.exit(1);
      }
      fs.mkdirSync(backupDir, { recursive: true });
      for (const volume of STATE_VOLUMES) {
        const command = buildVolumeBackupCommand(volume, backupDir);
        if (!run({ ...command, cwd: COMPOSE_DIR })) {
          console.error(
            `\n✖ La sauvegarde du volume ${PROJECT}_${volume} a échoué : ARRÊT.\n` +
              "  Rien n'a été reconstruit ni recréé. Les volumes sont intacts ;\n" +
              "  relancez la commande après avoir corrigé la cause (voir docs/gds-server-setup.md §9.4).\n",
          );
          process.exit(1);
        }
      }
      for (const volume of STATE_VOLUMES) {
        const file = path.join(backupDir, `${volume}.tgz`);
        const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
        if (size <= 0) {
          console.error(`\n✖ Sauvegarde vide ou introuvable : ${file} : ARRÊT.\n`);
          process.exit(1);
        }
        result.backupFiles.push({ name: `${volume}.tgz`, size });
      }
      result.backupDir = backupDir;
      console.log(`✔ Sauvegarde datée : ${backupDir}`);
    }
  }

  // 3. Reconstruction de l'image
  if (!run({ ...buildImageCommand(), cwd: COMPOSE_DIR })) {
    console.error("\n✖ La reconstruction de l'image a échoué. Les volumes sont intacts.\n");
    process.exit(1);
  }

  // 4. Recréation du conteneur, volumes CONSERVÉS
  if (opts.mode !== "image-only") {
    if (!run({ ...buildRecreateCommand(), cwd: COMPOSE_DIR })) {
      console.error(
        "\n✖ La recréation du conteneur a échoué. Les volumes sont intacts.\n" +
          "  Diagnostic : `docker compose ps`, `docker compose logs gds` (gds-server/).\n",
      );
      process.exit(1);
    }

    // 5. Attente que le service réponde
    result.healthUrl = buildHealthUrl(readEnvText());
    result.healthOk = await waitForHealth(result.healthUrl, opts.timeoutS);
  }

  // 6. Compte rendu
  result.elapsedS = (Date.now() - startedAt) / 1000;
  console.log(formatReport(result));
  if (opts.mode !== "image-only" && !result.healthOk) {
    console.error("✖ Le service ne répond pas encore : voir le dépannage (docs/gds-server-setup.md §6).\n");
    process.exit(1);
  }
  console.log("✔ Terminé.\n");
}

// Garde : le module est importable par les tests sans rien exécuter.
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(`\n✖ ${error.message}\n`);
    process.exit(1);
  });
}
