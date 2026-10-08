// mcp-secret-scope.js — Périmètre de la clé du coffre pour un serveur MCP
// (tâche 399, incrément 2 : extension). Module PUR (aucune I/O, aucun appel
// Tauri), testé en unitaire, partagé par l'extension MCP (`mcp-client.src.ts`,
// bundlée par esbuild) et par l'interface des Paramètres.
//
// Règle : l'environnement HÉRITÉ du process de l'agent ne transmet la variable
// de clé `PILOT_MCP_SECRET` qu'au serveur qui la déclare LUI-MÊME (une
// référence d'entrée du coffre, `secret_ref`). Sinon la variable est retirée
// avant de lancer le serveur : un serveur qui ne demande rien ne peut plus
// recevoir la clé par héritage.
//
// Ce module ne manipule JAMAIS la valeur d'une clé autrement que pour la
// transmettre telle quelle au serveur qui l'a déclarée : il ne l'affiche pas,
// ne la journalise pas et ne la recopie nulle part.

/** Variable d'environnement portant la clé du coffre (posée par Pilot). */
export const MCP_SECRET_VAR = "PILOT_MCP_SECRET";

/** Variable de contrôle Pilot : référence inconnue du coffre (mode strict).
 * Elle ne doit JAMAIS être transmise au serveur MCP. */
export const MCP_SECRET_BLOCK_VAR = "PILOT_MCP_SECRET_BLOCK";

/**
 * Vrai si le serveur déclare lui-même une référence d'entrée du coffre non
 * vide (`secret_ref`). Fonction pure.
 * @param {{secret_ref?: string}|any} server
 * @returns {boolean}
 */
export function declaresSecret(server) {
  return !!String((server && server.secret_ref) || "").trim();
}

/**
 * Lit le mode strict (`mcp_secret_strict`) d'un `config.json` brut. Absent,
 * invalide ou illisible → `true` (défaut de Pilot, y compris pour une
 * configuration ancienne qui ne connaît pas ce champ). Fonction pure.
 * @param {string} rawConfig
 * @returns {boolean}
 */
export function parseSecretStrict(rawConfig) {
  try {
    const value = (JSON.parse(String(rawConfig || "")) || {}).mcp_secret_strict;
    return value === undefined ? true : value === true;
  } catch {
    return true;
  }
}

/**
 * Décide l'environnement d'UN serveur MCP et l'état de sa clé.
 *
 * `env` : copie de `baseEnv` débarrassée du canal de contrôle
 * (`PILOT_MCP_SECRET_BLOCK`) et, selon la déclaration et le mode, de la clé
 * héritée. `secret` : la clé effectivement transmise (`""` si aucune).
 * `blocked` + `reason` : refus explicite (à appliquer par l'appelant : le
 * serveur ne doit pas être lancé). `notice` : message lisible quand le serveur
 * démarre SANS clé alors qu'il la demandait.
 *
 * Cas :
 *   - `PILOT_MCP_SECRET_BLOCK` présent (décision de Rust en mode strict,
 *     référence inconnue du coffre) → refus, en nommant la référence ;
 *   - le serveur déclare et la clé est présente → clé transmise ;
 *   - le serveur déclare mais la clé manque (coffre verrouillé, référence
 *     vide, mode non strict) → message, lancement sans clé ;
 *   - le serveur ne déclare rien → en mode strict la clé héritée est RETIRÉE,
 *     sans refus ni avertissement ; en mode non strict l'ancien comportement
 *     est conservé (la variable héritée reste transmise).
 *
 * Aucun message ne contient une valeur de clé (seule la référence est nommée).
 * @param {Record<string,string|undefined>|undefined} baseEnv
 * @param {{declared?: boolean, strict?: boolean}} [options]
 * @returns {{env: Record<string,string>, secret: string, blocked: boolean, reason: string, notice: string, removedInherited: boolean}}
 */
export function scopeMcpSecret(baseEnv, options = {}) {
  const env = { ...(baseEnv || {}) };
  const blockRef = String(env[MCP_SECRET_BLOCK_VAR] || "").trim();
  delete env[MCP_SECRET_BLOCK_VAR]; // canal de contrôle Pilot : jamais transmis
  const inherited = String(env[MCP_SECRET_VAR] || "").trim();
  const strict = options.strict !== false;
  const declared = options.declared === true;

  // Refus décidé côté Rust (mode strict + référence introuvable) : appliqué ici.
  if (blockRef) {
    delete env[MCP_SECRET_VAR];
    return {
      env,
      secret: "",
      blocked: true,
      reason:
        `MCP : le serveur demande la clé du coffre « ${blockRef} », introuvable — lancement refusé en mode strict. ` +
        `Choisissez une entrée existante du coffre 🔐 ou désactivez le mode strict dans les Paramètres → Serveurs MCP.`,
      notice: "",
      removedInherited: inherited !== "",
    };
  }

  if (declared) {
    if (inherited) {
      env[MCP_SECRET_VAR] = inherited;
      return { env, secret: inherited, blocked: false, reason: "", notice: "", removedInherited: false };
    }
    return {
      env,
      secret: "",
      blocked: false,
      reason: "",
      notice:
        "MCP : ce serveur demande une clé du coffre, mais elle est indisponible " +
        "(coffre 🔐 verrouillé, référence vide, ou mode non strict) — il démarre SANS clé.",
      removedInherited: false,
    };
  }

  // Serveur qui ne demande rien : en mode strict, aucune clé héritée ne peut
  // lui être transmise ; en mode non strict, l'ancien comportement est conservé.
  if (strict) {
    delete env[MCP_SECRET_VAR];
  }
  return {
    env,
    secret: strict ? "" : inherited,
    blocked: false,
    reason: "",
    notice: "",
    removedInherited: strict && inherited !== "",
  };
}

/**
 * Libellé français de l'état de clé renvoyé par `mcp_test_connection`
 * (`secretStatus`). Jamais une valeur de clé. Fonction pure.
 * @param {string} code
 * @returns {string}
 */
export function secretStatusLabel(code) {
  switch (String(code || "").trim()) {
    case "ready":
      return "clé résolue et transmise";
    case "not_requested":
      return "aucune clé demandée (démarrage sans clé)";
    case "empty_ref":
      return "référence de clé vide (démarrage sans clé)";
    case "unknown_ref":
      return "référence de clé introuvable dans le coffre (démarrage sans clé)";
    case "locked":
      return "coffre 🔐 verrouillé (démarrage sans clé)";
    default:
      return "état de clé inconnu";
  }
}
