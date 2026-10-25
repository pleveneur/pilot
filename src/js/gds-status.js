// gds-status.js — Détection « projet branché sur un GDS » (spec_gds.md)
//
// Un projet est « branché sur un GDS » quand il a une configuration GDS
// (`.pilot/gds.json` présent et activé). Évolution 3 : l'état est rendu
// honnête via la commande Tauri `gds_connection_status` (retourne
// 'connected' | 'error' | 'not_configured'), pour que le bandeau reflète la
// réalité de la connexion (dépôt bare valide, remote `gds` présent, pool
// joignable) et pas seulement la présence du fichier de config. Fail-open :
// toute erreur → non branché (jamais bloquant).

import { invoke } from "@tauri-apps/api/core";

/**
 * Mappe la réponse du backend (commande `gds_connection_status`) sur un état
 * normalisé. Pure — testable. Toute valeur inattendue / manquante →
 * `'not_configured'` (fail-open).
 * @param {{status?: string} | null | undefined} v - réponse Tauri.
 * @returns {string} `'connected'` | `'not_published'` | `'error'` |
 *   `'not_configured'`.
 */
export function mapGdsStatus(v) {
  const s = v && v.status;
  return s === "connected" || s === "not_published" || s === "error"
    ? s
    : "not_configured";
}

/**
 * Décision de badge « connecté » : SEULE la valeur `'connected'` (évol 3)
 * justifie le suffixe GDS. `'error'`, `'not_published'` et `'not_configured'`
 * sont des chaînes TRUTHY mais ne doivent JAMAIS être traitées comme connectées
 * (piège qui a causé une régression : tous les badges assistant suffixés `- (GDS)`).
 * `'not_published'` = dépôt du serveur vide (branche jamais publiée) : la
 * synchronisation ne peut pas fonctionner, donc jamais « connecté ». Pure.
 * @param {string} status - résultat de `isProjectGds`.
 * @returns {boolean} `true` uniquement si `status === "connected"`.
 */
export function isGdsConnected(status) {
  return status === "connected";
}

/**
 * Retourne l'état de connexion GDS d'un projet : `'connected'` |
 * `'not_published'` | `'error'` | `'not_configured'`. Fail-open : erreur d'appel
 * → `'not_configured'`. Ne révèle jamais de mot de passe (le backend ne remonte
 * que l'état).
 * @param {string} projectPath - chemin du projet.
 * @returns {Promise<string>}
 */
export async function isProjectGds(projectPath) {
  if (!projectPath) return "not_configured";
  try {
    const res = await invoke("gds_connection_status", { project: projectPath });
    return mapGdsStatus(res);
  } catch (_) {
    return "not_configured"; // fail-open : jamais bloquant
  }
}

/**
 * État GDS complet d'un projet, pour les libellés qui doivent distinguer les
 * DEUX faits : l'inscription du projet **sur le serveur** (`onServer`) et la
 * **liaison de ce poste** (`status`). `gds_connection_status` renvoie `error`
 * aussi bien pour un projet inscrit que pour un projet absent du serveur :
 * `status` seul ne permet donc pas d'affirmer l'inscription. Fail-open :
 * erreur d'appel → `not_configured` + `onServer: false`. Aucun secret.
 * @param {string} projectPath - chemin du projet.
 * @returns {Promise<{status: string, onServer: boolean}>}
 */
export async function projectGdsInfo(projectPath) {
  if (!projectPath) return { status: "not_configured", onServer: false };
  try {
    const res = await invoke("gds_connection_status", { project: projectPath });
    return { status: mapGdsStatus(res), onServer: !!(res && res.on_server) };
  } catch (_) {
    return { status: "not_configured", onServer: false }; // fail-open
  }
}

// -----------------------------------------------------------------------------
// PORTAGE (mode reseau multi-postes, plan §7 etape 5) -- SOURCE UNIQUE de la
// lecture des reponses de portage et des textes de l'interface.
//
// Le serveur reste seul juge : l'interface ne fait que LIRE ce qu'il repond
// (`gds_handover_can_write`, `gds_handover_take`, `gds_handover_state`,
// `gds_handover_return`) et le dit en francais simple. Aucune de ces fonctions
// n'ecrit, ne devine un porteur et n'invente une echeance : sans donnee, elles
// repondent `unknown`.
// -----------------------------------------------------------------------------

/** Aucun porteur : ce poste peut prendre le projet en main. */
export const HANDOVER_FREE = "free";
/** Ce poste tient le projet. */
export const HANDOVER_MINE = "mine";
/** Le projet est tenu par un AUTRE poste : lecture seule. */
export const HANDOVER_OTHER = "other";
/** L'etat n'a pas pu etre etabli (panne, refus sans porteur, reponse vide). */
export const HANDOVER_UNKNOWN = "unknown";

/** Etat de portage neutre (aucune information) : jamais une supposition. */
function emptyHandover(message = "") {
  return {
    kind: HANDOVER_UNKNOWN,
    allowed: false,
    claimRequired: false,
    mine: false,
    holder: "",
    until: "",
    expired: false,
    posteId: "",
    message: String(message || ""),
  };
}

/** Identifiant de poste porte par un objet `holder` (objet ou chaine). Pure. */
function holderPosteIdOf(obj) {
  if (!obj || typeof obj !== "object") return "";
  const h = obj.holder;
  if (!h) return "";
  const raw = typeof h === "string" ? h : h.poste_id;
  return String(raw == null ? "" : raw).trim();
}

/**
 * Lit une reponse de portage et en tire un etat exploitable par l'interface.
 * Pure.
 *
 * Formes acceptees (toutes rendues par le poste) :
 *  - `gds_handover_can_write` : `{ ok, allowed, claim_required, poste_id, state }`,
 *    ou un refus `{ ok:false, refused:true, error, poste_id, state }` ;
 *  - `gds_handover_take` : succes `{ ok:true, action, state, poste_id }`, refus
 *    `{ ok:false, refused:true, error, holder, until }` (porteur et echeance
 *    sont alors en tete de reponse, pas dans `state`).
 *
 * Regles : porteur = ce poste et prise NON expiree -> `mine` ; porteur = ce
 * poste mais prise expiree -> `free` (a reprendre) ; porteur = un autre poste
 * -> `other` ; aucun porteur -> `free` ; tout le reste -> `unknown`.
 * @param {object|null|undefined} value - reponse brute d'une commande de portage.
 * @returns {{kind: string, allowed: boolean, claimRequired: boolean,
 *   mine: boolean, holder: string, until: string, expired: boolean,
 *   posteId: string, message: string}}
 */
export function mapHandoverState(value) {
  const v = value && typeof value === "object" ? value : null;
  if (!v) return emptyHandover();
  const state = v.state && typeof v.state === "object" ? v.state : v;
  const out = emptyHandover(v.error || v.message || "");
  out.posteId = String(v.poste_id || state.poste_id || "").trim();
  out.holder = holderPosteIdOf(state) || holderPosteIdOf(v);
  out.until = String(state.expires_at || state.until || v.until || "").trim();
  out.expired = state.expired === true || v.expired === true;
  out.allowed = v.allowed === true;
  out.claimRequired = v.claim_required === true;
  const samePoste =
    !!out.holder &&
    !!out.posteId &&
    out.holder.toLowerCase() === out.posteId.toLowerCase();
  if (out.allowed) out.kind = HANDOVER_MINE;
  else if (samePoste) out.kind = out.expired ? HANDOVER_FREE : HANDOVER_MINE;
  else if (out.holder) out.kind = HANDOVER_OTHER;
  else if (out.claimRequired) out.kind = HANDOVER_FREE;
  else if (v.ok === true) out.kind = HANDOVER_FREE;
  out.mine = out.kind === HANDOVER_MINE;
  return out;
}

/** Deux chiffres, avec un zero devant (`4` -> `"04"`). Pure. */
function two(n) {
  return String(n).padStart(2, "0");
}

/**
 * Heure de fin de prise en main, LISIBLE, dans le fuseau de ce poste. Pure.
 *
 * Rend `"14:35"` quand l'echeance tombe le jour courant, `"26/10 a 14:35"` un
 * autre jour, `"26/10/2026 a 14:35"` une autre annee. Une echeance absente ou
 * illisible rend une chaine vide : jamais une heure inventee.
 * @param {string} iso - `expires_at` du serveur (RFC 3339 ou horodatage SQL).
 * @param {Date} [now] - "maintenant" (injectable pour les tests).
 * @returns {string}
 */
export function formatHandoverUntil(iso, now = new Date()) {
  const raw = String(iso == null ? "" : iso).trim();
  if (!raw) return "";
  let d = new Date(raw);
  if (Number.isNaN(d.getTime())) d = new Date(raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  const hhmm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hhmm;
  const jour = `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
  if (d.getFullYear() !== now.getFullYear()) {
    return `${jour}/${d.getFullYear()} a ${hhmm}`;
  }
  return `${jour} a ${hhmm}`;
}

/**
 * Bandeau de portage de l'ecran GDS. Pure.
 *
 * - `other` -> bandeau d'alerte « tenu par un autre developpeur, jusqu'a
 *   HH:MM » + lecture seule de publication (JAMAIS sans l'heure quand elle est
 *   connue) ;
 * - `unknown` -> dit que la verification est impossible (jamais un silence) ;
 * - `mine` -> AUCUN bandeau : ce poste tient le projet, rien a signaler (le
 *   bouton de restitution suffit, voir `handoverHasGiveBack`) ;
 * - `free` -> AUCUN bandeau : projet libre, rien a signaler.
 *
 * Le texte ne promet QUE ce qui est reellement tenu : rien ne peut etre PUBLIE
 * vers le serveur tant que ce poste ne tient pas le projet (le serveur refuse),
 * et la lecture / la navigation / la consultation restent possibles.
 * @param {object} h - etat rendu par `mapHandoverState`.
 * @param {Date} [now] - "maintenant" (injectable).
 * @returns {{tone: string, text: string}|null}
 */
export function handoverBanner(h, now = new Date()) {
  const kind = h && h.kind;
  if (kind === HANDOVER_OTHER) {
    const until = formatHandoverUntil(h.until, now);
    const qui = until
      ? `Ce projet est tenu par un autre développeur, jusqu'à ${until}.`
      : "Ce projet est tenu par un autre développeur.";
    return {
      tone: "warn",
      text:
        `${qui} Ce poste ne peut rien publier tant qu'il ne tient pas le projet : ` +
        "la lecture, la navigation et la consultation restent possibles, la " +
        "publication du code et de l'avancement est refusée.",
    };
  }
  if (kind === HANDOVER_UNKNOWN) {
    const why = h && h.message ? ` (${h.message})` : "";
    return {
      tone: "warn",
      text:
        "L'état de la prise en main de ce projet n'a pas pu être vérifié" +
        `${why}. Le serveur reste seul juge au moment de publier : rien n'est publié ` +
        "dans le dos d'un autre développeur.",
    };
  }
  return null;
}

/**
 * Signale le TRAVAIL LOCAL qui ne peut pas etre publie faute de portage, et
 * propose l'action « prendre le projet pour publier » (plan §1). Pure.
 *
 * Aucune modification locale n'est supprimee ni ecrasee : on le dit, et on ne
 * fait jamais croire a une publication. Rend `null` quand il n'y a rien a dire
 * (aucun changement local, ou projet tenu par ce poste).
 * @param {object} h - etat rendu par `mapHandoverState`.
 * @param {number} changed - nombre de fichiers modifies localement.
 * @param {Date} [now] - "maintenant" (injectable).
 * @returns {string|null}
 */
export function handoverLocalWorkNotice(h, changed, now = new Date()) {
  const n = Number(changed);
  if (!Number.isFinite(n) || n <= 0) return null;
  const kind = h && h.kind;
  const fichiers = n === 1 ? "1 fichier modifié" : `${n} fichiers modifiés`;
  if (kind === HANDOVER_OTHER) {
    const until = formatHandoverUntil(h.until, now);
    return (
      `Votre travail local (${fichiers}) ne peut pas être publié : le projet est tenu ` +
      `par un autre développeur${until ? ` jusqu'à ${until}` : ""}. ` +
      "Il est conservé sur ce poste, rien n'est supprimé : prenez le projet en main " +
      "pour publier."
    );
  }
  if (kind === HANDOVER_FREE) {
    return (
      `Votre travail local (${fichiers}) n'est pas encore publié : ce projet n'est tenu ` +
      "par aucun poste. Prenez-le en main pour publier."
    );
  }
  return null;
}

/**
 * Ce poste peut-il declencher une action qui publie sur le projet ? `false`
 * quand un AUTRE poste tient le projet : c'est la LECTURE SEULE du plan (§1).
 *
 * Un projet libre n'est pas bloque (le chemin d'ecriture prend la main une seule
 * fois, sans voler le projet a personne) et un etat **invérifiable** non plus :
 * bloquer dessus empecherait de reparer une liaison cassee (« Ajouter ce projet
 * au GDS »), alors que le serveur reste de toute facon seul juge au moment de
 * publier. Dans ces deux cas le bandeau dit ce qu'il en est. Pure.
 * @param {object} h - etat rendu par `mapHandoverState`.
 * @returns {boolean}
 */
export function handoverWriteAllowed(h) {
  return !h || h.kind !== HANDOVER_OTHER;
}

/**
 * Message affiche AU CLIC quand une action est empechee : jamais un refus muet,
 * jamais un bouton mort. Pure. Chaine vide = l'action n'est pas empechee (c'est
 * le cas tant qu'un autre poste ne tient pas le projet : voir
 * `handoverWriteAllowed`).
 * @param {object} h - etat rendu par `mapHandoverState`.
 * @param {string} actionLabel - nom lisible de l'action refusee.
 * @param {Date} [now] - "maintenant" (injectable).
 * @returns {string}
 */
export function handoverWriteRefusal(h, actionLabel, now = new Date()) {
  const nom = String(actionLabel || "").trim();
  const action = nom ? `L'action « ${nom} »` : "Cette action";
  const kind = h && h.kind;
  if (kind === HANDOVER_OTHER) {
    const until = formatHandoverUntil(h.until, now);
    return (
      `${action} n'a pas été faite : ce projet est tenu par un autre développeur` +
      `${until ? ` jusqu'à ${until}` : ""}. Ce poste ne peut rien publier tant qu'il ` +
      "ne tient pas le projet : prenez le projet en main pour publier."
    );
  }
  return "";
}

/**
 * Faut-il proposer « Prendre le projet pour publier » ? Oui quand un autre poste
 * tient le projet, et quand le projet est libre alors qu'il reste du travail
 * local a publier. Pure.
 * @param {object} h - etat rendu par `mapHandoverState`.
 * @param {number} changed - nombre de fichiers modifies localement.
 * @returns {boolean}
 */
export function handoverHasTake(h, changed) {
  const kind = h && h.kind;
  if (kind === HANDOVER_OTHER) return true;
  if (kind === HANDOVER_FREE) return Number(changed) > 0;
  return false;
}

/**
 * Faut-il afficher le bouton de restitution ? Uniquement quand ce poste tient
 * le projet (bouton discret, aucun bandeau : rien a signaler). Pure.
 * @param {object} h - etat rendu par `mapHandoverState`.
 * @returns {boolean}
 */
export function handoverHasGiveBack(h) {
  return !!h && h.kind === HANDOVER_MINE;
}

/**
 * Nombre de fichiers modifies localement a partir d'un etat Git. Accepte les
 * deux formes rendues par le poste : `git_status` (`entries` : chemin -> code)
 * et `git_status_project` (`pending` : nombre). 0 quand ce n'est pas un depot
 * ou quand la reponse est inattendue : on ne compte jamais large. Pure.
 * @param {object|null|undefined} status - reponse d'une commande Git.
 * @returns {number}
 */
export function countLocalChanges(status) {
  if (!status || status.is_repo !== true) return 0;
  const entries = status.entries;
  if (entries && typeof entries === "object") return Object.keys(entries).length;
  const pending = Number(status.pending);
  return Number.isFinite(pending) && pending > 0 ? pending : 0;
}
