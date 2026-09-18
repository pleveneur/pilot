// Tests unitaires — sound-deferred.js : le son de fin n'est joué qu'une fois
// l'affichage RÉELLEMENT terminé (aucun son tant que du texte arrive encore,
// un seul son par fin de mission, délai de sécurité borné).
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createDeferredSoundPlayer,
  setDeferredSoundPlayer,
  armDoneSound,
  noteSoundRenderActivity,
  markSoundRenderIdle,
  resetDeferredSound,
} from "./sound-deferred.js";

/**
 * Faux horloge déterministe : planificateur + annulateur injectables, avance
 * manuelle du temps (les timers dus sont déclenchés dans l'ordre).
 */
function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    schedule(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!next || t.at < next.t.at)) next = { id, t };
        }
        if (!next) break;
        timers.delete(next.id);
        now = next.t.at;
        next.t.fn();
      }
      now = target;
    },
  };
}

function setup(opts = {}) {
  const play = vi.fn();
  const clock = makeClock();
  const player = createDeferredSoundPlayer({
    play,
    schedule: clock.schedule,
    cancel: clock.cancel,
    safetyMs: 100,
    coalesceMs: 50,
    ...opts,
  });
  return { play, clock, player };
}

describe("API applicative (singleton branché sur playAssistantSound)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDeferredSound();
  });
  afterEach(() => {
    resetDeferredSound();
    setDeferredSoundPlayer(null);
    vi.useRealTimers();
  });

  it("le signal de fin arme le son, il n'est joué qu'au repos du rendu", () => {
    const play = vi.fn();
    setDeferredSoundPlayer(play);
    armDoneSound("fin");
    expect(play).toHaveBeenCalledTimes(0);
    noteSoundRenderActivity("superagent");
    expect(play).toHaveBeenCalledTimes(0);
    expect(markSoundRenderIdle("superagent")).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith("fin");
  });

  it("un autre onglet qui écrit encore retient le son (Assistant + agent)", () => {
    const play = vi.fn();
    setDeferredSoundPlayer(play);
    armDoneSound("fin");
    noteSoundRenderActivity("superagent");
    noteSoundRenderActivity("agent");
    expect(markSoundRenderIdle("agent")).toBe(false);
    expect(play).toHaveBeenCalledTimes(0);
    expect(markSoundRenderIdle("superagent")).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("un seul son par fin de mission (arm + idle répétés)", () => {
    const play = vi.fn();
    setDeferredSoundPlayer(play);
    armDoneSound("fin");
    markSoundRenderIdle("superagent");
    armDoneSound("fin");
    markSoundRenderIdle("superagent");
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("délai de sécurité : sans fin d'affichage signalée, le son finit par partir", () => {
    const play = vi.fn();
    setDeferredSoundPlayer(play);
    armDoneSound("fin");
    vi.advanceTimersByTime(12000);
    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe("createDeferredSoundPlayer — attendre la fin de l'affichage", () => {
  it("aucun son tant que du texte arrive encore (surface encore active)", () => {
    const { play, player } = setup();
    player.arm("fin");
    player.activity("superagent");
    expect(play).toHaveBeenCalledTimes(0);
    // Une AUTRE surface écrit encore : le repos de la première ne suffit pas.
    player.activity("agent");
    expect(player.idle("superagent")).toBe(false);
    expect(play).toHaveBeenCalledTimes(0);
    // Toutes les surfaces au repos → le son part, une seule fois.
    expect(player.idle("agent")).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith("fin");
  });

  it("son joué une seule fois (idle répétés, arm répété pendant l'attente)", () => {
    const { play, player } = setup();
    player.arm("fin");
    player.arm("fin"); // second armement de la même fin → ignoré
    player.idle("superagent");
    expect(play).toHaveBeenCalledTimes(1);
    player.idle("superagent");
    player.idle("superagent");
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("anti-doublon : un armement juste après l'émission est coalescé", () => {
    const { play, clock, player } = setup();
    player.arm("fin");
    player.idle("superagent");
    expect(play).toHaveBeenCalledTimes(1);
    // Même fin de mission signalée deux fois (deux chemins) → un seul son.
    player.arm("fin");
    player.idle("superagent");
    expect(play).toHaveBeenCalledTimes(1);
    // Après la fenêtre de coalescence, une NOUVELLE fin de mission sonne.
    clock.advance(50);
    player.arm("fin");
    player.idle("superagent");
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("délai de sécurité borné : la fin d'affichage n'arrive jamais → le son part quand même", () => {
    const { play, clock, player } = setup();
    player.arm("fin");
    expect(play).toHaveBeenCalledTimes(0);
    clock.advance(99);
    expect(play).toHaveBeenCalledTimes(0);
    clock.advance(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(player.isArmed()).toBe(false);
  });

  it("chaque écriture repousse le délai de sécurité (jamais de son pendant le flux)", () => {
    const { play, clock, player } = setup();
    player.arm("fin");
    clock.advance(80);
    player.activity("superagent");
    clock.advance(80);
    expect(play).toHaveBeenCalledTimes(0);
    clock.advance(20); // 100 ms depuis la dernière activité
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("reset() : rien n'est joué et l'état repart à zéro", () => {
    const { play, clock, player } = setup();
    player.arm("fin");
    player.activity("superagent");
    player.reset();
    expect(player.isArmed()).toBe(false);
    expect(player.pendingCount()).toBe(0);
    clock.advance(1000);
    expect(play).toHaveBeenCalledTimes(0);
  });

  it("émetteur absent ou en échec : aucune erreur propagée (fail-open)", () => {
    const clock = makeClock();
    const player = createDeferredSoundPlayer({ schedule: clock.schedule, cancel: clock.cancel, safetyMs: 100 });
    player.arm("fin");
    expect(() => player.idle("superagent")).not.toThrow();
    const throwing = createDeferredSoundPlayer({
      play: () => {
        throw new Error("boom");
      },
      schedule: clock.schedule,
      cancel: clock.cancel,
      safetyMs: 100,
    });
    throwing.arm("fin");
    expect(() => throwing.idle("superagent")).not.toThrow();
  });
});
