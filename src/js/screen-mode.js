// screen-mode.js — SOURCE UNIQUE des trois modes d'ecran (lot 1)
//
// Trois modes, UN SEUL bouton, UNE SEULE cle de memoire :
//   « Detaille »       -> l'ecran actuel de Pilot (rangee d'onglets + colonne
//                         de gauche de 280 px, inchangee) ;
//   « Assistant seul » -> le plein ecran de l'onglet Assistant. Il EXISTE DEJA
//                         (overlay de super-agent.js) : ce module ne le refait
//                         pas, il demande a y entrer ;
//   « Vocal »          -> PROVISOIRE au lot 1 : branche sur l'ecran de
//                         l'assistant seul. L'ecran vocal arrive au lot 2 ;
//                         une seule ligne a changer ici (`IMMERSIVE_SCREEN_MODES`).
//
// Ce module ne dessine AUCUN ecran : l'entree et la sortie du plein ecran
// restent la propriete de super-agent.js (`enterImmersive` / `exitImmersive`).
// Il publie `pilot-screen-mode-apply` et il tient le bouton (libelle du mode
// COURANT, infobulle du mode SUIVANT, pastille de la teinte du mode courant).
// Aucun second mecanisme, aucun ecran de reglage.
//
// Reference : RAPPORT-trois-modes-ecran-vocal.md §1 et §5 « Lot 1 ».

import { setIcon } from "./icons.js";

/** Cle UNIQUE du mode d'ecran (localStorage). */
export const SCREEN_MODE_KEY = "pilot_screen_mode";

/** Ancien reglage BINAIRE (overlay present / absent), repris par la migration. */
export const LEGACY_IMMERSIVE_KEY = "pilot_superagent_immersive";

/** Identifiant du bouton UNIQUE (il n'existe qu'un seul noeud dans le document). */
export const SCREEN_MODE_BUTTON_ID = "screen-mode-button";

/** Evenement qui demande l'application d'un mode (ecoute par super-agent.js). */
export const SCREEN_MODE_APPLY_EVENT = "pilot-screen-mode-apply";

/** Les trois modes, dans l'ordre du cycle : Detaille -> Assistant seul -> Vocal. */
export const SCREEN_MODES = [
  { id: "detailed", label: "Détaillé", icon: "panels-top-left" },
  { id: "assistant", label: "Assistant seul", icon: "message-circle" },
  { id: "vocal", label: "Vocal", icon: "audio-lines" },
];

// Modes qui demandent un PLEIN ECRAN. Au lot 1, « Vocal » emprunte l'ecran de
// l'assistant seul : c'est la seule ligne a modifier au lot 2.
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
 * Met le bouton en accord avec le mode : libelle du mode COURANT, infobulle du
 * mode SUIVANT, icone Lucide et pastille de la teinte du mode courant.
 * Sans effet si le bouton n'est pas dans le document.
 */
export function renderScreenModeButton(mode) {
  const id = normalizeScreenMode(mode);
  const info = screenModeInfo(id);
  const titre = screenModeTitle(id);
  const btn =
    typeof document !== "undefined" ? document.getElementById(SCREEN_MODE_BUTTON_ID) : null;
  if (!btn) return null;
  btn.dataset.screenMode = id;
  btn.title = titre;
  btn.setAttribute("aria-label", titre);
  const label = btn.querySelector(".screen-mode-label");
  if (label) label.textContent = info.label;
  const icone = btn.querySelector(".screen-mode-icon");
  if (icone) setIcon(icone, info.icon);
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
 * @returns {"detailed"|"assistant"|"vocal"} le mode memorise du poste.
 */
export function initScreenMode() {
  const btn =
    typeof document !== "undefined" ? document.getElementById(SCREEN_MODE_BUTTON_ID) : null;
  if (btn && btn.dataset.screenModeWired !== "1") {
    btn.dataset.screenModeWired = "1";
    btn.addEventListener("click", () => {
      applyScreenMode(nextScreenMode(getScreenMode()));
    });
  }
  return rememberScreenMode(getScreenMode());
}
