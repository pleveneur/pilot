// demande-pendant-le-tour.js — SOURCE UNIQUE de ce que devient une DEMANDE
// (tapée ou DICTÉE) qui arrive PENDANT que l'Assistant travaille.
//
// Le défaut que ce module corrige (propriétaire : « quand l'assistante
// travaille, le mode vocal ne répond plus, j'ai dû relancer mon onglet ») :
// `send()` de super-agent.js REFUSAIT la demande tant que le moteur était
// occupé (`isStreaming || backendBusy`). Le texte restait dans la zone de
// saisie et l'explication s'affichait sur `statusEl` — une ligne qui N'EST PAS
// DANS L'ÉCRAN VOCAL, qui n'a que son portrait, son rond et SA propre ligne
// d'état. Une demande DICTÉE (fin d'écoute → `applyVoiceEnd` → `send`) tombait
// donc dans le vide : rien ne partait, rien ne s'affichait, et rien ne
// repartait à la fin du tour. Un silence complet, sans aucun message.
//
// LA RÈGLE (décision du propriétaire, 2026-11) : une demande n'est JAMAIS
// refusée parce qu'un travail est en cours. Elle est ACCUSÉE tout de suite
// (une phrase, la même dans la conversation et sur la ligne d'état de l'écran
// Vocal), mise EN FILE, puis traitée dès que le tour en cours se termine. Le
// travail en cours n'est ni interrompu, ni perdu, ni attendu par l'écran : le
// mode vocal répond immédiatement.
//
// Ce que ce module ne fait PAS (et ne fera jamais) :
//   - aucun envoi : l'unique chemin d'envoi reste `send()` (super-agent.js),
//     qui reprend la demande depuis la zone de saisie ;
//   - aucune minuterie, aucun délai, aucun « timeout plus long » : la file est
//     vidée sur la FIN DE TOUR réelle (`agent_end`) et sur l'état que le moteur
//     déclare lui-même (`get_agent_supervision` : aucune session en traitement),
//     jamais « au bout de X secondes » ;
//   - aucun réglage, aucun bouton, aucune seconde ligne d'état ;
//   - aucun tri, aucune fusion des demandes : elles partent dans l'ordre reçu.
//
// Le module est PUR (aucun DOM, aucune horloge, aucun IPC) : les décisions sont
// vérifiables, et super-agent.js ne fait que les appliquer.

/**
 * NOMBRE MAXIMAL de demandes gardées pendant un tour.
 *
 * La file est BORNÉE : une demande qui arrive quand elle est pleine est
 * refusée avec un message clair (le texte reste dans la zone de saisie, rien
 * n'est perdu) plutôt que d'empiler sans fin des demandes que l'utilisateur a
 * oubliées. Cinq est le nombre de phrases qu'on peut encore tenir en tête en
 * regardant l'écran Vocal ; au-delà, c'est un empilement aveugle.
 */
export const DEMANDES_EN_ATTENTE_MAX = 5;

/** Le moteur est libre : la demande part par le chemin d'envoi existant. */
export const DEMANDE_ENVOYER = "envoyer";
/** Le moteur travaille : la demande est accusée et mise en file. */
export const DEMANDE_ENFILER = "enfiler";
/** Rien n'est accepté (texte vide, ou file pleine) : l'appelant le dit. */
export const DEMANDE_REFUSEE = "refuser";

/**
 * Accusé de réception dans la CONVERSATION (onglet Assistant).
 * Une phrase, sans jargon : elle dit ce qui va se passer et quand.
 */
export const MESSAGE_DEMANDE_ACCUSEE =
  "🕓 Demande reçue : je m'en occupe dès que j'ai terminé ce que je fais.";

/**
 * Le MÊME accusé sur l'UNIQUE ligne d'état de l'écran Vocal (la conversation
 * n'y est pas affichée : sans cette phrase, l'accusé serait invisible).
 */
export const VOCAL_MESSAGE_DEMANDE_ACCUSEE = "C'est noté, je m'en occupe dès que j'ai terminé.";

/** La file est pleine : rien n'est empilé de plus (le texte reste dans la zone). */
export const MESSAGE_DEMANDE_FILE_PLEINE =
  "🕓 J'ai déjà " +
  DEMANDES_EN_ATTENTE_MAX +
  " demandes en attente. Terminez-en une, puis renvoyez celle-ci : elle reste dans la zone de saisie.";

/**
 * DÉCIDE ce que devient une demande qui arrive maintenant.
 *
 * PURE : ne touche à rien, ne connaît ni le DOM ni le moteur.
 *
 * L'ORDRE DES RÈGLES EST LA SPÉCIFICATION (il est testé tel quel) :
 *   1. pas de texte          → refusée (il n'y a rien à envoyer)
 *   2. moteur LIBRE          → envoyée : le chemin d'envoi existant, inchangé
 *   3. moteur occupé + place → ENFILÉE : accusée tout de suite, traitée ensuite
 *   4. moteur occupé + pleine→ refusée, avec un message clair (jamais muet)
 *
 * @param {object} [etats] `texte` (demande telle qu'elle partirait),
 *   `occupe` (le moteur travaille : `isStreaming || backendBusy`),
 *   `enAttente` (nombre de demandes déjà en file)
 * @returns {{action: string, raison: string, place: number}}
 *   `place` = rang dans la file (0 = prochaine à partir), -1 = aucune place
 */
export function decideDemandePendantLeTour(etats = {}) {
  const e = etats || {};
  const texte = typeof e.texte === "string" ? e.texte.trim() : "";
  // 1. Aucun texte : il n'y a rien à envoyer (et rien à accuser).
  if (texte === "") return { action: DEMANDE_REFUSEE, raison: "sans-texte", place: -1 };
  // 2. Moteur libre : le chemin d'envoi existant, exactement comme avant.
  if (e.occupe !== true) return { action: DEMANDE_ENVOYER, raison: "moteur-libre", place: 0 };
  const n = Number(e.enAttente);
  const deja = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  // 3. Le moteur travaille et il reste de la place : on prend la demande.
  if (deja < DEMANDES_EN_ATTENTE_MAX) {
    return { action: DEMANDE_ENFILER, raison: "tour-en-cours", place: deja };
  }
  // 4. File pleine : refus explicite (le texte reste dans la zone de saisie).
  return { action: DEMANDE_REFUSEE, raison: "file-pleine", place: -1 };
}

/**
 * PREND la prochaine demande de la file, si le moteur est libre.
 *
 * PURE : rend le texte à envoyer et la file restante, ne modifie rien.
 * C'est le seul endroit qui décide de l'ORDRE de sortie (premier arrivé,
 * premier servi) : l'appelant remet le texte dans la zone de saisie et appelle
 * `send()`, l'unique chemin d'envoi.
 *
 * @param {string[]} [file] demandes en attente, dans l'ordre reçu
 * @param {boolean} [occupe] le moteur travaille encore
 * @returns {{texte: string|null, reste: string[]}} `texte` = null si rien ne part
 */
export function prendreDemandeEnAttente(file = [], occupe = false) {
  const f = Array.isArray(file) ? file.filter((t) => typeof t === "string" && t !== "") : [];
  if (occupe === true || f.length === 0) return { texte: null, reste: f };
  return { texte: f[0], reste: f.slice(1) };
}
