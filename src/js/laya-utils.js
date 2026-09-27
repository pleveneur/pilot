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
 * @param {{configured?: boolean, reachable?: boolean, ready?: boolean, embedded?: boolean, outcome?: (string|null)}} [status]
 * @returns {{ text: string, kind: "success"|"info"|"warning"|"error" }}
 */
export function layaStatusMessage(status) {
  const s = status && typeof status === "object" ? status : {};
  if (s.configured !== true) {
    // Service EMBARQUÉ mais pas encore exploitable : le modèle n'est pas complet
    // (téléchargement en cours/à faire) ou le démarrage automatique a été
    // désactivé. Il n'y a rien à régler : le dire évite un conseil sans effet.
    if (s.embedded === true) {
      return {
        text: "Le service Laya est livré avec Pilot : modèle pas encore téléchargé, ou démarrage automatique désactivé.",
        kind: "warning",
      };
    }
    // Paquet construit SANS Laya (`embedded` renseigné à `false`) : aucun réglage
    // ne peut le faire apparaître, le dire clairement.
    if (s.embedded === false) {
      return {
        text: "Cette version de Pilot n'embarque pas le service Laya. Indiquez un programme de service et un dossier de modèle pour en utiliser un.",
        kind: "warning",
      };
    }
    return {
      text: "Service Laya non configuré : activez le démarrage automatique, puis indiquez le service et le dossier du modèle.",
      kind: "warning",
    };
  }
  if (s.reachable !== true) {
    // Issue RÉELLE du dernier contrôle de démarrage : c'est elle qui EXPLIQUE
    // pourquoi le service ne répond pas. Un lancement raté ne doit jamais être
    // annoncé comme « arrêté » (et jamais rester invisible).
    if (typeof s.outcome === "string" && s.outcome.length > 0) {
      return layaOutcomeMessage(s.outcome);
    }
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

/** Raisons possibles d'un téléchargement du modèle (`FetchReason`, camelCase). */
export const LAYA_FETCH_REASONS = [
  "ok",
  "networkOffline",
  "serverRefused",
  "invalidAddress",
  "diskFull",
  "integrityFailed",
  "addressMissing",
  "fetchMissing",
  "nodeMissing",
  "cancelled",
  "alreadyRunning",
  "unknown",
];

/**
 * Traduit l'état du modèle (commande `laya_model_state`) en message utilisateur.
 * Aucun chemin brut, aucun nom de fichier ni code technique à l'écran : un état
 * absent/`null` est traité comme « état indisponible », jamais un crash.
 * @param {{present?: boolean, downloading?: boolean, percent?: (number|null), reason?: (string|null)}} [state]
 * @returns {{ text: string, kind: "success"|"info"|"warning"|"error" }}
 */
export function layaModelStateMessage(state) {
  const s = state && typeof state === "object" ? state : null;
  if (!s) {
    return { text: "État du modèle momentanément indisponible.", kind: "warning" };
  }
  if (s.downloading === true) {
    const percent = layaModelProgressPercent(s);
    return {
      text: percent > 0
        ? `Téléchargement du modèle en cours… ${percent} %`
        : "Téléchargement du modèle en cours…",
      kind: "info",
    };
  }
  if (s.present === true) {
    return { text: "Le modèle de classification est prêt.", kind: "success" };
  }
  switch (s.reason) {
    case "networkOffline":
      return {
        text: "Le modèle n'a pas pu être téléchargé : la connexion à Internet semble indisponible.",
        kind: "warning",
      };
    case "invalidAddress":
      return {
        text: "Le modèle n'a pas pu être téléchargé : l'adresse d'hébergement indiquée n'est pas valide.",
        kind: "warning",
      };
    case "addressMissing":
      return {
        text: "Le modèle n'est pas encore téléchargeable : aucune adresse d'hébergement n'est renseignée.",
        kind: "warning",
      };
    case "diskFull":
      return {
        text: "Le modèle n'a pas pu être téléchargé : il n'y a plus assez de place sur le disque.",
        kind: "error",
      };
    case "integrityFailed":
      return {
        text: "Le modèle téléchargé est abîmé. Relancez le téléchargement : il reprendra et vérifiera les fichiers.",
        kind: "error",
      };
    case "fetchMissing":
      return {
        text: "Le programme de téléchargement est introuvable. Indiquez le fichier de téléchargement du modèle.",
        kind: "warning",
      };
    case "serverRefused":
      return {
        text: "Le modèle n'a pas pu être téléchargé : le serveur d'hébergement a refusé la demande. Réessayez dans quelques minutes.",
        kind: "warning",
      };
    case "nodeMissing":
      return {
        text: "Le moteur d'exécution Node.js est introuvable : le modèle ne peut pas être téléchargé automatiquement.",
        kind: "warning",
      };
    case "cancelled":
      return {
        text: "Téléchargement interrompu. Relancez-le : il reprendra où il s'était arrêté.",
        kind: "info",
      };
    case "alreadyRunning":
      return { text: "Un téléchargement du modèle est déjà en cours.", kind: "info" };
    case "ok":
      return { text: "Le modèle de classification est prêt.", kind: "success" };
    case "unknown":
      return {
        text: "Le téléchargement du modèle a échoué. Relancez-le pour réessayer.",
        kind: "error",
      };
    default:
      return {
        text: "Le modèle de classification est absent. Lancez le téléchargement pour activer le service.",
        kind: "warning",
      };
  }
}

/**
 * Pourcentage d'avancement borné 0..100 (0 si inconnu). Pur.
 * @param {{percent?: (number|null)}} [state]
 * @returns {number}
 */
export function layaModelProgressPercent(state) {
  const s = state && typeof state === "object" ? state : {};
  const percent = s.percent;
  if (typeof percent !== "number" || !Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

// ── Découpe d'un texte en morceaux à UN SEUL SUJET (avant appel Laya) ─────────
// Laya ne donne un verdict fiable que sur un texte à un seul sujet : sur un
// texte à plusieurs sujets il répond sur un seul d'entre eux, parfois le mauvais,
// avec une confiance élevée. Le même texte découpé en phrases puis classé
// morceau par morceau donne des réponses fiables. La découpe ci-dessous est
// DÉTERMINISTE : aucune règle apprise, aucun modèle, aucun appel réseau.

/** En dessous de cette longueur, un morceau est fusionné avec son voisin. */
export const LAYA_CHUNK_MIN_CHARS = 12;

/** Marqueur interne de coupe sur connecteur (jamais présent dans un texte). */
const LAYA_SPLIT_MARK = "\u0000";

/** Connecteurs qui introduisent un AUTRE sujet (coupure au niveau du connecteur). */
const LAYA_CONNECTOR_RE = /\s(?:et|puis|aussi|également|egalement|sauf|and|then)\s/gi;

/**
 * Découpe un texte en morceaux à UN SEUL sujet, de façon DÉTERMINISTE (aucun
 * modèle) : coupe sur la ponctuation forte (point, point-virgule, point
 * d'exclamation, point d'interrogation, points de suspension) et sur les
 * connecteurs qui introduisent un autre problème (« et », « puis », « aussi »,
 * « également », « sauf », « and », « then »). Les morceaux vides ou trop courts
 * sont fusionnés avec leur voisin ; un point interne à un mot (extension de
 * fichier, version, décimale) ne coupe pas ; un texte sans séparateur (le cas le
 * plus fréquent) donne UN SEUL morceau, identique à l'entrée. Fonction PURE.
 * @param {string} text
 * @returns {string[]}
 */
export function splitLayaChunks(text) {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return [];
  const marked = t.replace(LAYA_CONNECTOR_RE, ` ${LAYA_SPLIT_MARK} `);
  const raw = [];
  let start = 0;
  for (let i = 0; i < marked.length; i++) {
    const ch = marked[i];
    if (ch === LAYA_SPLIT_MARK) {
      raw.push(marked.slice(start, i));
      start = i + 1;
      continue;
    }
    if (ch === "." || ch === "!" || ch === "?" || ch === ";" || ch === "…") {
      // Un point ne sépare que s'il n'est pas suivi d'une lettre/chiffre :
      // « 1.5 », « README.md » et « v0.2.5 » restent entiers.
      if (ch === "." && /[\p{L}\p{N}]/u.test(marked[i + 1] || "")) continue;
      raw.push(marked.slice(start, i + 1));
      start = i + 1;
    }
  }
  raw.push(marked.slice(start));
  // Nettoyage : jamais de morceau vide (ponctuation multiple, connecteur doublé).
  const chunks = raw
    .map((s) =>
      s
        .replace(/^[\s.;!?…]+/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((s) => s.length > 0);
  // Fusion d'un morceau trop court avec son voisin (précédent, puis suivant
  // pour le tout premier) plutôt que de le garder isolé.
  const merged = [];
  for (const chunk of chunks) {
    if (merged.length > 0 && chunk.length < LAYA_CHUNK_MIN_CHARS) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  if (merged.length > 1 && merged[0].length < LAYA_CHUNK_MIN_CHARS) {
    merged[1] = `${merged[0]} ${merged[1]}`;
    merged.shift();
  }
  return merged;
}
