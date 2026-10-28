// vocal-brevity.js — EN MODE VOCAL, PILOT PARLE COURT (ET LA LONGUEUR SE REGLE).
//
// POURQUOI CE MODULE : dans l'ecran Vocal, la voix est le SEUL canal — la
// conversation n'y est pas affichee et la reponse est LUE A VOIX HAUTE. Une
// reponse de chat ecrit (listes, titres, noms de fichiers, code) y est penible
// a ecouter et lente. Decision du proprietaire : Pilot repond BRIEVEMENT,
// comme dans une conversation, et ne developpe que si on le lui demande.
//
// DEPUIS QUE LA LONGUEUR SE REGLE (Parametres -> onglet « Assistant » -> section
// « Mode Vocal »), la consigne n'est plus FIGEE : elle est CONSTRUITE pour l'un
// des QUATRE niveaux ci-dessous.
// Le niveau par defaut est « courtes » et reproduit MOT POUR MOT la consigne
// historique : sans reglage, rien ne change dans le comportement.
//
// CE QUI VIT ICI, ET RIEN QU'ICI :
//   - `VOCAL_BREVITY_LEVELS` / `VOCAL_BREVITY_DEFAULT_LEVEL` : les quatre cles
//     STABLES (memorisees dans la configuration) et le defaut ;
//   - `normalizeVocalBrevityLevel(value)` : SEUL juge de ce qu'une valeur vaut
//     (inconnue, vide, nulle, casse differente -> niveau par defaut) ;
//   - `vocalBrevityLabel(value)` : SEUL libelle francais d'un niveau ;
//   - `vocalBrevityInstruction(niveau)` : la consigne exacte d'un niveau ;
//   - `VOCAL_BREVITY_INSTRUCTION` : la consigne du niveau par defaut (identique
//     a la consigne historique, mot pour mot) ;
//   - `composeVocalPrompt(texte, { modeVocal, niveau })` : le SEUL assemblage
//     « demande + consigne ». Hors du mode Vocal, le texte est rendu INCHANGE :
//     le chat ecrit et l'onglet Assistant gardent leurs reponses actuelles.
//
// CE QUI NE CHANGE JAMAIS, QUEL QUE SOIT LE NIVEAU :
//   - une demande explicite de developper (« detaille », « explique »,
//     « pourquoi », « comment ») passe AVANT le niveau choisi ;
//   - une panne, un refus, une erreur (outil, micro, agent) ou une demande de
//     confirmation restent ENTIEREMENT dits, meme au niveau « tres courte » ;
//   - hors du mode Vocal, le texte est INCHANGE ;
//   - une demande vide ne recoit aucune consigne ;
//   - la BRIEVETE VIENT DE LA CONSIGNE, JAMAIS D'UNE COUPE : rien n'est tronque
//     ici (aucune limite de caracteres, aucune `slice`, aucun `substring`). Une
//     reponse coupee au milieu d'une phrase sonnerait faux et cacherait une
//     information utile — la consigne suffit, la coupe est interdite.
//
// Aucun DOM, aucune configuration, aucun etat dans ce module : les fonctions
// sont PURES. La relecture du reglage (fail-open) vit dans l'ecran qui s'en sert.

/**
 * Les QUATRE niveaux de longueur des reponses orales, dans l'ordre d'affichage.
 *
 * Les cles sont STABLES : elles sont memorisees telles quelles par
 * l'application (reglage de l'utilisateur). Les renommer perdrait ce reglage —
 * ne jamais le faire.
 */
export const VOCAL_BREVITY_LEVELS = ["tres-courte", "courtes", "moyenne", "detaillees"];

/**
 * Niveau par defaut : « courtes », c'est-a-dire le comportement HISTORIQUE
 * (deux ou trois phrases). Une configuration absente ou illisible y retombe.
 */
export const VOCAL_BREVITY_DEFAULT_LEVEL = "courtes";

/** Les libelles francais, un par niveau (aucun autre formatage ailleurs). */
const LIBELLES = {
  "tres-courte": "Très courte",
  courtes: "Courtes",
  moyenne: "Moyenne",
  detaillees: "Détaillées",
};

/** Les deux premieres lignes de la consigne : communes aux quatre niveaux. */
const EN_TETE = [
  "## Mode vocal — parler court",
  "Cette demande vient de l'écran Vocal de Pilot : la conversation n'y est pas affichée et ta réponse va être LUE À VOIX HAUTE.",
];

/**
 * La REGLE DE LONGUEUR de chaque niveau (ce que le niveau demande, en clair).
 * « courtes » est la phrase historique, recopiee mot pour mot.
 */
const REGLES = {
  "tres-courte":
    "Règle de conversation parlée : réponds en UNE À DEUX PHRASES, l'essentiel seulement, comme à l'oral. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider.",
  courtes:
    "Règle de conversation parlée : réponds en DEUX OU TROIS PHRASES AU PLUS, comme à l'oral. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider.",
  moyenne:
    "Règle de conversation parlée : réponds en QUATRE À SIX PHRASES, comme à l'oral, et donne le pourquoi quand il aide à comprendre. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider, et pourquoi.",
  detaillees:
    "Règle de conversation parlée : donne une réponse COMPLÈTE ET DÉVELOPPÉE, mais toujours dite à l'oreille : des phrases suivies, pas de listes, pas de titres, pas de tableaux, pas de code, et jamais un nom de fichier lu à voix haute. Prends le temps qu'il faut pour tout expliquer de vive voix : ce qui est utile à dire à voix haute, dans l'ordre où on comprend.",
};

/**
 * La clause « developper si on le demande » — la MEME pour les quatre niveaux
 * (la demande de l'utilisateur passe avant la longueur).
 */
const DEVELOPPEMENT =
  "Si l'utilisateur demande explicitement de développer (« détaille », « explique », « pourquoi », « comment »), alors développe : donne le détail demandé, en restant compréhensible à l'oreille (des phrases, jamais de tableau ni de code).";

/** La clause d'exception (securite dite en entier) de chaque niveau. */
const EXCEPTIONS = {
  "tres-courte":
    "Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, même si c'est plus long qu'une ou deux phrases. Ne cache jamais une information utile pour rester court.",
  courtes:
    "Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, même si c'est plus long que trois phrases. Ne cache jamais une information utile pour rester court.",
  moyenne:
    "Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, même si c'est plus long que six phrases. Ne cache jamais une information utile pour rester court.",
  detaillees:
    "Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, sans rien abréger. Ne cache jamais une information utile pour rester court.",
};

/**
 * Ramène une valeur quelconque (réglage, configuration ancienne, valeur
 * absente) à un niveau RÉELLEMENT utilisable. Absent, vide, `null`, illisible ou
 * écrit avec une autre casse ⇒ le niveau PAR DÉFAUT (« courtes »).
 *
 * Fonction PURE : c'est le seul endroit qui décide de ce qu'une valeur veut
 * dire. Elle sert à la fois aux Paramètres (affichage et enregistrement) et à la
 * composition du message envoyé à l'agent.
 */
export function normalizeVocalBrevityLevel(value) {
  if (typeof value !== "string") return VOCAL_BREVITY_DEFAULT_LEVEL;
  const cle = value.trim();
  return VOCAL_BREVITY_LEVELS.includes(cle) ? cle : VOCAL_BREVITY_DEFAULT_LEVEL;
}

/**
 * Libellé lisible d'un niveau (« Très courte », « Courtes », « Moyenne »,
 * « Détaillées »). Une seule formulation pour tout le produit.
 */
export function vocalBrevityLabel(value) {
  return LIBELLES[normalizeVocalBrevityLevel(value)];
}

/**
 * La consigne de conversation parlée d'UN niveau, ajoutée au message envoyé à
 * l'agent pour une demande faite depuis l'écran Vocal.
 *
 * Le niveau « courtes » rend EXACTEMENT la consigne historique, mot pour mot :
 * sans réglage, le comportement ne change pas. Aucune troncature n'est faite
 * ici : la longueur vient de la consigne, jamais d'une coupe du texte.
 *
 * @param {string} [niveau] clé de niveau (normalisée ; défaut « courtes »)
 * @returns {string} la consigne complète, prête à être ajoutée à la demande
 */
export function vocalBrevityInstruction(niveau) {
  const cle = normalizeVocalBrevityLevel(niveau);
  // Le développement demandé par l'utilisateur passe AVANT le niveau : la
  // priorité est dite en clair pour les niveaux réglés (le niveau par défaut,
  // lui, garde sa formulation historique, qui dit déjà « alors développe »).
  const developpement =
    cle === VOCAL_BREVITY_DEFAULT_LEVEL
      ? DEVELOPPEMENT
      : `Cette demande de développement passe AVANT le niveau de longueur choisi. ${DEVELOPPEMENT}`;
  return [...EN_TETE, REGLES[cle], developpement, EXCEPTIONS[cle]].join("\n");
}

/**
 * La consigne du niveau PAR DÉFAUT — exactement celle d'avant le réglage.
 * Conservée comme constante pour que rien d'existant ne change.
 */
export const VOCAL_BREVITY_INSTRUCTION = vocalBrevityInstruction(VOCAL_BREVITY_DEFAULT_LEVEL);

/**
 * Compose le message ENVOYE a l'agent : la demande de l'utilisateur, et — si et
 * seulement si elle vient de l'ecran Vocal — la consigne de brièveté du niveau
 * réglé, ajoutee a la fin. Points uniques :
 *   - `modeVocal` faux / absent : le texte revient INCHANGE (aucun ecran autre
 *     que le mode Vocal ne change de comportement) ;
 *   - la demande reste INTACTE en tete du message (jamais coupee, jamais
 *     reformulee : ce que l'utilisateur a dit est conserve mot pour mot) ;
 *   - une demande vide ne recoit rien (aucune consigne orpheline) ;
 *   - le niveau est lu ICI, au moment de la composition : un reglage change
 *     s'applique donc a la demande SUIVANTE, jamais a une demande en cours.
 *
 * @param {string} text demande de l'utilisateur (telle qu'envoyee aujourd'hui)
 * @param {{ modeVocal?: boolean, niveau?: string }} [etats] ecran d'origine + niveau regle
 * @returns {string} le message a envoyer a l'agent
 */
export function composeVocalPrompt(text, etats = {}) {
  const demande = typeof text === "string" ? text : "";
  if (!etats || etats.modeVocal !== true) return demande;
  if (!demande.trim()) return demande;
  return `${demande}\n\n${vocalBrevityInstruction(etats.niveau)}`;
}
