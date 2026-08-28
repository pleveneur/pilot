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
import { readFileSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";

const RESERVATIONS_FILE = ".pilot/reservations.json";

function normalize(p: string): string {
  return p.replace(/\\/g, "/");
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
      try {
        const raw = readFileSync(resolve(ctx.cwd, RESERVATIONS_FILE), "utf8");
        reservations = JSON.parse(raw);
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

      return {
        block: true,
        reason: `Fichier réservé au codeur : ${rel}. Ce fichier est réservé à l'agent principal (codeur). Écris dans un autre répertoire (ex: tests/, docs/) ou demande au codeur de le modifier.`,
      };
    } catch (err) {
      // Ne jamais faire planter pi : en cas d'erreur, autoriser l'outil (fail-open).
      ctx.ui.notify(`Pilot reserve gate: erreur (${String(err)}) — outil autorisé par défaut`, "warning");
    }
  });
}
