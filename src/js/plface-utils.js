// plface-utils.js — Helpers purs pour le réglage « Lancer mon avatar (PLface)
// au démarrage » (onglet Général → Démarrage des Paramètres).
//
// Aucune dépendance DOM/navigateur : ce module est testable en environnement
// node (cf. `src/js/plface-utils.test.js`), sur le modèle de `mcp-utils.js`.
//
// Le moteur Rust (commande `check_and_launch_plface`) renvoie un état sérialisé
// en camelCase (`PlfaceLaunchOutcome`). Ce module traduit chaque état en message
// utilisateur CLAIR ET NON TECHNIQUE : aucun nom de code, aucun message d'erreur
// brut n'est visible par l'utilisateur.

/** États possibles renvoyés par la commande `check_and_launch_plface`. */
export const PLFACE_OUTCOMES = [
  "alreadyRunning",
  "launched",
  "executableNotFound",
  "disabled",
  "launchFailed",
];

/** États possibles renvoyés par la commande `stop_plface`. */
export const PLFACE_STOP_OUTCOMES = ["closed", "notRunning", "failed"];

/**
 * Traduit un état de lancement PLface en message utilisateur.
 * @param {string} outcome état sérialisé renvoyé par le moteur (camelCase)
 * @returns {{ text: string, kind: "success"|"info"|"warning"|"error" }}
 */
export function plfaceOutcomeMessage(outcome) {
  switch (outcome) {
    case "alreadyRunning":
      return { text: "Votre avatar est déjà lancé.", kind: "info" };
    case "launched":
      return { text: "Votre avatar vient d'être lancé.", kind: "success" };
    case "executableNotFound":
      return {
        text: "Le fichier de l'avatar est introuvable. Vérifiez le chemin indiqué.",
        kind: "warning",
      };
    case "disabled":
      return {
        text: "Le lancement automatique est désactivé ou le chemin est vide : rien n'a été lancé.",
        kind: "info",
      };
    case "launchFailed":
      return {
        text: "Le lancement de l'avatar a échoué. Vérifiez le chemin indiqué puis réessayez.",
        kind: "error",
      };
    default:
      return {
        text: "Impossible de déterminer l'état de l'avatar. Réessayez.",
        kind: "warning",
      };
  }
}

/**
 * Traduit l'état d'arrêt de l'avatar en message utilisateur clair et discret.
 * @param {string} outcome état sérialisé renvoyé par `stop_plface` (camelCase)
 * @returns {{ text: string, kind: "success"|"info"|"warning"|"error" }}
 */
export function plfaceStopMessage(outcome) {
  switch (outcome) {
    case "closed":
      return { text: "Votre avatar s'est fermé proprement.", kind: "success" };
    case "notRunning":
      return { text: "Votre avatar n'était pas lancé.", kind: "info" };
    case "failed":
      return {
        text: "Votre avatar n'a pas pu se fermer. Il est peut-être déjà arrêté.",
        kind: "warning",
      };
    default:
      return {
        text: "Impossible de déterminer si l'avatar s'est arrêté.",
        kind: "warning",
      };
  }
}

/**
 * Traduit l'état de fonctionnement de l'avatar (indicateur de l'onglet Avatar).
 * @param {boolean} running vrai si l'avatar répond
 * @returns {{ text: string, kind: "success"|"info" }}
 */
export function plfaceStateMessage(running) {
  return running
    ? { text: "Votre avatar est lancé.", kind: "success" }
    : { text: "Votre avatar est arrêté.", kind: "info" };
}
