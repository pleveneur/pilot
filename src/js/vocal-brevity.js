// vocal-brevity.js — EN MODE VOCAL, PILOT PARLE COURT.
//
// POURQUOI CE MODULE : dans l'ecran Vocal, la voix est le SEUL canal — la
// conversation n'y est pas affichee et la reponse est LUE A VOIX HAUTE. Une
// reponse de chat ecrit (listes, titres, noms de fichiers, code) y est penible
// a ecouter et lente. Decision du proprietaire : Pilot repond BRIEVEMENT,
// comme dans une conversation, et ne developpe que si on le lui demande.
//
// CE QUI VIT ICI, ET RIEN QU'ICI :
//   - `VOCAL_BREVITY_INSTRUCTION` : la consigne exacte ajoutee a la demande
//     envoyee a l'agent quand la demande vient de l'ecran Vocal ;
//   - `composeVocalPrompt(texte, { modeVocal })` : le SEUL assemblage
//     « demande + consigne ». Hors du mode Vocal, le texte est rendu
//     INCHANGE : le chat ecrit et l'onglet Assistant gardent leurs reponses
//     actuelles (aucun autre ecran ne change de comportement).
//
// LA BRIEVETE VIENT DE LA CONSIGNE, JAMAIS D'UNE COUPE : rien n'est tronque
// ici (aucune limite de caracteres, aucune `slice`, aucun `substring`). Une
// reponse coupee au milieu d'une phrase sonnerait faux et cacherait une
// information utile — la consigne suffit, la coupe est interdite.
//
// LES CAS DE SECURITE SONT EXCLUS EXPLICITEMENT dans la consigne : une panne,
// un refus, une erreur (outil, micro, agent) ou une demande de confirmation
// restent ENTIEREMENT dits, meme si c'est plus long que trois phrases.
//
// Aucun reglage, aucun bouton, aucune phrase d'interface : c'est le
// comportement NORMAL du mode Vocal.

/**
 * La consigne de conversation parlee, ajoutee au message envoye a l'agent
 * pour une demande faite depuis l'ecran Vocal. Texte FIGE (aucune donnee, aucun
 * reglage) : il est ajoute tel quel, en fin de demande.
 */
export const VOCAL_BREVITY_INSTRUCTION = [
  "## Mode vocal — parler court",
  "Cette demande vient de l'écran Vocal de Pilot : la conversation n'y est pas affichée et ta réponse va être LUE À VOIX HAUTE.",
  "Règle de conversation parlée : réponds en DEUX OU TROIS PHRASES AU PLUS, comme à l'oral. Pas de listes, pas de titres, pas de tableaux, pas de noms de fichiers, pas de code. Va droit à ce qui est utile à dire à voix haute : ce que tu as fait, ce que ça donne, ce qu'il faut décider.",
  "Si l'utilisateur demande explicitement de développer (« détaille », « explique », « pourquoi », « comment »), alors développe : donne le détail demandé, en restant compréhensible à l'oreille (des phrases, jamais de tableau ni de code).",
  "Exception qui passe AVANT la brièveté : une panne, un refus, une erreur (outil, micro, agent) ou une demande de confirmation se disent ENTIÈREMENT — tout ce qu'il faut pour comprendre et agir, même si c'est plus long que trois phrases. Ne cache jamais une information utile pour rester court.",
].join("\n");

/**
 * Compose le message ENVOYE a l'agent : la demande de l'utilisateur, et — si et
 * seulement si elle vient de l'ecran Vocal — la consigne de brièveté ajoutee a
 * la fin. Points uniques :
 *   - `modeVocal` faux / absent : le texte revient INCHANGE (aucun ecran autre
 *     que le mode Vocal ne change de comportement) ;
 *   - la demande reste INTACTE en tete du message (jamais coupee, jamais
 *     reformulee : ce que l'utilisateur a dit est conserve mot pour mot) ;
 *   - une demande vide ne recoit rien (aucune consigne orpheline).
 *
 * @param {string} text demande de l'utilisateur (telle qu'envoyee aujourd'hui)
 * @param {{ modeVocal?: boolean }} [etats] contexte de l'ecran d'ou part la demande
 * @returns {string} le message a envoyer a l'agent
 */
export function composeVocalPrompt(text, etats = {}) {
  const demande = typeof text === "string" ? text : "";
  if (!etats || etats.modeVocal !== true) return demande;
  if (!demande.trim()) return demande;
  return `${demande}\n\n${VOCAL_BREVITY_INSTRUCTION}`;
}
