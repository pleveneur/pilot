// laya-utils.js — Helpers purs pour le réglage « Service Laya » (onglet Réglages
// → Service Laya). Traduction des états techniques en messages utilisateur.
//
// Aucune dépendance DOM/navigateur : ce module est testable en environnement
// node (cf. `src/js/laya-utils.test.js`), sur le modèle de `plface-utils.js`.
//
// La commande Rust `laya_status` renvoie un état sérialisé en camelCase
// (`LayaStatus`) et la dernière issue de démarrage (`LayaOutcome`, camelCase).
// Ce module traduit chaque état en message CLAIR ET NON TECHNIQUE : aucun nom de
// code, aucun message d'erreur brut n'est visible par l'utilisateur.

/** Issues possibles d'un contrôle de démarrage (`LayaOutcome`). */
export const LAYA_OUTCOMES = [
  "disabled",
  "invalidPath",
  "alreadyRunning",
  "launched",
  "launchedNotReady",
  "launchFailed",
];

/**
 * Traduit l'état du service (commande `laya_status`) en message utilisateur.
 * Un état absent/`null` est traité comme « réglages incomplets » : jamais de
 * crash, jamais de nom technique à l'écran.
 * @param {{configured?: boolean, reachable?: boolean, ready?: boolean}} [status]
 * @returns {{ text: string, kind: "success"|"info"|"warning" }}
 */
export function layaStatusMessage(status) {
  const s = status && typeof status === "object" ? status : {};
  if (s.configured !== true) {
    return {
      text: "Service Laya non configuré : activez le démarrage automatique, puis indiquez le service et le dossier du modèle.",
      kind: "warning",
    };
  }
  if (s.reachable !== true) {
    return { text: "Le service Laya est arrêté.", kind: "info" };
  }
  if (s.ready !== true) {
    return {
      text: "Le service Laya est en cours de chargement du modèle…",
      kind: "info",
    };
  }
  return { text: "Le service Laya est prêt.", kind: "success" };
}

/**
 * Traduit la dernière issue d'un contrôle de démarrage en message utilisateur.
 * @param {string} outcome issue sérialisée renvoyée par le moteur (camelCase)
 * @returns {{ text: string, kind: "success"|"info"|"warning"|"error" }}
 */
export function layaOutcomeMessage(outcome) {
  switch (outcome) {
    case "disabled":
      return {
        text: "Le démarrage automatique du service Laya est désactivé : rien n'a été lancé.",
        kind: "info",
      };
    case "invalidPath":
      return {
        text: "Le service Laya n'a pas été lancé : le chemin du service ou le dossier du modèle est introuvable.",
        kind: "warning",
      };
    case "alreadyRunning":
      return { text: "Le service Laya est déjà lancé.", kind: "info" };
    case "launched":
      return { text: "Le service Laya vient d'être lancé.", kind: "success" };
    case "launchedNotReady":
      return {
        text: "Le service Laya a démarré et charge encore son modèle.",
        kind: "info",
      };
    case "launchFailed":
      return {
        text: "Le lancement du service Laya a échoué. Vérifiez les chemins indiqués puis réessayez.",
        kind: "error",
      };
    default:
      return {
        text: "Impossible de déterminer l'état du service Laya. Réessayez.",
        kind: "warning",
      };
  }
}
