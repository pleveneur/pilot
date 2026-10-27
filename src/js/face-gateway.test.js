// Tests Vitest du cœur PUR de la passerelle du visage (face-gateway.js).
//
// On teste face à un FAUX visage : un serveur HTTP local sur un port éphémère
// (jamais le port 3000 du vrai visage). Aucun accès réseau externe.
//
// ── DÉTERMINISME DE LA FIXTURE (voir .pilot/rapports/rapport-test-instable-face-gateway.md) ──
// `listen(0, "127.0.0.1")` laisse le SYSTÈME choisir le port. Or « le port a pu
// être réservé » ne signifie pas « une requête atteindra ce serveur » : la plage
// de ports dynamiques de cette machine est étroite et basse (1024 → 15000,
// `netsh int ipv4 show dynamicport tcp`) et certains de ses ports sont, par
// intermittence, refusés à la connexion alors que `listen()` a réussi : la
// requête n'arrive JAMAIS au gestionnaire (tableau `received` vide, ou
// `requeteArrivee: 0`) et le test échoue sans que la passerelle soit en cause.
// Constaté sur 5060, 3659, 4190, 6665-6668, 6697 (bindables, puis injoignables,
// puis de nouveau joignables plus tard : ce n'est pas une liste fixe).
// Le fichier échouait donc par intermittence, uniquement selon les ports que le
// système avait bien voulu donner — et il en donnait d'autres quand toute la
// suite tournait en parallèle (curseur d'allocation déplacé par les 16 workers).
// On ne fait plus confiance au port rendu : on PROUVE, par une vraie requête
// HTTP sur le transport exact du test, que le serveur est atteignable, et on en
// redemande un autre sinon. Aucune assertion n'est modifiée, aucun délai
// d'assertion n'est touché : c'est la fixture qui devient déterministe.

import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import {
  DEFAULT_FACE_API_URL,
  FACE_TOOL_NAMES,
  buildFaceRequest,
  faceOffMessage,
  callFaceApi,
  runFaceTool,
} from "./face-gateway.js";

/** Nombre de ports demandés au système avant de renoncer (borne, aucun délai). */
const MAX_PORT_ATTEMPTS = 60;
/**
 * Chemin réservé au témoin de la fixture. Il est intercepté par la fixture
 * elle-même : il n'apparaît donc jamais dans le tableau `received` des tests.
 */
const FIXTURE_PROBE_PATH = "/__fixture_probe";
/**
 * Borne du témoin : ce n'est pas un délai d'assertion, seulement le temps
 * laissé à la requête de témoin pour ARRIVER (un serveur muet ne répond
 * jamais, et c'est justement le cas que certains tests exercent).
 */
const FIXTURE_PROBE_TIMEOUT_MS = 300;

/** Vrai si l'erreur est une expiration du témoin (et non un refus de connexion). */
function isAbort(err) {
  const name = err && err.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Ouvre UN serveur HTTP local sur un port choisi par le système. */
function listenOnce(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    // Sans ceci, un échec de `listen` (EADDRINUSE, EMFILE…) laisserait la
    // promesse en suspens : le test mourrait en « timeout » au lieu de dire
    // clairement ce qui s'est passé.
    server.once("error", reject);
    // Un témoin refermé sans requête complète fait émettre `clientError` au
    // serveur : on l'ignore, la fixture n'a pas à s'en plaindre.
    server.on("clientError", () => {});
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, port });
    });
  });
}

function stopFakeFace(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/**
 * Démarre un faux visage (serveur HTTP local) et renvoie son URL de base.
 * `handler(req, res)` produit la réponse.
 *
 * Avant de rendre la main, la fixture PROUVE que le transport utilisé par le
 * test (`fetch`, donc undici) atteint réellement ce serveur : elle envoie une
 * requête de témoin sur `FIXTURE_PROBE_PATH` et vérifie qu'elle est bien
 * ARRIVÉE. Si le port rendu par le système est refusé par l'environnement, elle
 * en redemande un autre. L'assertion du test n'est jamais atteinte tant que le
 * transport n'est pas prouvé sain.
 */
async function startFakeFace(handler) {
  const constats = [];
  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt++) {
    let probeHits = 0;
    const { server, baseUrl, port } = await listenOnce((req, res) => {
      if (req.url.startsWith(FIXTURE_PROBE_PATH)) {
        probeHits += 1;
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("fixture-probe");
        return;
      }
      handler(req, res);
    });
    try {
      await fetch(`${baseUrl}${FIXTURE_PROBE_PATH}`, {
        signal: AbortSignal.timeout(FIXTURE_PROBE_TIMEOUT_MS),
      });
    } catch {
      // Un faux visage « qui ne répond jamais » fait expirer le témoin : ce
      // n'est pas un échec, seule l'ARRIVÉE de la requête est jugée.
    }
    // Laisse au gestionnaire du serveur la boucle nécessaire pour compter.
    await new Promise((resolve) => setImmediate(resolve));
    if (probeHits > 0) {
      return { server, baseUrl, port };
    }
    constats.push(`${port} (requête de témoin jamais arrivée)`);
    await stopFakeFace(server);
  }
  throw new Error(
    `Aucun port local atteignable pour le faux visage après ${MAX_PORT_ATTEMPTS} essais : ` +
      `${constats.join(", ")} — l'environnement refuse ces connexions locales, ` +
      `ce n'est pas la passerelle qui est en cause.`,
  );
}

/**
 * Renvoie une URL locale dont la connexion est VÉRIFIÉE comme réellement
 * REFUSÉE, avec le MÊME transport que le test (`fetch`).
 * Sans cette vérification, le test dépendait du bon vouloir du système : un
 * autre processus peut reprendre le port libéré, la réponse viendrait alors
 * d'un inconnu et l'échec n'aurait plus rien à voir avec la passerelle. Un port
 * simplement FILTRÉ (témoin expiré) est écarté lui aussi : le test annonce une
 * « connexion refusée », il doit donc en observer une vraie.
 */
async function pickRefusedBaseUrl() {
  const constats = [];
  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt++) {
    const { server, baseUrl, port } = await listenOnce((_req, res) => res.end("x"));
    await stopFakeFace(server);
    try {
      const res = await fetch(`${baseUrl}${FIXTURE_PROBE_PATH}`, {
        signal: AbortSignal.timeout(FIXTURE_PROBE_TIMEOUT_MS),
      });
      await res.text();
      // Quelqu'un répond encore : ce port ne convient pas.
      constats.push(`${port} (une réponse est arrivée)`);
    } catch (err) {
      if (isAbort(err)) {
        constats.push(`${port} (témoin expiré)`);
        continue;
      }
      return { baseUrl, port };
    }
  }
  throw new Error(
    `Aucun port local réellement REFUSÉ après ${MAX_PORT_ATTEMPTS} essais : ` +
      `${constats.join(", ")} — impossible de vérifier le cas « visage éteint ».`,
  );
}

/** Faux visage qui répond 200 avec un texte par défaut. */
async function withFakeFace(fn) {
  const received = [];
  const { server, baseUrl, port } = await startFakeFace((req, res) => {
    received.push(req.url);
    if (req.url.startsWith("/emotion") && req.url.includes("name=boom")) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("emotion inconnue");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`ok ${req.url}`);
  });
  try {
    // Le port éphémère ne doit jamais être 3000 (visage du propriétaire).
    expect(port).not.toBe(3000);
    await fn({ baseUrl, received });
  } finally {
    await stopFakeFace(server);
  }
}

describe("buildFaceRequest (pur)", () => {
  it("traduit set_expression vers /emotion?name=", () => {
    expect(buildFaceRequest("set_expression", { emotion: "smile" })).toEqual({
      pathname: "/emotion",
      params: { name: "smile" },
    });
  });

  it("traduit get_status vers /status", () => {
    expect(buildFaceRequest("get_status", {})).toEqual({
      pathname: "/status",
      params: {},
    });
  });

  it("traduit set_position vers /set_position avec x et y", () => {
    expect(buildFaceRequest("set_position", { x: 10, y: 20 })).toEqual({
      pathname: "/set_position",
      params: { x: 10, y: 20 },
    });
  });

  it("traduit reset vers /neutral", () => {
    expect(buildFaceRequest("reset", {})).toEqual({
      pathname: "/neutral",
      params: {},
    });
  });

  it("renvoie null pour un outil inconnu", () => {
    expect(buildFaceRequest("does_not_exist", {})).toBeNull();
  });

  it("expose exactement les 4 noms d'outils attendus", () => {
    expect([...FACE_TOOL_NAMES].sort()).toEqual(
      ["get_status", "reset", "set_expression", "set_position"].sort(),
    );
  });
});

describe("runFaceTool face à un faux visage", () => {
  it("set_expression atteint /emotion?name=smile", async () => {
    await withFakeFace(async ({ baseUrl, received }) => {
      const res = await runFaceTool("set_expression", { emotion: "smile" }, { baseUrl });
      expect(res.ok).toBe(true);
      expect(received).toHaveLength(1);
      expect(received[0]).toBe("/emotion?name=smile");
      expect(res.text).toContain("/emotion?name=smile");
    });
  });

  it("get_status atteint /status", async () => {
    await withFakeFace(async ({ baseUrl, received }) => {
      const res = await runFaceTool("get_status", {}, { baseUrl });
      expect(res.ok).toBe(true);
      expect(received[0]).toBe("/status");
    });
  });

  it("set_position atteint /set_position?x=10&y=20", async () => {
    await withFakeFace(async ({ baseUrl, received }) => {
      const res = await runFaceTool("set_position", { x: 10, y: 20 }, { baseUrl });
      expect(res.ok).toBe(true);
      expect(received[0]).toBe("/set_position?x=10&y=20");
    });
  });

  it("reset atteint /neutral", async () => {
    await withFakeFace(async ({ baseUrl, received }) => {
      const res = await runFaceTool("reset", {}, { baseUrl });
      expect(res.ok).toBe(true);
      expect(received[0]).toBe("/neutral");
    });
  });

  it("une émotion refusée (HTTP 400) donne une erreur lisible, sans exception", async () => {
    await withFakeFace(async ({ baseUrl }) => {
      const res = await runFaceTool("set_expression", { emotion: "boom" }, { baseUrl });
      expect(res.ok).toBe(false);
      expect(res.error).toContain("HTTP 400");
    });
  });

  it("un outil inconnu ne lève pas et renvoie une erreur claire", async () => {
    const res = await runFaceTool("nope", {}, {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain("inconnu");
  });
});

describe("visage éteint", () => {
  it("connexion refusée → message clair, jamais d'exception", async () => {
    // Port fermé et REFUSÉ de façon vérifiée (voir pickRefusedBaseUrl).
    const { baseUrl } = await pickRefusedBaseUrl();
    const res = await runFaceTool("get_status", {}, { baseUrl });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ne répond pas/);
  });

  it("délai dépassé → message clair", async () => {
    // Serveur qui accepte mais ne répond jamais.
    const { server, baseUrl } = await startFakeFace(() => {});
    try {
      const res = await runFaceTool("get_status", {}, { baseUrl, timeoutMs: 150 });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/délai dépassé/);
    } finally {
      await stopFakeFace(server);
    }
  });

  it("faceOffMessage mentionne l'URL et le port par défaut", () => {
    expect(faceOffMessage()).toContain(DEFAULT_FACE_API_URL);
    expect(DEFAULT_FACE_API_URL).toBe("http://127.0.0.1:3000");
  });
});

describe("callFaceApi (bas niveau)", () => {
  it("normalise la réponse (endpoint, status, ok, text)", async () => {
    await withFakeFace(async ({ baseUrl }) => {
      const res = await callFaceApi({ baseUrl, pathname: "/status" });
      expect(res.endpoint).toBe("/status");
      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
      expect(res.text).toContain("ok /status");
    });
  });
});
