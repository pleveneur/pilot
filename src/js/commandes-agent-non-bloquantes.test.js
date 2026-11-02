// ANTI-RÉCIDIVE — « aucune commande chaude du chemin agent ne s'exécute sur le
// thread principal » (docs/rapports/RAPPORT-gel-session-pilot.md § 4.1).
//
// FAIT : une commande Tauri déclarée `pub fn` tourne sur le THREAD PRINCIPAL.
// `get_agent_state` (8 s), `get_agent_messages` (30 s) et
// `purge_agent_conversation_to` (≈ 76 s au pire) attendaient la réponse de `pi`
// à cet endroit : la fenêtre entière se figeait pendant ce temps.
//
// CONSIGNE : ces trois commandes restent `pub async fn` et déportent leur travail
// bloquant dans `tauri::async_runtime::spawn_blocking` (le motif déjà utilisé
// dans `agents.rs`). Un retour à `pub fn` — ou un `spawn_blocking` retiré — fait
// échouer ce test.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `.gitattributes` force LF, mais un worktree Windows peut être en CRLF : on
// normalise la lecture avant toute recherche d'ancre (piège CI, AGENTS.md).
const rpc = readFileSync(resolve(process.cwd(), "src-tauri/src/rpc.rs"), "utf8").replace(
  /\r\n/g,
  "\n"
);

/** Corps d'une commande Tauri : du `#[tauri::command]` au `\n}\n` suivant. */
function commandBody(name) {
  const marker = `pub async fn ${name}(`;
  const start = rpc.indexOf(marker);
  if (start === -1) return null;
  const end = rpc.indexOf("\n}\n", start);
  return end === -1 ? null : rpc.slice(start, end);
}

const HOT_COMMANDS = ["get_agent_state", "get_agent_messages", "purge_agent_conversation_to"];

describe("commandes agent — jamais sur le thread principal", () => {
  for (const name of HOT_COMMANDS) {
    it(`\`${name}\` est async et déporte son attente de pi dans spawn_blocking`, () => {
      // Déclarée `pub fn` = exécutée sur le thread principal de Tauri.
      expect(rpc).not.toContain(`pub fn ${name}(`);
      const body = commandBody(name);
      expect(body, `commande ${name} introuvable ou déclarée en pub fn`).not.toBeNull();
      expect(body).toContain("tauri::async_runtime::spawn_blocking");
      // Aucune commande RPC bloquante ne doit rester dans la commande elle-même.
      expect(body).not.toContain("send_command_sync");
      expect(body).not.toContain("with_active_session");
    });
  }

  it("les cœurs synchrones appelés par le mode distant restent disponibles", () => {
    // web_server.rs appelle ces helpers directs : ils ne doivent pas disparaître.
    expect(rpc).toContain("pub(crate) fn do_get_agent_state(");
    expect(rpc).toContain("pub(crate) fn do_get_agent_messages(");
    // Les cœurs déportés existent et sont les seuls à parler à pi.
    for (const core of [
      "do_get_agent_state_in",
      "do_get_agent_messages_in",
      "do_purge_agent_conversation_to",
    ]) {
      expect(rpc).toContain(`pub(crate) fn ${core}(`);
    }
  });
});
