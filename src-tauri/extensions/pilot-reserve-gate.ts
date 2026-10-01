// Pilot Reserve Gate — pre-write block for files reserved to the coder
// (spec_orchestration_multiagents.md, Phase 0, T3).
//
// Hooks the `tool_call` event for `write` and `edit` built-in tools, BEFORE they
// execute. Reads the per-project reservations file `.pilot/reservations.json`
// (format: { "coder": "<agent_id>", "files": ["src/lib.rs", ...],
// "agents": ["<agent_id>", ...] }) and, if the current agent is NOT a
// participant of the run that owns the reservations and the target file is in
// the reserved list, automatically BLOCKS the write (no user confirmation).
//
// Fail-open on identity (T6-fix, leak 3): EVERY participant of the run is
// exempted (`agents` list, `coder` kept for backward compatibility with older
// files) — a legitimate second coder of the same run must never be silently
// blocked (it would then never clean up the reservations file). Agents OUTSIDE
// the run stay blocked on the reserved files. A specialist may still READ the
// reserved files.
//
// The current agent id is passed to the pi process via the environment variable
// `PILOT_AGENT_ID` (set by Pilot when spawning the agent process). If the env
// var is absent, the gate cannot identify the agent → it blocks reserved files
// for everyone (safe default for specialist processes).
//
// Fail-open: on any error (missing file, parse error, missing env), the tool is
// allowed to run — the gate must never crash pi.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, statSync, appendFileSync, unlinkSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";

const RESERVATIONS_FILE = ".pilot/reservations.json";
// Trace des libérations (une ligne par réservation périmée reprise) : la
// libération n'est jamais silencieuse, elle est écrite ici et notifiée à l'UI.
const RELEASED_LOG_FILE = ".pilot/reservations-released.log";
// Péremption : le frontend renouvelle le fichier (`renewedAt`) tant que la run
// est vivante ; au-delà de ce délai sans renouvellement, le détenteur n'existe
// plus (app fermée, webview rechargée, run avortée) → la réservation ne doit
// pas bloquer indéfiniment.
const RESERVATION_TTL_MS = 10 * 60 * 1000;

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Date de dernier renouvellement de la réservation (ms epoch). `renewedAt`
 * (battement de cœur du frontend) prioritaire, `createdAt` en secours, et
 * mtime du fichier en dernier recours (fichiers écrits avant ce champ).
 */
function reservationAnchorMs(
  reservations: { createdAt?: string; renewedAt?: string },
  fileMtimeMs: number,
): number {
  for (const raw of [reservations.renewedAt, reservations.createdAt]) {
    if (typeof raw === "string") {
      const t = Date.parse(raw);
      if (!Number.isNaN(t)) return t;
    }
  }
  return fileMtimeMs;
}

function describeAge(ageMs: number): string {
  const min = Math.max(0, Math.round(ageMs / 60000));
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${Math.round(min / 60)} h`;
}

/**
 * Libère une réservation périmée : trace écrite (log + notification) PUIS
 * suppression du fichier, pour que les écritures suivantes ne soient plus
 * bloquées par un détenteur disparu. Jamais silencieux.
 */
function releaseStaleReservation(
  ctx: { cwd: string; ui: { notify: (msg: string, level?: string) => void } },
  holder: string,
  rel: string,
  ageMs: number,
): void {
  const line = `${new Date().toISOString()}\tlibération automatique (péremption)\tdétenteur=${holder || "inconnu"}\tfichier=${rel}\tdernier renouvellement=${describeAge(ageMs)}\n`;
  try {
    appendFileSync(resolve(ctx.cwd, RELEASED_LOG_FILE), line, "utf8");
  } catch {
    // fail-open : la trace ne doit pas empêcher la reprise du travail.
  }
  try {
    unlinkSync(resolve(ctx.cwd, RESERVATIONS_FILE));
  } catch {
    // fail-open : si le fichier a déjà disparu, l'écriture reste autorisée.
  }
  ctx.ui.notify(
    `🧹 Réservation périmée (agent « ${holder || "inconnu"} », ${describeAge(ageMs)}) libérée : "${rel}" redevient modifiable. Trace : ${RELEASED_LOG_FILE}`,
    "warning",
  );
}

/**
 * Fail-open on identity: any participant of the run owning the reservations is
 * exempted — `agents` lists every agent of the run (coder included); `coder`
 * (first coder, owner of the cleanup) is kept for backward compatibility with
 * older reservations files.
 */
function isRunParticipant(agentId: string, reservations: { coder?: string; agents?: string[] }): boolean {
  if (reservations.coder && agentId === reservations.coder) return true;
  return Array.isArray(reservations.agents) && reservations.agents.includes(agentId);
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    try {
      const tool = event.toolName;
      if (tool !== "write" && tool !== "edit") return;

      const input = event.input as { path?: string } | undefined;
      const rawPath = input?.path;
      if (typeof rawPath !== "string" || !rawPath.trim()) return;

      const absPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);

      // Réservations du projet (si absentes → aucun blocage).
      let reservations: { coder?: string; agents?: string[]; files?: string[] } | null = null;
      let fileMtimeMs = 0;
      try {
        const file = resolve(ctx.cwd, RESERVATIONS_FILE);
        const raw = readFileSync(file, "utf8");
        reservations = JSON.parse(raw);
        fileMtimeMs = statSync(file).mtimeMs;
      } catch {
        reservations = null;
      }
      if (!reservations || !Array.isArray(reservations.files) || reservations.files.length === 0) {
        return; // pas de réservation → autoriser
      }

      // Tout participant de la run (codeur ou spécialiste) n'est jamais bloqué
      // (fail-open : on ne bloque jamais un agent légitime de la run). Les
      // agents HORS de la run restent bloqués sur les fichiers réservés.
      const agentId =
        (typeof process !== "undefined" && process.env && process.env.PILOT_AGENT_ID) || "";
      if (agentId && isRunParticipant(agentId, reservations)) {
        return; // participant de la run → autoriser
      }

      // Chemin relatif au projet pour comparer avec la liste réservée.
      const rel = normalize(relative(ctx.cwd, absPath));
      const reserved = reservations.files.map(normalize);
      const hit = reserved.some((f) => f === rel || rel.startsWith(f + "/"));
      if (!hit) return; // fichier non réservé → autoriser

      const holder = reservations.coder || (reservations.agents || [])[0] || "";
      const ageMs = Date.now() - reservationAnchorMs(reservations, fileMtimeMs);

      // Détenteur disparu : plus aucun renouvellement depuis plus de TTL (run
      // terminée, session fermée, webview rechargée). On ne bloque pas
      // indéfiniment : la réservation est libérée explicitement (trace + avis)
      // et le chemin est repris par l'agent qui écrit.
      if (ageMs > RESERVATION_TTL_MS) {
        releaseStaleReservation(ctx, holder, rel, ageMs);
        return;
      }

      return {
        block: true,
        reason:
          `Fichier réservé : ${rel}. Réservé à l'agent « ${holder || "inconnu"} » ` +
          `(réservation renouvelée ${describeAge(ageMs)}). Ce chemin est protégé pour ` +
          `éviter deux écritures simultanées : la réservation se libère à la fin de la ` +
          `run de « ${holder || "inconnu"} », et expire automatiquement ${Math.round(RESERVATION_TTL_MS / 60000)} min après ` +
          `son dernier renouvellement si ce détenteur n'existe plus. D'ici là, écris dans ` +
          `un autre répertoire (ex: tests/, docs/) ou demande à « ${holder || "inconnu"} » de déposer la modification.`,
      };
    } catch (err) {
      // Ne jamais faire planter pi : en cas d'erreur, autoriser l'outil (fail-open).
      ctx.ui.notify(`Pilot reserve gate: erreur (${String(err)}) — outil autorisé par défaut`, "warning");
    }
  });
}
