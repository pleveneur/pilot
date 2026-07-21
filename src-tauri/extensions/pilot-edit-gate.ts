// Pilot Edit Gate — pre-write confirmation gate (spec_diff_review.md, A4 V2).
//
// Hooks the `tool_call` event for `write` and `edit` built-in tools, BEFORE they
// execute. Reads the current file content (before), computes the resulting
// content (after), and asks the user to confirm via `ctx.ui.confirm()`.
//
// In RPC mode, `ctx.ui.confirm()` emits an `extension_ui_request` on stdout and
// BLOCKS pi until the client (Pilot) sends back an `extension_ui_response`. The
// request `message` carries a sentinel-prefixed JSON payload so Pilot can render
// a rich before/after diff and decide.
//
// If the user refuses (confirmed=false/cancelled), we return `{ block: true }`
// → pi does NOT run the tool → the file is left untouched. This is the coherent
// pre-write gate (no modification happens until accepted).
//
// When Pilot has the feature disabled (config `confirm_file_edits` = false) or
// is running in autonomous Mode Orchestration, Pilot auto-responds
// `confirmed: true` immediately, so this extension is a no-op overhead (one
// extra stdin/stdout round-trip per write/edit).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const SENTINEL = "PILOT_EDIT_GATE::";
// Cap before/after size shipped through the confirm payload to avoid huge
// stdin/stdout transfers. The diff view truncates very large files anyway.
const MAX_PAYLOAD = 200_000;

function truncate(s: string | null): string | null {
  if (s == null) return null;
  if (s.length <= MAX_PAYLOAD) return s;
  return s.slice(0, MAX_PAYLOAD) + "\n…[truncated by Pilot edit gate]";
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    let tool: string;
    try {
      tool = event.toolName;
      if (tool !== "write" && tool !== "edit") return;

      const input = event.input as
        | { path?: string; content?: string; edits?: Array<{ oldText: string; newText: string }> }
        | undefined;
      const rawPath = input?.path;
      if (typeof rawPath !== "string" || !rawPath.trim()) return;

      const absPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);

      // `before` : current disk content. Non-racy — the tool has NOT run yet (we
      // block in `tool_call`, before execution). File may not exist yet (creation).
      let before: string | null = null;
      try {
        before = readFileSync(absPath, "utf8");
      } catch {
        before = null;
      }

      // `after` : predicted resulting content from the tool args.
      let after: string | null = null;
      if (tool === "write") {
        after = typeof input?.content === "string" ? input.content : null;
      } else if (tool === "edit") {
        after = before == null ? "" : before;
        const edits = Array.isArray(input?.edits) ? input!.edits : [];
        for (const e of edits) {
          if (e && typeof e.oldText === "string" && typeof e.newText === "string") {
            after = after.split(e.oldText).join(e.newText);
          }
        }
      }

      const payload = JSON.stringify({
        tool,
        path: absPath,
        before: truncate(before),
        after: truncate(after),
      });
      const message = SENTINEL + payload;

      const ok = await ctx.ui.confirm("Pilot — confirmer la modification du fichier", message);
      if (!ok) {
        return { block: true, reason: "Modification refusée par l'utilisateur (Pilot edit gate)" };
      }
      // ok === true → allow the tool to run (return nothing).
    } catch (err) {
      // Ne jamais faire planter pi : en cas d'erreur, autoriser l'outil (fail-open).
      // Une extension qui throw provoque un extension_error et peut déstabiliser pi.
      ctx.ui.notify(`Pilot edit gate: erreur (${String(err)}) — outil autorisé par défaut`, "warning");
    }
  });
}