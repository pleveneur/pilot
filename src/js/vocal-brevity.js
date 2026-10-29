// vocal-brevity.js — EN MODE VOCAL, PILOT PARLE COURT (ET LA LONGUEUR SE REGLE).
//
// POURQUOI CE MODULE : dans l'ecran Vocal, la voix est le SEUL canal — la
// conversation n'y est pas affichee et la reponse est LUE A VOIX HAUTE. Une
// reponse de chat ecrit (listes, titres, noms de fichiers, code) y est penible
// a ecouter et lente. Decision du proprietaire : Pilot repond BRIEVEMENT,
// comme dans une conversation, et ne developpe que si on le lui demande.
//
// LE MEME COMPORTEMENT DEPUIS TELEGRAM (decision du proprietaire, 2026-11) :
// quand le proprietaire ecrit a son bot Telegram, la demande est traitee comme
// une demande de l'ecran Vocal — meme brievete, meme possibilite de developper
// sur demande explicite, meme continuite de conversation. La consigne et la
// facon de l'assembler viennent donc d'ICI et de NULLE PART AILLEURS : il n'y a
// pas de seconde consigne « Telegram » qui pourrait diverger. SEUL L'EN-TETE
// change (`EN_TETE_PAR_ORIGINE`) pour dire la VERITE du canal (reponse sur le
// telephone plutot que lue a voix haute) ; les regles de longueur, la clause de
// developpement et les exceptions sont MOT POUR MOT les memes.
//
// DEPUIS QUE LA LONGUEUR SE REGLE (Parametres -> onglet « Assistant » -> section
// « Mode Vocal »), la consigne n'est plus FIGEE : elle est CONSTRUITE pour l'un
// des QUATRE niveaux ci-dessous.
// Le niveau par defaut est « courtes », soit DEUX phrases exactement (longueurs
// arretees par le proprietaire le 2026-10-27 : la reponse par defaut est plus
// stricte qu'avant — deux phrases, pas trois).
//
// CE QUI VIT ICI, ET RIEN QU'ICI :
//   - `VOCAL_BREVITY_LEVELS` / `VOCAL_BREVITY_DEFAULT_LEVEL` : les quatre cles
//     STABLES (memorisees dans la configuration) et le defaut ;
//   - `normalizeVocalBrevityLevel(value)` : SEUL juge de ce qu'une valeur vaut
//     (inconnue, vide, nulle, casse differente -> niveau par defaut) ;
//   - `vocalBrevityLabel(value)` : SEUL libelle francais d'un niveau ;
//   - `vocalBrevityInstruction(niveau, origine)` : la consigne exacte d'un
//     niveau, pour le canal demande (Vocal par defaut, Telegram accepte) ;
//   - `VOCAL_BREVITY_INSTRUCTION` : la consigne du niveau par defaut (« courtes »,
//     DEUX phrases) ;
//   - `composeVocalPrompt(texte, { modeVocal, niveau })` : le SEUL assemblage
//     « demande + consigne ». Hors du mode Vocal, le texte est rendu INCHANGE :
//     le chat ecrit et l'onglet Assistant gardent leurs reponses actuelles ;
//   - `composeTelegramPrompt(texte, { niveau })` : le MEME assemblage pour une
//     demande venue de Telegram (meme consigne, meme ordre, meme niveau regle).
//
// CE QUI NE CHANGE JAMAIS, QUEL QUE SOIT LE NIVEAU :
//   - une demande explicite de developper ou d'avoir plus de details
//     (« detaille », « explique », « pourquoi », « comment », « donne-moi le
//     detail ») LEVE la brievete : la regle de longueur NE S'APPLIQUE PLUS et
//     Pilot developpe AUTANT QU'IL FAUT, en restant comprehensible a l'oreille.
//     Cette levee est la MEME dans les deux canaux (Telegram et mode Vocal) :
//     elle vit dans la clause partagee ci-dessous, jamais dans un en-tete ;
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
 * Niveau par defaut : « courtes », c'est-a-dire DEUX phrases exactement. Une
 * configuration absente ou illisible y retombe.
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

/** Canal d'origine d'une demande. Le mode Vocal est le canal de reference. */
export const VOCAL_BREVITY_ORIGIN_VOCAL = "vocal";
export const VOCAL_BREVITY_ORIGIN_TELEGRAM = "telegram";

/**
 * Les deux premieres lignes de la consigne, PAR CANAL D'ORIGINE.
 *
 * Seul l'en-tete change : il dit la VERITE du canal (une reponse lue a voix
 * haute, ou une reponse qui part sur le telephone et a laquelle on repond
 * depuis la). Les regles de longueur, la clause de developpement et les
 * exceptions ci-dessous sont IDENTIQUES : c'est la meme conversation.
 */
const EN_TETE_PAR_ORIGINE = {
  [VOCAL_BREVITY_ORIGIN_VOCAL]: EN_TETE,
  [VOCAL_BREVITY_ORIGIN_TELEGRAM]: [
    "## Conversation Telegram — répondre court",
    "Cette demande vient de la conversation Telegram de Pilot : ta réponse part sur son téléphone et il te répond depuis là. C'est un TOUR DE CONVERSATION, la suite du MÊME fil : reprends là où vous en étiez, ne repars pas de zéro et ne transforme pas sa demande en compte rendu à classer.",
  ],
};

/**
 * La REGLE DE LONGUEUR de chaque niveau (ce que le niveau demande, en clair).
 *
 * Les nombres sont ecrits EN TOUTES LETTRES et repetes (« en UNE phrase, pas
 * deux ») pour qu'un modele ne puisse pas les lire de travers.
 */
const REGLES = {
  "tres-courte":
    "Règle de conversation parlée : réponds en UNE phrase, une seule, pas deux — l'essentiel seulement, comme à l'oral. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider.",
  courtes:
    "Règle de conversation parlée : réponds en DEUX phrases, exactement deux, pas trois — comme à l'oral. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider.",
  moyenne:
    "Règle de conversation parlée : réponds en QUATRE À SIX PHRASES, comme à l'oral, et donne le pourquoi quand il aide à comprendre. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider, et pourquoi.",
  detaillees:
    "Règle de conversation parlée : donne une réponse COMPLÈTE ET DÉVELOPPÉE, mais toujours dite à l'oreille : des phrases suivies, pas de listes, pas de titres, pas de tableaux, pas de code, et jamais un nom de fichier lu à voix haute. Prends le temps qu'il faut pour tout expliquer de vive voix : ce qui est utile à dire à voix haute, dans l'ordre où on comprend.",
};

/**
 * La clause « DEVELOPPER SI ON LE DEMANDE » — la MEME pour les quatre niveaux ET
 * pour les deux canaux (elle est dans le corps commun, jamais dans l'en-tete).
 *
 * Decision du proprietaire (precision de la mission Telegram) : la brievete est
 * le DEFAUT, mais une demande explicite de details la LEVE entierement. Il faut
 * donc que la consigne le dise sans ambiguite pour qu'un modele ne s'arrete pas
 * au nombre de phrases du niveau choisi :
 *   - les mots que l'utilisateur peut employer sont cites (dont « donne-moi le
 *     detail », ajoute par cette precision) ;
 *   - la levee est NOMMEE (« la regle de brievete ne s'applique plus ») ;
 *   - la longueur n'est plus bornee (« developpe autant qu'il faut ») ;
 *   - le canal ne change RIEN : un message Telegram qui demande le detail
 *     recoit la meme levee qu'une demande orale.
 */
const DEVELOPPEMENT =
  "Si l'utilisateur demande explicitement de développer ou plus de détails (« détaille », « explique », « pourquoi », « comment », « donne-moi le détail »), alors développe autant qu'il faut : la règle de brièveté NE S'APPLIQUE PLUS, donne le détail demandé en entier, en restant compréhensible à l'oreille (des phrases suivies, jamais un tableau ni de code).";

/** La clause d'exception (securite dite en entier) de chaque niveau. */
const EXCEPTIONS = {
  "tres-courte":
    "Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, même si c'est plus long qu'une phrase. Ne cache jamais une information utile pour rester court.",
  courtes:
    "Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, même si c'est plus long que deux phrases. Ne cache jamais une information utile pour rester court.",
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
 * l'agent pour une demande faite depuis l'écran Vocal ou depuis Telegram.
 *
 * Le niveau « courtes » (defaut) demande DEUX phrases exactement. Aucune
 * troncature n'est faite ici : la longueur vient de la consigne, jamais d'une
 * coupe du texte.
 *
 * @param {string} [niveau] clé de niveau (normalisée ; défaut « courtes »)
 * @param {string} [origine] canal d'origine (`VOCAL_BREVITY_ORIGIN_*` ; défaut : Vocal)
 * @returns {string} la consigne complète, prête à être ajoutée à la demande
 */
export function vocalBrevityInstruction(niveau, origine = VOCAL_BREVITY_ORIGIN_VOCAL) {
  const cle = normalizeVocalBrevityLevel(niveau);
  // Un canal inconnu retombe sur l'en-tete du mode Vocal : la consigne existe
  // toujours, aucune demande ne part sans elle.
  const entete = EN_TETE_PAR_ORIGINE[origine] || EN_TETE;
  // Le développement demandé par l'utilisateur passe AVANT le niveau : la
  // priorité est dite en clair pour les niveaux réglés (le niveau par défaut,
  // lui, garde la formulation d'origine, qui dit déjà « alors développe »).
  const developpement =
    cle === VOCAL_BREVITY_DEFAULT_LEVEL
      ? DEVELOPPEMENT
      : `Cette demande de développement passe AVANT le niveau de longueur choisi. ${DEVELOPPEMENT}`;
  return [...entete, REGLES[cle], developpement, EXCEPTIONS[cle]].join("\n");
}

/**
 * La consigne du niveau PAR DÉFAUT (« courtes » : DEUX phrases). Conservée
 * comme constante : c'est elle qui part quand aucun niveau n'est transmis.
 */
export const VOCAL_BREVITY_INSTRUCTION = vocalBrevityInstruction(VOCAL_BREVITY_DEFAULT_LEVEL);

/**
 * Assemble « demande + consigne » — code PARTAGE par les deux canaux (aucune
 * seconde mise en forme) :
 *   - la demande reste INTACTE en tete du message (jamais coupee, jamais
 *     reformulee) ;
 *   - une demande vide ne recoit rien (aucune consigne orpheline).
 *
 * @param {string} text
 * @param {string} [niveau]
 * @param {string} origine
 * @returns {string}
 */
function composeWithInstruction(text, niveau, origine) {
  const demande = typeof text === "string" ? text : "";
  if (!demande.trim()) return demande;
  return `${demande}\n\n${vocalBrevityInstruction(niveau, origine)}`;
}

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
  return composeWithInstruction(demande, etats.niveau, VOCAL_BREVITY_ORIGIN_VOCAL);
}

/**
 * Compose le message ENVOYE a l'agent pour une demande venue de TELEGRAM :
 * exactement le meme assemblage que le mode Vocal (`composeWithInstruction`),
 * avec la MEME consigne de brièveté, au MEME niveau réglé. Rien n'est copie :
 * seule l'origine change, et elle ne change que l'en-tete.
 *
 * @param {string} text message du proprietaire
 * @param {{ niveau?: string }} [etats] niveau regle (relu par l'appelant)
 * @returns {string} le message a envoyer a l'agent
 */
export function composeTelegramPrompt(text, etats = {}) {
  return composeWithInstruction(text, etats && etats.niveau, VOCAL_BREVITY_ORIGIN_TELEGRAM);
}
