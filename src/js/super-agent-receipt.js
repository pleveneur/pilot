// super-agent-receipt.js — REÇU VISIBLE d'un compte rendu remis à l'Assistant.
//
// LE DÉFAUT (diagnostic `RAPPORT-diag-restitution-perdue.md`, mission #3 du
// 2026-10-26) : un compte rendu de fin de mission pouvait être écrit en base,
// remis à l'Assistant, LU et exploité… sans que RIEN ne l'affiche. La seule
// surface d'affichage était le texte libre du modèle — et un tour d'outils
// (`run_agents`, `db_execute`) peut se terminer sans un seul mot. Le
// propriétaire n'avait donc aucun moyen de constater l'arrivée d'un compte
// rendu, ni d'en lire le contenu.
//
// LA GARANTIE POSÉE ICI (invariant « un compte rendu remis laisse TOUJOURS une
// trace visible ») : chaque remise produit un REÇU affiché dans la conversation
// de l'Assistant, indépendamment de ce que le modèle décide d'écrire. Le reçu
// dit : le numéro de mission, les agents concernés, le projet, la taille du
// compte rendu et son statut de remise, avec son texte REPLIÉ qu'on peut ouvrir.
//
// Ce que ce module ne fait JAMAIS :
//  - il ne modifie pas le compte rendu (ni son contenu, ni son format, ni sa
//    longueur) : il n'en affiche qu'une lecture bornée ;
//  - il n'invente aucune identité : sans étiquette de mission, aucun numéro
//    n'est affiché ;
//  - il n'annonce jamais « livré » sans statut explicite du cœur ;
//  - il ne produit aucun repère d'onglet (ni pastille, ni badge) : la bulle est
//    du CONTENU de conversation, pas un signal d'onglet.
//
// Aucune dépendance (ni Tauri, ni DOM) : entièrement testable en Node. Le rendu
// DOM et l'emplacement d'affichage sont branchés dans `super-agent.js`.

/** Taille maximale du texte montré dans la bulle (le reste est annoncé omis). */
export const REPORT_RECEIPT_FOLD_MAX = 1200;

/**
 * Étiquette d'identité de mission posée en tête d'un compte rendu (RÈGLE 4,
 * `mission-identity.js`) : `[mission #3 · agents : concepteur-ui]`. La variante
 * historique utilisait un tiret cadratin (`—`) : les deux sont lues, pour ne pas
 * perdre l'identité d'un compte rendu déjà en base.
 */
const MISSION_TAG_RE = /\[mission\s*#(\d+)(?:\s*[·•—–-]\s*agents?\s*:\s*([^\]]*))?\]/i;

/**
 * Lit l'identité de mission portée par un compte rendu.
 * Tolérante par construction : aucune étiquette → aucune identité (jamais de
 * numéro inventé), et l'étiquette reste dans le texte affiché si non reconnue.
 * @param {unknown} text - texte du compte rendu (tel que remis).
 * @returns {{id: number|null, agentIds: string[]}}
 */
export function parseReportMission(text) {
  const str = String(text == null ? "" : text);
  const m = MISSION_TAG_RE.exec(str);
  if (!m) return { id: null, agentIds: [] };
  const id = Number(m[1]);
  const agentIds = String(m[2] || "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
  return {
    id: Number.isFinite(id) && id > 0 ? Math.trunc(id) : null,
    agentIds,
  };
}

/**
 * Retire l'étiquette de mission du texte affiché : elle est déjà dite dans le
 * titre de la bulle, la répéter au début du texte replié n'apprend rien.
 * @param {unknown} text
 * @returns {string}
 */
export function stripReportMissionTag(text) {
  return String(text == null ? "" : text).replace(MISSION_TAG_RE, "").trim();
}

/**
 * Taille lisible d'un compte rendu : nombre de caractères réel, groupé par
 * milliers avec une espace insécable fine (jamais un nombre inventé).
 * @param {unknown} text
 * @returns {string} ex. « 2 624 caractères »
 */
export function formatReportSize(text) {
  const chars = String(text == null ? "" : text).length;
  const grouped = String(chars).replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f");
  return `${grouped} caractère${chars > 1 ? "s" : ""}`;
}

/**
 * Libellé HONNÊTE du statut de remise. `delivered` = le moteur a accusé
 * réception ; `queued` = écrit en base durable, remis dès que l'assistant est
 * libre ; `error` = NON remis, sera réessayé (rejeu). Aucun autre statut n'est
 * présenté comme un succès.
 * @param {unknown} status - statut rendu par `inject_session_summary`.
 * @param {unknown} [detail] - détail éventuel (raison du refus).
 * @returns {string}
 */
export function receiptStatusLabel(status, detail) {
  const s = String(status == null ? "" : status).trim();
  if (s === "delivered") return "livré";
  if (s === "queued") return "mis en attente (remis dès que l'assistant est libre)";
  if (s === "error") {
    const why = String(detail == null ? "" : detail).trim();
    return why ? `NON remis — sera réessayé (${why})` : "NON remis — sera réessayé";
  }
  return "statut de remise illisible";
}

/**
 * Une bulle de reçu est-elle pertinente pour cette catégorie de remise ?
 * Les comptes rendus d'agents et les retours de session OUI ; un message
 * Telegram NON : c'est le texte du propriétaire lui-même, pas un compte rendu.
 * @param {unknown} category
 * @returns {boolean}
 */
export function shouldShowReportReceipt(category) {
  return String(category == null ? "" : category).trim() !== "telegram";
}

/**
 * Construit le REÇU d'une remise (objet pur, sans DOM).
 * Rend `null` quand aucune bulle ne doit être produite (catégorie exclue,
 * compte rendu vide) : l'appelant n'affiche alors rien plutôt qu'une bulle vide.
 * @param {object} input
 * @param {unknown} input.summary - texte exact remis (étiquette de mission comprise).
 * @param {unknown} [input.projectPath] - chemin du projet concerné.
 * @param {unknown} [input.projectName] - nom court du projet (déjà calculé).
 * @param {unknown} [input.status] - statut rendu par le cœur.
 * @param {unknown} [input.detail] - détail du statut (raison d'un refus).
 * @param {unknown} [input.category] - catégorie de remise.
 * @returns {null|{
 *   mission: {id: number|null, agentIds: string[]},
 *   title: string,
 *   meta: string,
 *   body: string,
 *   shown: string,
 *   truncated: boolean,
 *   omitted: number,
 *   chars: number,
 *   status: string,
 * }} le reçu, ou `null` si rien ne doit être affiché.
 */
export function buildReportReceipt(input) {
  const opts = input || {};
  if (!shouldShowReportReceipt(opts.category)) return null;
  const summary = String(opts.summary == null ? "" : opts.summary);
  const mission = parseReportMission(summary);
  const body = stripReportMissionTag(summary);
  const chars = body.length;
  if (chars === 0) return null;

  // Titre : l'identité de la mission, telle qu'elle est portée par le compte
  // rendu (RÈGLE 4). Sans identité, aucun numéro n'est affiché.
  let title = "📥 Compte rendu reçu";
  if (mission.id !== null) {
    title += ` — mission #${mission.id}`;
    if (mission.agentIds.length > 0) {
      title += ` (${mission.agentIds.join(", ")})`;
    }
  }

  // Ligne d'info : projet, taille RÉELLE, statut HONNÊTE.
  const projectName = String(opts.projectName == null ? "" : opts.projectName).trim();
  const metaBits = [];
  metaBits.push(projectName ? `Projet : ${projectName}` : "Projet : non précisé");
  metaBits.push(formatReportSize(body));
  metaBits.push(`statut : ${receiptStatusLabel(opts.status, opts.detail)}`);

  const truncated = chars > REPORT_RECEIPT_FOLD_MAX;
  const shown = truncated
    ? `${body.slice(0, REPORT_RECEIPT_FOLD_MAX).trimEnd()}…`
    : body;

  return {
    mission,
    title,
    meta: metaBits.join(" · "),
    body,
    shown,
    truncated,
    omitted: truncated ? chars - shown.length + 1 : 0,
    chars,
    status: String(opts.status == null ? "" : opts.status).trim(),
  };
}

/**
 * Point d'appel UNIQUE : décide puis fait afficher le reçu de la remise qui
 * vient d'avoir lieu. C'est ce chemin qui garantit l'invariant « un compte rendu
 * remis laisse toujours une trace visible » — l'affichage est APPELÉ, il n'est
 * pas laissé au texte libre du modèle.
 *
 * `append` est injecté (le rendu DOM vit dans `super-agent.js`) : ce module
 * reste pur, et un test peut prouver que la bulle est bien produite ET confiée à
 * l'affichage, pour les trois statuts.
 * @param {object} entry - entrée remise (`{summary, projectPath, category}`).
 * @param {object|null|undefined} res - résultat de `inject_session_summary`.
 * @param {object} [hooks]
 * @param {unknown} [hooks.summary] - texte réellement remis (surcharge `entry.summary`).
 * @param {unknown} [hooks.projectName] - nom court du projet.
 * @param {(receipt: object) => unknown} [hooks.append] - affichage du reçu.
 * @returns {null|object} le reçu produit (ou `null`).
 */
export function deliverReportReceipt(entry, res, hooks = {}) {
  const safe = entry || {};
  const receipt = buildReportReceipt({
    summary: hooks.summary === undefined ? safe.summary : hooks.summary,
    projectPath: safe.projectPath,
    projectName: hooks.projectName,
    status: res && res.status,
    detail: res && res.detail,
    category: safe.category,
  });
  if (!receipt) return null;
  if (typeof hooks.append === "function") hooks.append(receipt);
  return receipt;
}
