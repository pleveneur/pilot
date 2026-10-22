// update-window.js — FENÊTRE RÉSERVÉE de mise à jour de Pilot (règle unique).
//
// Règle du propriétaire (non réinterprétée) :
//   1. l'écran de mise à jour ne s'affiche que sur un terrain LIBRE (aucun agent
//      ne travaille) ; si du travail est en cours, il attend ;
//   2. pendant que l'écran est ouvert, ou pendant qu'une mise à jour
//      s'installe, AUCUN agent ne démarre ;
//   3. un travail en cours n'est jamais interrompu : rien ne s'affiche tant
//      qu'il dure, l'écran arrive de lui-même quand le terrain se libère ;
//   4. pas d'écran fantôme : la règle est vérifiée AU MOMENT D'AFFICHER, pas
//      seulement au moment de la détection.
//
// Ce module est le SEUL propriétaire de la réservation du terrain. La décision
// « le travail peut-il démarrer ? » reste celle du gardien existant
// (`run-policy.js`, fonction `canStartWork`), qui consulte simplement
// `isUpdateWindowReserved()` : il n'existe donc pas de second gardien
// concurrent, et le texte des refus n'est écrit qu'ici.

/** Motifs de réservation du terrain (un seul actif à la fois). */
export const UPDATE_WINDOW_REASONS = Object.freeze({
  /** L'écran de mise à jour est affiché (changelog visible). */
  WINDOW: "window",
  /** Une mise à jour est en cours d'installation (téléchargement/installateur). */
  INSTALLING: "installing",
});

/** Refus d'un démarrage pendant que l'écran de mise à jour est ouvert. */
export const UPDATE_WINDOW_BLOCKED_MESSAGE =
  "⏳ Mise à jour de Pilot : l'écran de mise à jour est ouvert, donc aucun agent ne " +
  "démarre. Choisissez « Plus tard » (le travail repart immédiatement) ou " +
  "« Installer maintenant » (le travail repart au redémarrage de Pilot).";

/** Refus d'un démarrage pendant qu'une mise à jour s'installe. */
export const UPDATE_INSTALLING_BLOCKED_MESSAGE =
  "⏳ Mise à jour de Pilot en cours d'installation : aucun agent ne démarre. " +
  "Le travail repart au redémarrage de Pilot, à la fin de l'installation.";

/** Motif actif ("" = terrain libre, le travail peut démarrer). */
let _reason = "";
/** Version concernée par la réservation (informatif, jamais une décision). */
let _version = "";

/**
 * Réserve le terrain au profit de la mise à jour.
 * @param {string} reason - `UPDATE_WINDOW_REASONS.WINDOW` ou `.INSTALLING`
 * @param {{version?: string}} [info]
 * @returns {string} motif effectivement posé
 */
export function reserveUpdateWindow(reason, info = {}) {
  const known = reason === UPDATE_WINDOW_REASONS.WINDOW || reason === UPDATE_WINDOW_REASONS.INSTALLING;
  _reason = known ? reason : UPDATE_WINDOW_REASONS.WINDOW;
  const version = info && typeof info.version === "string" ? info.version : "";
  if (version) _version = version;
  return _reason;
}

/**
 * Rend le terrain (écran refermé par « Plus tard »/✕, ou réservation périmée).
 * Le travail peut redémarrer immédiatement : c'est ce que promet le message de
 * refus affiché à l'utilisateur.
 * @returns {void}
 */
export function releaseUpdateWindow() {
  _reason = "";
}

/** true si la mise à jour occupe le terrain (écran ouvert ou installation). */
export function isUpdateWindowReserved() {
  return _reason !== "";
}

/**
 * État courant de la réservation (lecture seule, pour l'affichage et les
 * contrôles).
 * @returns {{reserved: boolean, reason: string, version: string}}
 */
export function getUpdateWindowReservation() {
  return { reserved: _reason !== "", reason: _reason, version: _version };
}

/**
 * Message de refus à afficher quand un démarrage est refusé à cause de la mise
 * à jour. Chaîne vide = aucune réservation (le refus, s'il y en a un, vient
 * d'une autre cause et c'est `run-policy.js` qui le nomme).
 * @returns {string}
 */
export function updateWindowBlockedMessage() {
  if (_reason === UPDATE_WINDOW_REASONS.INSTALLING) return UPDATE_INSTALLING_BLOCKED_MESSAGE;
  if (_reason === UPDATE_WINDOW_REASONS.WINDOW) return UPDATE_WINDOW_BLOCKED_MESSAGE;
  return "";
}

/**
 * Remise à zéro COMPLÈTE (tests uniquement : entre deux cas, aucune réservation
 * ne doit survivre au cas précédent).
 * @returns {void}
 */
export function __resetUpdateWindowForTest() {
  _reason = "";
  _version = "";
}
