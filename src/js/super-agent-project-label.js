// super-agent-project-label.js — ÉTIQUETTE DE PROJET D'UN MESSAGE DE L'ASSISTANT
//
// SOURCE UNIQUE de la décision « quel projet nomme cette étiquette de bulle ».
// Module 100 % PUR (aucun DOM, aucun `invoke`) → testable unitairement.
//
// DÉFAUT CORRIGÉ (rapport docs/rapports/RAPPORT-etiquette-projet-des-bulles.md) :
// l'étiquette nommait le projet ACTIF de la fenêtre au lieu du projet que
// l'échange concernait réellement. Cause : la bulle de réponse est créée au
// `message_start` de l'assistant, donc AVANT l'appel d'outil qui révèle le
// projet visé (`run_agents` / `delegate_to_coder`). À cet instant, le seul
// projet connu est le projet ouvert : il était figé comme « dernier recours »
// et plus rien ne le corrigeait ensuite. Un badge de dernier recours n'est
// pourtant pas une information prouvée — il doit s'effacer dès que le tour
// révèle le projet réellement concerné.
//
// DEUX DÉCISIONS, et elles suffisent :
//   1. `decideMessageProjectLabel` — à la CRÉATION de la bulle (ce qu'on sait
//      à cet instant) : explicite > nommé dans le texte > mission/délégation >
//      projet ouvert (dernier recours) > rien.
//   2. `decideFinalBubbleProjectLabel` — à la FIN DU TOUR (ce que le tour a
//      révélé) : les projets RÉELLEMENT visés passent en tête (le premier est
//      LE projet principal de la mission, les autres sont signalés ensuite),
//      un badge de simple dernier recours est remplacé, un nom prouvé n'est
//      jamais retiré, aucun projet non concerné n'est jamais nommé.
//
// La décision se prend donc PAR MESSAGE (une bulle, un tour), jamais au niveau
// de la fenêtre.

/** Provenance d'une étiquette. */
export const PROJECT_LABEL_SOURCE = Object.freeze({
  /** Badges fournis par l'appelant qui connaît le projet (relais d'une question d'agent). */
  EXPLICIT: "explicit",
  /** Projet cité dans le texte du message (demande ou réponse). */
  NAMED: "named",
  /** Projet réellement visé par le tour (mission, agent ciblé, délégation, projet ouvert par l'Assistant). */
  MISSION: "mission",
  /** DERNIER RECOURS : projet ouvert à l'écran (information NON prouvée). */
  OPEN_PROJECT: "open-project",
  /** Rien à afficher. */
  NONE: "none",
});

/** Prochaines provenances considérées comme PROUVÉES (jamais retirées). */
const PROVEN_SOURCES = [
  PROJECT_LABEL_SOURCE.EXPLICIT,
  PROJECT_LABEL_SOURCE.NAMED,
  PROJECT_LABEL_SOURCE.MISSION,
];

/**
 * Copie normalisée d'une liste de noms : chaînes non vides, espaces retirés,
 * sans doublon (insensible à la casse), ordre conservé. Toute valeur invalide
 * donne une liste vide (jamais d'exception, jamais de nom inventé).
 * @param {unknown} list
 * @returns {string[]}
 */
export function normalizeProjectLabels(list) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(list)) return out;
  for (const value of list) {
    const name = String(value == null ? "" : value).trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Vrai si la provenance est une information PROUVÉE (jamais retirée). */
export function isProvenLabelSource(source) {
  return PROVEN_SOURCES.includes(source);
}

/**
 * Objet de décision complet : noms à afficher (ordre d'affichage), provenance,
 * projet principal (premier nom) et projets seulement signalés (les autres).
 * @param {string[]} labels
 * @param {string} source
 */
function makeDecision(labels, source) {
  const names = normalizeProjectLabels(labels);
  return Object.freeze({
    labels: names,
    source: names.length ? source : PROJECT_LABEL_SOURCE.NONE,
    main: names.length ? names[0] : "",
    others: names.slice(1),
  });
}

/**
 * Décision PRISE À LA CRÉATION de la bulle, avec ce que l'on sait à cet
 * instant. Ordre de la règle (inchangé, décision propriétaire 2026-10-22) :
 *   1. `explicit` — l'appelant connaît le projet (relais d'une question) ;
 *   2. `named` — projets nommés dans le texte du message (ordre d'apparition) ;
 *   3. `concerned` — projets réellement visés par l'échange ;
 *   4. `openProject` — DERNIER RECOURS, projet ouvert à cet instant ;
 *   5. sinon aucune étiquette.
 * @param {string[]|null} explicit
 * @param {string[]|null} named
 * @param {string[]|null} concerned
 * @param {string[]|null} openProject
 * @returns {{labels:string[], source:string, main:string, others:string[]}}
 */
export function decideMessageProjectLabel(explicit, named, concerned, openProject) {
  const ordered = [
    [explicit, PROJECT_LABEL_SOURCE.EXPLICIT],
    [named, PROJECT_LABEL_SOURCE.NAMED],
    [concerned, PROJECT_LABEL_SOURCE.MISSION],
    [openProject, PROJECT_LABEL_SOURCE.OPEN_PROJECT],
  ];
  for (const [value, source] of ordered) {
    const labels = normalizeProjectLabels(value);
    if (labels.length) return makeDecision(labels, source);
  }
  return makeDecision([], PROJECT_LABEL_SOURCE.NONE);
}

/**
 * Décision PRISE À LA FIN DU TOUR : le tour a-t-il révélé le projet réellement
 * concerné ? Règles, DANS L'ORDRE :
 *   1. des projets RÉELLEMENT visés par le tour existent (`concerned`) → ils
 *      passent EN TÊTE (le premier est le projet principal de la mission), puis
 *      les noms prouvés déjà figés, puis les projets cités par la réponse. Le
 *      badge de simple dernier recours n'est PAS conservé : la mission le
 *      remplace (c'est exactement le défaut corrigé) ;
 *   2. sinon un nom PROUVÉ est déjà figé (explicite, nommé dans le message,
 *      mission d'un tour précédent du même message) → il est conservé et la
 *      réponse peut seulement y AJOUTER les projets qu'elle cite ;
 *   3. sinon la réponse cite un ou des projets réels → ils étiquettent la bulle
 *      (et le badge de dernier recours s'efface : un nom prouvé vaut mieux) ;
 *   4. sinon le badge de DERNIER RECOURS (projet ouvert) reste : un message
 *      purement conversationnel retombe sur le projet actif ;
 *   5. sinon aucune étiquette (aucun projet ouvert, aucun projet concerné).
 * Fail-open : arguments invalides → aucune étiquette, jamais d'exception.
 * @param {string[]|null} frozen - noms affichés par la bulle à sa création.
 * @param {string|null} frozenSource - provenance de ces noms.
 * @param {string[]|null} concerned - projets réellement visés par le tour.
 * @param {string[]|null} responseNamed - projets cités par le texte de la réponse.
 * @returns {{labels:string[], source:string, main:string, others:string[]}}
 */
export function decideFinalBubbleProjectLabel(frozen, frozenSource, concerned, responseNamed) {
  const base = normalizeProjectLabels(frozen);
  const mission = normalizeProjectLabels(concerned);
  const cited = normalizeProjectLabels(responseNamed);
  // 1. La mission est la preuve la plus forte de ce que le message concerne.
  //    Un badge de simple DERNIER RECOURS (projet ouvert, non prouvé) n'est PAS
  //    conservé : c'est exactement le défaut corrigé. Un nom PROUVÉ reste, mais
  //    derrière les projets réellement visés.
  if (mission.length) {
    const keepBase = base.length && isProvenLabelSource(frozenSource) ? base : [];
    return makeDecision([...mission, ...keepBase, ...cited], PROJECT_LABEL_SOURCE.MISSION);
  }
  // 2. Un nom prouvé ne recule jamais devant un ajout de la réponse.
  if (base.length && isProvenLabelSource(frozenSource)) {
    return makeDecision([...base, ...cited], frozenSource);
  }
  // 3. Un projet réellement cité par la réponse vaut mieux que le dernier recours.
  if (cited.length) {
    return makeDecision(cited, PROJECT_LABEL_SOURCE.NAMED);
  }
  // 4. Message purement conversationnel + projet ouvert → dernier recours.
  if (base.length) {
    return makeDecision(base, PROJECT_LABEL_SOURCE.OPEN_PROJECT);
  }
  // 5. Rien.
  return makeDecision([], PROJECT_LABEL_SOURCE.NONE);
}

/**
 * Infobulle de chaque badge, alignée sur `decision.labels` (même longueur).
 * Le premier est dit « principal » ; les suivants sont signalés comme autres
 * projets concernés. Un badge de simple dernier recours ne prétend RIEN (aucune
 * infobulle) : il n'est pas une information prouvée.
 * @param {{labels:string[], source:string}} decision
 * @returns {string[]}
 */
export function projectLabelBadgeTitles(decision) {
  const labels = normalizeProjectLabels(decision && decision.labels);
  const source = decision && decision.source;
  if (!labels.length) return [];
  const mainTitle =
    source === PROJECT_LABEL_SOURCE.MISSION
      ? "Projet principal de la mission"
      : source === PROJECT_LABEL_SOURCE.NAMED
        ? "Projet principal de l'échange"
        : source === PROJECT_LABEL_SOURCE.EXPLICIT
          ? "Projet concerné par cet échange"
          : "";
  return labels.map((_name, index) =>
    index === 0 ? mainTitle : "Autre projet concerné par l'échange"
  );
}
