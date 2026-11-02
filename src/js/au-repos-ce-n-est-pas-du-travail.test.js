/**
 * VERROU — « au repos, ce n'est pas du travail ».
 *
 * Défaut constaté par le propriétaire :
 *  1. la session de l'Assistante apparaissait comme « en cours » alors qu'elle ne
 *     faisait rien (une session OUVERTE n'est pas un travail) ;
 *  2. elle « respirait » au repos : un indicateur d'activité continuait de
 *     s'animer alors qu'aucun travail ne tournait.
 *
 * CAUSE (prouvée dans le rapport `docs/rapports/RAPPORT-au-repos-ce-n-est-pas-du-travail.md`) :
 * l'état affiché d'une session (`running` / `idle`) ne vivait que dans la vue
 * LOURDE (`get_agent_supervision`), relue UNIQUEMENT quand l'ENSEMBLE des
 * sessions change ou sur un push `agent-state-changed` (émis par `set_state`,
 * jamais par la fin d'un tour). Une session photographiée `running` pendant
 * qu'elle travaillait restait donc `running` À L'ÉCRAN indéfiniment : pastille
 * qui respire, libellé « en cours », mission comptée dans « Travail ». Le
 * moteur publie pourtant la vérité toutes les 2 s dans la sonde LÉGÈRE
 * (`working`, à défaut `busy`) — que le front ignorait.
 *
 * Les trois cas ci-dessous passent par la CHAÎNE RÉELLE
 * (`mergeProbeActivity` -> `flattenAgents` -> `buildRunningMissions` -> rendus) :
 * aucune logique n'est recopiée dans le test.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sliceFrom } from "./source-slice.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import {
  mergeProbeActivity,
  flattenAgents,
  buildRunningMissions,
  splitMissions,
  renderMissionsPanelHtml,
  renderDropdown,
  renderCard,
  isAgentWorking,
  anyBusy,
  stateFromProbeActivity,
  agentTaskCounterText,
} from "./agent-activity.js";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

/**
 * Vue LOURDE telle que `get_agent_supervision` la rend : une PHOTO. Celle-ci a
 * été prise pendant que l'Assistante travaillait (`state: "running"`) et n'est
 * jamais relue ensuite — c'est précisément la situation constatée.
 */
function supervisionAssistant({ state = "running", prompt = "", resume = "" } = {}) {
  return {
    projects: [
      {
        path: "",
        name: "",
        agents: [
          {
            id: "superagent",
            // Le libellé publié est le nom réglé de l'Assistante : l'identité se
            // lit sur `id`, jamais sur ce libellé.
            agent: "Assistante",
            state,
            visible: true,
            alive: true,
            prompt,
            resume,
            toolInProgress: false,
          },
        ],
      },
    ],
  };
}

/** Sonde LÉGÈRE (`agent_activity_probe`), relue toutes les 2 s : état réel. */
function probe({ working, busy = working, toolInProgress = false, alive = true } = {}) {
  const entry = { project: "", agent: "superagent", alive, toolInProgress };
  if (typeof working === "boolean") entry.working = working;
  if (typeof busy === "boolean") entry.busy = busy;
  return [entry];
}

/** Chaîne exacte de l'affichage : sonde -> liste plate -> missions -> rendus. */
function chain({ heavy, probe: sessions }) {
  const merged = mergeProbeActivity(heavy, sessions);
  const list = flattenAgents(merged, new Map(), new Map(), new Map());
  const missions = buildRunningMissions(list, []);
  return { merged, list, missions };
}

// ── CAS (a) — une session OUVERTE au repos n'est jamais « en cours » ─────────
describe("au repos, ce n'est pas du travail", () => {
  it("(a) une session ouverte sans travail n'est pas présentée comme en cours", () => {
    // La photo lourde date d'un tour terminé : elle affirme encore `running`.
    // La sonde de 2 s dit la vérité : plus aucun travail.
    const { list, missions } = chain({
      heavy: supervisionAssistant({ prompt: "une demande déjà terminée" }),
      probe: probe({ working: false }),
    });

    expect(list).toHaveLength(1);
    expect(list[0].state).toBe("idle");
    expect(isAgentWorking(list[0])).toBe(false);
    expect(anyBusy(list)).toBe(false);

    // Le volet des missions ne la liste PAS (même avec un prompt mémorisé)…
    expect(splitMissions(missions).running).toHaveLength(0);
    expect(renderMissionsPanelHtml(missions)).toContain("Aucune mission en cours.");
    // … le compteur du bouton « Travail » est vide…
    expect(agentTaskCounterText(splitMissions(missions).running, splitMissions(missions).waiting)).toBe("");
    // … et la fiche dit « Repos », pas « Travail ».
    expect(renderCard(list[0])).toContain(">Repos<");
    expect(renderCard(list[0])).not.toContain(">Travail<");

    // La session reste LISTÉE (décision 447 : aucun agent invisible) : c'est le
    // libellé et l'animation qui changent, jamais la présence dans la liste.
    expect(renderDropdown(list)).toContain("agent-activity-item");
  });

  // ── CAS (b) — aucune animation d'activité sur une session au repos ────────
  it("(b) aucune animation d'activité sur une session au repos", () => {
    const { list, missions } = chain({
      heavy: supervisionAssistant({ prompt: "une demande déjà terminée" }),
      probe: probe({ working: false }),
    });

    // `breathing` EST l'animation (`animation: agent-pulse 1.5s infinite` dans
    // le CSS) : la liste et la fiche ne doivent pas la porter au repos.
    expect(renderDropdown(list)).not.toContain("breathing");
    expect(renderCard(list[0])).not.toContain("breathing");
    // Aucun point de mission animé, aucune durée « en cours depuis ».
    const html = renderMissionsPanelHtml(missions);
    expect(html).not.toContain("sa-missions-dot");
    expect(html).not.toContain("sa-task-since");
  });

  // ── CAS (c) — un travail RÉEL reste « en cours » et animé ─────────────────
  it("(c) un travail réel est présenté comme en cours et animé", () => {
    // Photo lourde prise AU REPOS ; le tour vient de démarrer sur la session
    // DÉJÀ OUVERTE : l'ensemble des sessions ne change pas, donc aucune
    // relecture lourde n'a lieu. Seule la sonde de 2 s le sait.
    const { list, missions } = chain({
      heavy: supervisionAssistant({ state: "idle", prompt: "corriger la barre du bas" }),
      probe: probe({ working: true }),
    });

    expect(list[0].state).toBe("running");
    expect(isAgentWorking(list[0])).toBe(true);
    expect(anyBusy(list)).toBe(true);

    // Libellé : « en cours » (et non « Aucune mission en cours »).
    const { running } = splitMissions(missions);
    expect(running).toHaveLength(1);
    const html = renderMissionsPanelHtml(missions);
    expect(html).toContain("en cours");
    expect(html).toContain("sa-missions-dot");
    expect(renderCard(list[0])).toContain(">Travail<");

    // Animation d'activité : présente, et c'est le MÊME signal qu'avant.
    expect(renderDropdown(list)).toContain("breathing");
  });

  // ── Le repli (backend plus ancien) et le mouvement réduit ─────────────────
  it("retombe sur `busy` quand `working` n'est pas publié, sans rien inventer", () => {
    // `working` absent (charge ancienne) : `busy` est la seule preuve.
    expect(stateFromProbeActivity("running", { alive: true, busy: false })).toBe("idle");
    expect(stateFromProbeActivity("idle", { alive: true, busy: true })).toBe("running");
    // Aucune preuve du tout : l'état connu est CONSERVÉ (aucun état inventé).
    expect(stateFromProbeActivity("running", { alive: true })).toBe("running");
    // Processus mort : aucune ambiguïté.
    expect(stateFromProbeActivity("running", { alive: false, working: true })).toBe("stopped");
    // Une session PARQUÉE n'est pas requalifiée en « au repos ».
    expect(stateFromProbeActivity("paused", { alive: true, working: false })).toBe("paused");
  });

  it("le mouvement réduit coupe les animations d'activité (le texte les remplace)", () => {
    const css = read("src/css/style.css");
    const block = sliceFrom(css, "@media (prefers-reduced-motion: reduce)");
    expect(block, "bloc de mouvement réduit absent").not.toBe("");
    for (const selector of [
      "#agent-activity-dot.breathing",
      ".agent-activity-item-dot.breathing",
      ".sa-immersive-dot.breathing",
      ".agent-status.agent-status-streaming",
      ".sa-missions-dot",
    ]) {
      expect(block, `sélecteur non couvert : ${selector}`).toContain(selector);
    }
    expect(block).toContain("animation: none");
    // Le bloc est la DERNIÈRE règle du fichier : il gagne dans la cascade sur
    // les règles `.breathing` énoncées plus haut (aucune animation d'activité
    // n'est déclarée après lui).
    const mediaAt = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaAt).toBeGreaterThan(css.lastIndexOf("animation: agent-pulse"));
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });
});
