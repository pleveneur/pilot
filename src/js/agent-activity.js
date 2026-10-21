// agent-activity.js — Indicateur d'activité des agents (haut droite)
//
// Cercle flottant en haut à droite reflétant l'activité de TOUS les agents
// (assistant + codeurs). Le cercle « respire » (animation agent-pulse) dès
// qu'UN agent travaille. Au clic : liste déroulante (fond solide, teinté violet
// assistant) avec un
// cercle respirant par agent, puis une fiche (nom, état, projet, dernière
// activité) avec un bouton « Afficher l'onglet ».
//
// Comportement de la liste : le clic sur le cercle principal bascule
// l'ouverture/fermeture. La liste reste OUVERTE tant qu'on ne reclique pas sur
// ce cercle (pas de fermeture au clic extérieur). L'état déplié/replié est
// persisté via localStorage (agent-activity-expanded) et restauré au démarrage.
//
// Source de vérité : `get_agent_supervision` (dashboard.rs), pollée toutes les
// 2 s, + événement push `agent-state-changed` (Rust → JS) pour un rafraîchissement
// immédiat. Aucune commande Rust ajoutée.
//
// Le poll + le filtrage sont centralisés dans un « store » partagé
// (subscribeAgentActivity) consommé par l'indicateur ci-dessus ET par le
// résumé repliable des agents du mode « Assistant Only » immersif
// (super-agent.js) — même source de données, même filtrage, aucun polling
// dupliqué.
//
// Les fonctions pures (flattenAgents, anyBusy, shortMission, buildRunningMissions,
// renderDropdown, renderCard, renderStaticAgentList, formatLastActivity) sont
// testées dans agent-activity.test.js.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Dernière activité connue par agent (timestamp), alimentée par
// `agent-state-changed`. Clé = agentId (id brut, ex: "superagent" ou l'id agent).
const lastActivity = new Map();

// Espace réservé des agents d'assistant SANS projet (clé `__assistant__`),
// distinct de "" (super-agent Magnus) et de tout chemin de projet réel.
const ASSISTANT_SPACE = "__assistant__";

/** Échappe un texte pour insertion HTML sûre. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formate un timestamp en heure locale (HH:MM, 24h) ou null si absent. */
export function formatLastActivity(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  } catch (_) {
    return null;
  }
}

/**
 * Aplatit la supervision en une liste plate d'agents.
 * @param {object} supervision — sortie de get_agent_supervision ({projects:[...]}).
 * @param {Map<string,number>} [lastActivityMap] — timestamps de dernière activité.
 * @returns {Array<{agentId,rawId,label,project,projectPath,state,busy,lastActivity,kind}>}
 */
export function flattenAgents(supervision, lastActivityMap) {
  const projects = (supervision && supervision.projects) || [];
  const list = [];
  for (const proj of projects) {
    const project = proj.path || "";
    const isSuper = project === "";
    const isAssistant = project === ASSISTANT_SPACE;
    // L'assistant (projet pseudo-global "") et l'espace des agents d'assistant
    // (ASSISTANT_SPACE) n'ont pas de projet réel : étiquette lisible « Assistant ».
    const projectName = isSuper
      ? ""
      : isAssistant
        ? "Assistant"
        : proj.name || project.split(/[\\/]/).pop() || "";
    for (const a of proj.agents || []) {
      const label = a.agent || "";
      const state = a.state || "stopped";
      const busy = state === "running" || state === "compacting";
      // Travail EFFECTIF de la session : soit l'agent produit (busy), soit un
      // outil long est en cours (compilation, tests : silencieux mais reel),
      // soit le backend l'annonce (isWorking, champ additif optionnel).
      // C'est la SEULE verite de « il travaille » : jamais « un onglet est
      // ouvert ». Fonction pure partagee (isAgentWorking).
      const toolInProgress = a.toolInProgress === true;
      const isWorkingFlag = a.isWorking === true;
      const working = busy || toolInProgress || isWorkingFlag;
      // Regle 1 : une session qui TRAVAILLE est TOUJOURS listee, qu'elle ait un
      // onglet ouvert ou non (agent lance en arriere-plan, onglet ferme).
      // Une session qui NE travaille pas n'apparait que si elle a un onglet
      // ouvert (`visible`) ou si son processus pi est encore vivant (agent
      // recuperable au repos entre deux tours, tous modes de lancement : main /
      // agent_process / assistant_agent). Un agent au repos dont le processus
      // est mort est ecarte : aucune entree fantome. `visible` absent (backend
      // ancien) est traite comme « onglet ouvert ». L'assistant (projet "") et
      // les agents d'assistant (ASSISTANT_SPACE) ne sont jamais filtres.
      if (!isSuper && !isAssistant && !working) {
        const hasTab = a.visible !== false;
        const aliveBackground = a.alive === true; // pi process alive, all modes
        if (!hasTab && !aliveBackground) continue;
      }
      // Identité UNIQUE par agent : deux agents peuvent porter le même nom
      // (« codeur ») sur des PROJETS différents. Pour l'assistant (projet ""),
      // l'id reste "superagent" ; pour un agent, on combine nom + chemin projet
      // (ex: "codeur|C:/proj/Pilot") pour lever toute ambiguïté dans la liste
      // aplatie et au clic. `rawId` garde l'id brut (== label pour un agent
      // nommé), `label` et `project` restent l'affichage lisible.
      const rawId = isSuper ? "superagent" : label;
      const agentId = isSuper ? "superagent" : (isAssistant ? label : `${label}|${project}`);
      list.push({
        agentId,
        rawId,
        label,
        project: projectName,
        // Tâche #140 : un agent d'assistant (sans projet) porte l'espace réservé
        // `__assistant__` (et non "") : l'ouverture de son onglet doit pouvoir
        // distinguer « aucun projet » de « projet vide » pour ne JAMAIS retomber
        // sur le projet actif.
        projectPath: isAssistant ? ASSISTANT_SPACE : (isSuper ? "" : project),
        state,
        busy,
        // Travail effectif et visibilite d'onglet (regle 1) : l'affichage s'en
        // sert pour dire « travaille en arriere-plan (aucun onglet) ».
        working,
        visible: typeof a.visible === "boolean" ? a.visible : undefined,
        // Mission en cours (affichage « missions en cours » du panneau de la
        // cloche) : dernier prompt réellement envoyé à la session — déjà tronqué
        // côté Rust — et outil long éventuellement en cours. Champs ADDITIFS :
        // les consommateurs existants (indicateur d'activité, résumé immersif,
        // onglet agent, assistant web) les ignorent.
        prompt: typeof a.prompt === "string" ? a.prompt : "",
        // RÉSUMÉ COURT de la mission FOURNI avec la demande (champ `resume` de
        // `run_agents` / `run_assistant_agents`), conservé par le cœur avec la
        // session. Champ ADDITIF : absent des charges anciennes, jamais inventé.
        // Il est affiché EN PREMIER (avant l'agent et le projet) et prend le pas
        // sur l'extraction du prompt (resolveMissionLabel).
        resume: typeof a.resume === "string" ? a.resume : "",
        toolInProgress,
        lastActivity: lastActivityMap ? formatLastActivity(lastActivityMap.get(rawId)) : null,
        kind: isSuper ? "superagent" : (isAssistant ? "assistant" : "agent"),
      });
    }
  }
  return list;
}

/** true si au moins un agent est occupé (travail en cours). */
export function anyBusy(list) {
  return list.some((a) => a.busy);
}

// ── Travail effectif et travail SANS ONGLET (regle 1) ──
// Une seule source de verite pour « cet agent travaille-t-il ? », partagee par
// la liste deroulante (cercle en haut a droite), la fiche d'agent, le volet
// « En cours » du panneau de la cloche et le panneau « Activite » de l'onglet
// Agents : aucune logique de vivacite n'est dupliquee.

/**
 * true si la session TRAVAILLE reellement a cet instant. Fonction PURE.
 *  - `busy` : l'agent produit une reponse (ou compacte) ;
 *  - `toolInProgress` : un outil long est en cours (build, tests, install) ;
 *  - `isWorking` : travail effectif annonce par le backend (champ additif
 *    optionnel, absent des charges anciennes) ;
 *  - `working` : resultat deja calcule par flattenAgents.
 * Un agent vivant mais AU REPOS n'est jamais « travaillant ».
 * @param {object} agent entree de liste (flattenAgents) ou objet partiel.
 * @returns {boolean}
 */
export function isAgentWorking(agent) {
  if (!agent) return false;
  return (
    agent.working === true ||
    agent.busy === true ||
    agent.toolInProgress === true ||
    agent.isWorking === true
  );
}

/**
 * true si la session travaille SANS ONGLET ouvert (travail en arriere-plan).
 * Fonction PURE. Exige `visible === false` (aucun onglet) : quand la
 * visibilite est inconnue (backend ancien) on n'affirme rien (aucun badge
 * errone).
 * @param {object} agent entree de liste (flattenAgents).
 * @returns {boolean}
 */
export function isWorkingWithoutTab(agent) {
  return isAgentWorking(agent) && agent.visible === false;
}

/**
 * Missions des sessions qui travaillent SANS ONGLET, pretes a afficher
 * (panneau « Activite » de l'onglet Agents). Fonction PURE : elle ne fait que
 * filtrer la liste issue du store partage (aucun appel, aucun polling propre).
 * @param {Array} list liste aplatie (flattenAgents).
 * @returns {Array<{agentId, kind, agent, project, mission}>}
 */
export function buildBackgroundWorkMissions(list) {
  return (list || [])
    .filter((a) => isWorkingWithoutTab(a))
    .map((a) => ({
      agentId: a.agentId || "",
      kind: a.kind || "agent",
      agent: a.label || "",
      project: a.project || "Assistant",
      mission: resolveMissionLabel(a.resume, a.prompt),
    }));
}

// ── Missions en cours (affichage du panneau de la cloche) ──

/** Longueur maximale affichée du texte d'une mission (une phrase courte). */
export const MISSION_MAX_CHARS = 120;

/**
 * Longueur maximale du RÉSUMÉ COURT **fourni** avec une demande (« resume »).
 * Même plafond que l'affichage : une phrase courte, pas un paragraphe. La valeur
 * est identique côté Rust (`MISSION_RESUME_MAX_CHARS`, agent_service.rs), qui
 * applique le plafond avant de conserver le résumé avec la session.
 */
export const MISSION_RESUME_MAX_CHARS = 120;

/**
 * Tronque un texte à `MISSION_MAX_CHARS` caractères, suffixé « … » si coupé.
 * Coupe PROPRE : on recule jusqu'à une frontière de mot (jamais au milieu d'un
 * mot), sauf si cela amputait plus de la moitié du texte.
 */
function clipMission(text) {
  const chars = Array.from(text);
  if (chars.length <= MISSION_MAX_CHARS) return text;
  const minKeep = Math.floor(MISSION_MAX_CHARS / 2);
  let end = MISSION_MAX_CHARS;
  for (let i = MISSION_MAX_CHARS - 1; i >= minKeep; i--) {
    if (/\s/.test(chars[i])) {
      end = i;
      break;
    }
  }
  const cut = chars.slice(0, end).join("").trim().replace(/[\s,;:.!?\-–—]+$/u, "");
  const kept = cut || chars.slice(0, MISSION_MAX_CHARS).join("").trim();
  return kept + "…";
}

/**
 * Normalise le RÉSUMÉ COURT **fourni** avec une demande (`resume`) : espaces et
 * retours à la ligne réduits à une seule espace, plafonné à
 * `MISSION_RESUME_MAX_CHARS` et coupé **proprement sur un mot** (« … »).
 * Fonction PURE : aucun caractère n'est obligatoire, aucun contenu n'est
 * réécrit (le texte fourni est rendu tel quel, seulement nettoyé et plafonné).
 * Retourne `""` quand rien d'utilisable n'est fourni → l'appelant applique son
 * ordre de repli (jamais un résumé inventé).
 * @param {unknown} value — valeur brute reçue (chaîne attendue).
 * @returns {string} résumé utilisable, ou `""`.
 */
export function normalizeMissionResume(value) {
  if (typeof value !== "string") return "";
  const flat = value.replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return clipMission(flat);
}

/**
 * Libellé de mission selon l'ORDRE DE REPLI STRICT (aucun résumé inventé) :
 *  1. le **résumé fourni** avec la demande (`resume`) — affiché tel quel ;
 *  2. sinon l'**extrait de l'objectif** de la demande (`shortMission`, qui porte
 *     déjà ses propres replis honnêtes : « mission non communiquée » quand le
 *     texte n'est que le rôle, « (demande non précisée) » quand il n'y a rien).
 * Fonction PURE : elle ne déduit jamais un résumé par approximation, elle
 * choisit simplement la meilleure source DISPONIBLE.
 * @param {unknown} resume — résumé court fourni avec la demande (facultatif).
 * @param {string} prompt — texte du dernier prompt réellement envoyé.
 * @returns {string} libellé de mission, toujours non vide.
 */
export function resolveMissionLabel(resume, prompt) {
  const provided = normalizeMissionResume(resume);
  if (provided) return provided;
  return shortMission(prompt);
}

/**
 * Repli explicite affiché quand AUCUN résumé utilisable n'existe (le texte
 * enregistré n'est que le RÔLE de l'agent, « Tu es un planificateur logiciel… »).
 * Un rôle n'est JAMAIS une tâche, et ce libellé ne prétend rien : il est
 * HONNÊTE et court. Jamais « en préparation », qui ne dit rien de la tâche
 * (défaut corrigé : ce repli s'affichait à la place de la mission réelle).
 */
export const MISSION_ROLE_FALLBACK = "mission non communiquée";

// En-têtes MÉCANIQUES d'un prompt de délégation : ils décrivent la STRUCTURE du
// prompt (« ## Contexte », « ## Objectif », « ## Consignes », « ## Ce qu'il ne
// faut PAS faire »), pas la tâche. Les afficher n'apprend rien à l'utilisateur :
// on les saute pour prendre la première ligne de CONTENU réel.
// Les étiquettes du prompt de délégation (`buildAgentPrompt` : bandeaux de
// spécialité, de rôle, « MISSION », contexte de suivi de l'assistant) en font
// partie : ce sont des ÉTIQUETTES, jamais une tâche.
const MECHANICAL_HEADERS = new Set([
  "contexte",
  "objectif",
  "consignes",
  "ce qu il ne faut pas faire",
  "specialite",
  "role",
  "capacites",
  "mission",
  "protocole",
  "contexte de suivi assistant",
  "arborescence du projet",
  "taches precedentes terminees",
  "fin contexte",
]);

/** Normalise une ligne (minuscules, sans accents ni ponctuation) pour comparaison. */
function normalizeHeading(line) {
  return String(line == null ? "" : line)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** true si la ligne n'est qu'un en-tête mécanique de prompt (markdown compris). */
export function isMechanicalHeader(line) {
  return MECHANICAL_HEADERS.has(normalizeHeading(line));
}

/**
 * true si la ligne est l'énoncé du RÔLE de l'agent (« Tu es un <métier> … »,
 * « Vous êtes une … »), jamais une tâche à afficher.
 */
export function looksLikeAgentRole(line) {
  const flat = String(line == null ? "" : line)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return /^(?:tu es|vous etes|you are)\s+(?:un|une|le|la|the)\b/i.test(flat);
}

/** Retire les décorations markdown de tête (titre, liste, citation, gras). */
function stripLeadingMarkdown(line) {
  let s = String(line == null ? "" : line).trim();
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s
      .replace(/^>\s?/, "")
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\*{1,2}/, "")
      .trim();
    if (s === before) break;
  }
  return s.replace(/\*{1,2}$/, "").trim();
}

/**
 * true si la ligne est un BANDEAU de structure de prompt (« === MISSION === »,
 * « === SPÉCIALITÉ === », « === FIN CONTEXTE === ») : jamais une tâche.
 */
export function isPromptBanner(line) {
  return /^={2,}\s*\S.*={2,}$/.test(String(line == null ? "" : line).trim());
}

// Étiquettes de STRUCTURE d'un prompt (titre markdown, gras, bandeau).
const STRUCTURE_LABELS =
  /^(?:contexte|objectif|consignes|mission|protocole|specialite|role|capacites|fichiers|taches|arborescence|ce qu il ne faut pas faire|objectif global|fin contexte)\b/;

/**
 * true si la ligne est un EN-TÊTE de structure (titre markdown « ## Objectif »,
 * gras « **Objectif** », bandeau « === MISSION === »). Un titre peut porter la
 * tâche elle-même (« # Corriger le zoom ») : seuls les titres dont le libellé est
 * une étiquette de structure connue sont sautés.
 */
export function isStructuralHeading(line) {
  const raw = String(line == null ? "" : line).trim();
  if (isPromptBanner(raw)) return true;
  const heading = /^#{1,6}\s/.test(raw) || /^\*{1,2}[^*].*\*{1,2}$/.test(raw);
  if (!heading) return false;
  return STRUCTURE_LABELS.test(normalizeHeading(raw));
}

// Préambule TECHNIQUE d'une demande (« Contexte : version 0.4.37… »,
// « Version : … ») : ce n'est pas la tâche demandée.
const PREAMBLE_KEYS = /^(?:contexte|rappel|version|depot|branche|prerequis|etat)\b/;

/**
 * true si la ligne ne peut PAS être la tâche : vide, en-tête de structure,
 * bandeau, rôle d'agent (« Tu es un … ») ou préambule de spécialité
 * (« Rôle : … », « Capacités : … »).
 */
function isNonMissionLine(line) {
  const trimmed = String(line == null ? "" : line).trim();
  if (!trimmed) return true;
  if (isStructuralHeading(trimmed) || isMechanicalHeader(trimmed)) return true;
  const clean = stripLeadingMarkdown(trimmed);
  if (!clean) return true;
  if (looksLikeAgentRole(clean)) return true;
  if (/^(?:r[ôo]le|capacit[ée]s|sp[ée]cialit[ée])\s*:/i.test(clean)) return true;
  return false;
}

// Phrase d'OBJECTIF écrite sur une seule ligne : « Objectif : … », « But : … ».
const OBJECTIVE_INLINE_RE =
  /^(?:l['’]\s*)?(?:objectif|but)\s*:\s*(.+?)\s*$/i;

/** true si la ligne ouvre la section « Objectif » (« ## Objectif », « **Objectif** »). */
function isObjectiveHeading(line) {
  return normalizeHeading(stripLeadingMarkdown(line)) === "objectif";
}

/**
 * Contenu de la section « Objectif » : les lignes qui suivent son en-tête,
 * jusqu'au prochain en-tête de structure. Sert à trouver la phrase de la tâche
 * quand elle n'est pas écrite sur une ligne « Objectif : … ».
 */
function objectiveSectionBody(lines) {
  const idx = lines.findIndex((l) => isObjectiveHeading(l));
  if (idx < 0) return [];
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (isStructuralHeading(trimmed) || isMechanicalHeader(trimmed)) break;
    out.push(trimmed);
  }
  return out;
}

/**
 * Réduit le texte d'une demande d'agent à UNE PHRASE COURTE et LISIBLE pour
 * l'affichage du panneau. Fonction PURE et déterministe :
 *  1. si le texte contient une ligne `Tâche : <titre>` (prompts d'orchestration,
 *     y compris retries) → ce `<titre>` (PRIORITAIRE) ;
 *  2. sinon la phrase de l'OBJECTIF écrite en ligne (« Objectif : … »,
 *     « But : … ») — c'est la tâche réelle d'une demande de délégation ;
 *  3. sinon la section « Objectif » (« ## Objectif ») : sa première ligne de
 *     contenu réel, préambule technique sauté ;
 *  4. sinon la première ligne de CONTENU réel du prompt, en sautant le préambule
 *     de RÔLE (« Tu es un développeur… »), le bloc de spécialité (« Rôle : … »,
 *     « Capacités : … »), les bandeaux `=== … ===`, les en-têtes mécaniques et
 *     les fences de code ;
 *  5. sans résumé utilisable (texte réduit au rôle) → « mission non
 *     communiquée » : jamais le rôle, jamais « en préparation » ;
 *  6. texte vide ou inconnu → « (demande non précisée) » : JAMAIS une ligne
 *     vide, JAMAIS un texte inventé.
 * Le résultat est plafonné à `MISSION_MAX_CHARS` caractères, coupé proprement
 * sur un mot, avec points de suspension.
 * @param {string} text — prompt brut (déjà réduit côté Rust) ou valeur absente.
 * @returns {string} libellé de mission, toujours non vide.
 */
export function shortMission(text) {
  const raw = String(text == null ? "" : text);
  const lines = raw.split(/\r?\n/);
  // 1. Ligne « Tâche : … » (orchestration) — PRIORITAIRE, cherchée partout.
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*>]\s*)*(?:\*\*)?T[âa]che\s*:\s*(?:\*\*)?\s*(.+?)\s*(?:\*\*)?\s*$/);
    if (m && m[1].trim()) return clipMission(m[1].trim());
  }
  // 2. Phrase d'OBJECTIF en ligne : la tâche réellement demandée.
  for (const line of lines) {
    const m = stripLeadingMarkdown(line).match(OBJECTIVE_INLINE_RE);
    if (m && m[1].trim()) return clipMission(m[1].trim());
  }
  // 3. Section « Objectif » : première ligne de contenu réel (hors préambule).
  for (const line of objectiveSectionBody(lines)) {
    if (isNonMissionLine(line)) continue;
    const clean = stripLeadingMarkdown(line);
    if (!clean) continue;
    if (PREAMBLE_KEYS.test(normalizeHeading(clean))) continue;
    return clipMission(clean);
  }
  // 4. Première ligne de CONTENU réel, hors fences, préambule de rôle et
  //    en-têtes de structure. Un RÔLE est sauté (jamais affiché comme mission).
  let inFence = false;
  let sawRoleLine = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (looksLikeAgentRole(stripLeadingMarkdown(trimmed))) sawRoleLine = true;
    if (isNonMissionLine(trimmed)) continue;
    const clean = stripLeadingMarkdown(trimmed);
    if (!clean) continue;
    return clipMission(clean);
  }
  // 5. Repli explicite : le rôle n'est JAMAIS affiché, et « en préparation »
  //    n'est plus jamais présenté comme la tâche.
  if (sawRoleLine) return MISSION_ROLE_FALLBACK;
  // 6. Repli explicite (texte vide ou inconnu).
  return "(demande non précisée)";
}

/**
 * Construit la liste des missions RÉELLEMENT en cours à afficher (panneau de la
 * cloche, onglet « En cours »). Fonction PURE.
 *
 * Règles (faux négatifs interdits) :
 *  - un agent RETENU si `busy` OU `toolInProgress` : un outil long et SILENCIEUX
 *    (compilation, tests) ne fait pas disparaître sa mission ;
 *  - un agent AU REPOS (`idle` / `paused` / `stopped`) est MASQUÉ : pas de mission ;
 *  - l'Assistant lui-même suit la même règle ;
 *  - les missions EN ATTENTE (files d'attente de délégation / de run) sont
 *    ajoutées avec `waiting: true` (mention « en attente » à l'affichage).
 * @param {Array} list — liste aplatie (flattenAgents).
 * @param {Array<{project: string, mission: string, resume?: string}>} [queued] — missions en file.
 * @returns {Array<{agent: string, project: string, mission: string, waiting: boolean}>}
 */
export function buildRunningMissions(list, queued) {
  const out = [];
  for (const a of list || []) {
    if (!isAgentWorking(a)) continue;
    out.push({
      agent: a.label || "",
      project: a.project || "Assistant",
      // Ordre de repli strict : résumé FOURNI avec la demande, sinon extrait de
      // l'objectif du prompt, sinon libellé honnête (shortMission). La forme de
      // l'entrée reste identique (`resume` n'est pas recopié).
      mission: resolveMissionLabel(a.resume, a.prompt),
      waiting: false,
    });
  }
  for (const q of queued || []) {
    if (!q) continue;
    out.push({
      agent: q.agent || "",
      project: q.project || "Assistant",
      mission: resolveMissionLabel(q.resume, q.mission),
      waiting: true,
    });
  }
  return out;
}

/**
 * Répartit les missions en deux groupes ORDONNÉS : celles qui TOURNENT
 * (`waiting: false`) et celles qui ATTENDENT dans la file (`waiting: true`).
 * L'ordre d'origine — donc l'ordre de la file — est conservé. Fonction PURE.
 * @param {Array<{agent, project, mission, waiting}>} missions
 * @returns {{running: Array, waiting: Array}}
 */
export function splitMissions(missions) {
  const running = [];
  const waiting = [];
  for (const m of missions || []) {
    if (!m) continue;
    (m.waiting ? waiting : running).push(m);
  }
  return { running, waiting };
}

/** Libellé « agent — projet » d'une mission (au moins l'un des deux). */
function missionWho(m) {
  const agent = m.agent || "";
  const project = m.project || "";
  if (agent && project) return `${agent} — ${project}`;
  return agent || project || "Assistant";
}

/**
 * Rendu HTML du volet « En cours » du panneau (bas à droite). Fonction PURE.
 *
 * Deux groupes EXPLICITES et NUMÉROTÉS — « En cours (n) » puis « En attente (n) » —
 * pour que l'on voie d'un coup d'œil ce qui tourne ET dans quel ordre la file
 * attend. Chaque ligne porte son RANG et, sur la ligne principale, l'identité
 * « <agent> — <projet> » ; **EN DESSOUS**, sur la ligne secondaire (sa place
 * historique, inchangée), le texte d'indication de la tâche : le résumé court
 * fourni avec la demande, sinon l'extrait de l'objectif. Cet ordre visuel
 * (agent et projet AU-DESSUS, résumé EN DESSOUS) est FIGÉ par un test : il ne
 * doit pas être inversé (décision du propriétaire, disposition d'origine).
 * Aucune mission → message explicite, jamais une liste vide trompeuse.
 * @param {Array<{agent, project, mission, waiting}>} missions — buildRunningMissions.
 * @returns {string} HTML du volet.
 */
export function renderMissionsPanelHtml(missions) {
  const { running, waiting } = splitMissions(missions);
  if (!running.length && !waiting.length) {
    return '<div class="dash-muted">Aucune mission en cours.</div>';
  }
  const group = (title, list, isWaiting) => {
    if (!list.length) return "";
    const items = list
      .map(
        (m, i) => `
        <div class="sa-task-item${isWaiting ? " waiting" : " running"}">
          <div class="sa-task-head">
            <span class="sa-task-title"><span class="sa-missions-rank">${i + 1}.</span>${esc(missionWho(m))}</span>
            <span class="sa-task-status ${isWaiting ? "tone-todo" : "tone-progress"}">${isWaiting ? "en attente" : "en cours"}</span>
          </div>
          <div class="sa-task-meta">${esc(m.mission)}</div>
        </div>`
      )
      .join("");
    return `<div class="sa-task-client sa-missions-group ${isWaiting ? "waiting" : "running"}">${esc(title)} (${list.length})</div>${items}`;
  };
  return `${group("En cours", running, false)}${group("En attente", waiting, true)}`;
}

// ── Store partagé (supervision, plusieurs consommateurs) ──
// Sémantique historique de l'indicateur (poll 2 s + push `agent-state-changed`,
// filtrage flattenAgents), extraite d'initAgentActivity pour être réutilisée
// sans doublon : un seul polling actif quelle que soit la consommation. En cas
// d'échec de get_agent_supervision, aucun abonné n'est noté (pas de mise à
// jour), comme avant.
const activitySubscribers = new Set();
let activityStarted = false;
// Dernière liste/busy notifiés. `null` = store jamais alimenté.
let currentActivityList = null;
let currentActivityBusy = false;

async function activityRefresh() {
  try {
    const sup = await invoke("get_agent_supervision");
    const list = flattenAgents(sup, lastActivity);
    currentActivityList = list;
    currentActivityBusy = anyBusy(list);
    for (const cb of [...activitySubscribers]) {
      try { cb(currentActivityList, currentActivityBusy); } catch (_) {}
    }
  } catch (_) {
    /* ignore : pas de mise à jour */
  }
}

/** Démarre le polling partagé (une seule fois, au premier abonné). */
function ensureActivityStore() {
  if (activityStarted) return;
  activityStarted = true;
  // Push immédiat : changement d'état d'un agent (mise à jour lastActivity).
  listen("agent-state-changed", (event) => {
    const p = event.payload || {};
    if (p.agentId) lastActivity.set(p.agentId, Date.now());
    activityRefresh();
  }).catch(() => {});
  // Poll toutes les 2 s (source de vérité get_agent_supervision).
  setInterval(activityRefresh, 2000);
  activityRefresh();
}

/**
 * S'abonne au flux d'activité partagé (liste aplatie flattenAgents + busy).
 * L'abonné est noté immédiatement avec le dernier état connu (s'il existe),
 * puis à chaque poll/événement. @returns {Function} désabonnement.
 */
export function subscribeAgentActivity(cb) {
  ensureActivityStore();
  activitySubscribers.add(cb);
  if (currentActivityList) {
    try { cb(currentActivityList, currentActivityBusy); } catch (_) {}
  }
  return () => activitySubscribers.delete(cb);
}

/** Dernier état connu du store partagé (vide tant qu'aucun poll n'a abouti). */
export function getAgentActivitySnapshot() {
  return { list: currentActivityList || [], busy: currentActivityBusy };
}

/**
 * Rendu HTML de la liste des agents en AFFICHAGE SEUL (mode « Assistant Only »
 * immersif, barre du haut). Retour du 30/08 : la liste déployée en mode
 * assistant seul doit être EXACTEMENT la même que celle du mode standard —
 * mêmes entrées (pastille + nom + projet), issues de la même source (store
 * partagé, même filtrage amont) et rendues par le MÊME code : on réutilise
 * donc renderDropdown tel quel. SEULE différence (portée par le monteur) :
 * aucun handler d'action n'est branché sur ces items dans le mode immersif —
 * cliquer une entrée n'affiche AUCUN détail (pas de fiche, pas d'ouverture
 * d'onglet, pas de changement de projet) ; un clic replie simplement le
 * résumé. La liste reste strictement informative.
 * @param {Array} list — liste aplatie (flattenAgents), identique au standard.
 * @returns {string} HTML identique à la liste déroulante standard.
 */
export function renderStaticAgentList(list) {
  return renderDropdown(list || []);
}

/**
 * Monte le résumé des agents dans la barre du haut du mode « Assistant Only »
 * : le petit point unique (animation agent-pulse) qui « respire » quand un
 * agent ou l'Assistant travaille, statique sinon, reste AFFICHÉ EN PERMANENCE
 * dans le host — y compris quand la liste est déployée : il sert de poignée
 * d'ouverture/fermeture. Un clic sur le point déploie la liste des agents
 * (renderStaticAgentList — strictement informative, mêmes entrées que
 * l'indicateur du mode standard) à côté du point ; un second clic (sur le
 * point, ou n'importe quel item de la liste) replie. Rien n'est persisté :
 * chaque entrée en mode immersif repart repliée. Mise à jour continue via le
 * store partagé.
 * @param {HTMLElement|null} host — conteneur (détruit avec l'overlay immersif).
 * @returns {Function} désabonnement (à appeler à la sortie du mode).
 */
export function mountCollapsibleAgentList(host) {
  if (!host) return () => {};
  let expanded = false;
  const dot = (ariaExpanded, busy) => `
    <button type="button" class="sa-immersive-dot ${busy ? "breathing" : ""}" aria-expanded="${ariaExpanded}" title="${busy ? "Agents au travail — afficher la liste" : "Agents au repos — afficher la liste"}" aria-label="Agents"></button>`;
  const render = (list, busy) => {
    if (expanded) {
      // Retour 30/08 : la liste déployée réutilise le rendu EXACT des entrées
      // de la liste standard (renderStaticAgentList ≡ renderDropdown), dans un
      // panneau aux mêmes couleurs que le dropdown standard. Aucun handler
      // d'action n'est branché sur les items : cliquer une entrée n'affiche
      // aucun détail — le clic replie le résumé (strictement informatif,
      // aucune fiche, aucune ouverture d'onglet). Le point reste rendu à côté
      // : il ne disparaît JAMAIS, la liste apparaît sous/sur lui.
      host.innerHTML = `${dot("true", busy)}
    <div class="sa-immersive-agents-drop">${renderStaticAgentList(list)}</div>`;
    } else {
      host.innerHTML = dot("false", busy);
    }
  };
  // Clic sur la zone (point OU liste) → bascule point ⇆ liste. Le point restant
  // toujours rendu, un re-clic dessus sert de poignée de fermeture. Les items
  // de la liste déployée restent informatifs : le clic ne fait que replier.
  host.addEventListener("click", (e) => {
    e.stopPropagation();
    expanded = !expanded;
    const snapshot = getAgentActivitySnapshot();
    render(snapshot.list, snapshot.busy);
  });
  // Rendu initial sans attendre le premier poll : replié (point). Tant que le
  // store n'a rien signalé, busy=false (état neutre : point éteint).
  const snapshot = getAgentActivitySnapshot();
  render(snapshot.list, snapshot.busy);
  return subscribeAgentActivity(render);
}

/** Rendu HTML de la liste déroulante (fond solide teinté violet, un item par agent).
 * Affiche la pastille (cercle) ainsi que le nom de l'agent, et son projet s'il
 * est présent. Le nom complet (avec projet) reste accessible au survol via un
 * tooltip (title) sur le bouton.
 *
 * Décision propriétaire : plus AUCUNE mention « arrière-plan » dans cette liste
 * (ni chip visible, ni suffixe d'infobulle) — le mot n'apportait rien et
 * alourdissait la rangée. Le signal « travaille sans onglet » reste porté
 * silencieusement par la classe `working-background` (nom en gras) et par la
 * pastille respirante ; la fiche (`renderCard`) et le panneau Activité de
 * l'onglet Agents gardent, eux, leur libellé explicite. */
export function renderDropdown(list) {
  if (!list.length) {
    return '<div class="agent-activity-empty">Aucun agent actif</div>';
  }
  return list
    .map(
      (a) => `
    <button class="agent-activity-item${isWorkingWithoutTab(a) ? " working-background" : ""}" data-agent-id="${esc(a.agentId)}" data-kind="${esc(a.kind)}" title="${esc(a.label)}${a.project ? " — " + esc(a.project) : ""}">
      <span class="agent-activity-item-dot ${isAgentWorking(a) ? "breathing" : ""} ${a.kind === "superagent" ? "superagent" : ""}"></span>
      <span class="agent-activity-item-label">${esc(a.label)}</span>
      ${a.project ? `<span class="agent-activity-item-project">${esc(a.project)}</span>` : ""}
    </button>`
    )
    .join("");
}

/** Rendu HTML de la fiche d'un agent (nom, état, projet, dernière activité). */
export function renderCard(agent) {
  const working = isAgentWorking(agent);
  const withoutTab = isWorkingWithoutTab(agent);
  // Regle 2 : l'entree dit en un coup d'oeil l'agent, son projet, et le fait
  // qu'il travaille en ARRIERE-PLAN (aucun onglet ouvert).
  const stateLabel = working ? (withoutTab ? "Travail (arrière-plan)" : "Travail") : "Repos";
  return `
    <div class="agent-activity-card-head">
      <span class="agent-activity-item-dot ${working ? "breathing" : ""} ${agent.kind === "superagent" ? "superagent" : ""}"></span>
      <span class="agent-activity-card-name">${esc(agent.label)}</span>
    </div>
    <div class="agent-activity-card-row"><span>État</span><span>${stateLabel}</span></div>
    <div class="agent-activity-card-row"><span>Projet</span><span>${esc(agent.project || "—")}</span></div>
    <div class="agent-activity-card-row"><span>Onglet</span><span>${withoutTab ? "Aucun (arrière-plan)" : "Ouvert"}</span></div>
    <div class="agent-activity-card-row"><span>Dernière activité</span><span>${esc(agent.lastActivity || "—")}</span></div>
    <button class="agent-activity-card-open" data-agent-id="${esc(agent.agentId)}" data-kind="${esc(agent.kind)}">Afficher l'onglet</button>
  `;
}

/**
 * Rendu HTML du bloc « travail en arrière-plan » du panneau « Activité » de
 * l'onglet Agents : une carte par session qui TRAVAILLE sans onglet ouvert
 * (agent + projet + mission + mention « arrière-plan »). Fonction PURE,
 * reutilise les classes de cartes existantes (.agents-board /
 * .agent-status-card) : aucun nouveau composant. Aucun onglet n'est ouvert par
 * ce rendu (purement informatif).
 * @param {Array} missions sortie de buildBackgroundWorkMissions.
 * @returns {string} HTML (chaine vide si aucune session en arriere-plan).
 */
export function renderBackgroundWorkersHtml(missions) {
  const list = missions || [];
  if (!list.length) return "";
  const cards = list
    .map(
      (m) => `
        <div class="agent-status-card running working-background" data-agent-id="${esc(m.agentId)}">
          <span class="asc-icon">🤖</span>
          <div class="asc-info">
            <div class="asc-name">${esc(m.agent)}${m.project ? ` — ${esc(m.project)}` : ""}</div>
            <div class="asc-detail">${esc(m.mission)}</div>
          </div>
          <span class="asc-chip running">arrière-plan</span>
        </div>`
    )
    .join("");
  return `
      <div class="agents-board-title">Travail en arrière-plan (aucun onglet ouvert)</div>
      <div class="agents-board">${cards}</div>`;
}

/**
 * Initialise l'indicateur d'activité des agents.
 * @param {object} tabs — instance du gestionnaire d'onglets (tabs.js).
 */
export function initAgentActivity(tabs) {
  const container = document.getElementById("agent-activity");
  const dot = document.getElementById("agent-activity-dot");
  const dropdown = document.getElementById("agent-activity-dropdown");
  const card = document.getElementById("agent-activity-card");
  if (!container || !dot || !dropdown || !card) return;

  let currentList = [];
  let currentCardAgent = null;

  // Consommation du store partagé (poll 2 s + push agent-state-changed, même
  // filtrage flattenAgents) : comportement identique à l'ancien refresh()
  // interne, sans polling propre (source unique pour tous les affichages).
  subscribeAgentActivity((list, busy) => {
    currentList = list;
    dot.classList.toggle("breathing", busy);
    dot.title = busy ? "Un agent travaille" : "Agents au repos";
    if (!dropdown.classList.contains("hidden")) {
      dropdown.innerHTML = renderDropdown(list);
    }
    if (currentCardAgent) {
      const updated = list.find(
        (a) => a.agentId === currentCardAgent.agentId && a.kind === currentCardAgent.kind
      );
      if (updated) {
        currentCardAgent = updated;
        card.innerHTML = renderCard(updated);
      }
    }
  });

  function toggleDropdown() {
    if (dropdown.classList.contains("hidden")) {
      dropdown.innerHTML = renderDropdown(currentList);
      dropdown.classList.remove("hidden");
      card.classList.add("hidden");
      localStorage.setItem("agent-activity-expanded", "true");
    } else {
      dropdown.classList.add("hidden");
      localStorage.setItem("agent-activity-expanded", "false");
    }
  }

  // Clic sur le cercle → bascule l'ouverture/fermeture de la liste.
  dot.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Clic sur un agent de la liste → affiche sa fiche (la liste se replie).
  dropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".agent-activity-item");
    if (!item) return;
    const agent = currentList.find(
      (a) => a.agentId === item.dataset.agentId && a.kind === item.dataset.kind
    );
    if (!agent) return;
    currentCardAgent = agent;
    card.innerHTML = renderCard(agent);
    dropdown.classList.add("hidden");
    localStorage.setItem("agent-activity-expanded", "false");
    card.classList.remove("hidden");
  });

  // Bouton « Afficher l'onglet » → ouvre l'onglet de l'agent du BON projet.
  card.addEventListener("click", async (e) => {
    const btn = e.target.closest(".agent-activity-card-open");
    if (!btn) return;
    const agent = currentList.find(
      (a) => a.agentId === btn.dataset.agentId && a.kind === btn.dataset.kind
    );
    if (!agent) return;
    if (agent.kind === "superagent") {
      tabs.openFile(agent.label, "superagent");
    } else if (agent.kind === "assistant") {
      // Agent d'assistant SANS projet : il tourne dans l'espace réservé
      // ~/.pilot/assistant, aucun projet réel à activer. On ouvre son onglet via
      // son id brut ET l'espace réservé (5ᵉ argument) pour que le gestionnaire
      // d'onglets ne retombe pas sur le projet actif (tâche #140).
      tabs._openAgent(agent.label, agent.rawId, false, true, ASSISTANT_SPACE);
    } else {
      // L'onglet d'un agent est lié au PROJET actif (_openAgent utilise
      // window._pilotProjectPath). Si l'agent cliqué appartient à un autre
      // projet, basculer d'abord sur ce projet via la sidebar, puis ouvrir
      // son onglet avec son id brut (rawId). `agentId` (composite unique)
      // ne sert qu'à l'identification interne/du clic, pas à l'ouverture.
      const targetPath = agent.projectPath;
      if (targetPath && targetPath !== (window._pilotProjectPath || "")) {
        const sidebar = window._pilotGetSidebar ? window._pilotGetSidebar() : null;
        if (sidebar) {
          try { await sidebar._activateProject(targetPath); } catch (_) {}
        }
      }
      tabs._openAgent(agent.label, agent.rawId);
    }
    card.classList.add("hidden");
  });

  // NOTE : pas de fermeture au clic extérieur — la liste reste ouverte jusqu'à
  // ce qu'on reclique sur le cercle principal (comportement « liste persistante »).
  // L'état déplié/replié est persisté via localStorage (agent-activity-expanded).
  // Le poll 2 s + le push `agent-state-changed` sont gérés par le store partagé
  // (ensureActivityStore), auquel l'indicateur vient de s'abonner.

  // Restaure l'état déplié/replié persisté (localStorage).
  if (localStorage.getItem("agent-activity-expanded") === "true") {
    dropdown.innerHTML = renderDropdown(currentList);
    dropdown.classList.remove("hidden");
  }
}
