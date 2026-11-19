// Pilot Assistant Files — espace d'écriture restreint du super-agent.
//
// Le super-agent (onglet 🧭) est lecture seule sur les projets. Il dispose d'un
// espace d'écriture dédié `~/.pilot/assistant/` pour ses fichiers de suivi
// (notes, analyses, exports), organisé par client puis par projet.
//
// This extension intercepts the `write`/`edit` tools only and:
//   - allows them ONLY when the REAL path (symlinks followed) is under
//     `~/.pilot/assistant/` (missing parent folders created inside it);
//   - blocks everything else, and blocks on any doubt or error (missing or
//     invalid path, "..", resolution/permission error) — fail-closed;
//   - refuses the path forms pi rewrites before writing ("~" / "~/…", a leading
//     "@", "file://…") and the Unicode spaces it turns into an ASCII space
//     (no-break, thin, ideographic…), like "..": the guard must judge the path
//     pi really writes.
// Limits (not covered here): `bash` and other pi tools, sessions started
// without this extension, races between this check and the actual write.
//
// Les outils de question (ask_choice, ask_input, ask_confirm, ask_multi_choice)
// sont fournis par l'extension pilot-choices, chargée séparément.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { lstatSync, mkdirSync, realpathSync, statSync } from "node:fs";

// Racine de l'espace d'écriture de l'assistant : ~/.pilot/assistant/
const ASSISTANT_ROOT = join(homedir(), ".pilot", "assistant");

/** Vrai si `absPath` est sous la racine de l'assistant (ou égal). */
function isUnderRoot(absPath: string): boolean {
  const root = resolve(ASSISTANT_ROOT);
  const p = resolve(absPath);
  return p === root || p.startsWith(root + sep);
}

/** lstat that returns null when the entry does not exist; other errors propagate. */
function lstatOrNull(p: string) {
  try {
    return lstatSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Check the REAL path of a write target (symlinks followed), component by
 * component, starting from the real assistant root. Missing intermediate
 * folders are created one at a time, only inside a parent already verified to
 * be a real directory under the root. Returns null when allowed, otherwise the
 * refusal reason. Resolution/permission errors propagate (caller blocks).
 *
 * Limit: this is a validation hook. A link swapped between this check and the
 * actual write (race) cannot be excluded here.
 */
function checkRealPath(absPath: string): string | null {
  const rootLex = resolve(ASSISTANT_ROOT);
  // Only the assistant space itself is created here, never anything outside.
  mkdirSync(rootLex, { recursive: true });
  const realRoot = realpathSync(rootLex);
  const inside = (p: string) => p === realRoot || p.startsWith(realRoot + sep);

  const segments = relative(rootLex, resolve(absPath)).split(sep).filter(Boolean);
  if (segments.length === 0) return "le chemin vise le dossier de l'espace lui-même.";

  const outside = `le chemin réel sort de l'espace ${ASSISTANT_ROOT} (lien symbolique).`;
  let cur = realRoot;
  for (const seg of segments.slice(0, -1)) {
    const next = join(cur, seg);
    if (!lstatOrNull(next)) {
      // Parent `cur` is a verified real directory inside the root.
      mkdirSync(next);
      cur = next;
      continue;
    }
    const real = realpathSync(next);
    if (!inside(real)) return outside;
    if (!statSync(real).isDirectory()) return "un élément du chemin n'est pas un dossier.";
    cur = real;
  }

  const target = join(cur, segments[segments.length - 1]);
  const st = lstatOrNull(target);
  if (st?.isSymbolicLink()) {
    let real: string;
    try {
      real = realpathSync(target);
    } catch (err) {
      // Dangling link: the write would create its (unchecked) target.
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return outside;
      throw err;
    }
    if (!inside(real)) return outside;
  }
  return null;
}

/** Block decision returned to pi (user-facing reason stays in French). */
function deny(reason: string) {
  return { block: true, reason: `Écriture refusée : ${reason}` };
}

/** Best-effort notification: a missing or throwing ui must never crash pi. */
function safeNotify(ctx: unknown, message: string) {
  try {
    (ctx as { ui?: { notify?: (m: string, l: string) => void } } | undefined)?.ui?.notify?.(
      message,
      "warning",
    );
  } catch {
    // Ignore: the block decision is already made.
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    // Read-only and other tools are not concerned: leave them untouched.
    let tool: unknown;
    try {
      tool = event?.toolName;
    } catch {
      return;
    }
    if (tool !== "write" && tool !== "edit") return;

    // From here on, any doubt or error BLOCKS the write (fail-closed).
    try {
      const input = event.input as { path?: unknown } | undefined;
      const rawPath = input?.path;
      if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.includes("\0")) {
        return deny("chemin manquant ou invalide.");
      }
      // pi turns these Unicode spaces into an ASCII space before writing: we would
      // judge a different name than the one written (a link could then be followed).
      // Non-breaking, en/em/thin/narrow, medium mathematical and ideographic spaces.
      if (/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/.test(rawPath)) {
        return deny(
          "les espaces Unicode (insécable, fine, etc.) ne sont pas acceptés dans un chemin, utiliser un espace normal.",
        );
      }
      // The OS resolves ".." AFTER following links, unlike resolve(): refuse it.
      if (rawPath.split(/[\\/]/).includes("..")) {
        return deny("les segments « .. » ne sont pas acceptés, donner un chemin direct.");
      }

      // pi rewrites these forms (home, leading "@", file:// URL) before writing:
      // we would judge a different path than the one written. Refuse them.
      if (/^(~([\\/]|$)|@|file:\/\/)/i.test(rawPath.trimStart())) {
        return deny(
          "les formes « ~ », « @ » de tête et « file:// » ne sont pas acceptées, donner un chemin direct (relatif, ou absolu sous " +
            `${ASSISTANT_ROOT}).`,
        );
      }

      const absPath = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);

      // Outside the assistant space → block (projects stay read-only).
      if (!isUnderRoot(absPath)) {
        return deny(
          `le super-agent est lecture seule sur les projets. Seul l'espace ${ASSISTANT_ROOT} est autorisé pour ses fichiers de suivi.`,
        );
      }

      // Real path check (symlinks followed); creates missing parent folders
      // (client/project tree) only inside the verified space.
      const refusal = checkRealPath(absPath);
      if (refusal) return deny(refusal);
      // Allow the tool (return nothing).
    } catch (err) {
      // Never crash pi, never allow by default: block on error.
      safeNotify(ctx, `Pilot assistant files: erreur (${String(err)}) — écriture refusée par sécurité`);
      return deny(`vérification du chemin impossible (${String(err)}).`);
    }
  });
}
