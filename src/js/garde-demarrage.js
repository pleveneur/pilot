// garde-demarrage.js — GARDE DE DÉMARRAGE (tâche 424, décision du 16/11/2026) :
// « on n'annonce jamais qu'une chose est testable sans avoir lancé
// l'application pour de vrai et vu l'écran principal s'ouvrir ».
//
// Deux endroits (décision #536 du 17/11/2026) :
//   1. aucune annonce « tu peux tester » sans ce contrôle ;
//   2. aucune fabrication de version sans ce même contrôle.
// Ce module porte les DÉCISIONS des deux endroits, une seule fois :
//   - `decideDemarrage` : la fenêtre observée montre-t-elle VRAIMENT l'écran
//     principal ? (règle FAIL-CLOSED : seule une preuve POSITIVE compte, une
//     observation absente, partielle ou illisible vaut « pas démarré ») ;
//   - `verdictPreuveDemarrage` : la preuve de démarrage permet-elle de livrer
//     cette version ? (absente, ratée, d'une autre version ou périmée ⇒
//     livraison REFUSÉE — jamais un succès par défaut).
//
// 100 % PUR : aucun DOM, aucun import Tauri, aucune I/O. Le lancement réel de
// l'application et l'écriture de la preuve vivent dans
// `scripts/verifier-demarrage.js`, qui appelle ces décisions sans les recopier.
//
// Verrous : `src/js/garde-demarrage.test.js` (décisions) +
// `scripts/garde-demarrage-chaine.test.js` (chaîne de livraison).

// ── Valeurs de référence ────────────────────────────────────────────────────

/** Délai borné accordé à l'application pour ouvrir son écran principal. */
export const GARDE_DEMARRAGE_DELAI_MS = 90_000;

/** Intervalle entre deux observations de la fenêtre. */
export const GARDE_DEMARRAGE_SONDE_MS = 750;

/** Au-delà, une preuve de démarrage ne dit plus rien de la version livrée. */
export const GARDE_DEMARRAGE_FRAICHEUR_MS = 7 * 24 * 60 * 60 * 1000;

/** Dossier des preuves versionnées (à côté du changelog de publication). */
export const GARDE_DEMARRAGE_PREUVE_DIR = "release-notes";

/**
 * Marqueur DOM posé par `main.js` à la SEULE fin normale de l'initialisation
 * (juste après le masquage de l'écran de chargement). L'attribut est lu par
 * l'observation ci-dessous — les deux valeurs doivent rester identiques.
 */
export const GARDE_DEMARRAGE_MARQUEUR = "data-pilot-pret";

/**
 * Sortie de secours EXPLICITE de la chaîne de livraison : elle ne peut tolérer
 * que l'ABSENCE de preuve, jamais une preuve ratée (même esprit que
 * `ALLOW_INCOMPLETE_RELEASE`).
 */
export const ALLOW_NO_STARTUP_PROOF_ENV = "ALLOW_NO_STARTUP_PROOF";

/** Remplacement du chemin de la preuve (poste du propriétaire, tests). */
export const GARDE_DEMARRAGE_PREUVE_ENV = "GARDE_DEMARRAGE_PREUVE";

/** Dimension minimale du corps de l'application pour dire « écran ouvert ». */
export const GARDE_DEMARRAGE_TAILLE_MIN = 200;

/**
 * Chemin de la preuve d'une version : `release-notes/demarrage-v<version>.json`.
 * La preuve voyage AVEC le tag (elle est committée avec le bump), donc la
 * chaîne de publication peut la relire sans lancer d'interface.
 * @param {string} version
 * @returns {string}
 */
export function cheminPreuveDemarrage(version) {
  return `${GARDE_DEMARRAGE_PREUVE_DIR}/demarrage-v${String(version || "").trim()}.json`;
}

// ── Observation de la fenêtre ───────────────────────────────────────────────

/**
 * Expression évaluée DANS la fenêtre de Pilot (via le protocole de débogage)
 * pour observer le démarrage. Source unique : le lanceur l'envoie telle quelle,
 * les tests la relisent sur un faux serveur de débogage.
 */
export const OBSERVATION_EXPRESSION = `(() => {
  const pret = document.documentElement.getAttribute(${JSON.stringify(
    GARDE_DEMARRAGE_MARQUEUR,
  )});
  const boot = document.getElementById("boot-overlay");
  const corps = document.getElementById("app-body");
  const rect = corps && corps.getBoundingClientRect ? corps.getBoundingClientRect() : null;
  return {
    url: String(location.href || ""),
    etat: String(document.readyState || ""),
    pret: pret === "1",
    chargementAffiche: !!(boot && boot.isConnected && !boot.classList.contains("hidden")),
    corpsPresent: !!corps,
    largeur: rect ? Math.round(rect.width) : 0,
    hauteur: rect ? Math.round(rect.height) : 0,
    tauri: !!(window.__TAURI_INTERNALS__ || window.__TAURI__),
  };
})()`;

/**
 * La fenêtre observée montre-t-elle VRAIMENT l'écran principal ?
 *
 * FAIL-CLOSED : on n'accepte que ce qui est explicitement constaté. Un
 * démarrage encore en cours n'est pas un succès (l'appelant réessaie jusqu'au
 * délai borné, puis conclut à l'échec) ; une observation absente, vide ou
 * inattendue vaut « pas démarré ».
 *
 * @param {unknown} observation ce que `OBSERVATION_EXPRESSION` a rendu
 * @returns {{ok: boolean, enCours: boolean, raison: string}}
 */
export function decideDemarrage(observation) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
    return {
      ok: false,
      enCours: false,
      raison: "aucune observation de la fenêtre n'a pu être lue",
    };
  }
  const o = /** @type {Record<string, unknown>} */ (observation);
  if (o.erreur) {
    return {
      ok: false,
      enCours: false,
      raison: `la fenêtre a répondu une erreur : ${String(o.erreur).slice(0, 200)}`,
    };
  }
  if (o.pret !== true) {
    return {
      ok: false,
      enCours: true,
      raison: "l'initialisation de Pilot n'est pas terminée",
    };
  }
  if (o.corpsPresent !== true) {
    return {
      ok: false,
      enCours: false,
      raison: "le corps de l'application n'est pas dans la page",
    };
  }
  const largeur = Number(o.largeur);
  const hauteur = Number(o.hauteur);
  if (
    !Number.isFinite(largeur) ||
    !Number.isFinite(hauteur) ||
    largeur < GARDE_DEMARRAGE_TAILLE_MIN ||
    hauteur < GARDE_DEMARRAGE_TAILLE_MIN
  ) {
    return {
      ok: false,
      enCours: false,
      raison: `le corps de l'application n'occupe pas l'écran (${Number.isFinite(largeur) ? largeur : "?"}×${
        Number.isFinite(hauteur) ? hauteur : "?"
      } px)`,
    };
  }
  if (o.chargementAffiche === true) {
    return {
      ok: false,
      enCours: false,
      raison: "l'écran de chargement est encore affiché alors que l'initialisation se dit terminée",
    };
  }
  if (o.tauri !== true) {
    return {
      ok: false,
      enCours: false,
      raison: "la page n'a pas reçu l'API Tauri (ce n'est pas la vraie application)",
    };
  }
  return { ok: true, enCours: false, raison: "l'écran principal est ouvert" };
}

// ── La preuve de démarrage ──────────────────────────────────────────────────

/**
 * Construit la preuve écrite sur disque. Elle porte de quoi décider plus tard
 * sans relancer l'application : verdict, version concernée, exécutable, instant,
 * durée et observation brute (jamais un champ inventé).
 *
 * @param {{ok: boolean, raison: string, version: string, exe?: string,
 *          at?: Date|string, dureeMs?: number, delaiMs?: number,
 *          observation?: unknown}} p
 * @returns {Record<string, unknown>}
 */
export function preuveDeDemarrage(p) {
  const at = p.at instanceof Date ? p.at : p.at ? new Date(p.at) : new Date();
  const instant = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
  const verdict = {
    ok: p.ok === true,
    raison: String(p.raison || "").trim() || "aucune raison consignée",
    version: String(p.version || "").trim(),
    at: instant,
    exe: String(p.exe || "").trim(),
    duree_ms: Number.isFinite(Number(p.dureeMs)) ? Number(p.dureeMs) : null,
    delai_ms: Number.isFinite(Number(p.delaiMs)) ? Number(p.delaiMs) : GARDE_DEMARRAGE_DELAI_MS,
    observation: p.observation === undefined ? null : p.observation,
  };
  return verdict;
}

/**
 * Relit une preuve (chaîne JSON ou objet déjà lu). Rend `null` quand le contenu
 * n'est pas un objet : une preuve illisible ne vaut pas une preuve.
 * @param {unknown} brut
 * @returns {Record<string, unknown>|null}
 */
export function parsePreuveDemarrage(brut) {
  if (brut == null) return null;
  if (typeof brut === "string") {
    const texte = brut.trim();
    if (!texte) return null;
    try {
      return parsePreuveDemarrage(JSON.parse(texte));
    } catch {
      return null;
    }
  }
  if (typeof brut !== "object" || Array.isArray(brut)) return null;
  return /** @type {Record<string, unknown>} */ (brut);
}

/**
 * La livraison de `version` est-elle permise par la preuve de démarrage ?
 *
 * FAIL-CLOSED, dans cet ordre : preuve absente ⇒ refus (sauf tolérance
 * EXPLICITE de l'absence) ; preuve illisible ⇒ refus ; verdict non favorable ⇒
 * refus (la mission est DÉCLARÉE RATÉE, la tolérance ne s'y applique jamais) ;
 * autre version ⇒ refus ; date illisible ou trop ancienne ⇒ refus.
 *
 * @param {{preuve?: unknown, version: string, maintenant?: Date|string|number,
 *          fraicheurMs?: number, allowMissing?: boolean}} p
 * @returns {{livrer: boolean, raison: string, chemin: string}}
 */
export function verdictPreuveDemarrage(p) {
  const version = String(p.version || "").trim();
  const chemin = cheminPreuveDemarrage(version);
  const maintenant = p.maintenant instanceof Date ? p.maintenant : p.maintenant ? new Date(p.maintenant) : new Date();
  const fraicheur = Number.isFinite(Number(p.fraicheurMs))
    ? Number(p.fraicheurMs)
    : GARDE_DEMARRAGE_FRAICHEUR_MS;

  if (p.preuve == null) {
    if (p.allowMissing === true) {
      return {
        livrer: true,
        chemin,
        raison: `aucune preuve de démarrage, tolérée explicitement (${ALLOW_NO_STARTUP_PROOF_ENV})`,
      };
    }
    return {
      livrer: false,
      chemin,
      raison:
        `aucune preuve de démarrage pour la version ${version || "?"} (${chemin}) : ` +
        "l'application n'a pas été vue démarrer, la mission est DÉCLARÉE RATÉE. " +
        `Lancez « npm run verif:demarrage » et committez la preuve, ou assumez l'absence avec ${ALLOW_NO_STARTUP_PROOF_ENV}=1`,
    };
  }

  const preuve = parsePreuveDemarrage(p.preuve);
  if (!preuve) {
    return {
      livrer: false,
      chemin,
      raison: `la preuve de démarrage est illisible (${chemin}) : elle ne prouve rien, la mission est DÉCLARÉE RATÉE`,
    };
  }
  if (preuve.ok !== true) {
    return {
      livrer: false,
      chemin,
      raison: `l'application n'a pas démarré : ${String(preuve.raison || "aucune raison consignée")} — la mission est DÉCLARÉE RATÉE`,
    };
  }
  const versionPreuve = String(preuve.version || "").trim();
  if (!version || versionPreuve !== version) {
    return {
      livrer: false,
      chemin,
      raison: `la preuve de démarrage concerne la version ${versionPreuve || "inconnue"}, pas ${version || "?"}`,
    };
  }
  const at = new Date(String(preuve.at || ""));
  if (Number.isNaN(at.getTime())) {
    return {
      livrer: false,
      chemin,
      raison: "la preuve de démarrage ne porte pas de date lisible",
    };
  }
  const age = maintenant.getTime() - at.getTime();
  if (!Number.isFinite(age)) {
    return { livrer: false, chemin, raison: "l'âge de la preuve de démarrage n'a pas pu être calculé" };
  }
  if (age > fraicheur) {
    const jours = Math.round(age / (24 * 60 * 60 * 1000));
    return {
      livrer: false,
      chemin,
      raison: `la preuve de démarrage a ${jours} jour(s), au-delà de la fraîcheur admise : relancez « npm run verif:demarrage »`,
    };
  }
  return {
    livrer: true,
    chemin,
    raison: `l'application a été vue démarrer (version ${version}, preuve du ${at.toISOString()})`,
  };
}

// ── Phrases (une seule formulation par situation) ────────────────────────────

/**
 * Phrase de conclusion d'un contrôle RATÉ (imprimée par le lanceur et reprise
 * dans le rapport) : elle dit toujours que la livraison est refusée.
 * @param {{raison: string, dureeMs?: number}} p
 * @returns {string}
 */
export function phraseEchecDemarrage(p) {
  const raison = String(p.raison || "").trim() || "aucune raison consignée";
  const duree = Number(p.dureeMs);
  const attente = Number.isFinite(duree) && duree > 0 ? ` après ${Math.round(duree / 100) / 10} s` : "";
  return `ÉCHEC DU CONTRÔLE DE DÉMARRAGE${attente} : ${raison}. La mission est DÉCLARÉE RATÉE — rien n'est annoncé testable.`;
}

/**
 * Phrase de conclusion d'un contrôle RÉUSSI.
 * @param {{dureeMs?: number, version?: string, exe?: string}} p
 * @returns {string}
 */
export function phraseSuccesDemarrage(p) {
  const duree = Number(p.dureeMs);
  const attente = Number.isFinite(duree) && duree > 0 ? ` en ${Math.round(duree / 100) / 10} s` : "";
  const version = String(p.version || "").trim();
  const exe = String(p.exe || "").trim();
  const ou = exe ? ` (« ${exe} »)` : "";
  return `L'application a été lancée et son écran principal est ouvert${attente}${ou}${
    version ? ` — version ${version}` : ""
  }.`;
}
