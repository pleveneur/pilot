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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HANDOFF_FILE = join(".pilot", "context-inject.md");

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    try {
      const abs = join(ctx.cwd, HANDOFF_FILE);
      let content: string;
      try {
        content = readFileSync(abs, "utf8");
      } catch {
        return; // no handoff file → nothing to inject
      }
      if (!content || !content.trim()) return;
      return {
        systemPrompt: event.systemPrompt + "\n\n" + content.trim() + "\n",
      };
    } catch (err) {
      // Fail-open: never crash pi, never break the prompt.
      try {
        ctx.ui.notify(`pilot-context: erreur (${String(err)})`, "warning");
      } catch { /* ignore */ }
    }
  });
}
