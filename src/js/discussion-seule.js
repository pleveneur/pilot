/**
 * « Discussion seulement via llama » — DÉCISIONS DE LA FENÊTRE, PURES.
 *
 * Ce module ne fait aucun DOM, ne parle à aucun moteur et n'importe pas Tauri :
 * il décide seulement de ce que l'écran montre et de la forme des messages
 * échangés avec le socle. Les phrases (refus, attente, compte rendu d'écriture)
 * vivent dans `src-tauri/src/discussion_seule.rs` et
 * `src-tauri/src/persona_fiche.rs` : la fenêtre les REÇOIT
 * (`discussion_seule_state`) au lieu de les recopier.
 *
 * La décision d'activation (case cochée ET personnage actif) n'est pas ici non
 * plus : elle est dans `discussion_seule::is_active`, côté socle, une seule
 * fois. Ici, on ne fait que LIRE l'état servi.
 */

/** Clé de configuration du mode (carte nom → true). Même valeur que le socle. */
export const CONVERSATION_ONLY_KEY = "character_conversation_only";

/** Sentinelle machine portée par l'outil d'écriture de la fiche. */
export const FICHE_SENTINEL = "PILOT_PERSONA_FICHE::";

/** Libellé EXACT de la pastille de l'en-tête (conception §4.4). */
export const DISCUSSION_ONLY_BADGE = "Discussion seule";

/** Libellé EXACT de la case à cocher (conception §1). */
export const DISCUSSION_ONLY_LABEL = "Discussion seulement via llama";

/** Lien de retour en arrière (conception §4.4). */
export const ROLLBACK_LABEL = "Revenir à la version précédente de la fiche";

/** État par défaut : rien n'est actif, la case n'existe pas. */
export function emptyDiscussionState() {
  return {
    persona: "",
    ficheName: "",
    active: false,
    fiche: "absente",
    hasPrevious: false,
    notice: "",
    optionsLine: "",
    badge: DISCUSSION_ONLY_BADGE,
    configKey: CONVERSATION_ONLY_KEY,
    refusalText: "",
    refusalVocal: "",
    noLocalModel: "",
    workRefusal: "",
    waitingLine: "",
    waitingNoticeMs: 3000,
    waitingTimeoutMs: 60000,
    ficheTool: "",
    ficheSentinel: FICHE_SENTINEL,
    personaLine: "",
    partialStopLine: "",
    disabledLine: "",
  };
}

/**
 * Normalise l'état renvoyé par le socle (`discussion_seule_state`). Toute
 * valeur manquante ou d'un autre type retombe sur le défaut INACTIF : une
 * réponse incomplète ne peut jamais activer le mode par accident.
 */
export function normalizeDiscussionState(raw) {
  const base = emptyDiscussionState();
  if (!raw || typeof raw !== "object") return base;
  const texte = (v, def) => (typeof v === "string" && v.trim() ? v : def);
  const nombre = (v, def) => (Number.isFinite(v) && v > 0 ? v : def);
  return {
    persona: texte(raw.persona, ""),
    ficheName: texte(raw.fiche_name, ""),
    active: raw.active === true,
    fiche: texte(raw.fiche, base.fiche),
    hasPrevious: raw.has_previous === true,
    notice: texte(raw.notice, ""),
    optionsLine: texte(raw.options_line, ""),
    badge: texte(raw.badge, base.badge),
    configKey: texte(raw.config_key, base.configKey),
    refusalText: texte(raw.refusal_text, ""),
    refusalVocal: texte(raw.refusal_vocal, ""),
    noLocalModel: texte(raw.no_local_model, ""),
    workRefusal: texte(raw.work_refusal, ""),
    waitingLine: texte(raw.waiting_line, ""),
    waitingNoticeMs: nombre(raw.waiting_notice_ms, base.waitingNoticeMs),
    waitingTimeoutMs: nombre(raw.waiting_timeout_ms, base.waitingTimeoutMs),
    ficheTool: texte(raw.fiche_tool, ""),
    ficheSentinel: texte(raw.fiche_sentinel, base.ficheSentinel),
    personaLine: texte(raw.persona_line, ""),
    partialStopLine: texte(raw.partial_stop_line, ""),
    disabledLine: texte(raw.disabled_line, ""),
  };
}

/**
 * La case existe-t-elle ? SEULEMENT quand un personnage est actif : sans
 * personnage, l'écran des Options est exactement celui d'avant (conception
 * §4.1, décision 2).
 */
export function checkboxVisible(state) {
  return !!(state && state.persona && state.persona.trim());
}

/** La case doit-elle apparaître cochée ? */
export function checkboxChecked(state) {
  return !!(state && state.active === true);
}

/** La pastille « Discussion seule » est-elle visible dans l'en-tête ? */
export function badgeVisible(state) {
  return checkboxVisible(state) && checkboxChecked(state);
}

/**
 * LA LIGNE GRISE DE LA CONVERSATION, celle qui ne se répète jamais.
 *
 * Trois faits seulement l'ouvrent, et chacun UNE fois par session :
 *   - `disabled` — le personnage a été DÉSACTIVÉ en cours de discussion (§1.5) :
 *     c'est le seul qui parle alors que le mode n'est plus actif ;
 *   - `notice` — le personnage parle sans consigne (fiche absente, vide ou
 *     illisible, conception §3.3 : « une seule fois par session ») ; une fiche
 *     INCOMPLÈTE ne dit rien, c'est un état normal ;
 *   - `personaLine` — le personnage actif a changé en cours de session (§3.4).
 *
 * Aucun de ces textes n'est composé ici : ils viennent tous du socle.
 *
 * @param {object} state état servi par le socle
 * @param {{notice?:boolean, persona?:boolean, disabled?:boolean}} deja ce qui a déjà été dit
 * @returns {{text:string, key:"disabled"|"notice"|"persona"|""}} ce qu'il reste à dire
 */
export function sessionNotice(state, deja) {
  const rien = { text: "", key: "" };
  const s = state || emptyDiscussionState();
  const dits = deja && typeof deja === "object" ? deja : {};
  // La DÉSACTIVATION passe EN PREMIER et ne dépend pas du mode : quand le
  // personnage disparaît, le mode n'est plus actif — pourtant c'est le moment
  // où l'utilisateur a le plus besoin de savoir ce qui vient de se passer.
  if (s.disabledLine && !s.persona && !dits.disabled) {
    return { text: s.disabledLine, key: "disabled" };
  }
  if (!badgeVisible(state)) return rien;
  if (s.notice && !dits.notice) return { text: s.notice, key: "notice" };
  if (s.personaLine && !dits.persona) return { text: s.personaLine, key: "persona" };
  return rien;
}

/**
 * La ligne grise des Options : elle dit, sans erreur rouge, que le personnage
 * parlera SANS consigne (fiche absente, fiche vide) — conception §4.1, §5.
 */
export function optionsNotice(state) {
  if (!checkboxVisible(state)) return "";
  return (state && state.optionsLine) || "";
}

/** Le lien de retour en arrière n'apparaît que s'il existe une version d'avant. */
export function rollbackVisible(state) {
  return checkboxVisible(state) && !!(state && state.hasPrevious === true);
}

/**
 * La requête d'écriture de la fiche (`ctx.ui.input` de l'extension)
 * est-elle pour nous ? Rend la charge utile (JSON, chaîne) ou `null`.
 */
export function ficheRequestPayload(sentinel, title) {
  const marque = typeof sentinel === "string" && sentinel ? sentinel : FICHE_SENTINEL;
  const t = typeof title === "string" ? title : "";
  if (!t.startsWith(marque)) return null;
  return t.slice(marque.length);
}

/**
 * Ce que le MODÈLE reçoit en retour de l'outil d'écriture : le compte rendu du
 * socle, tel quel. Un socle qui ne rend rien (panne) ne fait jamais croire à
 * une écriture réussie.
 */
export function ficheToolValue(report) {
  const texte = typeof report === "string" ? report : "";
  return texte || "L'écriture n'a pas abouti. Ta fiche est restée exactement comme avant.";
}

/**
 * Ligne d'attente : « J'attends le modèle local… » s'affiche seulement après le
 * délai prévu (3 s par défaut, valeur du socle), et le refus seulement après le
 * délai long (60 s). Avant, l'écran ne dit rien.
 */
export function waitingPlan(state, elapsedMs) {
  const s = state || emptyDiscussionState();
  const ecoule = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return {
    showWaiting: ecoule >= s.waitingNoticeMs && !!s.waitingLine,
    showRefusal: ecoule >= s.waitingTimeoutMs,
  };
}

/**
 * La phrase de refus à afficher, choisie par le socle selon le canal (écrit ou
 * oral). Chaîne vide = rien à dire (le socle n'a pas fourni de phrase).
 */
export function refusalSentence(state, vocal) {
  if (!state) return "";
  return (vocal ? state.refusalVocal : state.refusalText) || "";
}

/**
 * Le personnage n'a aucun modèle local réglé : la phrase du socle est affichée
 * et RIEN ne part (aucune bascule silencieuse vers le moteur habituel).
 */
export function noLocalModelSentence(state) {
  return (state && state.noLocalModel) || "";
}

/** Le message envoyé a-t-il échoué faute de modèle local ? (décision d'affichage) */
export function isNoLocalModelError(state, message) {
  const phrase = noLocalModelSentence(state);
  if (!phrase) return false;
  const texte = typeof message === "string" ? message : "";
  return !!texte && texte.includes(phrase.slice(0, 40));
}

/**
 * QUE DIRE QUAND LE LOCAL S'ARRÊTE EN PLEINE RÉPONSE (conception §2.3) ?
 *
 *   - une réponse était DÉJÀ reçue (`partialText` non vide) ⇒ elle est gardée
 *     telle quelle, et on ajoute SEULEMENT la ligne grise du socle : aucune
 *     phrase d'excuse inventée, aucune reprise automatique ;
 *   - rien n'était reçu ⇒ c'est le refus du §2.2 (message gardé dans la barre).
 *
 * Décision pure : aucune écriture à l'écran, aucun minuteur.
 */
export function interruptionPlan(state, partialText, vocal) {
  const recu = typeof partialText === "string" ? partialText.trim() : "";
  const ligne = (state && state.partialStopLine) || "";
  return {
    keepAnswer: !!recu,
    sentence: recu ? ligne : refusalSentence(state, vocal),
  };
}

/**
 * Faut-il retirer le texte de la barre de saisie après un envoi ? En discussion
 * seule, un envoi REFUSÉ garde le texte (conception §2.2) : c'est la même règle
 * que le reste de la fenêtre, l'appelant passe `sent`.
 */
export function keepDraftAfterSend(sent) {
  return sent !== true;
}
