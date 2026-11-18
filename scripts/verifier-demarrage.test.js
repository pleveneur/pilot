/**
 * VERROUS DU GARDE DE DÉMARRAGE — le lanceur (`scripts/verifier-demarrage.js`)
 * et la chaîne de livraison ne doivent JAMAIS conclure « c'est bon » par défaut.
 *
 * Ces tests exécutent le VRAI script :
 *   - cas « l'application ne démarre pas » : exécutable introuvable ⇒ code 2,
 *     preuve `ok: false`, et cette preuve refuse la livraison ;
 *   - cas « écran principal ouvert » : une fenêtre simulée par le protocole de
 *     débogage (aucune interface graphique en test) ⇒ code 0 et preuve `ok: true` ;
 *   - cas « resté sur l'écran de chargement » ⇒ code 2 au bout du délai borné ;
 *   - cas « écran de chargement encore affiché » ⇒ code 2 immédiat.
 *
 * Aucun test ne tolère le succès : si l'un de ces cas rendait 0, la suite
 * échoue — c'est le comportement voulu (fail-closed).
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const RACINE = path.resolve(__dirname, "..");
const SCRIPT = path.join(RACINE, "scripts", "verifier-demarrage.js");

const dossiers = [];
function dossierTemporaire() {
  const d = mkdtempSync(path.join(os.tmpdir(), "garde-demarrage-"));
  dossiers.push(d);
  return d;
}

afterEach(() => {
  while (dossiers.length) {
    const d = dossiers.pop();
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* le nettoyage ne change jamais un verdict */
    }
  }
});

/** Réponse de `Runtime.evaluate` : la page simulée rend cette observation. */
function observationSimulee({ pret, chargementAffiche, tauri = true, largeur = 1280, hauteur = 860 }) {
  return {
    url: "http://tauri.localhost/",
    etat: "complete",
    pret: pret === true,
    chargementAffiche: chargementAffiche === true,
    corpsPresent: true,
    largeur,
    hauteur,
    tauri,
  };
}

/**
 * Faux serveur du protocole de débogage : `/json/list` + une session WebSocket
 * minuscule qui répond à `Runtime.evaluate` par l'observation fournie.
 */
function fauxServeurCdp(observation) {
  const serveur = http.createServer((req, res) => {
    if (req.url && req.url.startsWith("/json/list")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify([
          {
            type: "page",
            title: "Pilot",
            url: "http://tauri.localhost/",
            webSocketDebuggerUrl: `ws://127.0.0.1:${serveur.address().port}/devtools/page/1`,
          },
        ]),
      );
      return;
    }
    res.writeHead(404);
    res.end("");
  });

  serveur.on("upgrade", (req, socket) => {
    const cle = req.headers["sec-websocket-key"];
    const accept = crypto
      .createHash("sha1")
      .update(`${cle}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on("data", (tampon) => {
      // Trame cliente (masquée) : on ne lit que le contenu texte.
      let i = 2;
      const masque = tampon[1] & 0x80;
      let longueur = tampon[1] & 0x7f;
      if (longueur === 126) {
        longueur = tampon.readUInt16BE(2);
        i = 4;
      } else if (longueur === 127) {
        longueur = Number(tampon.readBigUInt64BE(2));
        i = 10;
      }
      let decalage = 0;
      if (masque) decalage = 4;
      const donnees = tampon.subarray(i + decalage, i + decalage + longueur);
      const texte = Buffer.from(donnees.map((o, k) => o ^ tampon[i + (k % 4)])).toString("utf8");
      let message = null;
      try {
        message = JSON.parse(texte);
      } catch {
        return;
      }
      if (!message || message.method !== "Runtime.evaluate") return;
      const corps = JSON.stringify({
        id: message.id,
        result: { result: { type: "object", value: observation } },
      });
      const charge = Buffer.from(corps, "utf8");
      const entete = charge.length < 126 ? Buffer.from([0x81, charge.length]) : Buffer.concat([Buffer.from([0x81, 126]), (() => {
        const b = Buffer.alloc(2);
        b.writeUInt16BE(charge.length);
        return b;
      })()]);
      socket.write(Buffer.concat([entete, charge]));
    });
    socket.on("error", () => socket.destroy());
  });

  return new Promise((resolve) => {
    serveur.listen(0, "127.0.0.1", () => resolve(serveur));
  });
}

function lancer(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: RACINE,
      windowsHide: true,
      env: { ...process.env, ...(options.env || {}) },
    });
    let sortie = "";
    child.stdout.on("data", (d) => (sortie += d));
    child.stderr.on("data", (d) => (sortie += d));
    child.on("exit", (code) => resolve({ code, sortie }));
  });
}

function lirePreuve(chemin) {
  return JSON.parse(readFileSync(chemin, "utf8"));
}

describe("garde de démarrage : le lanceur ne rend jamais un succès par défaut", () => {
  it("refuse et écrit une preuve ratée quand l'exécutable n'existe pas", async () => {
    const dossier = dossierTemporaire();
    const preuve = path.join(dossier, "demarrage.json");
    const r = await lancer(["--exe", path.join(dossier, "absent", "pilot.exe"), "--preuve", preuve]);
    expect(r.code).toBe(2);
    expect(r.sortie).toContain("DÉCLARÉE RATÉE");
    const p = lirePreuve(preuve);
    expect(p.ok).toBe(false);
    expect(p.raison).toContain("introuvable");
    expect(p.version).toBeTruthy();
  });

  it("accepte seulement quand la fenêtre montre vraiment l'écran principal", async () => {
    const serveur = await fauxServeurCdp(observationSimulee({ pret: true, chargementAffiche: false }));
    try {
      const dossier = dossierTemporaire();
      const preuve = path.join(dossier, "demarrage.json");
      const r = await lancer([
        "--cdp",
        `http://127.0.0.1:${serveur.address().port}`,
        "--preuve",
        preuve,
        "--delai",
        "5000",
      ]);
      expect(r.code).toBe(0);
      const p = lirePreuve(preuve);
      expect(p.ok).toBe(true);
      expect(p.observation.pret).toBe(true);
    } finally {
      serveur.close();
    }
  });

  it("refuse quand la fenêtre reste sur l'écran de chargement (délai borné épuisé)", async () => {
    const serveur = await fauxServeurCdp(observationSimulee({ pret: false, chargementAffiche: true }));
    try {
      const dossier = dossierTemporaire();
      const preuve = path.join(dossier, "demarrage.json");
      const debut = Date.now();
      const r = await lancer([
        "--cdp",
        `http://127.0.0.1:${serveur.address().port}`,
        "--preuve",
        preuve,
        "--delai",
        "1500",
      ]);
      expect(r.code).toBe(2);
      expect(Date.now() - debut).toBeLessThan(20000);
      const p = lirePreuve(preuve);
      expect(p.ok).toBe(false);
      expect(p.raison).toContain("initialisation");
    } finally {
      serveur.close();
    }
  });

  it("refuse quand l'écran de chargement est encore affiché alors que l'init se dit terminée", async () => {
    const serveur = await fauxServeurCdp(observationSimulee({ pret: true, chargementAffiche: true }));
    try {
      const dossier = dossierTemporaire();
      const preuve = path.join(dossier, "demarrage.json");
      const r = await lancer([
        "--cdp",
        `http://127.0.0.1:${serveur.address().port}`,
        "--preuve",
        preuve,
        "--delai",
        "5000",
      ]);
      expect(r.code).toBe(2);
      expect(lirePreuve(preuve).raison).toContain("écran de chargement");
    } finally {
      serveur.close();
    }
  });

  it("refuse quand la fenêtre n'est pas la vraie application (API Tauri absente)", async () => {
    const serveur = await fauxServeurCdp(observationSimulee({ pret: true, chargementAffiche: false, tauri: false }));
    try {
      const dossier = dossierTemporaire();
      const preuve = path.join(dossier, "demarrage.json");
      const r = await lancer([
        "--cdp",
        `http://127.0.0.1:${serveur.address().port}`,
        "--preuve",
        preuve,
        "--delai",
        "5000",
      ]);
      expect(r.code).toBe(2);
      expect(lirePreuve(preuve).raison).toContain("API Tauri");
    } finally {
      serveur.close();
    }
  });
});
