// Pilot Context Injection — before_agent_start systemPrompt hook.
//
// The pi RPC protocol only lets Pilot send a `prompt` as a USER message; there is
// no per-prompt system-prompt injection over RPC. To keep project context and
// instructions (PROJECT_MEMORY.md + Context Engine block) OUT of the stored
// user-message discussion — so `/resume` and the session history (H9) show only
// real user input + agent output — Pilot writes a handoff file
// (`.pilot/context-inject.md`) and this extension appends it to the SYSTEM PROMPT
// for each turn. The content is still visible to the LLM (like AGENTS.md) but is
// NOT stored as a user message and therefore does not pollute `/resume`.
//
// Pilot writes the file when it decides to (re)inject context (once per session,
// or on refresh) and deletes it on session boundaries (new session, compact,
// reconnect, restart, orchestration off). As long as the file exists, the context
// is appended on every turn, preserving the previous behaviour where the injected
// context remained available for the whole session.
//
// It also reads `.pilot/work-state.md`: a short, bounded snapshot of the current
// work state (last user request, last agent answer, current orchestration task)
// written by Pilot at the START of a compaction, so the agent does not lose track
// of what it was doing once the history is cut. Same mechanism as the handoff
// (system prompt only, deleted on session boundaries, dated freshness warning in
// the content itself).

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HANDOFF_FILE = join(".pilot", "context-inject.md");
const WORK_STATE_FILE = join(".pilot", "work-state.md");

/** Reads an injectable file (handoff or work-state); "" when absent/empty. */
function readInjectable(cwd: string, relPath: string): string {
  try {
    const content = readFileSync(join(cwd, relPath), "utf8");
    return content && content.trim() ? content.trim() : "";
  } catch {
    return "";
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    try {
      const parts = [
        readInjectable(ctx.cwd, HANDOFF_FILE),
        readInjectable(ctx.cwd, WORK_STATE_FILE),
      ].filter(Boolean);
      if (parts.length === 0) return; // nothing to inject
      return {
        systemPrompt: event.systemPrompt + "\n\n" + parts.join("\n\n") + "\n",
      };
    } catch (err) {
      // Fail-open: never crash pi, never break the prompt.
      try {
        ctx.ui.notify(`pilot-context: erreur (${String(err)})`, "warning");
      } catch { /* ignore */ }
    }
  });
}
