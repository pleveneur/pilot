// Tests Vitest du cœur PUR de la passerelle du visage (face-gateway.js).
//
// On teste face à un FAUX visage : un serveur HTTP local sur un port éphémère
// (jamais le port 3000 du vrai visage). Aucun accès réseau externe.

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

/**
 * Démarre un faux visage (serveur HTTP local) et renvoie son URL de base.
 * `handler(req, res)` produit la réponse.
 */
function startFakeFace(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, port });
    });
  });
}

function stopFakeFace(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
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
    // Port fermé : on démarre puis on arrête un serveur pour obtenir un port libre.
    const { server, baseUrl } = await startFakeFace((_req, res) => res.end("x"));
    await stopFakeFace(server);
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
