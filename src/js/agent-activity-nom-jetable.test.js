// Tests unitaires — NOM D'AFFICHAGE d'un agent jetable (agent-activity.js).
//
// Cause corrigée : la supervision ne publiait que le champ `agent` (identifiant
// brut `eph-<base36>-<hex>`), que le frontend affichait tel quel — le
// propriétaire voyait « eph-mvj108jh-17 » en haut à droite, dans la liste des
// tâches et dans l'onglet de l'agent. `dashboard.rs` publie désormais un champ
// ADDITIF `name` (nom lisible, borné à 40 caractères) ; ici on prouve que :
//
//  1. le LIBELLÉ affiché prend le nom quand il existe (les trois rendus ne
//     contiennent plus l'identifiant technique) ;
//  2. l'IDENTITÉ reste l'identifiant brut (`rawId`), employée par les actions
//     (ouverture d'onglet ciblée, arrêt ciblé, horodatage d'activité) ;
//  3. un agent du REGISTRE (et l'assistant) n'y perd rien : sans `name`, tout
//     est exactement comme avant.
//
// Les tests échouent si `label` redevient `a.agent` (régression d'affichage) ou
// si `rawId` prend le libellé (régression d'identité → actions cassées).
import { describe, it, expect, vi } from "vitest";
import {
  flattenAgents,
  buildRunningMissions,
  renderMissionsPanelHtml,
  renderDropdown,
  renderCard,
} from "./agent-activity.js";

// L'import de agent-activity.js charge les API Tauri (store partagé) : on les
// mocke comme le fait agent-activity.test.js — aucune commande réelle.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

/** Identifiant réellement tracé dans .pilot/agent-stops.log (cas vécu). */
const EPH_ID = "eph-mvj108jh-17";
const EPH_NAME = "auditeur-cohérence";

/** Supervision telle que `get_agent_supervision` la renvoie après correction. */
function supervisionJetable(extra = {}) {
  return {
    projects: [
      {
        path: "C:/proj/a",
        name: "a",
        agents: [
          {
            agent: EPH_ID,
            name: EPH_NAME,
            state: "running",
            alive: true,
            visible: false,
            prompt: "=== ROLE ===\n## Objectif\nContrôler la cohérence des données.",
            ...extra,
          },
        ],
      },
    ],
  };
}

describe("flattenAgents — libellé lisible, identité technique intacte", () => {
  it("affiche le NOM et conserve l'identifiant brut dans rawId", () => {
    const [a] = flattenAgents(supervisionJetable());
    expect(a.label).toBe(EPH_NAME);
    // Identité : le clic « Afficher l'onglet », l'arrêt ciblé et l'horodatage
    // d'activité passent par l'identifiant brut, jamais par le libellé.
    expect(a.rawId).toBe(EPH_ID);
    // Clé composite unique : bâtie sur l'identifiant, pas sur le nom.
    expect(a.agentId).toBe(`${EPH_ID}|C:/proj/a`);
    expect(a.projectPath).toBe("C:/proj/a");
  });

  it("retombe sur l'identifiant quand aucun nom n'est fourni (comportement d'avant)", () => {
    const sup = supervisionJetable();
    delete sup.projects[0].agents[0].name;
    const [a] = flattenAgents(sup);
    expect(a.label).toBe(EPH_ID);
    expect(a.rawId).toBe(EPH_ID);
    expect(a.agentId).toBe(`${EPH_ID}|C:/proj/a`);
  });

  it("un nom vide ne remplace jamais l'identifiant", () => {
    const [a] = flattenAgents(supervisionJetable({ name: "" }));
    expect(a.label).toBe(EPH_ID);
    expect(a.rawId).toBe(EPH_ID);
  });

  it("agent du REGISTRE : affichage et identité inchangés (aucun champ name)", () => {
    const sup = {
      projects: [
        {
          path: "C:/proj/a",
          name: "a",
          agents: [{ agent: "codeur", state: "running", alive: true }],
        },
      ],
    };
    const [a] = flattenAgents(sup);
    expect(a.label).toBe("codeur");
    expect(a.rawId).toBe("codeur");
    expect(a.agentId).toBe("codeur|C:/proj/a");
  });

  it("assistant (projet pseudo-global) : libellé réglé par l'utilisateur, inchangé", () => {
    const sup = {
      projects: [
        {
          path: "",
          name: "Assistant",
          agents: [{ agent: "Magnus", state: "idle", alive: true }],
        },
      ],
    };
    const [a] = flattenAgents(sup);
    expect(a.label).toBe("Magnus");
    expect(a.rawId).toBe("superagent");
    expect(a.agentId).toBe("superagent");
  });
});

describe("panneau et liste — plus d'identifiant technique à l'écran", () => {
  it("liste des tâches en cours : « nom — projet », sans identifiant", () => {
    const list = flattenAgents(supervisionJetable());
    // Horodatage d'activité : clé = identifiant brut (jamais le nom).
    const lastActivity = new Map([[EPH_ID, Date.now()]]);
    const withActivity = flattenAgents(supervisionJetable(), lastActivity);
    expect(withActivity[0].lastActivity).toMatch(/^\d{2}:\d{2}$/);

    const missions = buildRunningMissions(list, []);
    expect(missions).toHaveLength(1);
    expect(missions[0].agent).toBe(EPH_NAME);

    const html = renderMissionsPanelHtml(missions);
    expect(html).toContain(`${EPH_NAME} — a`);
    expect(html).not.toMatch(/eph-/);
  });

  it("liste déroulante (haut droite) : nom affiché, identifiant absent du texte visible", () => {
    const html = renderDropdown(flattenAgents(supervisionJetable()));
    expect(html).toContain(`>${EPH_NAME}</span>`);
    // Aucun identifiant technique dans le TEXTE (nom affiché, infobulle) : le
    // seul endroit où il subsiste est la clé technique `data-agent-id`.
    expect(html).not.toContain(`>${EPH_ID}<`);
    expect(html).not.toContain(`title="${EPH_ID}`);
    expect(html).toContain(`title="${EPH_NAME} — a"`);
    // L'identité de la ligne (data-agent-id) reste celle de l'agent.
    expect(html).toContain(`data-agent-id="${EPH_ID}|C:/proj/a"`);
  });

  it("fiche de l'agent : nom affiché, identifiant absent du texte visible", () => {
    const html = renderCard(flattenAgents(supervisionJetable())[0]);
    expect(html).toContain(`>${EPH_NAME}</span>`);
    expect(html).not.toContain(`>${EPH_ID}<`);
    expect(html).toContain(`data-agent-id="${EPH_ID}|C:/proj/a"`);
  });

  it("repli complet : sans nom, la liste et le panneau montrent l'identifiant comme avant", () => {
    const sup = supervisionJetable();
    delete sup.projects[0].agents[0].name;
    const list = flattenAgents(sup);
    expect(renderDropdown(list)).toContain(EPH_ID);
    expect(renderMissionsPanelHtml(buildRunningMissions(list, []))).toContain(
      `${EPH_ID} — a`
    );
  });
});
