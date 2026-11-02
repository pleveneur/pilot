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
        `Choisissez une entrée existante du coffre 🔐 ou désactivez le mode strict dans les Options → Serveurs MCP.`,
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

// ── Plusieurs serveurs dans la MÊME session (décision du 2026-11-02) ──
//
// La conversation de l'Assistant charge TOUS les serveurs activés : la clé du
// coffre ne peut donc plus voyager dans la variable unique `PILOT_MCP_SECRET`
// (elle serait la même pour tous). Pilot pose à la place une TABLE
// `PILOT_MCP_SECRETS` = `{ "<identifiant de serveur>": "<clé>" }` : chaque serveur
// ne reçoit QUE la sienne, et les deux tables (clés et refus) sont retirées de
// l'environnement AVANT de lancer un serveur — un serveur ne peut donc jamais
// lire la clé d'un autre. Aucune clé n'est affichée ni journalisée.

/** Table des clés par identifiant de serveur (posée par Pilot, multi-serveurs). */
export const MCP_SECRETS_VAR = "PILOT_MCP_SECRETS";

/** Table des refus par identifiant de serveur (référence introuvable, mode strict). */
export const MCP_SECRET_BLOCKS_VAR = "PILOT_MCP_SECRET_BLOCKS";

/**
 * Lit une table `{ identifiant: valeur }` depuis le JSON posé par Pilot. Toute
 * entrée dont la valeur n'est pas une chaîne non vide est ignorée (jamais une
 * exception). Fonction pure.
 * @param {string} raw
 * @returns {Record<string,string>}
 */
export function parseSecretMap(raw) {
  const out = {};
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ""));
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.trim() !== "") out[String(key)] = value;
  }
  return out;
}

/**
 * Clés auxquelles la fiche d'un serveur peut répondre dans les tables de Pilot :
 * l'identifiant utilisé dans les noms d'outils, puis `id`, puis `name`, avec et
 * sans espaces autour. Plusieurs candidats parce que Rust et l'extension ne
 * résolvent pas l'identifiant de la même façon quand `id` est absent ou vide —
 * aucune de ces deux résolutions ne doit jamais faire perdre une clé. Fonction
 * pure.
 * @param {{id?: string, name?: string}|any} server
 * @returns {string[]}
 */
export function serverSecretKeyCandidates(server) {
  const s = server || {};
  const id = String(s.id ?? "");
  const name = String(s.name ?? "");
  const list = [id, name, id.trim(), name.trim()]
    .map((k) => String(k || ""))
    .filter((k) => k !== "");
  return [...new Set(list)];
}

/**
 * Décide l'environnement d'UN serveur quand PLUSIEURS serveurs sont chargés
 * ensemble. Mêmes règles que `scopeMcpSecret`, avec deux différences :
 *   - la clé vient de la table `secrets` (celle du serveur, jamais celle d'un
 *     autre ; les deux tables sont retirées de l'environnement transmis) ;
 *   - le refus vient de la table `blocks`, et nomme l'identifiant du serveur.
 * Fonction pure : ni `baseEnv`, ni `secrets`, ni `blocks` ne sont modifiés.
 * @param {Record<string,string|undefined>|undefined} baseEnv
 * @param {{serverId?: string, server?: any, declared?: boolean, strict?: boolean, secrets?: Record<string,string>, blocks?: Record<string,string>}} [options]
 * @returns {{env: Record<string,string>, secret: string, blocked: boolean, reason: string, notice: string, removedInherited: boolean}}
 */
export function scopeMcpSecretForServer(baseEnv, options = {}) {
  const env = { ...(baseEnv || {}) };
  delete env[MCP_SECRETS_VAR]; // la table entière ne part JAMAIS chez un serveur
  delete env[MCP_SECRET_BLOCKS_VAR];
  delete env[MCP_SECRET_BLOCK_VAR];
  const strict = options.strict !== false;
  const declared = options.declared === true;
  const serverId = String(options.serverId ?? "");
  const secrets = options.secrets || {};
  const blocks = options.blocks || {};
  const keys = [serverId, ...serverSecretKeyCandidates(options.server)];
  const lookup = (table) => {
    for (const key of keys) {
      const value = String(table[key] ?? "").trim();
      if (value !== "") return value;
    }
    return "";
  };
  const inherited = String(env[MCP_SECRET_VAR] || "").trim();
  const blockRef = lookup(blocks);

  if (blockRef) {
    delete env[MCP_SECRET_VAR];
    return {
      env,
      secret: "",
      blocked: true,
      reason:
        `MCP : le serveur « ${serverId} » demande la clé du coffre « ${blockRef} », introuvable — lancement refusé en mode strict. ` +
        `Choisissez une entrée existante du coffre 🔐 ou désactivez le mode strict dans les Options → Serveurs MCP.`,
      notice: "",
      removedInherited: inherited !== "",
    };
  }

  const own = lookup(secrets);

  if (declared) {
    if (own) {
      env[MCP_SECRET_VAR] = own;
      return { env, secret: own, blocked: false, reason: "", notice: "", removedInherited: false };
    }
    delete env[MCP_SECRET_VAR];
    return {
      env,
      secret: "",
      blocked: false,
      reason: "",
      notice:
        `MCP : le serveur « ${serverId} » demande une clé du coffre, mais elle est indisponible ` +
        "(coffre 🔐 verrouillé, référence vide, ou mode non strict) — il démarre SANS clé.",
      removedInherited: inherited !== "",
    };
  }

  if (strict) {
    delete env[MCP_SECRET_VAR];
    return {
      env,
      secret: "",
      blocked: false,
      reason: "",
      notice: "",
      removedInherited: inherited !== "",
    };
  }
  return {
    env,
    secret: inherited,
    blocked: false,
    reason: "",
    notice: "",
    removedInherited: false,
  };
}
