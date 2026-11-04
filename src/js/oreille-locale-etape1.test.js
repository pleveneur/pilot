// oreille-locale-etape1.test.js — VERROUS de l'oreille LOCALE (étape 1 : le pont
// machine vers le service local VoiceStudio, `src-tauri/src/asr_voicestudio.rs`).
//
// Ce que ces verrous empêchent de régresser :
//   1. les six commandes sont BRANCHÉES (`invoke_handler`) et `pub async fn` :
//      aucune n'exécute son travail sur le thread principal (règle anti-gel) ;
//   2. UNE SEULE PORTE : le chemin du flux et les chemins de dictée ne sont écrits
//      que dans le module frère de `tts_voicestudio.rs`, et la fenêtre ne joint
//      JAMAIS le service de transcription elle-même (aucun `fetch`, aucune
//      adresse recopiée) ;
//   3. AUCUNE ADRESSE EN DUR dans le nouveau module : il emprunte `BASE_URL` à
//      `tts_voicestudio.rs` (jamais une deuxième constante à garder en phase) ;
//   4. aucun fichier audio écrit, aucun modèle téléchargé : le module n'importe
//      ni `std::fs` ni le téléchargeur de voix ;
//   5. le modèle français est IMPOSÉ (`MODEL_FRENCH`) et jamais celui que le
//      service a choisi tout seul (`sherpa-whisper-tiny`) ;
//   6. l'étape reste HONNÊTE : le module dit lui-même que l'écran n'est pas
//      encore branché, donc il ne revendique aucune amélioration invisible.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Découpage de source VÉRIFIÉ (l'inventaire de `source-slice.test.js` refuse un
// découpage non protégé : une ancre absente rendrait l'assertion vraie à vide).
import { neutraliserSource, sliceSource } from "./source-slice.js";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "..", "..");

/** Lit un fichier du dépôt, fins de ligne normalisées (piège CI Windows). */
function lire(relatif) {
  return fs.readFileSync(path.join(RACINE, relatif), "utf8").replace(/\r\n/g, "\n");
}

const RUST = lire("src-tauri/src/asr_voicestudio.rs");
const LIB = lire("src-tauri/src/lib.rs");
const FRERE = lire("src-tauri/src/tts_voicestudio.rs");

/** Tous les fichiers JS de l'application (hors tests). */
function fichiersApp(relatif = "src/js") {
  const racine = path.join(RACINE, relatif);
  const sortie = [];
  for (const entree of fs.readdirSync(racine, { withFileTypes: true })) {
    const chemin = path.join(racine, entree.name);
    if (entree.isDirectory()) {
      sortie.push(...fichiersApp(path.relative(RACINE, chemin).replace(/\\/g, "/")));
    } else if (entree.name.endsWith(".js") && !entree.name.endsWith(".test.js")) {
      sortie.push(path.relative(RACINE, chemin).replace(/\\/g, "/"));
    }
  }
  return sortie;
}

const COMMANDES = [
  "asr_voicestudio_status",
  "asr_voicestudio_start",
  "asr_voicestudio_send",
  "asr_voicestudio_stop",
  "asr_voicestudio_cancel",
  "asr_voicestudio_log",
];

// ---------------------------------------------------------------------------
describe("1. Les six commandes sont branchées et jamais sur le thread principal", () => {
  it("le module est déclaré dans lib.rs", () => {
    expect(LIB).toContain("mod asr_voicestudio;");
  });

  it("chaque commande est enregistrée dans invoke_handler", () => {
    const handler = sliceSource(
      LIB,
      "tauri::generate_handler![",
      "]",
      10_000,
    );
    for (const nom of COMMANDES) {
      expect(handler, `commande ${nom} non branchée`).toContain(
        `asr_voicestudio::${nom}`,
      );
    }
  });

  it("aucune commande n'est déclarée `pub fn` (thread principal)", () => {
    for (const nom of COMMANDES) {
      expect(RUST).not.toContain(`pub fn ${nom}(`);
      const corps = sliceSource(RUST, `pub async fn ${nom}(`, "\n}\n", 20);
      expect(corps, `${nom} doit être async`).not.toBe("");
    }
  });

  it("les commandes qui interrogent le service déportent leur attente", () => {
    // Sonde et ouverture de session parlent HTTP : jamais sur le thread principal.
    for (const nom of ["asr_voicestudio_status", "asr_voicestudio_start", "asr_voicestudio_log"]) {
      const corps = sliceSource(RUST, `pub async fn ${nom}(`, "\n}\n", 20);
      expect(corps, `${nom} doit déporter son travail`).toContain(
        "tauri::async_runtime::spawn_blocking",
      );
    }
  });

  it("le chemin du son ne fait AUCUN appel réseau dans la commande", () => {
    // `send` / `stop` / `cancel` ne poussent qu'un message dans la session : si
    // l'un d'eux se met à parler au service, la fenêtre attend un aller-retour
    // HTTP à chaque morceau de son.
    for (const nom of ["asr_voicestudio_send", "asr_voicestudio_stop", "asr_voicestudio_cancel"]) {
      const corps = sliceSource(RUST, `pub async fn ${nom}(`, "\n}\n", 20);
      expect(corps, `${nom} ne doit pas joindre le service`).not.toContain("reqwest");
      expect(corps, `${nom} ne doit pas joindre le service`).not.toContain("connect_async");
      expect(corps, `${nom} ne doit pas bloquer`).not.toContain("std::thread::sleep");
    }
  });
});

// ---------------------------------------------------------------------------
describe("2. Une seule porte vers le service, côté machine", () => {
  it("le chemin du flux n'est écrit QUE dans le module de l'oreille locale", () => {
    const fichiers = fs
      .readdirSync(path.join(RACINE, "src-tauri/src"))
      .filter((nom) => nom.endsWith(".rs"));
    const porteurs = fichiers.filter((nom) =>
      lire(`src-tauri/src/${nom}`).includes("/v1/audio/transcriptions/stream"),
    );
    expect(porteurs).toEqual(["asr_voicestudio.rs"]);
  });

  it("la fenêtre ne joint JAMAIS le service (aucun fetch, aucun chemin recopié)", () => {
    // Les CHEMINS de la dictée n'ont aucune raison d'exister côté fenêtre, même
    // en commentaire : ils ne sont écrits qu'à un seul endroit, côté machine.
    const chemins = [
      "/v1/audio/transcriptions",
      "/dictation/models",
      "/dictation/readiness",
    ];
    for (const fichier of fichiersApp()) {
      const source = lire(fichier);
      for (const chemin of chemins) {
        expect(source, `${fichier} joint le service lui-même (${chemin})`).not.toContain(
          chemin,
        );
      }
    }
    // L'ADRESSE, elle, peut être CITÉE en commentaire (la voix imitée explique
    // qu'elle est sur la boucle locale) : on ne juge que le code réel, et sur
    // l'adresse PORTÉE du service (`hôte:port`), pas sur le mot « localhost »
    // employé ailleurs par le mode distant.
    for (const fichier of fichiersApp()) {
      const code = neutraliserSource(lire(fichier));
      expect(code, `${fichier} code l'adresse du service`).not.toContain("127.0.0.1:3900");
      expect(code, `${fichier} code l'adresse du service`).not.toContain("localhost:3900");
    }
  });

  it("aucune adresse en dur : le module emprunte celle du frère", () => {
    // Le module peut la NOMMER en commentaire (« boucle locale ») ; ce qui est
    // interdit, c'est de l'écrire dans du code, donc de créer une deuxième
    // constante à tenir en phase avec celle du frère.
    const code = neutraliserSource(RUST);
    expect(code).not.toContain("127.0.0.1");
    expect(code).not.toContain("localhost");
    expect(code).not.toContain("http://");
    // L'adresse n'existe qu'une fois dans le code Rust : chez le frère.
    expect(RUST).toContain("use crate::tts_voicestudio::{BASE_URL");
    // Le frère garde la sienne : une seule source pour l'adresse.
    expect(FRERE).toContain('pub const BASE_URL: &str = "http://127.0.0.1:3900"');
  });

  it("le frère n'a pas été détourné : la voix imitée reste intacte", () => {
    // La mission INTERDIT de modifier `tts_voicestudio.rs` : ses trois commandes
    // et son adresse doivent rester exactement là.
    for (const nom of [
      "tts_voicestudio_status",
      "tts_voicestudio_synthesize",
      "tts_voicestudio_warmup",
    ]) {
      expect(FRERE).toContain(`pub async fn ${nom}(`);
    }
    expect(FRERE).not.toContain("dictation");
  });
});

// ---------------------------------------------------------------------------
describe("3. Rien n'est écrit sur le disque, rien n'est téléchargé", () => {
  it("aucune écriture de fichier audio, aucun dossier créé", () => {
    expect(RUST).not.toContain("std::fs");
    expect(RUST).not.toContain("File::create");
    expect(RUST).not.toContain("fs::write");
    expect(RUST).not.toContain("create_dir");
    // Le seul accès disque est le journal TEXTE du frère, via son helper.
    expect(RUST).toContain("append_log");
  });

  it("aucun téléchargement de modèle n'est déclenché", () => {
    expect(RUST).not.toContain("tts_local_download");
    expect(RUST).not.toContain("download(");
    expect(RUST).not.toContain("reqwest::get");
  });

  it("aucun secret, aucune clé, aucun en-tête d'autorisation", () => {
    expect(RUST.toLowerCase()).not.toContain("api_key");
    expect(RUST).not.toContain("Authorization");
  });
});

// ---------------------------------------------------------------------------
describe("4. Le modèle français est imposé, jamais celui du service", () => {
  it("le modèle par défaut est un modèle européen installé, pas le plus petit", () => {
    expect(RUST).toContain('pub const MODEL_FRENCH: &str = "sherpa-parakeet-tdt-v3"');
    // Le service, lui, a `sherpa-whisper-tiny` par défaut : on ne le suit pas.
    expect(RUST).not.toContain('pub const MODEL_FRENCH: &str = "sherpa-whisper-tiny"');
  });

  it("le modèle part dans l'adresse de la session (sinon le service choisit)", () => {
    const url = sliceSource(RUST, "pub fn stream_url_at(", "\n}\n", 100);
    expect(url).toContain("model=");
    expect(url).toContain("pcm=1");
    expect(url).toContain("sr=");
  });

  it("un modèle non installé est refusé, jamais téléchargé", () => {
    const choix = sliceSource(RUST, "pub fn pick_candidates(", "\n}\n", 120);
    expect(choix).toContain("installed");
    expect(choix).toContain("n'est pas installé");
    // Un modèle dont la licence n'est pas acceptée ne part pas non plus en
    // silence : la raison le nomme (aucune licence n'est acceptée par Pilot).
    expect(RUST).toContain("pub fn licence_state");
    expect(RUST).toContain("pub fn licence_sentence");
    expect(RUST).toContain("Pilot n'accepte");
  });
});

// ---------------------------------------------------------------------------
describe("5. L'étape reste honnête et lisible", () => {
  it("le module dit que l'écran n'est pas encore branché", () => {
    expect(RUST).toContain("ÉTAPE 1 = pont machine");
    expect(RUST).toContain("n'est PAS encore branché");
  });

  it("les pannes sont dites en français, jamais par un code brut", () => {
    // Une phrase par panne, et le code stable à part pour l'application.
    expect(RUST).toContain("pub fn down_hint");
    expect(RUST).toContain("pub fn human_error");
    expect(RUST).toContain("REASON_ABSENT");
    expect(RUST).toContain("REASON_MUTE");
    expect(RUST).toContain("REASON_NO_FRENCH_MODEL");
    expect(RUST).toContain("REASON_NOT_READY");
    // Aucune panne ne peut lever : la sonde est construite sans `?` ni `unwrap`
    // sur le réseau (les erreurs deviennent des états).
    const sonde = sliceSource(RUST, "pub fn probe_base(", "\n}\n", 120);
    expect(sonde).not.toContain(".unwrap()");
    expect(sonde).not.toContain("panic!");
  });

  it("le texte arrive par un évènement au nom stable", () => {
    expect(RUST).toContain('pub const EVENT_TRANSCRIPT: &str = "asr-voicestudio-transcript"');
    expect(RUST).toContain('"partial"');
    expect(RUST).toContain('"final"');
    expect(RUST).toContain('"summary"');
  });
});
