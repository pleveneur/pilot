// Tests — onglet 🎭 Agents : le panneau « Activité » montre le travail SANS
// ONGLET (regle 1).
//
// Defaut corrige : le panneau « Activité » n'etait alimente QUE par les
// evenements du bus d'agents (`window.__agentBusState`). Un agent lance en
// arriere-plan par l'assistant, ou dont l'onglet a ete ferme, travaille
// reellement mais n'apparaissait nulle part dans cet ecran (« Aucune run en
// cours. »). Il s'abonne desormais au store d'activite PARTAGE (meme source que
// le cercle du haut d'ecran et que le volet « En cours »), sans ouvrir d'onglet.
//
// Ces tests sont DISCRIMINANTS : ils rougissent si le branchement est retire de
// la production (verifie par neutralisation, cf. rapport).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  flattenAgents,
  buildBackgroundWorkMissions,
  renderBackgroundWorkersHtml,
} from "./agent-activity.js";

const here = dirname(fileURLToPath(import.meta.url));
// Normalisation des fins de ligne (quality-gate § 3.4) : un worktree CRLF ne
// doit pas rendre une ancre introuvable.
const source = readFileSync(resolve(here, "agents-ui.js"), "utf8").replace(/\r\n/g, "\n");

/** Bloc `function updateActivity() { … }` (jusqu'a la fonction suivante). */
function updateActivitySource() {
  const start = source.indexOf("function updateActivity() {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  function renderList()", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("agents-ui — le panneau « Activité » s'abonne au store partage", () => {
  it("importe les helpers purs de visibilite (aucune logique de vivacite dupliquee)", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*subscribeAgentActivity[^}]*\}\s*from\s*"\.\/agent-activity\.js"/s
    );
    expect(source).toContain("buildBackgroundWorkMissions");
    expect(source).toContain("renderBackgroundWorkersHtml");
  });

  it("s'abonne a subscribeAgentActivity et alimente backgroundMissions", () => {
    expect(source).toContain("activityUnsub = subscribeAgentActivity(");
    expect(source).toMatch(/backgroundMissions\s*=\s*buildBackgroundWorkMissions\(list\)/);
    // L'abonnement provoque un nouveau rendu (pas d'attente du prochain tick).
    expect(source).toMatch(/backgroundMissions\s*=\s*buildBackgroundWorkMissions\(list\);\s*\n\s*updateActivity\(\);/);
  });

  it("rend le bloc « arriere-plan » dans le panneau, et pas seulement quand le bus tourne", () => {
    const body = updateActivitySource();
    // Le rendu est calcule AVANT la sortie anticipee : une session qui
    // travaille sans onglet affiche le panneau meme si aucune run du bus n'a
    // ete vue (`agentStates` vide, `isRunning` faux).
    expect(body.indexOf("renderBackgroundWorkersHtml(backgroundMissions)")).toBeLessThan(
      body.indexOf("if (!isRunning && agentStates.size === 0")
    );
    expect(body).toContain("${backgroundHtml}");
  });

  it("ne presente pas une session au repos comme travaillante", () => {
    // Une liste sans travail effectif ne produit aucun bloc.
    const repos = flattenAgents({
      projects: [
        {
          path: "C:/proj/pilot",
          name: "pilot",
          agents: [{ agent: "codeur", state: "idle", visible: false, alive: true }],
        },
      ],
    });
    expect(buildBackgroundWorkMissions(repos)).toEqual([]);
    expect(renderBackgroundWorkersHtml(buildBackgroundWorkMissions(repos))).toBe("");
  });

  it("detache l'abonnement au nettoyage (aucun abonne fantome apres fermeture)", () => {
    const start = source.indexOf("function cleanup() {");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\n  }", start));
    expect(body).toContain("activityUnsub()");
    expect(body).toContain("destroyAgentsBus()");
  });

  it("n'ouvre JAMAIS d'onglet ni ne change d'onglet actif depuis ce panneau", () => {
    const body = updateActivitySource();
    expect(body).not.toContain("_openAgent");
    expect(body).not.toContain("openFile");
    expect(body).not.toContain("setActiveTab");
    // Le rendu du bloc arriere-plan ne contient aucun bouton (purement informatif).
    const html = renderBackgroundWorkersHtml([
      { agentId: "codeur|C:/proj/pilot", kind: "agent", agent: "codeur", project: "pilot", mission: "Tests" },
    ]);
    expect(html).not.toContain("<button");
    expect(html).toContain("arrière-plan");
  });
});
