// agent-activity.js — Suivi du travail (haut droite)
//
// Cercle flottant en haut à droite reflétant l'activité de TOUS les agents
// (assistant + codeurs). Le cercle « respire » (animation agent-pulse) dès
// qu'UN agent travaille. Au clic : UN SEUL panneau (fond subtilement teinté
// violet assistant) à TROIS onglets, dans cet ordre DÉFINITIF (décision
// propriétaire, qui prime sur l'ordre initialement demandé) :
//   1. « Agents »     — la liste des agents (pastille respirante, nom, projet)
//                       puis la fiche de l'agent cliqué ;
//   2. « Tâches »     — les missions réellement en cours et la file « en
//                       attente » des agents ;
//   3. « Événements » — le journal des événements système (délégations,
//                       démarrages/arrêts, erreurs, connexions perdues).
// Les volets 2 et 3 sont ceux de l'ancien panneau de la cloche de l'onglet
// Assistant, DÉPLACÉS ici : mêmes contenus, mêmes réglages, un seul endroit.
//
// Comportement du panneau : le clic sur le cercle bascule ouverture/fermeture ;
// il reste OUVERT tant qu'on ne reclique pas sur ce cercle, sur × ou sur Échap
// (pas de fermeture au clic extérieur). L'onglet actif et l'état ouvert/replié
// sont persistés (localStorage) et restaurés au démarrage — dernier onglet
// utilisé, sinon « Agents ».
//
// Source de vérité : `get_agent_supervision` (dashboard.rs), pollée toutes les
// 2 s, + événement push `agent-state-changed` (Rust → JS) pour un rafraîchissement
// immédiat. Aucune commande Rust ajoutée.
//
// Le poll + le filtrage sont centralisés dans un « store » partagé
// (subscribeAgentActivity) consommé par le panneau ci-dessus ET par le
// résumé repliable des agents du mode « Assistant Only » immersif
// (super-agent.js) — même source de données, même filtrage, aucun polling
// dupliqué.
//
// Les fonctions pures (flattenAgents, anyBusy, shortMission, buildRunningMissions,
// renderDropdown, renderCard, renderStaticAgentList, formatLastActivity) sont
// testées dans agent-activity.test.js ; le panneau à trois onglets l'est dans
// panneau-suivi-trois-onglets.test.js.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { formatWorkingSince, formatWorkingSinceShort } from "./duree-travail.js";
// PERSONNAGE ACTIF (Présences) : la liste des agents en haut a droite porte le
// MEME nom que le titre de l'onglet. La supervision nomme la session de
// l'assistant d'apres le nom REGLE (« Nova ») : sans ce branchement, le nom du
// personnage etait ignore partout ailleurs que dans l'onglet. Une seule regle,
// celle de `assistant-persona.js` — aucune copie de la priorite ici.
import { getAssistantPersonaName, personaDisplayName } from "./assistant-persona.js";

// Dernière activité connue par agent (timestamp), alimentée par
// `agent-state-changed`. Clé = agentId (id brut, ex: "superagent" ou l'id agent).
const lastActivity = new Map();

// Instant où chaque agent a été vu TRAVAILLANT pour la première fois (ms epoch).
// Clé = agentId composite (agent + projet). Sert à afficher « En cours depuis
// 3 min 12 s » : un travail est un INTERVALLE daté, pas un événement instantané
// (rapport `.pilot/rapports/rapport-diagnostic-attente-silencieuse.md`).
// Entrée effacée dès que l'agent ne travaille plus : aucune durée périmée.
const workingSince = new Map();

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
 * Mémorise (et relit) l'instant où un agent a commencé à travailler.
 * Fonction PURE vis-à-vis du DOM : le magasin est injecté, donc testable.
 * @param {Map<string,number>} map magasin `agentId → timestamp de début`.
 * @param {string} key identité de l'agent (agentId composite).
 * @param {boolean} working l'agent travaille-t-il à cet instant ?
 * @returns {number|null} début du travail en cours, ou null au repos.
 */
function trackWorkingSince(map, key, working) {
  if (!map || typeof map.get !== "function") return null;
  if (!working) {
    map.delete(key);
    return null;
  }
  const known = map.get(key);
  if (known) return known;
  const now = Date.now();
  map.set(key, now);
  return now;
}

/**
 * Aplatit la supervision en une liste plate d'agents.
 * @param {object} supervision — sortie de get_agent_supervision ({projects:[...]}).
 * @param {Map<string,number>} [lastActivityMap] — timestamps de dernière activité.
 * @param {Map<string,number>} [workingSinceMap] — instants de début du travail en
 *   cours (facultatif : sans magasin, `workingSince` vaut null — aucune durée
 *   inventée, aucun effet de bord).
 * @param {Map<string,{sig:string,since:number,started:boolean}>} [missionStartMap] —
 *   mémoire du suivi des **démarrages** (par défaut la mémoire du module, comme
 *   la supervision courante ; une mémoire explicite est acceptée pour les
 *   tests). Une entrée ne porte le champ additif `starting` que lorsqu'il est
 *   vrai : la forme historique est préservée dans tous les autres cas.
 * @returns {Array<{agentId,rawId,label,project,projectPath,state,busy,working,workingSince,lastActivity,lastActivityRelative,kind,starting?}>}
 */
export function flattenAgents(
  supervision,
  lastActivityMap,
  workingSinceMap,
  missionStartMap = missionStartTracking
) {
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
      // Affichage vs IDENTITÉ : `name` est un champ ADDITIF de la supervision
      // (nom lisible d'un agent jetable, publié par dashboard.rs). Le libellé
      // affiché le prend quand il existe et retombe sur l'identifiant technique
      // sinon (agents du registre : comportement inchangé). L'IDENTITÉ reste
      // l'identifiant brut `a.agent` (`eph-…` pour un agent jetable) : elle
      // alimente `rawId` (arrêt ciblé, ouverture d'onglet) et la clé
      // d'horodatage d'activité. Un libellé mis à la place de l'identifiant
      // casserait ces actions.
      // L'assistant : le libelle affiche suit la SEULE regle de nom (personnage
      // actif -> nom regle -> « Assistant »). Le nom que porte la session cote
      // moteur EST le nom regle : il ne doit pas gagner sur le personnage.
      // L'IDENTITE, elle, ne change pas (`rawId`/`agentId` restent « superagent »).
      const label = isSuper
        ? personaDisplayName(getAssistantPersonaName(), a.name || a.agent || "")
        : a.name || a.agent || "";
      const state = a.state || "stopped";
      const busy = state === "running" || state === "compacting";
      // Travail EFFECTIF de la session, lu sur l'ACTIVITE REELLE : soit l'agent
      // produit (busy), soit un outil long est en cours (compilation, tests :
      // silencieux mais reel). C'est la SEULE verite de « il travaille » :
      // jamais « un onglet est ouvert ».
      // Le champ backend `isWorking` N'ENTRE PAS dans cette verite : il reste
      // vrai 120 s apres la fin d'un tour (fenetre « actif recemment ») alors
      // que l'etat publie est deja « idle » — il faisait « respirer » a tort
      // la barre de saisie et les pastilles pendant 2 minutes. Il reste
      // publie par le backend pour les sondes, mais l'affichage ne s'en sert
      // plus. Fonction pure partagee (isAgentWorking).
      const toolInProgress = a.toolInProgress === true;
      const working = busy || toolInProgress;
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
      // l'id reste "superagent" ; pour un agent, on combine l'IDENTIFIANT BRUT
      // + chemin projet (ex: "codeur|C:/proj/Pilot") pour lever toute ambiguïté
      // dans la liste aplatie et au clic. `rawId` garde l'id brut (`a.agent`) :
      // jamais le libellé d'affichage, qui peut être un nom lisible (agent
      // jetable) et ne sert qu'à l'affichage.
      const rawId = isSuper ? "superagent" : (a.agent || label);
      const agentId = isSuper ? "superagent" : (isAssistant ? rawId : `${rawId}|${project}`);
      // Début du travail EN COURS (intervalle daté) : mémorisé la première fois
      // qu'on voit l'agent travailler, effacé dès qu'il s'arrête.
      const startedAt = trackWorkingSince(workingSinceMap, agentId, working);
      // Famille « Demarrage » : mission ACCEPTEE mais pas encore DEMARREE. Le
      // calcul est fait AVANT l'empilement (la memoire de suivi est keyee par
      // `agentId`) et son resultat n'est pose que lorsqu'il est vrai : la forme
      // historique des entrees est preservee pour tous les autres consommateurs
      // (liste deroulante du cercle, onglet Agents, resume immersif).
      const starting = trackMissionStarting(missionStartMap, {
        agentId,
        prompt: typeof a.prompt === "string" ? a.prompt : "",
        resume: typeof a.resume === "string" ? a.resume : "",
        state,
        working,
      });
      const entry = {
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
        // Début du travail en cours (ms epoch) ou null : l'affichage en déduit
        // « En cours depuis … ». Jamais une valeur inventée.
        workingSince: startedAt,
        // Dernière activité : le RELATIF fourni par le backend (« il y a 3 s »)
        // est préféré quand il existe, car il AVANCE pendant le travail — c'est
        // lui qui prouve que quelque chose se passe. Repli sur l'heure locale
        // (map du push `agent-state-changed`, puis champ ISO de la supervision).
        lastActivity:
          formatLastActivity(lastActivityMap ? lastActivityMap.get(rawId) : undefined) ||
          formatLastActivity(a.lastActivity) ||
          null,
        lastActivityRelative:
          typeof a.lastActivityRelative === "string" ? a.lastActivityRelative : "",
        kind: isSuper ? "superagent" : (isAssistant ? "assistant" : "agent"),
      };
      // Champ ADDITIF « starting » : present SEULEMENT quand la mission est en
      // demarrage (voir MISSION_START_MAX_MS et trackMissionStarting).
      if (starting) entry.starting = true;
      list.push(entry);
    }
  }
  // Purge des durées devenues orphelines (agent sorti de la liste, arrêté) :
  // aucune entrée fantôme ne peut plus produire une durée aberrante.
  if (workingSinceMap && typeof workingSinceMap.keys === "function") {
    const stillWorking = new Set(list.filter((a) => a.working).map((a) => a.agentId));
    for (const key of [...workingSinceMap.keys()]) {
      if (!stillWorking.has(key)) workingSinceMap.delete(key);
    }
  }
  return list;
}

/**
 * true si au moins un agent TRAVAILLE (au sens de `isAgentWorking`).
 * Le cercle en haut à droite et son infobulle s'appuient sur CETTE vérité :
 * `busy` seul laissait le point s'éteindre et l'infobulle annoncer « Agents au
 * repos » pendant qu'un outil long (compilation, tests) tournait réellement.
 */
export function anyBusy(list) {
  return list.some(isAgentWorking);
}

// ── Travail effectif et travail SANS ONGLET (regle 1) ──
// Une seule source de verite pour « cet agent travaille-t-il ? », partagee par
// la liste deroulante (cercle en haut a droite), la fiche d'agent, le volet
// « Tâches » du panneau du suivi du travail et le panneau « Activite » de
// l'onglet Agents : aucune logique de vivacite n'est dupliquee.

/**
 * true si la session TRAVAILLE reellement a cet instant. Fonction PURE.
 *  - `busy` : l'agent produit une reponse (ou compacte) ;
 *  - `toolInProgress` : un outil long est en cours (build, tests, install) ;
 *  - `working` : resultat deja calcule par flattenAgents.
 * Le champ backend `isWorking` est VOLONTAIREMENT ignore : il vaut vrai pendant
 * 120 s apres la fin d'un tour (fenetre « actif recemment ») alors que la
 * session est deja au repos, ce qui faisait respirer l'indicateur et la barre
 * de saisie sans aucun travail. L'etat se lit sur l'ACTIVITE REELLE, jamais sur
 * une fenetre de temps.
 * Un agent vivant mais AU REPOS n'est jamais « travaillant ».
 * @param {object} agent entree de liste (flattenAgents) ou objet partiel.
 * @returns {boolean}
 */
export function isAgentWorking(agent) {
  if (!agent) return false;
  return (
    agent.working === true ||
    agent.busy === true ||
    agent.toolInProgress === true
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

// ── Missions ACCEPTEES mais pas encore DEMARREES (groupe « Demarrage ») ──────
// Defaut corrige (docs/rapports/RAPPORT-taches-invisibles.md § 3 cas (c),
// correction : docs/rapports/RAPPORT-taches-demarrage-b1.md) : une mission
// ACCEPTEE mais pas encore DEMARREE n'apparaissait dans AUCUN groupe. Le prompt
// est pourtant enregistre par le coeur des l'envoi et publie (champs additifs
// `prompt` / `resume` de la supervision), mais l'etat publie reste « idle » tant
// que le moteur n'a pas inscrit la session dans son observateur d'anomalie
// (spawn de la session + sonde du backend : jusqu'a 2 x 5 s a froid, plus 2 s de
// poll). `isAgentWorking` est donc faux et `buildRunningMissions` ecartait la
// ligne : la liste restait VIDE plusieurs secondes alors que la mission etait
// partie.
//
// La famille est deduite de la SUPERVISION DEJA RECUE (store d'activite
// partage) : aucun appel nouveau au moteur, aucune structure metier dupliquee.
// Une mission est « en demarrage » quand la session PORTE une mission
// (`prompt` / `resume`) et que l'agent ne travaille pas ENCORE.
//
// Deux garde-fous, tous deux couverts par `taches-demarrage.test.js` :
//  1. DEDOUBLONNAGE : des que l'agent TRAVAILLE (ou a travaille) pour cette
//     mission, elle quitte le groupe « Demarrage » — elle est alors listee dans
//     « En cours » par `buildRunningMissions`. Jamais deux fois.
//  2. BORNE HONNETE (`MISSION_START_MAX_MS`) : une entree qui ne devient jamais
//     « running » n'y reste pas eternellement (lancement echoue = aucune ligne
//     fantome), et elle ne disparait pas avant que l'utilisateur ait pu la voir.

/**
 * Borne de vie d'une entree de « Demarrage » (ms).
 *
 * Mesuree depuis le PREMIER passage du front sur cette mission (le poll suivant
 * l'envoi : au plus 2 s apres, donc la fenetre vue par l'utilisateur reste
 * >= 28 s).
 *
 * Pourquoi 30 s : la fenetre reelle du defaut est le spawn de la session plus
 * la sonde du backend, soit JUSQU'A 2 x 5 s = 10 s a froid, plus 2 s de poll =
 * 12 s au pire — la borne vaut 2,5 x ce pire cas. Une mission qui demarre
 * reellement bascule bien avant ; un lancement qui n'aboutit JAMAIS ne laisse
 * aucune ligne fantome au-dela de 30 s. Ce groupe est une information
 * TRANSITOIRE, pas un historique : au-dela, l'inventaire des sessions reste
 * consultable dans l'onglet « Agents ».
 */
export const MISSION_START_MAX_MS = 30_000;

/** Libelle du groupe « Demarrage » (explicite, distinct des deux autres). */
export const MISSION_START_GROUP_LABEL = "Démarrage";

/**
 * Memoire de suivi des demarrages : `agentId` -> `{ sig, since, started }`.
 * `sig` = signature de la mission (resume fourni + prompt publie) ; `since` =
 * premier instant ou le front l'a vue ; `started` = l'agent a travaille pour
 * cette mission. Bornee par le nombre de couples (projet, agent) : aucune purge
 * necessaire (une entree terminee vaut `started: true` et n'est plus jamais
 * « en demarrage »).
 */
const missionStartTracking = new Map();

/**
 * Signature de la mission portee par une entree de la liste : resume FOURNI +
 * prompt publie. Fonction PURE : deux missions differentes ont deux signatures
 * differentes (un nouveau prompt change la signature, donc le suivi repart).
 * @param {object} agent entree de liste (ou objet partiel).
 * @returns {string}
 */
export function missionStartSignature(agent) {
  if (!agent) return "";
  const resume = typeof agent.resume === "string" ? agent.resume : "";
  const prompt = typeof agent.prompt === "string" ? agent.prompt : "";
  return `${resume}\u001f${prompt}`;
}

/**
 * Decide si une entree de la liste est une mission ACCEPTEE mais pas encore
 * DEMARREE, et met a jour la memoire de suivi. Fonction PURE vis-a-vis du DOM
 * (magasin et horloge injectes, donc testable).
 *
 * Regles, dans cet ordre :
 *  1. aucune mission portee par la session (ni resume ni prompt) -> rien ;
 *  2. l'agent TRAVAILLE -> la mission est en cours : `started` est pose et
 *     l'entree n'est JAMAIS « en demarrage » (dedoublonnage) ;
 *  3. l'agent a DEJA travaille pour cette meme mission -> jamais « en
 *     demarrage » (aucun retour en arriere apres la fin d'un tour) ;
 *  4. la session n'est ni `idle` ni `running` (`paused` / `stopped`) -> rien :
 *     elle n'a pas de mission qui part ;
 *  5. la borne `MISSION_START_MAX_MS` est depassee -> rien (aucune ligne
 *     fantome, et aucune disparition avant d'avoir pu etre vue).
 * @param {Map<string,{sig:string,since:number,started:boolean}>} map magasin de suivi.
 * @param {{agentId?:string, resume?:string, prompt?:string, state?:string, working?:boolean, busy?:boolean, toolInProgress?:boolean}} agent
 * @param {number} [now] horloge (ms epoch) — injectee pour les tests.
 * @returns {boolean} true si l'entree appartient au groupe « Demarrage ».
 */
export function trackMissionStarting(map, agent, now = Date.now()) {
  if (!map || typeof map.get !== "function" || !agent || !agent.agentId) return false;
  const sig = missionStartSignature(agent);
  const hasMission = sig.replace(/\u001f/g, "").trim() !== "";
  if (!hasMission) {
    map.delete(agent.agentId);
    return false;
  }
  const working = isAgentWorking(agent);
  const prev = map.get(agent.agentId);
  // Nouvelle mission (signature differente) : le suivi repart de cet instant.
  const known = prev && prev.sig === sig ? prev : { sig, since: now, started: false };
  if (working) known.started = true;
  map.set(agent.agentId, known);
  if (working) return false;
  if (known.started) return false;
  if (agent.state !== "idle" && agent.state !== "running") return false;
  const age = now - known.since;
  if (!Number.isFinite(age) || age < 0 || age > MISSION_START_MAX_MS) return false;
  return true;
}

/**
 * Missions ACCEPTEES mais pas encore DEMARREES, pretes a entrer dans le calcul
 * UNIQUE des missions (`buildRunningMissions`, via `collectQueuedMissions`).
 * Fonction PURE : elle ne fait que filtrer la liste issue du store partage.
 *
 * Les sources de la mission sont transmises BRUTES (`prompt` / `resume` /
 * `kind`) : `buildRunningMissions` applique ainsi le MEME ordre de repli que
 * pour une mission en cours — le groupe « Demarrage » ne peut pas afficher une
 * autre phrase que « En cours » pour la meme mission.
 * @param {Array} list liste aplatie (flattenAgents) — le drapeau `starting` y a
 *   deja ete calcule (champ additif, present seulement quand il est vrai).
 * @returns {Array<{agent:string, project:string, mission:string, resume:string, kind:string, starting:boolean}>}
 */
export function buildStartingMissions(list) {
  const out = [];
  for (const a of list || []) {
    if (!a || a.starting !== true) continue;
    out.push({
      agent: a.label || "",
      project: a.project || "Assistant",
      mission: a.prompt || "",
      resume: a.resume || "",
      kind: a.kind || "",
      starting: true,
    });
  }
  return out;
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
      mission: resolveMissionLabel(a.resume, a.prompt, a.kind),
    }));
}

// ── Missions en cours (volet « Taches » du panneau du suivi du travail) ──

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
 *  2. pour l'**assistant**, jamais d'interprétation de son `prompt` : ce champ
 *     contient son message complet, c'est-à-dire TOUT son prompt système de
 *     règles suivi de la demande. Le lire revenait à afficher un extrait de ses
 *     règles dans le panneau (« Si une tâche déléguée ou une action échoue… »).
 *     Sans résumé exploitable, on dit une chose neutre et vraie
 *     (`MISSION_ASSISTANT_FALLBACK`) ;
 *  3. sinon l'**extrait de l'objectif** de la demande (`shortMission`, qui porte
 *     déjà ses propres replis honnêtes : « mission non communiquée » quand le
 *     texte n'est que le rôle, « (demande non précisée) » quand il n'y a rien).
 * Fonction PURE : elle ne déduit jamais un résumé par approximation, elle
 * choisit simplement la meilleure source DISPONIBLE.
 * @param {unknown} resume — résumé court fourni avec la demande (facultatif).
 * @param {string} prompt — texte du dernier prompt réellement envoyé.
 * @param {string} [kind] — `"superagent"` pour l'assistant, `"agent"` sinon.
 * @returns {string} libellé de mission, toujours non vide.
 */
export function resolveMissionLabel(resume, prompt, kind) {
  const provided = normalizeMissionResume(resume);
  if (provided) return provided;
  if (kind === "superagent") return MISSION_ASSISTANT_FALLBACK;
  return shortMission(prompt);
}

/**
 * Repli de l'**assistant** quand aucune description fiable n'existe : neutre,
 * court et vrai. Il ne prétend rien sur la tâche (contrairement à un extrait de
 * son prompt système, qui parle de ses RÈGLES), et il n'usurpe pas le nom de
 * l'assistant, réglable par l'utilisateur (la ligne principale l'affiche déjà).
 */
export const MISSION_ASSISTANT_FALLBACK = "travail en cours";

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
 * Construit la liste des missions RÉELLEMENT en cours à afficher (volet
 * « Tâches » du panneau du suivi du travail). Fonction PURE.
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
 * @returns {Array<{agent: string, project: string, mission: string, waiting: boolean,
 *   since?: number, toolInProgress?: boolean}>}
 */
export function buildRunningMissions(list, queued) {
  const out = [];
  for (const a of list || []) {
    if (!isAgentWorking(a)) continue;
    const entry = {
      agent: a.label || "",
      project: a.project || "Assistant",
      // Ordre de repli strict : résumé FOURNI avec la demande, sinon extrait de
      // l'objectif du prompt, sinon libellé honnête (shortMission). Pour
      // l'assistant (`kind === "superagent"`), le prompt n'est JAMAIS interprété
      // (il contient ses règles) : repli neutre. La forme de l'entrée reste
      // identique (`resume` n'est pas recopié).
      mission: resolveMissionLabel(a.resume, a.prompt, a.kind),
      waiting: false,
    };
    // Début du travail en cours : ajouté SEULEMENT quand il est connu (champ
    // additif, absent sinon — la forme historique de l'entrée est préservée).
    if (a.workingSince) entry.since = a.workingSince;
    // Additif : l'agent exécute une OPÉRATION (outil en cours) et pas seulement
    // un raisonnement. La colonne de droite de l'écran Vocal s'en sert pour sa
    // ligne d'activité (« … exécute une opération » / « … réfléchit »). Posé
    // SEULEMENT s'il vaut vrai : la forme historique de l'entrée est préservée
    // pour tous les autres consommateurs.
    if (a.toolInProgress === true) entry.toolInProgress = true;
    out.push(entry);
  }
  for (const q of queued || []) {
    if (!q) continue;
    const entry = {
      agent: q.agent || "",
      project: q.project || "Assistant",
      // `kind` est transmis par la famille « Démarrage » (la mission de
      // l'Assistant n'est jamais déduite de son prompt système) ; absent des
      // familles de file historiques : comportement inchangé pour elles.
      mission: resolveMissionLabel(q.resume, q.mission, q.kind),
      waiting: true,
    };
    // Drapeau additif : la mission est ACCEPTÉE mais pas encore DÉMARRÉE (elle
    // reste du côté « pas encore en cours » — donc comptée dans le total du
    // bouton — mais elle est rendue dans son groupe « Démarrage »).
    if (q.starting === true) entry.starting = true;
    out.push(entry);
  }
  return out;
}

/**
 * Répartit les missions en deux FAMILLES ORDONNÉES : celles qui TOURNENT déjà
 * (`waiting: false`) et celles qui ne tournent PAS encore (`waiting: true`) —
 * cette seconde famille contient la file d'attente ET les missions acceptées en
 * cours de démarrage (`starting: true`, rendues dans leur propre groupe).
 * L'ordre d'origine — donc l'ordre de la file — est conservé. C'est CETTE
 * répartition qui alimente le bouton « Travail » (`running.length` en cours,
 * `waiting.length` en attente) et le volet : le bouton ne peut pas la contredire.
 * Fonction PURE.
 * @param {Array<{agent, project, mission, waiting, starting?}>} missions
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
export function missionWho(m) {
  const agent = m.agent || "";
  const project = m.project || "";
  if (agent && project) return `${agent} — ${project}`;
  return agent || project || "Assistant";
}

/**
 * Rendu HTML du volet des missions du panneau (bas à droite). Fonction PURE.
 *
 * TROIS groupes EXPLICITES et NUMÉROTÉS, dans cet ordre — « En cours (n) »,
 * « Démarrage (n) » puis « En attente (n) » — pour que l'on voie d'un coup d'œil
 * ce qui tourne, ce qui vient d'être accepté et n'a pas encore démarré, ET dans
 * quel ordre la file attend. Chaque ligne porte son RANG et, sur la ligne
 * principale, l'identité « <agent> — <projet> » ; **EN DESSOUS**, sur la ligne
 * secondaire (sa place historique, inchangée), le texte d'indication de la
 * tâche : le résumé court fourni avec la demande, sinon l'extrait de l'objectif.
 * Cet ordre visuel (agent et projet AU-DESSUS, résumé EN DESSOUS) est FIGÉ par
 * un test : il ne doit pas être inversé (décision du propriétaire, disposition
 * d'origine). Aucune mission → message explicite, jamais une liste vide
 * trompeuse.
 *
 * Le groupe « Démarrage » ne crée AUCUNE interface nouvelle : c'est le même
 * titre de groupe et la même ligne que les deux autres, avec un statut et une
 * couleur déjà existants (`tone-unqualified`). Aucun point qui respire et aucune
 * durée : la mission ne travaille pas encore, donc elle n'a pas de preuve de vie.
 * @param {Array<{agent, project, mission, waiting, starting?}>} missions — buildRunningMissions.
 * @returns {string} HTML du volet.
 */
export function renderMissionsPanelHtml(missions) {
  const { running, waiting } = splitMissions(missions);
  if (!running.length && !waiting.length) {
    return '<div class="dash-muted">Aucune mission en cours.</div>';
  }
  // Les missions de démarrage restent du côté « pas encore en cours » de
  // `splitMissions` (donc dans le TOTAL du bouton « Travail »), mais elles sont
  // rendues dans leur PROPRE groupe : une seule ligne, jamais deux.
  const starting = waiting.filter((m) => m.starting === true);
  const queueOnly = waiting.filter((m) => m.starting !== true);
  const group = (title, list, mode) => {
    if (!list.length) return "";
    const items = list
      .map((m, i) => {
        // Preuve de vie : une ligne « en cours » porte un point qui respire et la
        // durée écoulée (« depuis 3 min »). Rien de tout cela pour une mission
        // seulement EN ATTENTE — ni pour une mission EN DÉMARRAGE, qui ne
        // travaille pas encore : seule une ligne qui travaille est datée.
        const sinceLabel = mode === "running" ? formatWorkingSinceShort(m.since) : null;
        const dot = mode === "running" ? '<span class="sa-missions-dot"></span>' : "";
        const status =
          mode === "running" ? "en cours" : mode === "starting" ? "démarrage" : "en attente";
        const tone =
          mode === "running" ? "tone-progress" : mode === "starting" ? "tone-unqualified" : "tone-todo";
        return `
        <div class="sa-task-item ${mode}">
          <div class="sa-task-head">
            ${dot}<span class="sa-task-title"><span class="sa-missions-rank">${i + 1}.</span>${esc(missionWho(m))}</span>
            <span class="sa-task-status ${tone}">${status}</span>${sinceLabel ? `<span class="sa-task-since">${esc(sinceLabel)}</span>` : ""}
          </div>
          <div class="sa-task-meta">${esc(m.mission)}</div>
        </div>`;
      })
      .join("");
    return `<div class="sa-task-client sa-missions-group ${mode}">${esc(title)} (${list.length})</div>${items}`;
  };
  return `${group("En cours", running, "running")}${group(MISSION_START_GROUP_LABEL, starting, "starting")}${group("En attente", queueOnly, "waiting")}`;
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
    const list = flattenAgents(sup, lastActivity, workingSince);
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
  // PREUVE DE VIE : pendant une commande longue (compilation, tests), la fiche
  // affiche depuis COMBIEN DE TEMPS l'agent travaille. Sans cette ligne, la seule
  // donnée datée (« Dernière activité ») restait figée pendant dix minutes.
  const sinceLabel = working ? formatWorkingSince(agent.workingSince) : null;
  // « Dernière activité » : le relatif fourni par le backend est préféré (il
  // avance pendant le travail) ; repli sur l'heure locale, puis sur « — ».
  const lastLabel = agent.lastActivityRelative || agent.lastActivity || "—";
  return `
    <div class="agent-activity-card-head">
      <span class="agent-activity-item-dot ${working ? "breathing" : ""} ${agent.kind === "superagent" ? "superagent" : ""}"></span>
      <span class="agent-activity-card-name">${esc(agent.label)}</span>
    </div>
    <div class="agent-activity-card-row"><span>État</span><span>${stateLabel}</span></div>
    ${sinceLabel ? `<div class="agent-activity-card-row agent-activity-card-working"><span>En cours depuis</span><span>${esc(sinceLabel.replace("En cours depuis ", ""))}</span></div>` : ""}
    <div class="agent-activity-card-row"><span>Projet</span><span>${esc(agent.project || "—")}</span></div>
    <div class="agent-activity-card-row"><span>Onglet</span><span>${withoutTab ? "Aucun (arrière-plan)" : "Ouvert"}</span></div>
    <div class="agent-activity-card-row"><span>Dernière activité</span><span>${esc(lastLabel)}</span></div>
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
 * Initialise le suivi du travail : le cercle d'activité (haut droite) ouvre UN
 * SEUL panneau à TROIS onglets — « Agents » (qui travaille), « Tâches »
 * (missions en cours et en attente) et « Événements » (journal système). Les deux
 * derniers volets sont ceux de l'ancien panneau de la cloche de l'onglet
 * Assistant, DÉPLACÉS ici (mêmes contenus, mêmes réglages, un seul endroit).
 * @param {object} tabs — instance du gestionnaire d'onglets (tabs.js).
 */
export function initAgentActivity(tabs) {
  const container = document.getElementById("agent-activity");
  const dot = document.getElementById("agent-activity-dot");
  const panel = document.getElementById("agent-activity-dropdown");
  const listEl = document.getElementById("agent-activity-list");
  const card = document.getElementById("agent-activity-card");
  if (!container || !dot || !panel || !listEl || !card) return;

  let currentCardAgent = null;

  // Consommation du store partagé (poll 2 s + push agent-state-changed, même
  // filtrage flattenAgents) : comportement identique à l'ancien refresh()
  // interne, sans polling propre (source unique pour tous les affichages).
  subscribeAgentActivity((list, busy) => {
    dot.classList.toggle("breathing", busy);
    dot.title = busy ? "Un agent travaille" : "Agents au repos";
    if (isAgentPanelOpen() && panelActiveTab === "agents") renderAgentsPane();
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

  // Clic sur l'entree « Travail » → ouvre le panneau sur le dernier onglet
  // utilisé (à défaut « Agents ») ; un second clic le referme.
  // LOT 4 : l'entree est un bouton NOMMÉ de la bande de contexte ; le cercle
  // `#agent-activity-dot` en est désormais le CONTENU (une pastille d'état, pas
  // un bouton). Le comportement est le même qu'avant : un seul écouteur, la
  // même bascule, la même mémoire d'onglet.
  const entry = document.getElementById("agent-activity-entry");
  const trigger = entry || dot;
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleAgentPanel();
  });

  // Clic sur un agent de la liste → affiche sa fiche (le panneau se referme).
  listEl.addEventListener("click", (e) => {
    const item = e.target.closest(".agent-activity-item");
    if (!item) return;
    const agent = getAgentActivitySnapshot().list.find(
      (a) => a.agentId === item.dataset.agentId && a.kind === item.dataset.kind
    );
    if (!agent) return;
    currentCardAgent = agent;
    card.innerHTML = renderCard(agent);
    closeAgentPanel();
    card.classList.remove("hidden");
  });

  // Bouton « Afficher l'onglet » → ouvre l'onglet de l'agent du BON projet.
  card.addEventListener("click", async (e) => {
    const btn = e.target.closest(".agent-activity-card-open");
    if (!btn) return;
    const agent = getAgentActivitySnapshot().list.find(
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

  // Boutons d'onglet du panneau (souris + clavier).
  for (const tab of AGENT_PANEL_TABS) {
    const btn = document.getElementById(`agent-activity-tab-${tab}`);
    if (btn) btn.addEventListener("click", () => selectAgentPanelTab(tab));
  }
  // Flèches gauche/droite + Début/Fin : navigation standard d'une barre
  // d'onglets (les onglets masqués par le réglage sont sautés).
  const tablist = panel.querySelector('[role="tablist"]');
  if (tablist) {
    tablist.addEventListener("keydown", (e) => {
      const visible = AGENT_PANEL_TABS.filter((t) => panelTabEnabled[t]);
      if (!visible.length) return;
      const i = Math.max(0, visible.indexOf(panelActiveTab));
      let next = null;
      if (e.key === "ArrowRight") next = visible[(i + 1) % visible.length];
      else if (e.key === "ArrowLeft") next = visible[(i - 1 + visible.length) % visible.length];
      else if (e.key === "Home") next = visible[0];
      else if (e.key === "End") next = visible[visible.length - 1];
      if (!next) return;
      e.preventDefault();
      selectAgentPanelTab(next);
      const btn = document.getElementById(`agent-activity-tab-${next}`);
      if (btn) btn.focus();
    });
  }
  // Échap : referme le panneau et rend le focus au cercle (jamais de clavier
  // piégé dans le panneau).
  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    closeAgentPanel();
    // Le focus revient a l'entree « Travail » (LOT 4) : c'est elle, le bouton
    // reel ; la pastille n'est plus focusable (elle est son contenu).
    trigger.focus();
  });

  // Fermeture explicite (bouton ×) et effacement des événements (« tout
  // effacer », visible sur le seul onglet Événements).
  const closeBtn = document.getElementById("agent-activity-panel-close");
  if (closeBtn) closeBtn.addEventListener("click", () => closeAgentPanel());
  const clearBtn = document.getElementById("agent-activity-panel-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const eventsList = agentPanelEventsListElement();
      if (eventsList) eventsList.innerHTML = "";
      agentPanelClearUnread();
    });
  }
  // Un clic sur une mission referme le panneau (le détail d'une tâche de suivi
  // reste dans son onglet Kanban dédié).
  const tasksList = agentPanelTasksListElement();
  if (tasksList) tasksList.addEventListener("click", () => closeAgentPanel());

  // Réglage global « onglet Tâches » : appliqué dès le démarrage (le panneau est
  // global, il n'attend plus l'ouverture de l'onglet Assistant) et à chaque
  // changement de configuration.
  const applyTasksSetting = (cfg) => setAgentPanelTabsVisibility(cfg);
  invoke("get_config")
    .then(applyTasksSetting)
    .catch(() => { /* fail-open : onglet affiché */ });
  window.addEventListener("pilot-config-changed", () => {
    invoke("get_config").then(applyTasksSetting).catch(() => {});
  });

  // NOTE : pas de fermeture au clic extérieur — le panneau reste ouvert jusqu'à
  // ce qu'on reclique sur le cercle (ou × / Échap). Le poll 2 s + le push
  // `agent-state-changed` sont gérés par le store partagé (ensureActivityStore).

  // Restaure l'état ouvert/replié et le dernier onglet utilisé (localStorage).
  selectAgentPanelTab(
    normalizeAgentPanelTab(localStorage.getItem(AGENT_PANEL_TAB_KEY)),
    { persist: false }
  );
  if (localStorage.getItem("agent-activity-expanded") === "true") {
    openAgentPanel();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Panneau unique du suivi du travail : TROIS onglets dans un seul panneau
// ════════════════════════════════════════════════════════════════════════════
// Décision propriétaire : le travail se suit à UN SEUL endroit de l'écran. Le
// cercle en haut à droite ouvre ce panneau ; l'ancien panneau de la cloche (en
// bas à droite de l'onglet Assistant) a été déplacé ici, sans perte : mêmes
// événements (avec leur compteur non lu), mêmes missions (avec la mention
// « en attente »), mêmes réglages.

/**
 * Onglets du panneau, dans l'ordre d'affichage de GAUCHE À DROITE.
 * ATTENTION : cet ordre est DÉFINITIF et verrouillé par test —
 * « Agents » puis « Tâches » puis « Événements ». La navigation au clavier
 * (flèches ←/→) suit exactement ce tableau. Les volets correspondants de
 * index.html doivent être rangés dans le même ordre.
 */
export const AGENT_PANEL_TABS = ["agents", "tasks", "events"];
/** Libellés visibles (ordre et intitulés verrouillés par test). */
export const AGENT_PANEL_TAB_LABELS = { agents: "Agents", events: "Événements", tasks: "Tâches" };
/**
 * Onglet ouvert PAR DÉFAUT : « Agents » — à l'ouverture du panneau quand
 * l'utilisateur n'a encore jamais choisi d'onglet (aucune mémoire). Un onglet
 * mémorisé reste prioritaire sur ce défaut.
 */
export const AGENT_PANEL_DEFAULT_TAB = "agents";
/** Clé du DERNIER onglet utilisé (rouvert au prochain démarrage). */
export const AGENT_PANEL_TAB_KEY = "agent-activity-panel-tab";
/** Plafond du compteur de non-lus (au-delà : « 99+ »). */
export const AGENT_PANEL_UNREAD_MAX = 99;

let panelUnread = 0;
let panelActiveTab = AGENT_PANEL_DEFAULT_TAB;
let panelTabEnabled = { agents: true, events: true, tasks: true };
const panelTabListeners = new Set();

/** Élément du panneau (null tant que l'interface n'est pas prête). */
function panelEl() {
  return document.getElementById("agent-activity-dropdown");
}

/**
 * Visibilité des onglets selon la configuration : le réglage global
 * `super_agent_tasks_tab_enabled` (ACTIVÉ PAR DÉFAUT) commande le seul onglet
 * « Tâches » ; les deux autres sont toujours là. Fail-open : réglage illisible
 * → onglet affiché.
 * @param {object|null} config
 * @returns {{agents: boolean, events: boolean, tasks: boolean}}
 */
export function agentPanelTabVisibility(config) {
  const tasks = !(config && config.super_agent_tasks_tab_enabled === false);
  return { agents: true, events: true, tasks };
}

/**
 * Normalise un nom d'onglet (« agents » par défaut, jamais un onglet inconnu).
 * Sert aussi bien à la lecture de la mémoire (localStorage) qu'à un appel
 * direct : sans choix mémorisé, on arrive sur « Agents ».
 */
export function normalizeAgentPanelTab(tab) {
  return AGENT_PANEL_TABS.includes(tab) ? tab : AGENT_PANEL_DEFAULT_TAB;
}

/** Texte du compteur de non-lus (« 99+ » au-delà du plafond, chaine vide à 0). */
export function agentPanelBadgeText(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n <= 0) return "";
  return n > AGENT_PANEL_UNREAD_MAX ? `${AGENT_PANEL_UNREAD_MAX}+` : String(n);
}

// ── Compteur de TRAVAIL de l'entree « Travail » (bouton de la rangee) ────────
// Le bouton affiche « en cours / total » (ex. 2/5). Le total est celui demande
// par le proprietaire : "les taches totales prevues = celles en cours + celles
// en attente". Les deux nombres sortent de `splitMissions()` — LA MEME fonction
// pure que les deux titres de groupes de l'onglet « Taches » — donc le bouton ne
// peut pas contredire l'onglet (verrou : compteur-taches-travail.test.js).

/** Derniers nombres publies (repeints quand la visibilite de l'onglet change). */
let panelTaskRunning = 0;
let panelTaskWaiting = 0;

/** Normalise un compte (entier >= 0, jamais NaN). */
function countOf(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

/** Nombre du texte visible : plafonne a « 99+ » (le bouton ne s'allonge pas). */
function cappedCount(n) {
  return n > AGENT_PANEL_UNREAD_MAX ? `${AGENT_PANEL_UNREAD_MAX}+` : String(n);
}

/**
 * Texte du compteur de travail : « en cours / total », chaine VIDE quand il n'y
 * a ni travail en cours ni demande en attente (aucun « 0/0 » permanent).
 * Fonction PURE.
 * @param {number} running nombre de taches en cours
 * @param {number} waiting nombre de demandes en attente
 * @returns {string}
 */
export function agentTaskCounterText(running, waiting) {
  const r = countOf(running);
  const w = countOf(waiting);
  if (r + w <= 0) return "";
  return `${cappedCount(r)}/${cappedCount(r + w)}`;
}

/**
 * Infobulle (et `aria-label`, MEME chaine) du bouton « Travail ». Elle donne
 * TOUJOURS les nombres REELS : le plafond du texte visible ne ment jamais.
 * Fonction PURE.
 * @param {number} running
 * @param {number} waiting
 * @returns {string}
 */
export function agentTaskCounterLabel(running, waiting) {
  const r = countOf(running);
  const w = countOf(waiting);
  const total = r + w;
  if (total <= 0) return "Suivi du travail";
  const mot = r > 1 ? "taches" : "tache";
  if (r > 0) return `Travail : ${r} ${mot} en cours sur ${total} (${w} en attente)`;
  return `Travail : aucune tache en cours (${w} en attente)`;
}

/**
 * Infobulle du point de l'onglet « Evenements » : nombre REEL d'evenements non
 * lus (aucun chiffre n'est affiche sur l'onglet : la marge ne le porte pas).
 * Fonction PURE.
 * @param {number} count
 * @returns {string} chaine vide quand il n'y a rien a signaler
 */
export function agentUnreadTooltip(count) {
  const n = countOf(count);
  if (n <= 0) return "";
  return n > 1 ? `${n} evenements non lus` : `${n} evenement non lu`;
}

/**
 * Repeint le compteur de travail du bouton « Travail » (texte, `hidden`,
 * infobulle et `aria-label`). Le compteur SUIT le reglage de l'onglet
 * « Taches » : onglet absent, compteur absent (il renverrait a un volet qui
 * n'existe pas).
 */
function paintAgentPanelTaskCount() {
  const enabled = panelTabEnabled.tasks !== false;
  const running = enabled ? panelTaskRunning : 0;
  const waiting = enabled ? panelTaskWaiting : 0;
  const text = agentTaskCounterText(running, waiting);
  const label = agentTaskCounterLabel(running, waiting);
  const count = document.getElementById("agent-activity-count");
  if (count) {
    count.textContent = text;
    count.hidden = !text;
    // Au moins une tache EN COURS : le chiffre s'allume (aucune animation).
    if (typeof count.classList?.toggle === "function") count.classList.toggle("working", running > 0);
  }
  const entry = document.getElementById("agent-activity-entry");
  if (entry) {
    // UNE SEULE source pour l'infobulle et le nom lu : la meme chaine.
    entry.title = label;
    entry.setAttribute("aria-label", label);
  }
}

/**
 * Publie le compte de travail (appele par l'onglet « Taches », sur les memes
 * donnees que lui). Fonction a effet de bord limite a l'affichage.
 * @param {number} running taches en cours
 * @param {number} waiting demandes en attente
 */
export function setAgentPanelTaskCount(running, waiting) {
  panelTaskRunning = countOf(running);
  panelTaskWaiting = countOf(waiting);
  paintAgentPanelTaskCount();
}

/** Onglet actuellement affiché. */
export function getActiveAgentPanelTab() {
  return panelActiveTab;
}

/** Le panneau est-il ouvert ? */
export function isAgentPanelOpen() {
  const panel = panelEl();
  return !!panel && !panel.classList.contains("hidden");
}

/**
 * L'onglet `tab` est-il affiché à l'écran (panneau ouvert ET onglet actif ET
 * onglet disponible) ? Sert à ne pas compter comme « non lu » ce que
 * l'utilisateur regarde.
 */
export function isAgentPanelPaneVisible(tab) {
  const wanted = normalizeAgentPanelTab(tab);
  return isAgentPanelOpen() && panelActiveTab === wanted && panelTabEnabled[wanted] !== false;
}

/** Liste des événements (volet Événements) — null si l'interface n'est pas prête. */
export function agentPanelEventsListElement() {
  return document.querySelector("#agent-activity-pane-events .sa-events-list");
}

/** Liste des missions (volet Tâches) — null si l'interface n'est pas prête. */
export function agentPanelTasksListElement() {
  return document.querySelector("#agent-activity-pane-tasks .sa-tasks-list");
}

/**
 * S'abonne aux changements d'état du panneau (onglet actif, ouverture).
 * @param {(state: {tab: string, open: boolean}) => void} cb
 * @returns {Function} désabonnement.
 */
export function onAgentPanelTabChange(cb) {
  if (typeof cb !== "function") return () => {};
  panelTabListeners.add(cb);
  return () => panelTabListeners.delete(cb);
}

function emitAgentPanelState() {
  const state = { tab: panelActiveTab, open: isAgentPanelOpen() };
  for (const cb of [...panelTabListeners]) {
    try { cb(state); } catch (_) { /* un abonné fautif ne casse pas le panneau */ }
  }
}

/**
 * Met a jour le signal d'attention des evenements non lus. Il ne vit plus dans
 * le bouton (sa place porte desormais le compteur de travail) : le point du
 * bouton s'allume, et un point de 6 px apparait sur l'onglet « Evenements »,
 * avec le nombre REEL dans son infobulle et dans son nom lu (aucun chiffre
 * affiche : il ne tient pas dans la marge du panneau).
 */
function updateAgentPanelBadge() {
  const text = agentPanelBadgeText(panelUnread);
  const dot = document.getElementById("agent-activity-dot");
  if (dot) dot.classList.toggle("agent-unread", !!text);
  const point = document.getElementById("agent-activity-events-unread");
  if (point) point.hidden = !text;
  const tab = document.getElementById("agent-activity-tab-events");
  if (tab) {
    const tooltip = agentUnreadTooltip(panelUnread);
    // Infobulle vide = pas d'infobulle ; le nom lu garde TOUJOURS le libelle de
    // l'onglet, augmente du compte quand il y a quelque chose a voir.
    tab.title = tooltip;
    tab.setAttribute(
      "aria-label",
      tooltip ? `${AGENT_PANEL_TAB_LABELS.events} : ${tooltip}` : AGENT_PANEL_TAB_LABELS.events
    );
  }
}

/**
 * Affiche un onglet du panneau (et masque les autres). Un onglet désactivé par
 * le réglage n'est jamais sélectionné. Persiste le choix (mémoire d'onglet).
 * @param {"agents"|"events"|"tasks"} tab
 * @param {{persist?: boolean}} [options]
 * @returns {string} l'onglet réellement affiché.
 */
export function selectAgentPanelTab(tab, options) {
  const persist = !(options && options.persist === false);
  const wanted = normalizeAgentPanelTab(tab);
  const next = panelTabEnabled[wanted] === false ? AGENT_PANEL_DEFAULT_TAB : wanted;
  panelActiveTab = next;
  for (const t of AGENT_PANEL_TABS) {
    const btn = document.getElementById(`agent-activity-tab-${t}`);
    const pane = document.getElementById(`agent-activity-pane-${t}`);
    const active = t === next;
    if (btn) {
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
    }
    if (pane) pane.classList.toggle("hidden", !active);
  }
  // Le bouton « tout effacer » ne concerne que la liste des événements.
  const clearBtn = document.getElementById("agent-activity-panel-clear");
  if (clearBtn) clearBtn.hidden = next !== "events";
  // Regarder les événements, c'est les lire : le compteur retombe à zéro.
  if (next === "events" && isAgentPanelOpen()) {
    panelUnread = 0;
    updateAgentPanelBadge();
  }
  if (persist) {
    try { localStorage.setItem(AGENT_PANEL_TAB_KEY, next); } catch (_) { /* stockage plein */ }
  }
  emitAgentPanelState();
  return next;
}

/**
 * Applique la visibilité des onglets (réglage global). Appelée au démarrage et à
 * chaque changement de configuration : la bascule est immédiate, sans redémarrer.
 * @param {object|null} config
 * @returns {{agents: boolean, events: boolean, tasks: boolean}}
 */
export function setAgentPanelTabsVisibility(config) {
  const visible = agentPanelTabVisibility(config);
  panelTabEnabled = visible;
  for (const tab of AGENT_PANEL_TABS) {
    const btn = document.getElementById(`agent-activity-tab-${tab}`);
    if (btn) btn.hidden = !visible[tab];
  }
  // Onglet désactivé pendant qu'il est affiché → repli sur « Agents ».
  if (!visible.tasks && panelActiveTab === "tasks") selectAgentPanelTab(AGENT_PANEL_DEFAULT_TAB);
  // Le compteur de travail suit le reglage (onglet absent = compteur absent).
  paintAgentPanelTaskCount();
  return visible;
}

/**
 * Publie l'etat ouvert/ferme du panneau sur le BOUTON « Travail » (seul element
 * interactif et seul porteur du nom lu ; la pastille `#agent-activity-dot` n'est
 * qu'un contenu d'etat, sans role ni attribut d'accessibilite propre).
 * @param {boolean} open
 */
function setActivityExpanded(open) {
  const value = open ? "true" : "false";
  const entry = document.getElementById("agent-activity-entry");
  if (entry) entry.setAttribute("aria-expanded", value);
}

/** Ouvre le panneau (sur l'onglet mémorisé, ou sur `tab` s'il est fourni). */
export function openAgentPanel(tab) {
  const panel = panelEl();
  if (!panel) return;
  if (tab) selectAgentPanelTab(tab);
  renderAgentsPane();
  panel.classList.remove("hidden");
  const card = document.getElementById("agent-activity-card");
  if (card) card.classList.add("hidden");
  setActivityExpanded(true);
  try { localStorage.setItem("agent-activity-expanded", "true"); } catch (_) { /* stockage plein */ }
  if (panelActiveTab === "events") {
    panelUnread = 0;
    updateAgentPanelBadge();
  }
  emitAgentPanelState();
}

/** Referme le panneau (le contenu est conservé : aucune donnée perdue). */
export function closeAgentPanel() {
  const panel = panelEl();
  if (panel) panel.classList.add("hidden");
  setActivityExpanded(false);
  try { localStorage.setItem("agent-activity-expanded", "false"); } catch (_) { /* stockage plein */ }
  emitAgentPanelState();
}

/** Bascule ouverture/fermeture du panneau (clic sur le cercle). */
export function toggleAgentPanel() {
  if (isAgentPanelOpen()) closeAgentPanel();
  else openAgentPanel();
}

/**
 * Signale un nouvel événement système : compteur de non-lus + pastille sur le
 * cercle, SAUF si l'utilisateur regarde déjà la liste des événements.
 */
export function agentPanelNoteEvent() {
  if (isAgentPanelPaneVisible("events")) return;
  panelUnread++;
  updateAgentPanelBadge();
}

/** Remet le compteur de non-lus à zéro (liste lue ou effacée). */
export function agentPanelClearUnread() {
  panelUnread = 0;
  updateAgentPanelBadge();
}

/** Compteur courant de non-lus (lecture seule, pour l'UI et les tests). */
export function getAgentPanelUnread() {
  return panelUnread;
}

/** Repeint la liste des agents dans le volet « Agents ». */
function renderAgentsPane() {
  const listEl = document.getElementById("agent-activity-list");
  if (!listEl) return;
  listEl.innerHTML = renderDropdown(getAgentActivitySnapshot().list);
}
