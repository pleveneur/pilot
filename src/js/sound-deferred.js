// sound-deferred.js — Son de fin différé jusqu'à la fin RÉELLE de l'affichage.
//
// Problème corrigé : le son « fin » de l'Assistant était joué au moment où le
// signal de fin ARRIVAIT (remise d'un compte rendu d'agent, fin d'une run
// d'agents) — donc AVANT que le texte de l'assistant / de l'agent ait fini de
// s'afficher à l'écran. L'utilisateur entendait le son pendant que la réponse
// (ou le raisonnement) était encore en train de s'écrire.
//
// Principe : le signal de fin ARME le son (il n'est plus joué immédiatement) ;
// les surfaces de rendu (chat de l'Assistant 🧭, chat d'un agent π) signalent
// leur activité à chaque delta de texte / de raisonnement, puis leur repos à la
// fin du flux. Le son n'est joué que lorsque TOUTES les surfaces sont au repos
// ET qu'un son est armé.
//
// Garde-fous :
//   - aucun son tant qu'une surface de rendu écrit encore — un SILENCE ne prouve
//     JAMAIS la fin du tour : un tour comporte des étapes muettes (appel d'outil
//     long, réflexion non streamée, attente du premier token). Le délai de
//     sécurité ne joue donc le son que si PLUS AUCUNE surface n'est active ;
//     sinon il re-vérifie (cf. `restartSafety`) ;
//   - un son armé alors qu'un tour écrit déjà appartient au tour SUIVANT (le
//     sujet — un compte rendu, un résultat de run — ne sera affiché qu'après la
//     fin du tour en cours : remise différée). Il n'est donc jamais joué à la fin
//     du tour pendant lequel il a été armé ;
//   - un seul son par fin de mission (armement coalescé : un second armement
//     pendant l'attente, ou juste après l'émission, est ignoré) ;
//   - aucun silence complet (délai de sécurité : si rien n'est en cours
//     d'écriture et que la fin d'affichage n'est jamais signalée, le son est joué
//     après `safetyMs`).
//   - son jamais retardé par une interruption : un arrêt MANUEL de l'agent /
//     assistant, un ÉCHEC de processus ou une ANNULATION de run peuvent
//     interrompre le flux sans que la surface signale son repos. Ces sites
//     appellent `resetDeferredSound()` (super-agent.js, agent-pi.js,
//     agents-bus.js) pour remettre l'état à zéro : pas de surface active
//     périmée, donc pas de délai de sécurité résiduel de 12 s.
//
// Module PUR (aucun import navigateur, aucun effet de bord à l'import) :
// `play`, `schedule` et `cancel` sont injectables pour les tests. Le singleton
// exporté est branché sur `playAssistantSound` par l'application
// (`setDeferredSoundPlayer`).

/**
 * Crée un lecteur de son différé.
 * @param {object} [opts]
 * @param {(type: string) => unknown} [opts.play] - émetteur du son.
 * @param {(fn: Function, ms: number) => unknown} [opts.schedule] - planificateur.
 * @param {(id: unknown) => void} [opts.cancel] - annulateur du planificateur.
 * @param {number} [opts.safetyMs] - délai de sécurité sans activité (ms).
 * @param {number} [opts.coalesceMs] - fenêtre anti-doublon après émission (ms).
 * @returns {object} lecteur : arm / activity / idle / reset (+ introspection).
 */
export function createDeferredSoundPlayer({
  play,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  safetyMs = 12000,
  coalesceMs = 1500,
} = {}) {
  let armed = null; // type de son en attente de fin d'affichage.
  let safetyTimer = null; // délai de sécurité (borné) de l'attente.
  let coalesceTimer = null; // fenêtre anti-doublon après émission.
  let coalescing = false; // un son vient d'être joué.
  const activeSources = new Set(); // surfaces de rendu en train d'écrire.
  // Phase d'attente du son armé (cf. en-tête) :
  //   "awaitRunEnd"   : un tour écrit déjà à l'armement → on attend qu'il finisse,
  //                     SANS jouer (ce tour n'affiche pas le sujet) ;
  //   "awaitRunStart" : ce tour est fini, le tour qui affichera le sujet n'a pas
  //                     encore commencé → on attend sa première écriture ;
  //   "awaitIdle"     : le tour du sujet a commencé → on joue à son repos.
  let phase = "awaitIdle";

  const clearSafety = () => {
    if (safetyTimer !== null) {
      cancel(safetyTimer);
      safetyTimer = null;
    }
  };
  const clearCoalesce = () => {
    if (coalesceTimer !== null) {
      cancel(coalesceTimer);
      coalesceTimer = null;
    }
  };

  /** Joue le son armé (une seule fois) et ouvre la fenêtre anti-doublon. */
  function emit() {
    const type = armed;
    armed = null;
    clearSafety();
    if (!type) return false;
    coalescing = true;
    clearCoalesce();
    coalesceTimer = schedule(() => {
      coalescing = false;
      coalesceTimer = null;
    }, coalesceMs);
    try {
      if (typeof play === "function") play(type);
    } catch (_) {
      // fail-open : un son indisponible ne doit jamais casser le flux.
    }
    return true;
  }

  /**
   * (Re)démarre le délai de sécurité tant qu'un son est armé.
   *
   * RÈGLE : le silence n'est pas une fin de tour. Tant qu'une surface de rendu se
   * déclare en écriture, ou tant que le tour qui doit afficher le sujet n'a pas
   * commencé, le minuteur ne joue RIEN : il re-vérifie plus tard. Un tour d'agent
   * passe en effet par des étapes muettes (appel d'outil long, réflexion non
   * streamée) pendant lesquelles l'utilisateur voit encore l'agent travailler.
   */
  function restartSafety() {
    clearSafety();
    safetyTimer = schedule(() => {
      safetyTimer = null;
      if (!armed) return;
      // Du texte / de la réflexion arrive encore : ce n'est pas la fin du tour.
      if (activeSources.size > 0) {
        restartSafety();
        return;
      }
      // Le tour en cours à l'armement n'est pas celui du sujet → on attend.
      if (phase !== "awaitIdle") {
        restartSafety();
        return;
      }
      emit();
    }, safetyMs);
  }

  return {
    /**
     * Arme un son de fin : il sera joué quand l'affichage sera au repos.
     * Ignoré si un son est déjà armé (même fin de mission) ou vient d'être
     * joué (anti-doublon).
     * @param {string} [type]
     * @returns {boolean} true si le son a été armé.
     */
    arm(type = "fin") {
      if (coalescing) return false;
      if (armed) return false;
      armed = type;
      // Un tour écrit déjà ? Le sujet (compte rendu / fin de run) ne sera affiché
      // qu'APRÈS ce tour (remise différée) : sa fin ne doit donc pas faire sonner.
      phase = activeSources.size > 0 ? "awaitRunEnd" : "awaitIdle";
      restartSafety();
      return true;
    },
    /**
     * Signale qu'une surface de rendu écrit encore (delta de texte / pensée).
     * Repousse le délai de sécurité : aucun son tant que du texte arrive.
     * @param {string} [source]
     * @returns {number} nombre de surfaces actives.
     */
    activity(source = "default") {
      activeSources.add(source);
      if (armed) {
        // Tour qui affiche le sujet : à son repos, le son partira.
        if (phase === "awaitRunStart") phase = "awaitIdle";
        restartSafety();
      }
      return activeSources.size;
    },
    /**
     * Signale qu'une surface de rendu est au repos (flux terminé et rendu
     * appliqué). Le son armé n'est joué que si plus AUCUNE surface n'écrit.
     * @param {string} [source]
     * @returns {boolean} true si le son a été joué.
     */
    idle(source = "default") {
      activeSources.delete(source);
      if (!armed) return false;
      // Fin du tour pendant lequel le son a été armé : il ne le concerne pas.
      if (phase === "awaitRunEnd") {
        if (activeSources.size === 0) phase = "awaitRunStart";
        return false;
      }
      if (phase === "awaitRunStart") return false;
      if (activeSources.size > 0) return false;
      return emit();
    },
    /** Remet le lecteur à zéro (nouvelle session, purge de l'onglet). */
    reset() {
      armed = null;
      phase = "awaitIdle";
      activeSources.clear();
      clearSafety();
      clearCoalesce();
      coalescing = false;
    },
    /** @returns {boolean} true si un son est en attente. */
    isArmed() {
      return armed !== null;
    },
    /** @returns {string|null} phase d'attente (introspection / tests). */
    pendingPhase() {
      return armed === null ? null : phase;
    },
    /** @returns {number} nombre de surfaces de rendu actives. */
    pendingCount() {
      return activeSources.size;
    },
  };
}

// ── Singleton applicatif ──────────────────────────────────────────────────
// Les appelants (super-agent.js) branchent l'émetteur réel
// (`playAssistantSound`) via `setDeferredSoundPlayer`. Tant qu'il n'est pas
// branché, le lecteur est inerte.
let deferredPlay = null;

const defaultPlayer = createDeferredSoundPlayer({
  play: (type) => {
    if (typeof deferredPlay === "function") deferredPlay(type);
  },
});

/**
 * Branche l'émetteur réel du son de fin (typiquement `playAssistantSound`).
 * @param {(type: string) => unknown} fn
 */
export function setDeferredSoundPlayer(fn) {
  deferredPlay = typeof fn === "function" ? fn : null;
}

/**
 * Arme le son de fin : joué quand l'affichage sera réellement terminé.
 * @param {string} [type]
 * @returns {boolean}
 */
export function armDoneSound(type = "fin") {
  return defaultPlayer.arm(type);
}

/**
 * Signale une écriture en cours sur une surface de rendu.
 * @param {string} [source]
 * @returns {number}
 */
export function noteSoundRenderActivity(source = "default") {
  return defaultPlayer.activity(source);
}

/**
 * Signale qu'une surface de rendu est au repos.
 * @param {string} [source]
 * @returns {boolean}
 */
export function markSoundRenderIdle(source = "default") {
  return defaultPlayer.idle(source);
}

/** Remet le lecteur singleton à zéro. */
export function resetDeferredSound() {
  defaultPlayer.reset();
}

export const deferredSoundPlayer = defaultPlayer;
