// Tests unitaires — agent-scroll.js : suivi du bas dans la conversation d'un
// agent (« l'onglet d'un agent ne suit pas la conversation »).
//
// Le défaut : la décision de descendre en bas était recalculée APRÈS l'ajout du
// contenu. Un gros bloc (message long, résultat d'outil) fait grandir
// `scrollHeight` de plus du seuil → on croyait que l'utilisateur avait remonté
// → le suivi était coupé et l'affichage restait figé. Et dans un onglet masqué
// (`display:none`), les hauteurs valent 0 : impossible de scroller, et rien ne
// rattrapait la position à la réouverture.
//
// Ces tests sont DISCRIMINANTS : la logique ponctuelle d'origine (position
// courante) dit « non » sur un gros bloc et sur un onglet masqué ; l'intention
// mémorisée (`_agentAtBottom`) dit « oui » → test rouge avant, vert après.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shouldFollowBottom, updateFollowBottomFlag } from "./agent-scroll.js";

// Faux conteneur minimal (vitest tourne en environnement node, sans jsdom).
function fakeContainer({ scrollTop = 0, clientHeight = 500, scrollHeight = 1000, atBottom } = {}) {
  const c = { scrollTop, clientHeight, scrollHeight };
  if (atBottom !== undefined) c._agentAtBottom = atBottom;
  return c;
}

describe("shouldFollowBottom", () => {
  it("suit quand l'utilisateur est en bas (aucune intention mémorisée)", () => {
    expect(shouldFollowBottom(fakeContainer({ scrollTop: 500 }))).toBe(true);
    expect(shouldFollowBottom(fakeContainer({ scrollTop: 460 }))).toBe(true);
  });

  it("ne force pas le bas si l'utilisateur a remonté pour relire", () => {
    expect(shouldFollowBottom(fakeContainer({ scrollTop: 0 }))).toBe(false);
    expect(shouldFollowBottom(fakeContainer({ scrollTop: 400 }))).toBe(false);
  });

  it("suit un GROS bloc arrivé alors que l'utilisateur était en bas (bug : onglet figé)", () => {
    // L'utilisateur était en bas ; un message de 400 px vient d'être ajouté.
    // Le calcul ponctuel (500 + 500 < 1400 - 60) dirait « non » → suivi coupé.
    // L'intention mémorisée dit « oui » → la conversation continue de défiler.
    const c = fakeContainer({ scrollTop: 500, clientHeight: 500, scrollHeight: 1400, atBottom: true });
    expect(shouldFollowBottom(c)).toBe(true);
  });

  it("reprend le suivi à la réouverture d'un onglet masqué (hauteur nulle)", () => {
    // Onglet display:none : les hauteurs valent 0, l'intention « en bas » reste.
    const c = fakeContainer({ scrollTop: 0, clientHeight: 0, scrollHeight: 0, atBottom: true });
    expect(shouldFollowBottom(c)).toBe(true);
  });

  it("ne force pas le bas à la réouverture si l'utilisateur avait remonté", () => {
    const c = fakeContainer({ scrollTop: 0, clientHeight: 0, scrollHeight: 0, atBottom: false });
    expect(shouldFollowBottom(c)).toBe(false);
  });

  it("tolère un conteneur absent", () => {
    expect(shouldFollowBottom(null)).toBe(false);
    expect(shouldFollowBottom(undefined)).toBe(false);
  });
});

describe("updateFollowBottomFlag (réarmement par le listener `scroll`)", () => {
  it("désarme le suivi quand l'utilisateur remonte au-dessus du seuil", () => {
    const c = fakeContainer({ scrollTop: 200, atBottom: true });
    expect(updateFollowBottomFlag(c)).toBe(false);
    expect(c._agentAtBottom).toBe(false);
  });

  it("ré-arme le suivi dès que l'utilisateur redescend en bas", () => {
    const c = fakeContainer({ scrollTop: 500, atBottom: false });
    expect(updateFollowBottomFlag(c)).toBe(true);
    expect(c._agentAtBottom).toBe(true);
  });

  it("conserve l'intention sur un conteneur masqué (aucune position fiable)", () => {
    // Onglet masqué : hauteur nulle → on ne désarme pas le suivi à tort.
    const c = fakeContainer({ scrollTop: 0, clientHeight: 0, scrollHeight: 0, atBottom: true });
    expect(updateFollowBottomFlag(c)).toBe(true);
    expect(c._agentAtBottom).toBe(true);
    // Et l'utilisateur qui relisait (false) n'est pas ré-armé de force.
    const c2 = fakeContainer({ scrollTop: 0, clientHeight: 0, scrollHeight: 0, atBottom: false });
    expect(updateFollowBottomFlag(c2)).toBe(false);
    expect(c2._agentAtBottom).toBe(false);
  });
});

describe("branchement dans l'onglet agent (agent-pi.js)", () => {
  // Garde-fou anti-régression : le suivi ne doit pas être débranché du chat réel.
  const src = readFileSync(new URL("./agent-pi.js", import.meta.url), "utf8");

  it("la zone de messages utilise la décision mémorisée (agent-scroll)", () => {
    expect(src).toMatch(/shouldFollowBottom/);
    expect(src).toMatch(/_agentAtBottom/);
    expect(src).toMatch(/updateFollowBottomFlag\(messagesEl\)/);
  });

  it("la réouverture d'un onglet reprend le suivi du bas", () => {
    const activate = src.slice(src.indexOf("export function activateAgentTab"));
    expect(activate).toMatch(/shouldFollowBottom\(elements\.messagesEl\)/);
    expect(activate).toMatch(/scrollTop = elements\.messagesEl\.scrollHeight/);
  });
});
