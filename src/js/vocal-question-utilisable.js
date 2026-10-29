// vocal-question-utilisable.js — SOURCE UNIQUE de la règle « une question
// affichée sur l'écran Vocal rend la ZONE DE SAISIE utilisable ».
//
// LE DÉFAUT CORRIGÉ (complément à `spec_modes_ecran_vocal.md` §4bis) : la
// question s'affichait bien dans l'écran Vocal, mais la zone de saisie n'y
// recevait JAMAIS le curseur à son arrivée. `enterVocal` / `applyVocalState` ne
// s'exécutent pas quand une question arrive : le seul point appelé à l'arrivée
// est `pendingQuestionChromeSync` (rendu de la tête de file), et il ne
// s'occupait que de la visibilité du bas. L'utilisateur devait donc cliquer
// dans le champ avant de pouvoir écrire ou dicter sa réponse — et, si un clic
// se perdait sur un décor, la question restait ouverte sans qu'il comprenne
// pourquoi.
//
// CE QUE CE MODULE NE FAIT PAS : aucune réponse décidée à la place de
// l'utilisateur (le curseur ne valide rien), aucun second affichage, aucun
// minuteur, aucun DOM (il est pur : `super-agent.js` l'importe, jamais
// l'inverse).

/**
 * Faut-il DONNER le curseur à la zone de saisie de l'écran Vocal ?
 *
 * PURE : ne lit rien, ne touche à rien, ne connaît ni le DOM ni le focus.
 * L'ordre des règles EST la spécification (il est testé tel quel) :
 *
 *   1. HORS du mode Vocal → non. Le curseur n'est jamais volé au reste de
 *      l'application (éditeur, autre champ) : la règle ne vaut que pour cet
 *      écran.
 *   2. AUCUNE question en tête de file → non : il n'y a rien à rendre
 *      utilisable, et le champ ne doit pas être réveillé pour rien.
 *   3. UNE MODALE est ouverte → non : elle garde le curseur (même garde que
 *      `applyVocalState` / `vocalBargeIn`, écrite une seule fois ici).
 *   4. C'EST DÉJÀ cette question qui a reçu le curseur → non : le rendu de la
 *      rangée est rappelé à chaque clic d'un choix multiple, et le curseur ne
 *      doit pas être retiré au champ sous les doigts de l'utilisateur au
 *      milieu de sa sélection.
 *   5. Sinon → oui : une NOUVELLE question s'affiche, le champ prend le
 *      curseur, on peut donc écrire, dicter ou valider sans geste préalable
 *      (et `Entrée` répond à la question par le chemin existant de `send`).
 *
 * @param {object} [etats]
 * @param {boolean} [etats.vocal] l'écran Vocal est affiché
 * @param {string}  [etats.questionId] identifiant de la question en TÊTE de file
 * @param {boolean} [etats.modalOuverte] une modale est ouverte à l'écran
 * @param {string}  [etats.dejaConcentre] identifiant de la question qui a déjà
 *   reçu le curseur (mémoire de l'appelant)
 * @returns {boolean} vrai s'il faut donner le curseur à la zone de saisie
 */
export function decideVocalQuestionFocus(etats = {}) {
  const e = etats || {};
  // 1. Hors du mode Vocal : rien ne change, le curseur reste où il est.
  if (e.vocal !== true) return false;
  // 2. Aucune question en attente : le champ n'est pas réveillé pour rien.
  const id = e.questionId == null ? "" : String(e.questionId);
  if (id === "") return false;
  // 3. Une modale ouverte garde le curseur.
  if (e.modalOuverte === true) return false;
  // 4. Le curseur est DÉJÀ sur cette question : un re-rendu (choix multiple) ne
  //    le retire pas au champ.
  const deja = e.dejaConcentre == null ? "" : String(e.dejaConcentre);
  if (deja !== "" && deja === id) return false;
  // 5. Une nouvelle question s'affiche : le champ prend le curseur.
  return true;
}

/**
 * La MÊME règle, avec la mémoire du curseur : ce qu'il faut faire au rendu de
 * la rangée, et ce qu'il faut retenir pour le rendu suivant. PURE.
 *
 * Un seul appelant (`pendingQuestionChromeSync`, le point déjà appelé à chaque
 * changement de la file) : la décision et la mémoire ne peuvent donc pas
 * diverger.
 *
 * @param {object} [etats] voir `decideVocalQuestionFocus`
 * @returns {{focus: boolean, memoire: string}} `focus` : donner le curseur au
 *   champ ; `memoire` : identifiant de la question mémorisée pour le rendu
 *   suivant (`""` quand il n'y a plus de question, ou quand aucune n'a encore
 *   reçu le curseur).
 */
export function planVocalQuestionFocus(etats = {}) {
  const e = etats || {};
  const id = e.questionId == null ? "" : String(e.questionId);
  const focus = decideVocalQuestionFocus(e);
  if (id === "") return { focus: false, memoire: "" };
  // Le curseur n'a pas été donné cette fois (c'est DÉJÀ cette question) : la
  // mémoire garde sa valeur, sinon la question suivante la reprendrait pour
  // une question neuve.
  const deja = e.dejaConcentre == null ? "" : String(e.dejaConcentre);
  return { focus, memoire: focus ? id : deja };
}
