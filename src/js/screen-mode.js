// screen-mode.js — SOURCE UNIQUE des trois modes d'ecran (lot 1)
//
// Trois modes, UN SEUL bouton, UNE SEULE cle de memoire :
//   « Detaille »       -> l'ecran actuel de Pilot (rangee d'onglets + colonne
//                         de gauche de 280 px, inchangee) ;
//   « Assistant seul » -> le plein ecran de l'onglet Assistant. Il EXISTE DEJA
//                         (overlay de super-agent.js) : ce module ne le refait
//                         pas, il demande a y entrer ;
//   « Vocal »          -> l'ecran Vocal (lot 2) : son PROPRE plein ecran
//                         `.pilot-vocal` (un objet lumineux au centre, une
//                         seule ligne d'etat, la barre de saisie deplacee).
//                         `screenModeScreen()` est la SEULE source de cette
//                         correspondance mode -> ecran.
//
// Ce module ne dessine AUCUN ecran : l'entree et la sortie du plein ecran
// restent la propriete de super-agent.js (`enterImmersive` / `exitImmersive`,
// `enterVocal` / `exitVocal`). Il publie `pilot-screen-mode-apply` et il tient
// le bouton (infobulle du mode SUIVANT et trace `data-screen-mode` du mode
// COURANT). Le bouton est le LOGO Pilot (`#mode-logo`, dans le bandeau du haut
// de la colonne de gauche) : aucune pastille, aucun mot, aucun second bouton.
// Aucun second mecanisme, aucun ecran de reglage.
//
// Reference : CONCEPTION-logo-bouton-des-trois-modes.md (lots 1 a 3), et
// RAPPORT-trois-modes-ecran-vocal.md §1, §2 et §5 (« Lot 1 », « Lot 2 »).

/** Cle UNIQUE du mode d'ecran (localStorage). */
export const SCREEN_MODE_KEY = "pilot_screen_mode";

/** Ancien reglage BINAIRE (overlay present / absent), repris par la migration. */
export const LEGACY_IMMERSIVE_KEY = "pilot_superagent_immersive";

/** Identifiant du bouton UNIQUE des trois modes : c'est le LOGO du bandeau
 *  (`#mode-logo`, autour de `#btn-project-logo`). Le nom de la constante ne
 *  change pas : la constante dit le ROLE (un <button>), pas le dessin. */
export const SCREEN_MODE_BUTTON_ID = "mode-logo";

/** Delai pendant lequel un second clic sur le logo est ignore. Sous le seuil
 *  systeme de reconnaissance du double-clic (500 ms) : les deux clics d'un
 *  double-clic reflexe tombent dans la garde, deux clics volontaires non. Ce
 *  reflexe existait a cet endroit exact : le double-clic y agrandissait la
 *  fenetre (window-controls.js) avant que le logo ne devienne le bouton. */
export const MODE_CLICK_GUARD_MS = 400;

/** Decision PURE : ce clic doit-il etre ignore ? Des valeurs non numeriques
 *  (aucun clic precedent, `-Infinity` excepte) ne bloquent jamais. */
export function shouldIgnoreModeClick(now, dernier) {
  if (typeof now !== "number" || typeof dernier !== "number") return false;
  return now - dernier < MODE_CLICK_GUARD_MS;
}

/** Horodatage du dernier clic PRIS EN COMPTE (la garde ne le deplace pas). */
let dernierClicMode = -Infinity;

/** Evenement qui demande l'application d'un mode (ecoute par super-agent.js). */
export const SCREEN_MODE_APPLY_EVENT = "pilot-screen-mode-apply";

/** Les trois modes, dans l'ordre du cycle : Detaille -> Assistant seul -> Vocal. */
export const SCREEN_MODES = [
  { id: "detailed", label: "Détaillé", icon: "panels-top-left" },
  { id: "assistant", label: "Assistant seul", icon: "message-circle" },
  { id: "vocal", label: "Vocal", icon: "audio-lines" },
];

// Modes qui demandent un PLEIN ECRAN (tout sauf « Detaille »). La question
// « quel ECRAN ? » est tranchee par `screenModeScreen()`, une seule fois :
// « Vocal » a le sien depuis le lot 2.
const IMMERSIVE_SCREEN_MODES = ["assistant", "vocal"];

/** Mode connu exact, ou null si la valeur n'est pas l'un des trois modes. */
function knownScreenMode(value) {
  const raw = typeof value === "string" ? value : "";
  return SCREEN_MODES.some((m) => m.id === raw) ? raw : null;
}

/** Mode valide (repli « detailed » sur toute valeur absente ou inconnue). */
export function normalizeScreenMode(value) {
  return knownScreenMode(value) || "detailed";
}

/** Fiche du mode (identifiant, libelle affiche, icone Lucide). */
export function screenModeInfo(mode) {
  const id = normalizeScreenMode(mode);
  return SCREEN_MODES.find((m) => m.id === id);
}

/** Mode SUIVANT dans le cycle (Detaille -> Assistant seul -> Vocal -> Detaille). */
export function nextScreenMode(mode) {
  const id = normalizeScreenMode(mode);
  const i = SCREEN_MODES.findIndex((m) => m.id === id);
  return SCREEN_MODES[(i + 1) % SCREEN_MODES.length].id;
}

/** true si le mode demande un plein ecran (tout sauf « Detaille »). */
export function isImmersiveScreenMode(mode) {
  return IMMERSIVE_SCREEN_MODES.includes(normalizeScreenMode(mode));
}

/**
 * Ecran qui possede un mode — SOURCE UNIQUE de cette correspondance :
 *   « detailed »  -> l'ecran normal de Pilot (rangee d'onglets + colonne) ;
 *   « assistant » -> l'overlay du mode assistant seul (super-agent.js) ;
 *   « vocal »     -> l'ecran Vocal `.pilot-vocal` (super-agent.js, lot 2).
 * Aucun autre module ne decide ou « Vocal » est dessine.
 * @param {"detailed"|"assistant"|"vocal"|string} mode
 * @returns {"detailed"|"assistant"|"vocal"}
 */
export function screenModeScreen(mode) {
  return normalizeScreenMode(mode);
}

/**
 * Infobulle du bouton : elle dit le mode COURANT puis annonce le SUIVANT
 * (« Mode d'ecran : Detaille. Passer a « Assistant seul ». »). Le libelle du
 * bouton, lui, dit seulement le mode courant.
 */
export function screenModeTitle(mode) {
  const courant = screenModeInfo(mode).label;
  const suivant = screenModeInfo(nextScreenMode(mode)).label;
  return `Mode d'écran : ${courant}. Passer à « ${suivant} ».`;
}

/** localStorage du poste, ou null hors navigateur (les pures restent testables). */
function defaultStorage() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch (_) {
    /* acces refuse : aucun stockage, le mode retombe sur « Detaille » */
  }
  return null;
}

function storageOf(storage) {
  return storage === undefined ? defaultStorage() : storage;
}

/**
 * Lit le mode memorise. MIGRATION (§1.3) : si `pilot_screen_mode` est ABSENT et
 * que l'ancien reglage `pilot_superagent_immersive` vaut « 1 », on ecrit
 * « assistant ». L'ancienne valeur n'est PAS supprimee : le retour arriere
 * reste possible.
 * @param {Storage|null} [storage] — stockage a interroger (defaut : localStorage).
 * @returns {"detailed"|"assistant"|"vocal"}
 */
export function readScreenMode(storage) {
  const st = storageOf(storage);
  if (!st) return "detailed";
  let memorise = null;
  let ancien = null;
  try {
    memorise = st.getItem(SCREEN_MODE_KEY);
    ancien = st.getItem(LEGACY_IMMERSIVE_KEY);
  } catch (_) {
    return "detailed";
  }
  const connu = knownScreenMode(memorise);
  if (connu) return connu;
  if (memorise === null && ancien === "1") {
    try {
      st.setItem(SCREEN_MODE_KEY, "assistant");
    } catch (_) {
      /* ecriture refusee : le mode reste « assistant » pour cette session */
    }
    return "assistant";
  }
  return "detailed";
}

/**
 * Ecrit le mode memorise (une seule cle, aucune autre ecriture).
 * @returns {"detailed"|"assistant"|"vocal"} le mode effectivement ecrit.
 */
export function writeScreenMode(mode, storage) {
  const id = normalizeScreenMode(mode);
  const st = storageOf(storage);
  if (!st) return id;
  try {
    st.setItem(SCREEN_MODE_KEY, id);
  } catch (_) {
    /* ecriture refusee : le mode vaut pour la session en cours */
  }
  return id;
}

/** Mode courant du poste (lu une fois, puis tenu par ce module). */
let currentMode = null;

/** Mode courant (memoire du poste, migration comprise). */
export function getScreenMode() {
  if (currentMode === null) currentMode = readScreenMode();
  return currentMode;
}

/**
 * Met le bouton en accord avec le mode : infobulle du mode SUIVANT et trace
 * `data-screen-mode` du mode COURANT. Sans effet si le bouton n'est pas dans le
 * document. Le bouton etant le LOGO, il ne porte ni mot ni icone ni pastille :
 * le mode courant se lit a l'ecran, l'infobulle annonce le suivant.
 */
export function renderScreenModeButton(mode) {
  const id = normalizeScreenMode(mode);
  const titre = screenModeTitle(id);
  const btn =
    typeof document !== "undefined" ? document.getElementById(SCREEN_MODE_BUTTON_ID) : null;
  if (!btn) return null;
  btn.dataset.screenMode = id;
  btn.title = titre;
  btn.setAttribute("aria-label", titre);
  return btn;
}

/** Memorise le mode SANS demander d'ecran (utilise a l'entree / sortie reelles). */
export function rememberScreenMode(mode) {
  currentMode = writeScreenMode(mode);
  renderScreenModeButton(currentMode);
  return currentMode;
}

/**
 * Demande un mode : il est memorise, le bouton est mis a jour, puis l'ecran
 * reel est demande par l'evenement `pilot-screen-mode-apply` (ecoute par
 * super-agent.js et par main.js). Aucun ecran n'est dessine ici.
 * @returns {"detailed"|"assistant"|"vocal"} le mode applique.
 */
export function applyScreenMode(mode) {
  const id = rememberScreenMode(mode);
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(
      new CustomEvent(SCREEN_MODE_APPLY_EVENT, { detail: { mode: id } })
    );
  }
  return id;
}

/** Appelee par l'onglet Assistant quand il ENTRE reellement en plein ecran
 *  (Ctrl+Shift+A, retour arriere, restauration au demarrage). Un mode deja
 *  immersif est CONSERVE : « Vocal » emprunte cet ecran au lot 1 et ne doit pas
 *  etre remplace par « Assistant seul ». */
export function noteImmersiveEntered() {
  const courant = getScreenMode();
  if (isImmersiveScreenMode(courant)) {
    renderScreenModeButton(courant);
    return courant;
  }
  return rememberScreenMode("assistant");
}

/** Appelee par l'onglet Assistant quand il SORT du plein ecran (bouton retour,
 *  touche Echap, fermeture de l'onglet). */
export function noteImmersiveExited() {
  const courant = getScreenMode();
  if (!isImmersiveScreenMode(courant)) {
    renderScreenModeButton(courant);
    return courant;
  }
  return rememberScreenMode("detailed");
}

/**
 * Cablage du bouton unique (idempotent) + application de la migration. A
 * appeler une fois au demarrage, avant le masquage de l'ecran de chargement.
 * GARDE ANTI-DOUBLE-CLIC (lot 3) : un second clic a moins de 400 ms est
 * ignore — le double-clic reflexe de cet endroit (qui agrandissait la fenetre)
 * ne franchit donc qu'UN mode, jamais deux.
 * @returns {"detailed"|"assistant"|"vocal"} le mode memorise du poste.
 */
export function initScreenMode() {
  const btn =
    typeof document !== "undefined" ? document.getElementById(SCREEN_MODE_BUTTON_ID) : null;
  if (btn && btn.dataset.screenModeWired !== "1") {
    btn.dataset.screenModeWired = "1";
    btn.addEventListener("click", () => {
      const maintenant = Date.now();
      if (shouldIgnoreModeClick(maintenant, dernierClicMode)) return;
      dernierClicMode = maintenant;
      applyScreenMode(nextScreenMode(getScreenMode()));
    });
  }
  return rememberScreenMode(getScreenMode());
}
