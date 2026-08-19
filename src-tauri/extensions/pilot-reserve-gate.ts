// Pilot Reserve Gate — pre-write block for files reserved to the coder
// (spec_orchestration_multiagents.md, Phase 0, T3).
//
// Hooks the `tool_call` event for `write` and `edit` built-in tools, BEFORE they
// execute. Reads the per-project reservations file `.pilot/reservations.json`
// (format: { "coder": "<agent_id>", "files": ["src/lib.rs", ...] }) and, if the
// current agent is NOT the coder and the target file is in the reserved list,
// automatically BLOCKS the write (no user confirmation).
//
// The coder (agent principal) is never blocked: the reserved list only applies
// to the other specialists. A specialist may still READ the reserved files.
//
// The current agent id is passed to the pi process via the environment variable
// `PILOT_AGENT_ID` (set by Pilot when spawning the agent process). If the env
// var is absent, the gate cannot identify the coder → it blocks reserved files
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
      let reservations: { coder?: string; files?: string[] } | null = null;
      try {
        const raw = readFileSync(resolve(ctx.cwd, RESERVATIONS_FILE), "utf8");
        reservations = JSON.parse(raw);
      } catch {
        reservations = null;
      }
      if (!reservations || !Array.isArray(reservations.files) || reservations.files.length === 0) {
        return; // pas de réservation → autoriser
      }

      // Le codeur n'est jamais bloqué.
      const agentId =
        (typeof process !== "undefined" && process.env && process.env.PILOT_AGENT_ID) || "";
      if (agentId && reservations.coder && agentId === reservations.coder) {
        return; // codeur → autoriser
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
