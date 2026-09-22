// Tests — theme.js : thème clair/sombre + sous-thèmes.
//
// Contrat vérifié : applyTheme remplace TOUTES les classes `theme-*` (jamais
// d'accumulation), n'ajoute pas de classe pour le sous-thème « default »,
// persiste le choix, émet `theme-changed` ; getCurrentTheme relit la classe
// réellement posée ; la table SUBTHEMES couvre dark et light.

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  store: new Map(),
  emitted: [],
  classes: new Set(),
}));

vi.hoisted(() => {
  globalThis.localStorage = {
    getItem: (k) => (state.store.has(k) ? state.store.get(k) : null),
    setItem: (k, v) => state.store.set(k, String(v)),
    removeItem: (k) => state.store.delete(k),
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.document = {
    body: {
      classList: {
        add: (c) => state.classes.add(c),
        remove: (c) => state.classes.delete(c),
        contains: (c) => state.classes.has(c),
        forEach: (fn) => [...state.classes].forEach(fn),
      },
    },
  };
  globalThis.window = { dispatchEvent: (e) => state.emitted.push(e) };
});

import { SUBTHEMES, applyTheme, getCurrentTheme, getCurrentSubtheme } from "./theme.js";

beforeEach(() => {
  state.store.clear();
  state.emitted.length = 0;
  state.classes.clear();
});

describe("applyTheme", () => {
  it("pose theme-light + sous-thème et retire les classes theme-* précédentes", () => {
    applyTheme("dark", "dracula");
    expect(state.classes.has("theme-dark")).toBe(true);
    expect(state.classes.has("theme-dracula")).toBe(true);

    applyTheme("light", "github");
    expect(state.classes.has("theme-light")).toBe(true);
    expect(state.classes.has("theme-github")).toBe(true);
    // pas d'accumulation : les classes du thème précédent ont disparu
    expect(state.classes.has("theme-dark")).toBe(false);
    expect(state.classes.has("theme-dracula")).toBe(false);
  });

  it("sous-thème « default » (ou absent) : aucune classe supplémentaire", () => {
    applyTheme("dark");
    expect(state.classes.has("theme-dark")).toBe(true);
    expect(state.classes.has("theme-default")).toBe(false);
  });

  it("persiste le thème et le sous-thème", () => {
    applyTheme("light", "nord");
    expect(state.store.get("pilot-theme")).toBe("light");
    expect(state.store.get("pilot-subtheme")).toBe("nord");
  });

  it("émet theme-changed avec le thème et le sous-thème effectifs", () => {
    applyTheme("light", "github");
    expect(state.emitted.length).toBe(1);
    expect(state.emitted[0].type).toBe("theme-changed");
    expect(state.emitted[0].detail).toEqual({ theme: "light", subtheme: "github" });
  });
});

describe("getCurrentTheme / getCurrentSubtheme", () => {
  it("relit la classe réellement posée sur le body", () => {
    applyTheme("light", "default");
    expect(getCurrentTheme()).toBe("light");
    applyTheme("dark", "default");
    expect(getCurrentTheme()).toBe("dark");
  });

  it("getCurrentSubtheme retombe sur « default » quand rien n'est stocké", () => {
    expect(getCurrentSubtheme()).toBe("default");
    applyTheme("dark", "tokyo-night");
    expect(getCurrentSubtheme()).toBe("tokyo-night");
  });
});

describe("SUBTHEMES", () => {
  it("propose des sous-thèmes pour dark et light, « default » en tête", () => {
    for (const mode of ["dark", "light"]) {
      expect(Array.isArray(SUBTHEMES[mode])).toBe(true);
      expect(SUBTHEMES[mode].length).toBeGreaterThan(1);
      expect(SUBTHEMES[mode][0]).toEqual({ id: "default", label: "Pilot (défaut)" });
      // identifiants uniques
      const ids = SUBTHEMES[mode].map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
