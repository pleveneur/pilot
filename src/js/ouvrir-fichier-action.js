// ouvrir-fichier-action.js — POINT UNIQUE de l'OUVERTURE d'un fichier par
// l'Assistant (tâche 394).
//
// Ce module ne DÉCIDE rien : la décision (quel mode selon le type, et quand
// refuser) est entièrement dans `ouvrir-fichier.js` (pur). Ici, on ne fait
// qu'exécuter :
//   1. constater l'état du disque par la commande existante `inspect_open_path`
//      (elle n'ouvre rien) ;
//   2. assembler le périmètre autorisé (projets connus + espace de travail de
//      l'Assistant, annoncé par Rust) ;
//   3. demander la décision ;
//   4. ouvrir — par les DEUX mécanismes qui existent déjà, jamais un troisième :
//      `tabs.openFile(...)` (onglet de Pilot, geste de l'utilisateur dans
//      l'explorateur) ou la commande `open_in_browser` (`open::that` : programme
//      par défaut du système).
//
// Aucune commande arbitraire n'est exécutée : les deux modes n'ouvrent qu'un
// fichier EXISTANT, et un chemin qui ressemble à une commande est refusé par la
// décision. Les dépendances Tauri (`invoke`) et fenêtre (`tabs`) sont REÇUES en
// paramètres : ce module ne les importe pas, donc il se teste sans DOM ni Tauri.
import { OPEN_FILE_MODE_TAB, decideOpenFile } from "./ouvrir-fichier.js";

/**
 * Ouvre UN fichier pour le montrer à l'utilisateur, ou refuse proprement.
 *
 * @param {{
 *   info?: {path?: unknown},
 *   invoke?: (cmd: string, args?: object) => Promise<unknown>,
 *   tabs?: {openFile?: (path: string, mode?: string) => unknown} | null,
 *   projectPath?: string|null,
 * }} [deps]
 * @returns {Promise<{ok:boolean, mode:string|null, path:string, reason:string|null, message:string}>}
 */
export async function runOpenFileAction(deps = {}) {
  const { info, invoke: call, tabs, projectPath } = deps;
  const rawPath = info && typeof info.path === "string" ? info.path : "";
  const invokeFn = typeof call === "function" ? call : null;

  const fail = (reason, path, message) => ({ ok: false, mode: null, path, reason, message });

  // 1. État du disque. Sans la commande d'inspection, on n'ouvre rien : on ne
  //    peut pas garantir « fichier existant, non vide, pas un dossier ».
  let inspection = null;
  if (invokeFn) {
    try {
      inspection = await invokeFn("inspect_open_path", { path: rawPath });
    } catch (_) {
      inspection = null;
    }
  }

  // 2. Périmètre : projets réellement ouverts + projets suivis par l'Assistant +
  //    espace de travail de l'Assistant. Fail-open : une liste indisponible ne
  //    fait pas ouvrir hors périmètre (le refus « hors des projets connus » tombe).
  const roots = [];
  if (invokeFn) {
    try {
      const [opened, tracked] = await Promise.allSettled([
        invokeFn("list_open_projects"),
        invokeFn("list_super_agent_projects"),
      ]);
      if (opened.status === "fulfilled" && Array.isArray(opened.value)) {
        for (const p of opened.value) if (typeof p === "string" && p) roots.push(p);
      }
      if (
        tracked.status === "fulfilled" &&
        tracked.value &&
        Array.isArray(tracked.value.projects)
      ) {
        for (const p of tracked.value.projects) {
          if (p && typeof p.path === "string" && p.path) roots.push(p.path);
        }
      }
    } catch (_) {
      /* liste indisponible : le périmètre reste ce qu'on connaît */
    }
  }
  if (inspection && typeof inspection.assistant_root === "string" && inspection.assistant_root) {
    roots.push(inspection.assistant_root);
  }

  // 3. DÉCISION (pure, testable à part) : quel mode, ou quel refus.
  const decision = decideOpenFile(
    { path: rawPath, cwd: projectPath || null, roots },
    inspection,
  );
  if (!decision.ok) return fail(decision.reason, decision.path, decision.message);

  // 4. ACTION — un seul point, deux mécanismes existants.
  if (decision.mode === OPEN_FILE_MODE_TAB) {
    if (!tabs || typeof tabs.openFile !== "function") {
      return fail(
        "onglets-indisponibles",
        decision.path,
        `Je n'ai pas pu ouvrir « ${decision.path} » : la fenêtre des onglets n'est pas disponible.`,
      );
    }
    try {
      await Promise.resolve(tabs.openFile(decision.path, decision.tabMode || "edit"));
    } catch (e) {
      return fail(
        "ouverture-onglet-impossible",
        decision.path,
        `Je n'ai pas pu ouvrir « ${decision.path} » dans un onglet de Pilot (${String(e)}).`,
      );
    }
  } else {
    if (!invokeFn) {
      return fail(
        "ouverture-systeme-impossible",
        decision.path,
        `Je n'ai pas pu ouvrir « ${decision.path} » avec le programme par défaut de cet ordinateur.`,
      );
    }
    try {
      await invokeFn("open_in_browser", { path: decision.path });
    } catch (e) {
      return fail(
        "ouverture-systeme-impossible",
        decision.path,
        `Je n'ai pas pu ouvrir « ${decision.path} » avec le programme par défaut de cet ordinateur (${String(e)}).`,
      );
    }
  }

  return {
    ok: true,
    mode: decision.mode,
    path: decision.path,
    reason: null,
    message: decision.message,
  };
}
