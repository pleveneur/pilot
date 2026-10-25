// Tests — GARDE D'ÉCRITURE TENUE PAR LE SOCLE (mode réseau multi-postes,
// étape 5). Fichier de preuve nommé par la demande :
//   npx vitest run src/js/gds-garde-ecriture.test.js
//
// Ce fichier prouve, sans base ni serveur, ce que l'œil ne peut pas voir :
//  1. les commandes qui ÉCRIVENT consultent la garde du socle (si la garde
//     devenait purement visuelle — un simple refus à l'écran — ces tests
//     ÉCHOUENT) ;
//  2. le lancement d'un agent est gardé de la même façon ;
//  3. la commande de libération forcée EXISTE et est ENREGISTRÉE dans la liste
//     des commandes de l'application (un oubli d'enregistrement est un échec
//     SILENCIEUX : le bouton ne ferait rien) ;
//  4. la libération forcée passe par la session d'ADMINISTRATION du socle, avec
//     un motif obligatoire et une trace nommée ;
//  5. la règle cardinale : une panne réseau ne bloque JAMAIS le travail local
//     (fail-open), et l'écran envoie bien la commande au lieu de faire semblant.
//
// Les fragments de source sont découpés par `sliceSource` (découpage VÉRIFIÉ :
// une ancre qui bouge fait ÉCHOUER le test au lieu de le rendre vrai par
// construction), et les fins de ligne sont normalisées (piège CI Windows).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { sliceSource } from "./source-slice.js";
import { buildProjectReleaseArgs, handoverReleaseTraceLine } from "./gds-admin.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_TAURI = join(HERE, "..", "..", "src-tauri", "src");

/** Lit un source Rust, fins de ligne normalisées. */
function rustSource(name) {
  return readFileSync(join(SRC_TAURI, name), "utf8").replace(/\r\n/g, "\n");
}

/** Lit un source JS, fins de ligne normalisées. */
function jsSource(name) {
  return readFileSync(join(HERE, name), "utf8").replace(/\r\n/g, "\n");
}

describe("gestes qui écrivent — la garde est dans le SOCLE, pas à l'écran", () => {
  const files = rustSource("files.rs");
  const lib = rustSource("lib.rs");

  it("MORSURE : écrire un fichier texte passe par la garde du socle, AVANT d'écrire", () => {
    const body = sliceSource(
      files,
      "pub async fn write_file_content",
      "pub const CONTEXT_HANDOFF_STALENESS_WARNING",
      200
    );
    expect(body).toContain("gds_write_guard::ensure_path_writable");
    // La garde est consultée AVANT l'écriture : sinon elle ne garde rien.
    expect(body.indexOf("ensure_path_writable")).toBeLessThan(body.indexOf("fs::write"));
  });

  it("MORSURE : écrire un fichier binaire passe par la garde du socle", () => {
    const body = sliceSource(
      files,
      "pub async fn write_file_binary",
      "/// Lit la liste des commandes du projet",
      200
    );
    expect(body).toContain("gds_write_guard::ensure_path_writable");
  });

  it("MORSURE : créer, supprimer, renommer, coller une image sont gardés", () => {
    const gardes = [
      ["async fn create_folder(state", "async fn delete_file_or_dir", "ensure_path_writable"],
      ["async fn delete_file_or_dir(state", "async fn create_file(state", "ensure_path_writable"],
      ["async fn create_file(state", "/// Nom affiche par le systeme", "ensure_path_writable"],
      ["async fn rename_file_or_dir(", "fn rename_dir_fallback(", "ensure_path_writable"],
      ["async fn copy_image_to_project(", "fn unique_image_name(", "ensure_project_writable"],
    ];
    for (const [debut, fin, garde] of gardes) {
      const body = sliceSource(lib, debut, fin, 100);
      expect(body, `${debut} n'appelle pas ${garde}`).toContain(`gds_write_guard::${garde}`);
    }
  });

  it("MORSURE : lancer un agent du projet est gardé (les deux chemins de lancement)", () => {
    const agents = rustSource("agents.rs");
    const rpc = rustSource("rpc.rs");
    const bus = sliceSource(
      agents,
      "pub async fn start_agent_process",
      "// ── AGENT JETABLE",
      300
    );
    expect(bus).toContain("gds_write_guard::ensure_project_writable");
    const session = sliceSource(
      rpc,
      "pub async fn start_agent_session",
      "/// Multi-projets (spec_multiprojects.md §3)",
      300
    );
    expect(session).toContain("gds_write_guard::ensure_project_writable");
  });

  it("la garde elle-même est un module du socle, déclaré dans lib.rs", () => {
    expect(lib).toContain("mod gds_write_guard;");
    const garde = rustSource("gds_write_guard.rs");
    // Une seule décision, pure et partagée.
    expect(garde).toContain("pub(crate) fn decide(");
    // RÈGLE CARDINALE : une panne ne refuse jamais.
    expect(garde).toContain("Probe::Panne => return GuardDecision::Allow");
    // Un refus n'existe que si le serveur a répondu qu'un AUTRE poste tient le projet.
    expect(garde).toContain("!holder_expired(state)");
  });
});

describe("libération forcée — la commande existe ET est enregistrée", () => {
  const lib = rustSource("lib.rs");
  const admin = rustSource("gds_admin.rs");

  it("MORSURE : la commande est dans la liste des commandes de l'application", () => {
    // Un oubli d'enregistrement ne provoque AUCUNE erreur de compilation : le
    // bouton ne ferait simplement rien. C'est ce test qui l'empêche.
    const handlers = sliceSource(
      lib,
      "tauri::generate_handler![",
      "        ])",
      2000
    );
    expect(handlers).toContain("gds_admin::gds_handover_force");
    // Et elle n'y est qu'une fois.
    expect(handlers.split("gds_admin::gds_handover_force").length - 1).toBe(1);
  });

  it("la commande est async et passe par la session d'administration", () => {
    const body = sliceSource(
      admin,
      "pub async fn gds_handover_force",
      "// L4.5 — Espace utilisé + journal + clés SSH",
      400
    );
    expect(body).toContain("blocking_admin");
    // Session d'administration : le rôle est contrôlé par le serveur, un compte
    // `dev` est refusé (refus lisible, jamais un plantage).
    expect(body).toContain("admin_action(");
    // La route est celle du socle, jamais recopiée à la main.
    expect(body).toContain("crate::gds_handover::FORCE_PATH");
    // Un refus n'est jamais une panne : toute erreur attendue rend `ok: false`.
    expect(body).toContain('"ok": false');
  });

  it("le motif est contrôlé AVANT l'appel et la tentative est TRACÉE", () => {
    const body = sliceSource(
      admin,
      "pub async fn gds_handover_force",
      "// L4.5 — Espace utilisé + journal + clés SSH",
      400
    );
    const iPayload = body.indexOf("force_payload(");
    const iAction = body.indexOf("admin_action(");
    expect(iPayload).toBeGreaterThan(-1);
    expect(iPayload).toBeLessThan(iAction);
    // Trace nommée : poste, projet, compte, motif, résultat.
    expect(body).toContain("force_trace_line(");
    expect(body).toContain("trace_force_release(");
    // La ligne est rendue à l'écran même si le repère local n'a pas pu s'écrire.
    expect(body).toContain('"trace"');
  });

  it("la route de libération forcée reste celle du socle, motif obligatoire", () => {
    const handover = rustSource("gds_handover.rs");
    expect(handover).toContain(
      'pub(crate) const FORCE_PATH: &str = "/api/gds/handover/force"'
    );
    const payload = sliceSource(
      handover,
      "pub(crate) fn force_payload",
      "/// Clé du repère local de la libération forcée",
      200
    );
    expect(payload).toContain("reason.trim().is_empty()");
    expect(payload).not.toContain("unwrap()");
  });
});

describe("écran de libération — la commande est réellement envoyée", () => {
  const src = jsSource("gds-admin.js");
  const branche = () =>
    sliceSource(src, 'if (action === "release-confirm")', "// ── L4.5", 1200);

  it("MORSURE : le bouton « Libérer » n'affiche plus une trace sans rien faire", () => {
    const body = branche();
    expect(body).toContain('"gds_handover_force"');
    expect(body).toContain("await invokeAccounts(");
    // Plus aucun aveu « pas encore installée » : le geste existe vraiment.
    expect(src).not.toContain("n'est pas encore");
  });

  it("les gardes d'écran sont conservées (administrateur + motif obligatoire)", () => {
    const body = branche();
    expect(body).toContain("canReleaseProject(service.role)");
    expect(body).toContain("handoverReleaseReasonError(motif)");
    // Le motif est relu AVANT la commande.
    expect(body.indexOf("handoverReleaseReasonError(motif)")).toBeLessThan(
      body.indexOf('"gds_handover_force"')
    );
  });

  it("la charge utile envoyée est celle attendue par la commande", () => {
    expect(
      buildProjectReleaseArgs({ host: "srv", httpPort: "8443", email: "a@b.c" }, 7, "  panne  ")
    ).toEqual({
      host: "srv",
      httpPort: "8443",
      email: "a@b.c",
      password: "",
      projectId: 7,
      reason: "panne",
    });
  });

  it("un refus est dit avec la raison du serveur, sans mensonge", () => {
    const texte = handoverReleaseTraceLine({
      name: "Pilot",
      reason: "poste en panne",
      admin: "admin@exemple.com",
      applied: false,
      error: "Rôle administrateur requis",
    });
    expect(texte).toContain("Rien n'a été libéré");
    expect(texte).toContain("Rôle administrateur requis");
    expect(texte).not.toContain("n'est pas encore");
  });
});
