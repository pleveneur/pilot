#!/usr/bin/env node
// verifier-demarrage.js — LE LANCEUR du garde de démarrage (tâche 424).
//
// Ce script fait UNE chose : il lance l'application Pilot POUR DE VRAI, regarde
// sa fenêtre par le protocole de débogage, et écrit une PREUVE de démarrage sur
// disque. Les décisions (écran ouvert ? preuve utilisable ?) vivent dans
// `src/js/garde-demarrage.js` — rien n'est recopié ici.
//
// FAIL-CLOSED : si l'application ne démarre pas, si l'écran principal ne
// s'ouvre pas dans le délai borné, ou si le contrôle ne PEUT pas s'exécuter
// (exécutable absent, Pilot déjà ouvert, plateforme sans protocole de
// débogage), la preuve est écrite avec `ok: false` et le script sort en erreur
// (code 2) en annonçant que la mission est DÉCLARÉE RATÉE. Aucun « c'est bon »
// par défaut.
//
// Usage :
//   node scripts/verifier-demarrage.js [options]
//     --exe <chemin>     exécutable à lancer (défaut : cible release du dépôt)
//     --version <v>      version concernée (défaut : package.json, vérifié
//                        contre src-tauri/tauri.conf.json)
//     --preuve <chemin>  fichier de preuve (défaut : release-notes/demarrage-v<version>.json)
//     --delai <ms>       délai borné (défaut : GARDE_DEMARRAGE_DELAI_MS)
//     --cdp <url>        observe une fenêtre déjà joignable (tests, dépannage) :
//                        aucun lancement, aucune vérification d'instance
//     --json             imprime la preuve sur la sortie standard
//     --silence          n'imprime que les erreurs
//
// Voir docs/rapports/RAPPORT-garde-demarrage-424.md.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GARDE_DEMARRAGE_DELAI_MS,
  GARDE_DEMARRAGE_PREUVE_ENV,
  GARDE_DEMARRAGE_SONDE_MS,
  OBSERVATION_EXPRESSION,
  cheminPreuveDemarrage,
  decideDemarrage,
  phraseEchecDemarrage,
  phraseSuccesDemarrage,
  preuveDeDemarrage,
} from "../src/js/garde-demarrage.js";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Code de sortie d'un contrôle raté (même valeur que les refus de publication). */
export const EXIT_DEMARRAGE_REFUSE = 2;

// ── Arguments ───────────────────────────────────────────────────────────────

function lireArguments(argv) {
  const opts = {
    exe: "",
    version: "",
    preuve: "",
    delai: GARDE_DEMARRAGE_DELAI_MS,
    cdp: "",
    json: false,
    silence: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const suivant = () => {
      i += 1;
      return argv[i] == null ? "" : String(argv[i]);
    };
    if (a === "--exe") opts.exe = suivant();
    else if (a === "--version") opts.version = suivant();
    else if (a === "--preuve") opts.preuve = suivant();
    else if (a === "--delai") opts.delai = Number(suivant()) || GARDE_DEMARRAGE_DELAI_MS;
    else if (a === "--cdp") opts.cdp = suivant();
    else if (a === "--json") opts.json = true;
    else if (a === "--silence") opts.silence = true;
  }
  return opts;
}

function lireJson(chemin) {
  try {
    return JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    return null;
  }
}

/** Version de la version livrée : package.json, vérifiée contre tauri.conf.json. */
function versionDuDepot() {
  const pkg = lireJson(path.join(RACINE, "package.json"));
  const conf = lireJson(path.join(RACINE, "src-tauri", "tauri.conf.json"));
  const vPkg = pkg && typeof pkg.version === "string" ? pkg.version.trim() : "";
  const vConf = conf && typeof conf.version === "string" ? conf.version.trim() : "";
  if (vPkg && vConf && vPkg !== vConf) {
    return {
      version: "",
      raison: `versions incohérentes dans le dépôt : package.json ${vPkg} ≠ tauri.conf.json ${vConf}`,
    };
  }
  return { version: vPkg || vConf, raison: "" };
}

/** Exécutable construit par défaut, selon la plateforme. */
function exeParDefaut() {
  if (process.platform === "win32") {
    return path.join(RACINE, "src-tauri", "target", "release", "pilot.exe");
  }
  if (process.platform === "darwin") {
    return path.join(RACINE, "src-tauri", "target", "release", "bundle", "macos", "Pilot.app", "Contents", "MacOS", "Pilot");
  }
  return path.join(RACINE, "src-tauri", "target", "release", "pilot");
}

// ── Utilitaires système ─────────────────────────────────────────────────────

/** Un port libre sur la boucle locale (le protocole de débogage en exige un). */
function portLibre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address() && srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

/**
 * Une instance de Pilot tourne-t-elle déjà ? Deux instances du MÊME identifiant
 * ne peuvent pas coexister (plugin « single instance ») : la seconde sortirait
 * aussitôt, et le contrôle observerait la fenêtre de l'ancienne — un faux
 * positif. On refuse donc franchement.
 * @returns {string} le nom du processus trouvé, ou "" si aucun
 */
function instanceDejaOuverte() {
  if (process.platform !== "win32") return "";
  const r = spawnSync("tasklist", ["/FO", "CSV", "/NH"], {
    windowsHide: true,
    encoding: "utf8",
  });
  const sortie = String((r && r.stdout) || "");
  for (const ligne of sortie.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(ligne);
    if (!m) continue;
    if (/^pilot(\.exe)?$/i.test(m[1].trim())) return m[1].trim();
  }
  return "";
}

/** Tue l'arbre du processus lancé (Windows) puis, à défaut, le processus seul. */
function arreter(child) {
  try {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    }
    child.kill();
  } catch {
    /* l'arrêt ne change jamais le verdict */
  }
}

// ── Protocole de débogage (CDP) ─────────────────────────────────────────────

function httpJson(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let fini = false;
    const done = (v) => {
      if (fini) return;
      fini = true;
      resolve(v);
    };
    const req = http.get(url, (res) => {
      let corps = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (corps += c));
      res.on("end", () => {
        try {
          done(JSON.parse(corps));
        } catch {
          done(null);
        }
      });
    });
    req.on("error", () => done(null));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      done(null);
    });
  });
}

/** Cible de page joignable dans la fenêtre qui vient de s'ouvrir, ou null. */
async function cibleDeLaPage(base) {
  const listes = await httpJson(`${base}/json/list`);
  if (!Array.isArray(listes)) return null;
  return listes.find((t) => t && t.type === "page" && t.webSocketDebuggerUrl) || null;
}

/** Évalue `expression` dans la page et rend sa valeur (ou {erreur}). */
function evaluerDansLaPage(wsUrl, expression, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let ws;
    let fini = false;
    const done = (v) => {
      if (fini) return;
      fini = true;
      try {
        if (ws && ws.readyState === 1) ws.close();
      } catch {
        /* rien */
      }
      resolve(v);
    };
    const minuteur = setTimeout(() => done({ erreur: "la fenêtre n'a pas répondu à temps" }), timeoutMs);
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      clearTimeout(minuteur);
      return done({ erreur: `protocole de débogage indisponible (${err && err.message ? err.message : err})` });
    }
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: false },
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      let msg = null;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (!msg || msg.id !== 1) return;
      clearTimeout(minuteur);
      if (msg.error) return done({ erreur: String(msg.error.message || msg.error) });
      const res = msg.result || {};
      if (res.exceptionDetails) {
        const det = res.exceptionDetails;
        return done({ erreur: String((det.exception && det.exception.description) || det.text || "erreur dans la page") });
      }
      return done(res.result ? res.result.value : null);
    });
    ws.addEventListener("error", () => {
      clearTimeout(minuteur);
      done({ erreur: "la fenêtre a fermé son protocole de débogage" });
    });
    ws.addEventListener("close", () => {
      clearTimeout(minuteur);
      done({ erreur: "la fenêtre s'est fermée pendant l'observation" });
    });
  });
}

// ── Attente bornée ──────────────────────────────────────────────────────────

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Observe la fenêtre jusqu'au délai borné. Rend l'observation retenue pour la
 * décision et la raison d'un arrêt anticipé éventuel.
 */
async function observerJusquAuVerdict({ base, urlPage, delai, dejaSorti }) {
  const debut = Date.now();
  let derniere = null;
  let cible = urlPage;
  while (Date.now() - debut < delai) {
    const sorti = dejaSorti();
    if (sorti) {
      return {
        observation: derniere,
        dureeMs: Date.now() - debut,
        arret: `l'application s'est arrêtée avant d'afficher son écran (${sorti})`,
      };
    }
    if (!cible) {
      const t = await cibleDeLaPage(base);
      if (t) cible = t.webSocketDebuggerUrl;
    }
    if (cible) {
      const obs = await evaluerDansLaPage(cible, OBSERVATION_EXPRESSION);
      derniere = obs && typeof obs === "object" ? obs : null;
      const verdict = decideDemarrage(derniere);
      if (verdict.ok) {
        return { observation: derniere, dureeMs: Date.now() - debut, arret: "" };
      }
      if (!verdict.enCours) {
        return { observation: derniere, dureeMs: Date.now() - debut, arret: verdict.raison };
      }
    }
    await dormir(GARDE_DEMARRAGE_SONDE_MS);
  }
  const verdict = decideDemarrage(derniere);
  return {
    observation: derniere,
    dureeMs: Date.now() - debut,
    arret: raisonDuDelai(verdict),
  };
}

function raisonDuDelai(verdict) {
  if (verdict && verdict.ok) return "";
  const raison = verdict && verdict.raison ? verdict.raison : "aucune observation de la fenêtre n'a pu être lue";
  return raison;
}

// ── Programme ───────────────────────────────────────────────────────────────

function ecrirePreuve(chemin, preuve) {
  const dossier = path.dirname(chemin);
  mkdirSync(dossier, { recursive: true });
  writeFileSync(chemin, `${JSON.stringify(preuve, null, 2)}\n`, "utf8");
}

async function main(argv) {
  const opts = lireArguments(argv);
  const info = opts.version ? { version: opts.version.trim(), raison: "" } : versionDuDepot();
  const version = info.version;
  const cheminPreuve = path.resolve(
    process.env[GARDE_DEMARRAGE_PREUVE_ENV] || opts.preuve || cheminPreuveDemarrage(version),
  );

  const conclure = (ok, raison, extra = {}) => {
    const preuve = preuveDeDemarrage({
      ok,
      raison,
      version,
      exe: opts.cdp ? "" : extra.exe || "",
      dureeMs: extra.dureeMs,
      delaiMs: opts.delai,
      observation: extra.observation === undefined ? null : extra.observation,
    });
    ecrirePreuve(cheminPreuve, preuve);
    const phrase = ok
      ? phraseSuccesDemarrage({ dureeMs: extra.dureeMs, version, exe: preuve.exe })
      : phraseEchecDemarrage({ raison, dureeMs: extra.dureeMs });
    if (!opts.silence) {
      console.log(phrase);
      console.log(`Preuve écrite : ${cheminPreuve}`);
    }
    if (opts.json) console.log(JSON.stringify(preuve, null, 2));
    return ok ? 0 : EXIT_DEMARRAGE_REFUSE;
  };

  // 1. La version doit être connue : une preuve sans version ne sert à rien.
  if (info.raison) return conclure(false, info.raison);
  if (!version) return conclure(false, "la version de l'application n'a pas pu être lue (package.json / tauri.conf.json)");

  // 2. Mode « fenêtre déjà joignable » (tests, dépannage) : aucun lancement.
  if (opts.cdp) {
    const base = opts.cdp.replace(/\/+$/, "");
    const r = await observerJusquAuVerdict({
      base,
      urlPage: "",
      delai: opts.delai,
      dejaSorti: () => "",
    });
    return conclure(r.arret === "", r.arret || "l'écran principal est ouvert", {
      dureeMs: r.dureeMs,
      observation: r.observation,
    });
  }

  // 3. L'exécutable doit exister : sinon rien n'a été lancé. Checked BEFORE the
  // platform so the refusal names the actionable cause on every OS (CI runs on Linux).
  const exe = path.resolve(opts.exe || exeParDefaut());
  if (!existsSync(exe)) {
    return conclure(false, `l'exécutable à lancer est introuvable (« ${exe} ») : construisez l'application puis relancez`, {
      exe,
    });
  }

  // 4. Une plateforme sans protocole de débogage exploitable : on REFUSE.
  if (process.platform !== "win32") {
    return conclure(
      false,
      `le contrôle ne peut pas s'exécuter sur cette plateforme (${process.platform}) : ` +
        "le protocole de débogage de la fenêtre n'est pas joignable en automatique. " +
        "La livraison est refusée faute de preuve, jamais réputée bonne",
      { exe },
    );
  }

  // 5. Une seule instance : sinon on observerait la fenêtre d'une autre.
  const deja = instanceDejaOuverte();
  if (deja) {
    return conclure(
      false,
      `Pilot est déjà ouvert (processus « ${deja} ») : une seconde instance se refermerait aussitôt et le contrôle observerait l'ancienne fenêtre — fermez Pilot puis relancez le contrôle`,
      { exe },
    );
  }

  // 6. Lancement réel, puis observation bornée de la fenêtre.
  const port = await portLibre();
  const debut = Date.now();
  const child = spawn(exe, [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      // WebView2 n'ouvre son protocole de débogage que sur demande explicite.
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
  });
  let codeSortie = null;
  child.on("exit", (code, signal) => {
    codeSortie = signal ? `signal ${signal}` : `code ${code}`;
  });
  child.on("error", (err) => {
    codeSortie = `lancement impossible (${err && err.message ? err.message : err})`;
  });

  let resultat;
  try {
    resultat = await observerJusquAuVerdict({
      base: `http://127.0.0.1:${port}`,
      urlPage: "",
      delai: opts.delai,
      dejaSorti: () => (child.exitCode !== null || codeSortie ? codeSortie || `code ${child.exitCode}` : ""),
    });
  } finally {
    arreter(child);
  }

  return conclure(resultat.arret === "", resultat.arret || "l'écran principal est ouvert", {
    exe,
    dureeMs: Date.now() - debut,
    observation: resultat.observation,
  });
}

const estExecuteDirectement =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (estExecuteDirectement) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      // Même une panne du script n'est jamais un succès.
      console.error(phraseEchecDemarrage({ raison: `le contrôle s'est interrompu (${err && err.message ? err.message : err})` }));
      process.exit(EXIT_DEMARRAGE_REFUSE);
    });
}

export { main, lireArguments, exeParDefaut, versionDuDepot, observerJusquAuVerdict };
