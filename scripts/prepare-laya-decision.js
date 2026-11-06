// prepare-laya-decision.js — DÉCISIONS PURES de la préparation du service Laya.
//
// Pourquoi ce module existe (incident : « la commande de lancement dev échoue »,
// `docs/rapports/RAPPORT-diagnostic-lancement-dev.md`) :
//
//   `scripts/prepare-laya.js` commençait par `fs.rmSync("src-tauri/laya")` —
//   123,5 Mo dont un `node.exe` de 96 Mo — sans aucun rattrapage. Dès qu'un
//   fichier de ce dossier était tenu ouvert (une session de développement
//   précédente, le service Laya resté en fond, un explorateur Windows posé
//   dessus), l'appel levait `EPERM`/`EBUSY`, l'exception n'était pas rattrapée,
//   le script sortait en 1 et Tauri n'affichait plus qu'un
//   « beforeDevCommand terminated with a non-zero status code ». Pire : le
//   dossier se retrouvait AMPUTÉ (un seul fichier survivant) parce que la
//   suppression avait déjà commencé.
//
// Les trois décisions qui corrigent cela, et qui ne vivent QUE ici :
//
//   1. RÉESSAYER un effacement / un renommage qui échoue pour une raison
//      PASSAGÈRE (fichier tenu ouvert) — un petit nombre de fois, avec une
//      attente courte, et JAMAIS pour une cause définitive (`retryStep`) ;
//   2. DIRE quoi faire, en français, quand le plafond est atteint, et sortir
//      avec un code explicite (`lockedDestinationMessage`) ;
//   3. NE JAMAIS détruire l'état existant : la nouvelle version est construite
//      dans un dossier temporaire À CÔTÉ, puis BASCULÉE en une fois
//      (`installDestination`). Un échec laisse la cible intacte.
//
// Module PUR : aucune I/O, aucun `fs`, aucun minuteur — tout est INJECTÉ
// (`remove`, `rename`, `exists`, `sleep`). `scripts/prepare-laya-decision.test.js`
// le teste directement ; `scripts/prepare-laya.js` ne décide plus rien lui-même.

/** Nombre de tentatives d'un effacement / renommage passagèrement refusé. */
export const REMOVE_RETRY_ATTEMPTS = 8;

/** Attente entre deux tentatives (ms) : courte, l'utilisateur attend le dev. */
export const REMOVE_RETRY_DELAY_MS = 150;

/** Code de sortie quand la cible est tenue ouverte (distinct d'un échec de garde-fou). */
export const EXIT_DESTINATION_LOCKED = 2;

/** Suffixe du dossier de travail (construit à côté de la cible). */
export const TEMP_SUFFIX = ".tmp";

/** Suffixe du dossier précédent, mis de côté pendant la bascule. */
export const PREVIOUS_SUFFIX = ".old";

/**
 * Codes qui valent un RÉESSAI : un autre programme tient le fichier ou le
 * dossier, ce qui peut cesser en quelques centaines de millisecondes.
 * Tout le reste (disque plein, système de fichiers en lecture seule, chemin
 * invalide) est DÉFINITIF : réessayer ne ferait qu'attendre pour rien.
 */
export const TRANSIENT_CODES = Object.freeze([
  "EPERM",
  "EBUSY",
  "EACCES",
  "ENOTEMPTY",
]);

/** Code d'erreur normalisé (`""` si l'erreur n'en porte pas). PURE. */
export function errorCode(error) {
  const code = error && typeof error === "object" ? error.code : null;
  return typeof code === "string" ? code.toUpperCase() : "";
}

/** Une panne qui peut cesser d'elle-même (fichier tenu ouvert) ? PURE. */
export function failureIsTransient(error) {
  return TRANSIENT_CODES.includes(errorCode(error));
}

/** Dossier de travail de la préparation (`<cible>.tmp`). PURE. */
export function temporaryDirFor(dest) {
  return dest + TEMP_SUFFIX;
}

/** Dossier mis de côté le temps de la bascule (`<cible>.old`). PURE. */
export function previousDirFor(dest) {
  return dest + PREVIOUS_SUFFIX;
}

/**
 * Exécute une opération, en la RÉESSAYANT tant que la panne est passagère.
 * PURE (tout est injecté) et ASYNCHRONE (l'attente n'immobilise pas la boucle).
 *
 * Rend `{ ok, attempts, error }` :
 *   `ok`       : l'opération a fini par réussir ;
 *   `attempts` : nombre de tentatives RÉELLEMENT faites (1 pour une panne
 *                définitive : on n'attend pas pour rien) ;
 *   `error`    : la dernière exception, ou `null`.
 */
export async function retryStep({
  action,
  attempts = REMOVE_RETRY_ATTEMPTS,
  delayMs = REMOVE_RETRY_DELAY_MS,
  sleep,
  isTransient = failureIsTransient,
} = {}) {
  const plafond = Math.max(1, Math.trunc(attempts));
  let error = null;
  let tries = 0;
  for (let i = 1; i <= plafond; i++) {
    tries = i;
    try {
      action();
      return { ok: true, attempts: tries, error: null };
    } catch (e) {
      error = e;
      if (!isTransient(e)) break;
      // Aucune attente APRÈS la dernière tentative : on rend la panne tout de suite.
      if (i < plafond) await sleep(delayMs);
    }
  }
  return { ok: false, attempts: tries, error };
}

/** Efface un chemin, en réessayant les refus passagers. PURE (I/O injectée). */
export async function removeWithRetries({
  dest,
  remove,
  attempts = REMOVE_RETRY_ATTEMPTS,
  delayMs = REMOVE_RETRY_DELAY_MS,
  sleep,
  isTransient = failureIsTransient,
} = {}) {
  return retryStep({
    action: () => remove(dest),
    attempts,
    delayMs,
    sleep,
    isTransient,
  });
}

/**
 * BASCULE la nouvelle version en une seule fois — la cible n'est jamais
 * supprimée « en espérant » pouvoir la reconstruire (défaut d'origine).
 *
 *   1. si un `<cible>.old` traîne (bascule précédente interrompue), il est effacé ;
 *   2. si la cible existe, elle est RENOMMÉE en `<cible>.old` (une seule
 *      opération : ou bien elle réussit, ou bien la cible reste intacte) ;
 *   3. le dossier temporaire est renommé sur la cible ;
 *   4. `<cible>.old` est effacé (au mieux : un reste n'est pas fatal).
 *
 * Une panne du point 2 laisse la cible TELLE QUELLE. Une panne du point 3 remet
 * l'ancien dossier en place. Rend :
 *   `{ ok, stage, steps, attempts, error, previousLeftBehind }`.
 * `stage` vaut "done" en cas de succès, sinon l'étape fautive :
 * "drop-previous" | "move-aside" | "place-new".
 */
export async function installDestination({
  dest,
  tmp,
  exists,
  rename,
  remove,
  sleep,
  attempts = REMOVE_RETRY_ATTEMPTS,
  delayMs = REMOVE_RETRY_DELAY_MS,
  isTransient = failureIsTransient,
} = {}) {
  const previous = previousDirFor(dest);
  const steps = [];
  const retry = (action) =>
    retryStep({ action, attempts, delayMs, sleep, isTransient });

  let movedAside = false;
  if (exists(dest)) {
    if (exists(previous)) {
      const dropped = await retry(() => remove(previous));
      if (!dropped.ok) {
        return {
          ok: false,
          stage: "drop-previous",
          steps,
          attempts: dropped.attempts,
          error: dropped.error,
          previousLeftBehind: true,
        };
      }
      steps.push("drop-previous");
    }
    const aside = await retry(() => rename(dest, previous));
    if (!aside.ok) {
      // Rien n'a été touché : la cible est intacte, seul le temporaire est en trop.
      return {
        ok: false,
        stage: "move-aside",
        steps,
        attempts: aside.attempts,
        error: aside.error,
        previousLeftBehind: false,
      };
    }
    movedAside = true;
    steps.push("move-aside");
  }

  const placed = await retry(() => rename(tmp, dest));
  if (!placed.ok) {
    let restored = false;
    if (movedAside) {
      try {
        rename(previous, dest);
        restored = true;
      } catch {
        restored = false;
      }
    }
    return {
      ok: false,
      stage: "place-new",
      steps,
      attempts: placed.attempts,
      error: placed.error,
      restored,
      previousLeftBehind: !restored,
    };
  }
  steps.push("place-new");

  let previousLeftBehind = false;
  if (movedAside) {
    const dropped = await retry(() => remove(previous));
    if (dropped.ok) steps.push("drop-previous");
    else previousLeftBehind = true;
  }

  return {
    ok: true,
    stage: "done",
    steps,
    attempts: 1,
    error: null,
    previousLeftBehind,
  };
}

/** Phrase honnête sur l'état laissé après une bascule impossible. PURE. */
export function destinationIntactSentence({ stage, restored }) {
  if (stage === "move-aside" || stage === "drop-previous") {
    return "Rien n'a été effacé : le dossier existant est intact, tel qu'il était.";
  }
  if (restored) {
    return "L'ancien dossier a été remis en place : l'état existant n'a pas bougé.";
  }
  return "L'ancien dossier n'a pas pu être remis en place ; il reste à côté, intact.";
}

/**
 * Message EN FRANÇAIS, clair et actionnable, quand la cible est tenue ouverte
 * et que le plafond de tentatives est atteint. Aucune pile d'appels, aucun
 * jargon : trois gestes à faire, numérotés, puis l'état laissé. PURE.
 */
export function lockedDestinationMessage({
  dest,
  attempts = REMOVE_RETRY_ATTEMPTS,
  delayMs = REMOVE_RETRY_DELAY_MS,
  error = null,
  stage = "move-aside",
  restored = false,
} = {}) {
  const code = errorCode(error);
  return [
    "[prepare-laya] ❌ Le dossier des fichiers du service Laya n'a pas pu être remplacé.",
    `[prepare-laya]     ${dest}`,
    "[prepare-laya]     Un autre programme le tient ouvert : " +
      `${attempts} tentative(s) espacée(s) de ${delayMs} ms` +
      (code ? ` ont échoué (${code}).` : " ont échoué."),
    "[prepare-laya]",
    "[prepare-laya] Ce qu'il faut faire :",
    "[prepare-laya]   1. fermez Pilot s'il est ouvert (la version installée, ou une",
    "[prepare-laya]      session de développement précédente restée en vie) ;",
    "[prepare-laya]   2. arrêtez le service Laya resté en fond (Paramètres → « Service",
    "[prepare-laya]      Laya » → Arrêter) et fermez toute fenêtre de l'explorateur",
    "[prepare-laya]      Windows ouverte dans ce dossier ;",
    "[prepare-laya]   3. relancez la commande (npm run tauri dev).",
    "[prepare-laya]",
    `[prepare-laya] ${destinationIntactSentence({ stage, restored })}`,
  ].join("\n");
}

/**
 * Message d'échec d'une COPIE (interpréteur, bibliothèque, moteur natif) :
 * nomme la pièce et le code, puis dit quoi faire. Jamais de pile brute. PURE.
 */
export function copyFailureMessage({ rel, target, error } = {}) {
  const code = errorCode(error);
  return [
    "[prepare-laya] ❌ La copie des fichiers du service Laya a échoué.",
    `[prepare-laya]     Pièce : ${rel || "(inconnue)"}`,
    `[prepare-laya]     Vers  : ${target}`,
    code ? `[prepare-laya]     Code  : ${code}` : "",
    "[prepare-laya]",
    "[prepare-laya] Ce qu'il faut faire : fermez Pilot s'il est ouvert, arrêtez le",
    "[prepare-laya] service Laya resté en fond, puis relancez la commande.",
    "[prepare-laya] Le dossier existant n'a pas été abîmé : la copie se faisait à",
    "[prepare-laya] côté et sera refaite au prochain lancement.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Ce qu'il reste à faire d'un dossier temporaire après une bascule manquée :
 * il est effacé au mieux, et on le DIT (jamais un reste muet de 124 Mo). PURE.
 */
export function temporaryCleanupSentence({ tmp, removed } = {}) {
  return removed
    ? `[prepare-laya] La copie préparée (${tmp}) a été supprimée.`
    : `[prepare-laya] ⚠️  La copie préparée (${tmp}) n'a pas pu être supprimée ; ` +
        "elle sera reprise au prochain lancement.";
}

/** Ligne de fin : nomme l'étape pour que Tauri ne dise pas que « code non nul ». PURE. */
export function failureHeadline() {
  return "[prepare-laya] ÉCHEC — la préparation du service Laya s'arrête ici.";
}
