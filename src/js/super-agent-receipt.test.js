// super-agent-receipt.test.js — le compte rendu de fin de mission laisse une
// trace VISIBLE, et une remise non accusée n'est jamais réputée livrée.
//
// Défaut d'origine (diagnostic `RAPPORT-diag-restitution-perdue.md`, 2026-10-26,
// mission #3) : un compte rendu était écrit en base, remis à l'Assistant, LU et
// exploité — mais RIEN ne l'affichait. La seule surface était le texte libre du
// modèle, et un tour d'outils peut se terminer sans un mot. Le propriétaire ne
// pouvait donc ni constater l'arrivée d'un compte rendu, ni en lire le contenu.
//
// Ces tests MORDENT : ils échouent si la bulle disparaît, et si un compte rendu
// non accusé est compté comme livré.

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sliceFrom, sliceSource } from "./source-slice.js";
import {
  REPORT_RECEIPT_FOLD_MAX,
  buildReportReceipt,
  deliverReportReceipt,
  formatReportSize,
  parseReportMission,
  receiptStatusLabel,
  shouldShowReportReceipt,
} from "./super-agent-receipt.js";

// Compte rendu RÉEL tel qu'il est remis (extrait du rapport de diagnostic : la
// ligne 2489 de `session_summaries`, 2 624 caractères, mission #3).
const REPORT = [
  "[mission #3 · agents : concepteur-ui]",
  "## Résultat",
  "Le bandeau a été corrigé, la colonne de droite réorganisée.",
  "".padEnd(1),
  "## Vérifications",
  "- npm test : 3 226 tests passés.",
].join("\n");

const root = path.resolve(process.cwd());

/** Lit un fichier source et normalise les fins de ligne (worktree CRLF). */
function readSource(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");
}

describe("reçu d'un compte rendu remis — la bulle ne peut pas disparaître", () => {
  it("nomme la mission, les agents, le projet, la taille et le statut", () => {
    const receipt = buildReportReceipt({
      summary: REPORT,
      projectPath: "G:\\IA_PL\\pilot",
      projectName: "pilot",
      status: "delivered",
      detail: "accusé : started",
      category: "runagents",
    });
    expect(receipt).not.toBeNull();
    expect(receipt.title).toContain("mission #3");
    expect(receipt.title).toContain("concepteur-ui");
    expect(receipt.meta).toContain("pilot");
    expect(receipt.meta).toContain(formatReportSize(RECEIPT_BODY()));
    expect(receipt.meta).toContain("livré");
    // Le texte reçu est là (replié), et l'étiquette de mission déjà dite dans le
    // titre n'est pas répétée dans le corps.
    expect(receipt.body).toContain("Le bandeau a été corrigé");
    expect(receipt.body).not.toContain("[mission #3");
    expect(receipt.truncated).toBe(false);
    expect(receipt.chars).toBe(RECEIPT_BODY().length);
  });

  it("produit une bulle pour LES TROIS statuts et la confie toujours à l'affichage", () => {
    // LE test de l'invariant : quoi qu'il arrive au transport, le reçu existe et
    // il est APPELÉ. Si l'appel disparaît, ce test échoue.
    for (const status of ["delivered", "queued", "error"]) {
      const append = vi.fn();
      const receipt = deliverReportReceipt(
        { summary: REPORT, projectPath: "/p/pilot", category: "runagents" },
        { status, detail: status === "error" ? "refus du moteur" : "ok" },
        { projectName: "pilot", append },
      );
      expect(receipt, `statut ${status} : aucune bulle produite`).not.toBeNull();
      expect(append, `statut ${status} : bulle non confiée à l'affichage`).toHaveBeenCalledTimes(1);
      expect(append.mock.calls[0][0].title).toContain("mission #3");
      expect(append.mock.calls[0][0].meta).toContain(
        status === "delivered" ? "livré" : status === "queued" ? "en attente" : "NON remis",
      );
    }
  });

  it("dit la VÉRITÉ sur le statut : une remise non accusée n'est pas « livrée »", () => {
    const refused = buildReportReceipt({
      summary: REPORT,
      projectPath: "/p/pilot",
      projectName: "pilot",
      status: "error",
      detail: "aucun accusé de remise lisible",
      category: "runagents",
    });
    expect(refused.meta).toContain("NON remis");
    expect(refused.meta).toContain("sera réessayé");
    expect(refused.meta).not.toContain("statut : livré");
    // Un statut absent n'est JAMAIS présenté comme un succès.
    const unknown = buildReportReceipt({ summary: REPORT, status: undefined, category: "session" });
    expect(unknown.meta).not.toContain("livré");
    expect(unknown.meta).toContain("illisible");
    expect(receiptStatusLabel("delivered")).toBe("livré");
    expect(receiptStatusLabel("queued")).toContain("en attente");
    expect(receiptStatusLabel("error")).toContain("NON remis");
  });

  it("replie le texte reçu et annonce honnêtement ce qui n'est pas montré", () => {
    const long = `[mission #7 · agents : codeur]\n${"a".repeat(REPORT_RECEIPT_FOLD_MAX + 500)}`;
    const receipt = buildReportReceipt({ summary: long, status: "delivered", category: "runagents" });
    expect(receipt.truncated).toBe(true);
    expect(receipt.shown.length).toBeLessThanOrEqual(REPORT_RECEIPT_FOLD_MAX + 1);
    expect(receipt.shown.endsWith("…")).toBe(true);
    expect(receipt.chars).toBeGreaterThan(REPORT_RECEIPT_FOLD_MAX);
    expect(receipt.mission.id).toBe(7);
  });

  it("n'invente aucune identité de mission", () => {
    expect(parseReportMission("compte rendu sans étiquette")).toEqual({ id: null, agentIds: [] });
    const receipt = buildReportReceipt({ summary: "compte rendu sans étiquette", status: "delivered" });
    expect(receipt.title).toBe("📥 Compte rendu reçu");
    expect(receipt.title).not.toContain("#");
  });

  it("lit aussi l'ancienne étiquette (tiret cadratin) et plusieurs agents", () => {
    expect(parseReportMission("[mission #12 — agents : codeur, reviewer]")).toEqual({
      id: 12,
      agentIds: ["codeur", "reviewer"],
    });
  });

  it("n'affiche pas de reçu pour un message du propriétaire (Telegram)", () => {
    expect(shouldShowReportReceipt("telegram")).toBe(false);
    expect(
      deliverReportReceipt(
        { summary: "salut", projectPath: null, category: "telegram" },
        { status: "delivered" },
        { append: vi.fn() },
      ),
    ).toBeNull();
  });

  it("branche la bulle dans la conversation de l'Assistant, pas dans un repère d'onglet", () => {
    const src = readSource("src/js/super-agent.js");
    // La remise appelle TOUJOURS le reçu, sans condition, juste avant de rendre
    // le résultat de `inject_session_summary`.
    const invokeAt = src.indexOf('invoke("inject_session_summary"');
    const receiptCall = sliceFrom(src, "  deliverReportReceipt(entry, res, {", 100).slice(
      0,
      600,
    );
    expect(invokeAt).toBeGreaterThan(-1);
    expect(src.indexOf("  deliverReportReceipt(entry, res, {")).toBeGreaterThan(invokeAt);
    // L'appel n'est pas enfermé dans une condition : il est suivi du `return res;`
    // de la fonction, au même niveau d'indentation.
    expect(receiptCall).toContain(
      "append: (receipt) => appendReportReceipt(superWarnMessagesEl, receipt)",
    );
    expect(receiptCall).toContain("\n  return res;");
    // La bulle est un message de la conversation, avec le texte REPLIÉ.
    const appendBody = sliceSource(
      src,
      "function appendReportReceipt(",
      "function flushPendingReportReceipts(",
      200,
    );
    expect(appendBody).toContain(
      'className = "agent-message agent-message-system agent-message-receipt"',
    );
    expect(appendBody).toContain("messagesEl.appendChild(el)");
    expect(appendBody).toContain('"details"');
    expect(appendBody).toContain("textContent = receipt.shown");
    // Aucun repère d'onglet n'a été ajouté (ni pastille, ni point, ni badge).
    expect(appendBody).not.toMatch(/badge|pastille|onglet-indicator/);
    // Le reçu est réservé aux comptes rendus : la catégorie Telegram est filtrée
    // par le module pur (aucune bulle pour le texte du propriétaire).
    expect(shouldShowReportReceipt("session")).toBe(true);
    expect(shouldShowReportReceipt("runagents")).toBe(true);
  });

  it("garde un reçu arrivé avant l'ouverture de la conversation", () => {
    const src = readSource("src/js/super-agent.js");
    // La conversation peut ne pas exister au moment de la remise (onglet 🧭
    // jamais ouvert) : le reçu est gardé puis affiché à sa création.
    expect(src).toContain("const pendingReportReceipts = [];");
    expect(src).toContain("pendingReportReceipts.push(receipt)");
    const createBody = sliceFrom(src, "superWarnMessagesEl = messagesEl;", 200);
    expect(createBody).toContain("flushPendingReportReceipts();");
  });
});

describe("accusé de remise — un compte rendu non accusé n'est pas livré", () => {
  it("le chemin d'injection n'écrit plus dans le tuyau : il ATTEND l'accusé", () => {
    const rust = readSource("src-tauri/src/super_agent.rs");
    // Un seul lecteur d'accusé, une seule façon d'envoyer une injection.
    const defs = rust.match(/fn injection_ack\(/g) || [];
    expect(defs.length, "l'accusé doit avoir une seule définition").toBe(1);
    expect(rust.match(/fn send_injection_with_ack\(/g) || []).toHaveLength(1);

    /** Corps d'une fonction Rust, découpage VÉRIFIÉ (`sliceSource`). */
    const bodyOf = (marker, endMarker) => sliceSource(rust, marker, endMarker, 200);

    // Remise immédiate : accusé obligatoire, plus d'écriture seule.
    const inject = bodyOf(
      "pub async fn inject_session_summary(",
      "\n/// Construit le message d'injection",
    );
    expect(inject).toContain("send_injection_with_ack(");
    expect(inject).not.toMatch(/agent_service\s*\.\s*send_superagent\(/);
    // Refus / absence d'accusé ⇒ NON livré (aucun marquage) et essai consigné.
    expect(inject).toContain("note_ack_failure(");
    expect(inject.indexOf("mark_session_summary_delivered(&conn, summary_rowid)?;")).toBeGreaterThan(
      inject.indexOf("clear_ack_failure(summary_rowid);"),
    );

    // Rejeu : même contrat (l'ancien envoi d'écriture seule a disparu).
    const replay = bodyOf(
      "fn replay_pending_superagent_summaries_inner(",
      "\n/// Observateur d'événements du super-agent",
    );
    expect(replay).toContain("send_injection_with_ack(");
    expect(replay).not.toMatch(/send_superagent\(superagent_prompt_command/);

    // L'accusé n'accepte QUE ce que le moteur confirme explicitement.
    const ack = bodyOf("pub(crate) fn injection_ack(", "\n/// Envoie un prompt d'injection");
    expect(ack).toContain("Some(true) =>");
    expect(ack).toContain("Some(false) =>");
    expect(ack).toContain("None => Err(");
  });

  it("la mise en file du moteur occupé ne change aucun autre champ de la commande", () => {
    const rust = readSource("src-tauri/src/super_agent.rs");
    const body = sliceSource(
      rust,
      "fn send_injection_with_ack(",
      "\n}\n",
      200,
    );
    // C3 : un seul champ ajouté, dans le seul chemin d'injection.
    expect(body).toContain(
      'map.insert("streamingBehavior".to_string(), Value::String("followUp".to_string()));',
    );
    // Un SEUL endroit dans tout le cœur pose ce champ.
    expect(rust.match(/map\.insert\("streamingBehavior"/g) || []).toHaveLength(1);
    // La forme de la commande simple (prompt de l'utilisateur) reste intouchée.
    const service = readSource("src-tauri/src/agent_service.rs");
    const simple = sliceSource(
      service,
      "pub fn prompt_command_with_resume",
      "\n/// Normalise le résumé court",
      200,
    );
    expect(simple).not.toContain("streamingBehavior");
  });
});

/** Corps du compte rendu de référence (étiquette retirée), pour les tailles. */
function RECEIPT_BODY() {
  return REPORT.replace(/^\[mission #3[^\]]*\]\n/, "");
}
