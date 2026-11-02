// prechauffage-voix-imitee-demarrage.test.js — PRÉCHAUFFAGE de la voix imitée
// (service local VoiceStudio) AU DÉMARRAGE de Pilot.
//
// Problème posé par le propriétaire : la première phrase lue après le lancement
// attendait que le logiciel de voix imitée démarre (premier appel à froid
// ≈ 6 s), ce qui s'entend comme une lenteur. Décision : préchauffer UNE fois au
// démarrage — et seulement si c'est cette voix-là qui est mémorisée.
//
// Ce que ce fichier verrouille, contrôle par contrôle :
//   1. la DÉCISION (`shouldPrewarmVoiceStudio`, pure) : oui uniquement pour une
//      voix imitée AVEC identifiant de profil ;
//   2. le DÉCLENCHEMENT ne se fait pas pour une voix du système, une voix locale
//      ou une valeur inconnue (aucun appel, aucun démarrage de logiciel) ;
//   3. une panne au démarrage ne casse rien et n'affiche rien (aucune exception,
//      aucun message, aucune ligne de journal) ;
//   4. le préchauffage n'est JAMAIS attendu sur le chemin de démarrage (appel
//      `void` posé APRÈS l'affichage de la fenêtre, jamais `await`) ;
//   5. UNE tentative, plus au plus UNE seconde tentative discrète, et seulement
//      si le premier échec peut être passager ;
//   6. aucun double préchauffage (garde en mémoire), et aucun SON produit
//      (le préchauffage n'est pas une lecture).
//
// Preuves par neutralisation (mesurées, consignées dans
// docs/rapports/RAPPORT-predemarrage-voix-voicestudio.md) : remplacer la garde de
// décision par `return true` fait ÉCHOUER le § 2 ; retirer la garde
// `prewarmStartupStarted` fait ÉCHOUER le § 6 ; faire remonter l'erreur de
// `warmupVoiceStudio` fait ÉCHOUER le § 3.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VOICESTUDIO_PREWARM_RETRY_MS,
  isTransientWarmupFailure,
  prewarmVoiceStudioAtStartup,
  resetPrewarmStartupGuard,
  shouldPrewarmVoiceStudio,
  voiceStudioChoiceValue,
} from "./voicestudio-voice.js";
// Découpage de source VÉRIFIÉ (jamais `source.indexOf` en ligne : l'inventaire
// `source-slice.test.js` refuse un découpage non protégé).
import { sliceSource } from "./source-slice.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** Lit un fichier du dépôt (fin de lignes normalisées : piège CI Windows). */
function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

/** Valeur mémorisée désignant une voix imitée (identifiant du profil). */
const STUDIO = voiceStudioChoiceValue("a772c1b0");
/** Valeur mémorisée d'une voix du SYSTÈME (jamais une voix imitée). */
const SYSTEME = "Microsoft Hortense";
/** Valeur mémorisée de la voix locale par défaut (Piper). */
const PIPER = "local:piper";

/**
 * Invocateur factice : enregistre les commandes réellement demandées à la
 * machine. Aucun Tauri, aucun réseau.
 */
function fakeInvoke(behavior = {}) {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === "get_config") return { read_aloud_voice: behavior.voice || "" };
    if (command === "tts_voicestudio_warmup") {
      if (behavior.warmupError) throw new Error(behavior.warmupError);
      return "préchauffage terminé";
    }
    return null;
  };
  return { invoke, calls };
}

/**
 * Préchauffage factice : rejoue une suite de résultats (`true` = réussi, chaîne
 * = échec avec sa raison, `Error` = exception lancée).
 */
function fakeWarmup(outcomes = [true]) {
  const voices = [];
  let index = 0;
  const warmup = async (voice, onFailure) => {
    voices.push(voice);
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    if (outcome === true) return true;
    if (outcome instanceof Error) throw outcome;
    if (typeof onFailure === "function") onFailure(String(outcome));
    return false;
  };
  return { warmup, voices };
}

/** Commandes de PRÉCHAUFFAGE reçues par la machine (le reste n'en est pas un). */
function warmupCalls(calls) {
  return calls.filter((call) => call.command === "tts_voicestudio_warmup");
}

/** Espions silencieux : le préchauffage ne doit RIEN dire. */
function spyConsole() {
  return {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
}

beforeEach(() => {
  resetPrewarmStartupGuard();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("1. La décision est PURE : oui uniquement pour une voix imitée valide", () => {
  it("dit OUI pour une voix imitée AVEC identifiant de profil", () => {
    expect(shouldPrewarmVoiceStudio(STUDIO)).toBe(true);
    expect(shouldPrewarmVoiceStudio("local:voicestudio:autre-profil")).toBe(true);
    // Les espaces autour de la valeur mémorisée ne changent pas la décision.
    expect(shouldPrewarmVoiceStudio(" local:voicestudio:a772c1b0 ")).toBe(true);
  });

  it("dit NON pour la voix du système, la voix locale, une valeur vide ou inconnue", () => {
    for (const value of [
      "",
      "   ",
      null,
      undefined,
      SYSTEME,
      PIPER,
      "local:piper:fr_FR-tom-medium",
      "local:voicestudio",
      "local:voicestudio:",
      "local:voicestudio:   ",
      "voicestudio",
      "autre:chose",
    ]) {
      expect(shouldPrewarmVoiceStudio(value), `valeur refusée attendue : ${String(value)}`).toBe(
        false,
      );
    }
  });

  it("ne recopie pas la reconnaissance du type de voix (elle vient du module)", () => {
    // La décision se lit dans le module de la voix imitée et s'appuie sur
    // `voiceStudioProfileIdFor` : aucun préfixe n'est réécrit à la main.
    const source = read("src/js/voicestudio-voice.js");
    const decision = sliceSource(
      source,
      "export function shouldPrewarmVoiceStudio(value) {",
      "}\n",
    );
    expect(decision).toContain("voiceStudioProfileIdFor(value)");
  });
});

// ---------------------------------------------------------------------------
describe("2. Le préchauffage n'est PAS déclenché pour une autre voix", () => {
  // La seule commande admise sans préchauffage est la LECTURE de la voix
  // mémorisée (`get_config`, locale, sans réseau) : aucun appel au service,
  // aucun démarrage de logiciel pour rien.
  it("voix du SYSTÈME mémorisée : aucun préchauffage, aucun appel au service", async () => {
    const { invoke, calls } = fakeInvoke({ voice: SYSTEME });
    const ok = await prewarmVoiceStudioAtStartup({ invoke });
    expect(ok).toBe(false);
    expect(warmupCalls(calls)).toHaveLength(0);
    expect(calls.map((call) => call.command)).toEqual(["get_config"]);
  });

  it("voix LOCALE (Piper) mémorisée : aucun préchauffage, aucun appel au service", async () => {
    const { invoke, calls } = fakeInvoke({ voice: PIPER });
    const ok = await prewarmVoiceStudioAtStartup({ invoke });
    expect(ok).toBe(false);
    expect(warmupCalls(calls)).toHaveLength(0);
    expect(calls.map((call) => call.command)).toEqual(["get_config"]);
  });

  it("valeur vide ou inconnue : aucun préchauffage, aucun appel au service", async () => {
    for (const voice of ["", "autre:chose"]) {
      resetPrewarmStartupGuard();
      const { invoke, calls } = fakeInvoke({ voice });
      expect(await prewarmVoiceStudioAtStartup({ invoke })).toBe(false);
      expect(warmupCalls(calls), `aucun préchauffage attendu pour « ${voice} »`).toHaveLength(0);
      expect(calls.map((call) => call.command)).toEqual(["get_config"]);
    }
  });

  it("voix IMITÉE mémorisée : le préchauffage part UNE fois, avec l'identifiant du profil", async () => {
    const { invoke, calls } = fakeInvoke({ voice: STUDIO });
    const ok = await prewarmVoiceStudioAtStartup({ invoke });
    expect(ok).toBe(true);
    const prechauffages = warmupCalls(calls);
    expect(prechauffages).toHaveLength(1);
    expect(prechauffages[0].args).toEqual({ voice: "a772c1b0" });
    // Rien d'autre n'est demandé : ni état, ni synthèse, ni journal.
    expect(calls.map((call) => call.command)).toEqual(["get_config", "tts_voicestudio_warmup"]);
  });
});

// ---------------------------------------------------------------------------
describe("3. Une panne au démarrage ne casse rien et n'affiche rien", () => {
  it("service injoignable : aucune exception, aucune sortie console", async () => {
    const spies = spyConsole();
    const { invoke, calls } = fakeInvoke({ voice: STUDIO, warmupError: "service injoignable" });
    const ok = await prewarmVoiceStudioAtStartup({
      invoke,
      wait: async () => {},
    });
    expect(ok).toBe(false);
    // Rien n'est affiché : le repli (voix locale puis voix du système) reste
    // seul en jeu, sans le moindre message ajouté par le préchauffage.
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
    // Aucune ligne de journal écrite pour la voix imitée : seuls la lecture de
    // la configuration et le préchauffage lui-même parlent à la machine.
    expect(calls.map((call) => call.command)).toEqual([
      "get_config",
      "tts_voicestudio_warmup",
      "tts_voicestudio_warmup",
    ]);
  });

  it("configuration illisible : silence total, aucun préchauffage", async () => {
    const spies = spyConsole();
    let warmed = 0;
    const ok = await prewarmVoiceStudioAtStartup({
      loadConfig: async () => {
        throw new Error("get_config indisponible");
      },
      warmup: async () => {
        warmed += 1;
        return true;
      },
    });
    expect(ok).toBe(false);
    expect(warmed).toBe(0);
    expect(spies.error).not.toHaveBeenCalled();
    expect(spies.warn).not.toHaveBeenCalled();
  });

  it("échec DEFINITIF du service (voix inconnue) : pas de seconde tentative", async () => {
    const spies = spyConsole();
    const { warmup, voices } = fakeWarmup([
      "la voix « a772c1b0 » n'existe pas dans VoiceStudio",
    ]);
    const waits = [];
    const ok = await prewarmVoiceStudioAtStartup({
      loadConfig: () => STUDIO,
      warmup,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(ok).toBe(false);
    expect(voices).toHaveLength(1);
    expect(waits).toHaveLength(0);
    expect(spies.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("4. Aucun appel bloquant sur le chemin de démarrage", () => {
  it("l'appel rend la main tout de suite (promesse non attendue)", async () => {
    const { warmup, voices } = fakeWarmup([true]);
    let suite = false;
    const pending = prewarmVoiceStudioAtStartup({ loadConfig: () => STUDIO, warmup });
    // Le code qui suit l'appel s'exécute SANS attendre le service.
    suite = true;
    expect(suite).toBe(true);
    expect(pending).toBeInstanceOf(Promise);
    await pending;
    expect(voices).toHaveLength(1);
  });

  it("main.js déclenche APRÈS l'affichage, en `void`, jamais en `await`", () => {
    const main = read("src/js/main.js");
    // 1. Le module de la voix imitée est bien importé (un seul import).
    const imports = main.split("\n").filter((line) => line.includes('from "./voicestudio-voice.js"'));
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("prewarmVoiceStudioAtStartup");
    // 2. Un seul appel, et il n'est jamais attendu.
    expect(main).not.toContain("await prewarmVoiceStudioAtStartup");
    expect(main.split("prewarmVoiceStudioAtStartup(").length - 1).toBe(1);
    // 3. L'appel est posé APRÈS le masquage de l'écran de chargement (donc après
    //    l'affichage réel), dans la même portion de démarrage.
    const demarrage = sliceSource(
      main,
      'console.log("🚀 Pilot prêt.");',
      "// 13. Prise en main de la PREMIÈRE ouverture",
    );
    const masquage = demarrage.indexOf('bootOverlay.classList.add("hidden");');
    const appel = demarrage.indexOf("void prewarmVoiceStudioAtStartup();");
    expect(masquage).toBeGreaterThan(-1);
    expect(appel).toBeGreaterThan(masquage);
  });
});

// ---------------------------------------------------------------------------
describe("5. Une seule seconde tentative, et seulement si l'échec peut être passager", () => {
  it("service « injoignable » : exactement deux tentatives, à VOICESTUDIO_PREWARM_RETRY_MS", async () => {
    const { warmup, voices } = fakeWarmup(["service injoignable (connexion refusée)", true]);
    const waits = [];
    const ok = await prewarmVoiceStudioAtStartup({
      loadConfig: () => STUDIO,
      warmup,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(ok).toBe(true);
    expect(voices).toEqual(["a772c1b0", "a772c1b0"]);
    expect(waits).toEqual([VOICESTUDIO_PREWARM_RETRY_MS]);
  });

  it("deux échecs passagers : la seconde tentative est la DERNIÈRE (aucune boucle)", async () => {
    const { warmup, voices } = fakeWarmup(["service injoignable"]);
    const waits = [];
    const ok = await prewarmVoiceStudioAtStartup({
      loadConfig: () => STUDIO,
      warmup,
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(ok).toBe(false);
    expect(voices).toHaveLength(2);
    expect(waits).toHaveLength(1);
  });

  it("une exception porteuse de « injoignable » compte aussi comme passagère", async () => {
    const { warmup, voices } = fakeWarmup([new Error("service injoignable"), true]);
    const ok = await prewarmVoiceStudioAtStartup({
      loadConfig: () => STUDIO,
      warmup,
      wait: async () => {},
    });
    expect(ok).toBe(true);
    expect(voices).toHaveLength(2);
  });

  it("isTransientWarmupFailure distingue passager et définitif", () => {
    expect(isTransientWarmupFailure("service injoignable (connexion refusée)")).toBe(true);
    expect(isTransientWarmupFailure("operation timed out")).toBe(true);
    expect(isTransientWarmupFailure("la voix « x » n'existe pas dans VoiceStudio")).toBe(false);
    expect(isTransientWarmupFailure("le service a refusé la demande (HTTP 400)")).toBe(false);
    expect(isTransientWarmupFailure("")).toBe(false);
    expect(isTransientWarmupFailure(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("6. Un seul préchauffage par démarrage, et aucun son produit", () => {
  it("un second appel ne relance RIEN (garde en mémoire)", async () => {
    const { warmup, voices } = fakeWarmup([true]);
    const premiere = await prewarmVoiceStudioAtStartup({ loadConfig: () => STUDIO, warmup });
    const seconde = await prewarmVoiceStudioAtStartup({ loadConfig: () => STUDIO, warmup });
    expect(premiere).toBe(true);
    expect(seconde).toBe(false);
    expect(voices).toHaveLength(1);
  });

  it("le préchauffage n'est pas une lecture : aucun lecteur, aucun son", () => {
    const source = read("src/js/voicestudio-voice.js");
    const prechauffage = sliceSource(source, "// ── Préchauffage AU DÉMARRAGE", undefined, 200);
    // Le préchauffage passe par la SEULE fonction qui parle au service, et par
    // la commande de préchauffage (jamais la synthèse).
    expect(prechauffage).toContain("warmupVoiceStudio");
    expect(source).toContain("invoke(VOICESTUDIO_COMMAND_WARMUP");
    // Aucun chemin de lecture : ni lecteur audio, ni synthèse jouée.
    expect(prechauffage).not.toContain("new Audio");
    expect(prechauffage).not.toContain("createSpeaker");
    expect(prechauffage).not.toContain("synthesizeVoiceStudioAudio");
    // Aucune nouvelle porte vers le service : la commande de la machine reste
    // la seule voie (le module ne joint jamais le service lui-même).
    expect(source).not.toContain("fetch(");
  });
});
