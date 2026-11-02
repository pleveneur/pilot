// voicestudio-explication.js — CE QUE L'UTILISATEUR DOIT COMPRENDRE DE LA VOIX
// IMITÉE, écrit à UN SEUL endroit.
//
// Pourquoi ce fichier : la voix imitée ne vient pas d'un moteur embarqué dans
// Pilot, mais d'un **logiciel séparé** (VoiceStudio) que l'utilisateur installe
// et lance lui-même sur le même ordinateur. Tant que ce n'était pas dit à
// l'écran, l'utilisateur croyait que Pilot fournissait cette voix et ne
// comprenait pas pourquoi elle ne marchait pas. Ce module porte la phrase qui le
// dit — visible dans la section « Lecture des réponses » des Paramètres — et
// rien d'autre.
//
// Ce que le texte dit, et que la spec tient (`spec_read_aloud.md` § 4 quater,
// point 12) :
//   a) c'est un logiciel SÉPARÉ, à installer soi-même sur cet ordinateur ;
//   b) il doit être LANCÉ (et rester ouvert) pour que ce choix fonctionne ;
//   c) OÙ le récupérer — et Pilot, qui ne l'embarque pas, ne donne aucune
//      adresse : le texte le dit franchement au lieu d'inventer un lien ;
//   d) service absent ⇒ la lecture CONTINUE (voix française locale, puis voix
//      du système) et l'annonce là où l'on écoute : ni erreur, ni silence.
//
// Aucune URL, aucun nom de domaine, aucun nom de paquet, aucune commande
// d'installation : Pilot n'en connaît pas, et un lien inventé serait pire que
// pas de lien (le propriétaire seul peut en fournir un). Un test le verrouille
// (`voicestudio-explique-dans-les-reglages.test.js`) : ajouter une adresse dans
// ce texte fait échouer la suite tant que la source n'est pas une vraie source
// du dépôt.
//
// Module PUR : ni DOM, ni Tauri, ni réseau, ni état. La seule fonction qui
// touche à l'écran écrit dans le nœud qu'on LUI PASSE (`fillVoiceStudioExplanation`).

import { VOICESTUDIO_ENGINE } from "./voicestudio-voice.js";

/**
 * Phrase affichée dans la section « Lecture des réponses » (une seule copie,
 * reprise telle quelle par le repli écrit dans `index.html` — l'égalité des deux
 * est vérifiée par le test, aucun risque de deux versions divergentes).
 */
export const VOICESTUDIO_EXPLAIN_TEXT =
  `Ma voix imitée fonctionne avec ${VOICESTUDIO_ENGINE}, un logiciel séparé : il s'installe ` +
  "sur cet ordinateur, comme n'importe quel autre logiciel, et Pilot ne l'installe pas, ne le " +
  "lance pas et ne le télécharge pas. Il doit être lancé et rester ouvert pendant la lecture, " +
  "c'est lui qui fabrique le son de votre voix. Absent ou éteint, la lecture ne s'arrête pas : " +
  "elle continue avec la voix française locale, puis avec la voix du système, et une ligne " +
  "l'annonce à côté du bouton « Écouter ». Où le récupérer : Pilot ne fournit pas ce logiciel " +
  "et ne donne aucune adresse de téléchargement ; installez-le depuis la source dont vous " +
  "disposez déjà, puis cliquez sur « Vérifier à nouveau » dans cette section.";

/**
 * Écrit la phrase dans le nœud de la section « Lecture des réponses ».
 *
 * `textContent` seulement : aucun HTML interprété, donc aucun risque d'injection
 * et rien à échapper. Un nœud absent (autre écran, test) n'est pas une erreur :
 * la fonction rend `false`, sans exception — les Paramètres restent utilisables.
 *
 * @param {{textContent?: string}|null} node nœud à remplir (facultatif)
 * @returns {boolean} vrai si la phrase a été écrite
 */
export function fillVoiceStudioExplanation(node) {
  if (!node || typeof node !== "object") return false;
  node.textContent = VOICESTUDIO_EXPLAIN_TEXT;
  return true;
}
