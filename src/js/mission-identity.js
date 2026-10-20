// mission-identity.js — IDENTITÉ d'une MISSION mise en file d'attente (RÈGLE 4).
//
// RÈGLE 4 : « une demande mise en file est TOUJOURS rejouée avec SA PROPRE
// demande, jamais perdue en silence ». Une entrée de file portait jusqu'ici un
// libellé (`label`) et un lanceur (`launch`) : rien ne permettait de NOMMER la
// demande de façon machine (rapport livré, journal d'abandon, diagnostic), ni de
// constater qu'un rapport livré correspond bien à la demande rejouée. Ce module
// fournit l'identité minimale et PURE :
//   - un compteur MONOTONE (`nextMissionId`) : chaque demande lancée par
//     l'assistant reçoit un numéro unique dans la session ;
//   - la liste des agents visés (`agentIds`) : le rapport livré nomme les agents
//     de SA demande, pas ceux d'une autre ;
//   - l'étiquette lisible (`missionTag`) apposée en tête du compte rendu injecté
//     à l'assistant : une incohérence devient donc VISIBLE (mission #3 annoncée
//     avec les agents de la mission #4) au lieu d'être silencieuse ;
//   - l'estampillage d'une entrée de file (`stampQueuedMission`), qui refuse le
//     DOUBLE empilement de la même demande (même identifiant poussé deux fois).
//
// Aucune dépendance (ni Tauri, ni DOM) : entièrement testable en Node.

// Compteur de missions (monotone, jamais réutilisé dans la session).
let missionSequence = 0;

/**
 * Identifiant de mission NEUF (monotone, strictement croissant).
 * @returns {number}
 */
export function nextMissionId() {
  missionSequence += 1;
  return missionSequence;
}

/**
 * Remet le compteur à zéro (TESTS uniquement : numéros déterministes).
 * @returns {void}
 */
export function __resetMissionIdsForTest() {
  missionSequence = 0;
}

/**
 * Normalise une identité de mission (pure, tolérante).
 * Un identifiant absent ou invalide donne `id: null` : l'appelant peut alors
 * décider de ne rien annoter plutôt que d'inventer une identité.
 * @param {number|string|null|undefined} id
 * @param {Array<string>|null|undefined} agentIds
 * @returns {{id: number|null, agentIds: string[]}}
 */
export function makeMissionIdentity(id, agentIds) {
  const num = Number(id);
  const validId = Number.isFinite(num) && num > 0 ? Math.trunc(num) : null;
  const agents = Array.isArray(agentIds)
    ? agentIds.map((a) => String(a == null ? "" : a).trim()).filter((a) => a.length > 0)
    : [];
  return { id: validId, agentIds: agents };
}

/**
 * Étiquette lisible d'une identité de mission : `[mission #7 · agents : codeur]`.
 * Chaîne VIDE si l'identité n'est pas exploitable (aucun identifiant) : on
 * n'annote jamais un compte rendu avec une identité inventée.
 * @param {{id: number|null, agentIds: string[]}|null|undefined} identity
 * @returns {string}
 */
export function missionTag(identity) {
  const safe = identity || {};
  const id = Number(safe.id);
  if (!Number.isFinite(id) || id <= 0) return "";
  const agents = Array.isArray(safe.agentIds) ? safe.agentIds.filter((a) => !!a) : [];
  const suffix = agents.length > 0 ? ` · agents : ${agents.join(", ")}` : "";
  return `[mission #${Math.trunc(id)}${suffix}]`;
}

/**
 * Appose l'identité de mission en tête d'un compte rendu (pure). Sans identité
 * exploitable, le compte rendu est retourné INCHANGÉ (comportement historique :
 * un point d'avancement ou un retour sans mission n'est pas étiqueté).
 * @param {unknown} summary - texte du compte rendu
 * @param {{id: number|null, agentIds: string[]}|null|undefined} identity
 * @returns {string}
 */
export function annotateMissionReport(summary, identity) {
  const text = String(summary == null ? "" : summary);
  const tag = missionTag(identity);
  if (!tag) return text;
  return text ? `${tag} ${text}` : tag;
}

/**
 * Estampille une entrée de file d'attente avec l'identité de SA mission et
 * REFUSE le double empilement (même identifiant déjà présent).
 *
 * Le double empilement était une cause connue de doublon : la même demande
 * pouvait être poussée par deux gardes successives (`startRun` puis
 * `launchOrQueue`) et partir deux fois. L'entrée en trop est retirée de la file
 * (la plus RÉCENTE, la plus ancienne gardant sa position d'attente) et le fait
 * est signalé à l'appelant (`duplicate: true`) pour qu'il le dise à l'utilisateur
 * au lieu de le taire.
 * @param {Array<object>} queue - file de missions (mutable)
 * @param {object} entry - entrée qui vient d'être poussée
 * @param {{id: number|null, agentIds: string[]}} identity
 * @returns {{duplicate: boolean, id: number|null, agentIds: string[]}}
 */
export function stampQueuedMission(queue, entry, identity) {
  const safe = makeMissionIdentity(identity && identity.id, identity && identity.agentIds);
  if (entry && typeof entry === "object") {
    entry.id = safe.id;
    entry.agentIds = safe.agentIds.slice();
  }
  if (!Array.isArray(queue) || !entry || safe.id === null) {
    return { duplicate: false, id: safe.id, agentIds: safe.agentIds };
  }
  const duplicate = queue.some((e) => e !== entry && e && e.id === safe.id);
  if (duplicate) {
    const at = queue.lastIndexOf(entry);
    if (at >= 0) queue.splice(at, 1);
  }
  return { duplicate, id: safe.id, agentIds: safe.agentIds };
}

/**
 * Libellé d'une entrée de file pour le journal / l'interface : nomme la mission
 * (`#7 « texte de la demande »`) ou, à défaut d'identité, son texte seul.
 * @param {object|null|undefined} entry
 * @returns {string}
 */
export function missionQueueLabel(entry) {
  const e = entry || {};
  const text = String(e.label == null ? "" : e.label).replace(/\s+/g, " ").trim();
  const short = text.length > 120 ? `${text.slice(0, 117)}...` : text;
  const id = Number(e.id);
  if (Number.isFinite(id) && id > 0) return `#${Math.trunc(id)}${short ? ` « ${short} »` : ""}`;
  return short || "(demande sans libellé)";
}
