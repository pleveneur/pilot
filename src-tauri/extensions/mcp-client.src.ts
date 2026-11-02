// mcp-client.src.ts — PILOT MCP CLIENT (SOURCE).
//
// SOURCE éditable à la main. Le fichier embarqué réel est
// `src-tauri/extensions/pilot-mcp-client.ts`, GÉNÉRÉ par esbuild à partir de ce
// fichier (`npm run build:mcp` → scripts/build-mcp-extension.js). Ne jamais
// modifier le fichier généré directement.
//
// Ce POC prouve que Pilot peut se connecter à un serveur MCP tier via une
// extension pi, en embarquant le SDK MCP (@modelcontextprotocol/sdk) BUNDLÉ.
// L'extension a DEUX modes, décidés par une seule chose : `PILOT_MCP_SERVER`.
//
//   A. SESSION D'UN AGENT (`PILOT_MCP_SERVER` = identifiant) : UN serveur, celui
//      que l'agent a demandé (`run_agents` / `mcp_server`), sinon le premier
//      activé (mêmes règles que `select_session_server` côté Rust). Comportement
//      historique inchangé — un agent ne voit JAMAIS les outils d'un serveur
//      qu'il n'a pas demandé.
//
//   B. SESSION DE L'ASSISTANT (pas de `PILOT_MCP_SERVER`) : TOUS les serveurs
//      ACTIVÉS, ensemble (décision du propriétaire, 2026-11-02 : plus de « un
//      seul serveur à la fois »). L'Assistant choisit lequel utiliser en
//      raisonnant, jamais parce qu'un seul serait branché. Un serveur DÉSACTIVÉ
//      n'est jamais chargé ; la liste est relue avant chaque tour, donc un
//      changement d'activation est pris en compte SANS redémarrer Pilot.
//
// Étapes communes :
//   1. lit la config via process.env.PILOT_MCP_CONFIG (chemin d'un mcp.json —
//      Pilot le renseigne à la création du process pi, PAS via AppConfig),
//   3. choisit le transport selon le type du serveur : local (`stdio` =
//      programme) ou distant (`http`/`https` = adresse réseau, clé d'accès
//      présentée en EN-TÊTE `Authorization` via PILOT_MCP_SECRET — E2 ; en mode
//      multi-serveurs la clé vient de la table `PILOT_MCP_SECRETS`, une entrée par
//      serveur, jamais lisible par un autre serveur),
//   4. découvre tools/list et enregistre chaque outil sous
//      `mcp_<serverId>_<name>` via pi.registerTool (exécution qui redéclenche un
//      callTool sur le serveur).
//
// NOM DES OUTILS : le nom est construit par le module PUR partagé
// `src/js/mcp-tool-names.js` (source unique, testée). Un nom d'outil ne doit
// jamais être disputé par deux serveurs : si deux entrées de mcp.json portent le
// même identifiant (donc les mêmes noms d'outils), le chargement est REFUSÉ avec
// un message qui nomme les deux serveurs (§ 2 quater) ; si deux serveurs chargés
// ENSEMBLE exposeraient le même nom, `resolveToolNames` garde le premier et nomme
// le second ; si un serveur déclare deux fois le même outil, seule la première
// déclaration est exposée (§ 3).
//
// Fail-open : toute erreur (config absente, serveur indisponible, tools/list en
// échec) est interceptée — pi ne doit jamais planter à cause d'une extension MCP.
// En mode multi-serveurs, l'échec d'UN serveur est dit à l'utilisateur en une
// phrase (identifiant seul, jamais une adresse ni une clé) et les autres serveurs
// restent disponibles : un serveur lent, cassé ou injoignable ne bloque jamais la
// conversation.
//
// NOTE : la factory des extensions pi ne reçoit AUCUN `ctx` UI (le `ctx` n'est
// fourni que dans les event handlers / tool execute). Les messages décidés ici
// sont donc mis en attente et délivrés au `session_start` (ou au premier tour).

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
// Périmètre de la clé du coffre (tâche 399, cœur PUR partagé avec le frontend) :
// un serveur ne garde la clé héritée que s'il la déclare lui-même ; refus
// explicite et message de lancement sont décidés par le module testé en unitaire.
import {
  MCP_SECRETS_VAR,
  MCP_SECRET_BLOCKS_VAR,
  declaresSecret,
  parseSecretMap,
  parseSecretStrict,
  scopeMcpSecret,
  scopeMcpSecretForServer,
} from "../../src/js/mcp-secret-scope.js";
// Quelle liste de serveurs une session charge (module PUR partagé, testé) :
// tous les serveurs activés pour l'Assistant, un seul pour un agent, jamais un
// serveur désactivé, et les cas ambigus (même identifiant) refusés ensemble.
import {
  mcpAmbiguousIdNotice,
  mcpNoServerNotice,
  mcpServerFingerprint,
  mcpServerStillEnabled,
  mcpServerUnavailableNotice,
  mcpToolUnavailableMessage,
  planMcpRefresh,
  planMcpSessionServers,
} from "../../src/js/mcp-servers-session.js";
// Noms d'outils MCP (source unique, module PUR partagé avec les tests) : la
// règle `mcp_<serverId>_<outil>` et la détection des noms ambigus n'existent
// qu'ici.
import {
  crossServerToolClashMessage,
  duplicateToolNameMessage,
  duplicateToolNames,
  firstDeclarationOnly,
  mcpServerId,
  registeredToolName,
  resolveToolNames,
  serverIdClashMessage,
  serverIdOwners,
} from "../../src/js/mcp-tool-names.js";
// Garde-fous du contrôle de l'écran (cœur PUR, partagé avec le frontend) :
// bundlé par esbuild dans le fichier généré. Ils décident, POUR CHAQUE action,
// si elle est refusée, soumise à confirmation ou simulée, et tiennent le journal.
import {
  SCREEN_GATE_SENTINEL,
  SCREEN_JOURNAL_ACCEPTED,
  SCREEN_JOURNAL_REFUSED,
  SCREEN_JOURNAL_RELATIVE_PATH,
  SCREEN_JOURNAL_SIMULATED,
  SCREEN_NO_UI_MESSAGE,
  SCREEN_REFUSED_MESSAGE,
  SCREEN_SIMULATION_MESSAGE,
  formatScreenJournalLine,
  isScreenServer,
  isScreenTool,
  parseScreenGuard,
  screenGateOutcome,
  summarizeScreenAction,
} from "../../src/js/screen-guard.js";
// Le SDK MCP est bundlé (external uniquement pour pi-coding-agent et typebox).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

// Timeout de connexion au serveur MCP (ms). Garde-fou : un serveur absent ou
// bloquant ne doit pas geler le démarrage de la session pi (fail-open).
const CONNECT_TIMEOUT_MS = 8000;
// Timeout d'un appel outil (callTool) une fois connecté.
const CALL_TIMEOUT_MS = 60000;
// Titre du dialogue de confirmation d'une action sur l'écran.
// Garde-fou anti-blocage : en mode RPC, un `ctx.ui.*` émet un
// `extension_ui_request` et pi attend la réponse SANS limite de temps. Ces
// outils posent une question à l'utilisateur : on garde une attente longue
// (30 min) mais BORNÉE, pour qu'une question restée sans réponse ne fige pas la
// session ni la file d'attente du projet.
const PILOT_UI_OPTS = { timeout: 1800000 };

const SCREEN_CONFIRM_TITLE = "Contrôle de l'écran par l'agent";

// Réglages du contrôle de l'écran (miroir de AppConfig / screen-guard.js).
interface ScreenGuard {
  enabled: boolean;
  simulation: boolean;
  emergencyStop: boolean;
}

// Structure d'un serveur dans mcp.json (miroir de src-tauri/src/mcp_config.rs).
interface McpServerConfig {
  id?: string;
  name?: string;
  transport?: string;
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /// Référence d'une entrée du coffre (jamais la clé) : déclarée par le serveur
  /// LUI-MÊME. Sans elle, aucune clé (héritée ou non) ne lui est transmise.
  secret_ref?: string;
  /// Serveur de contrôle de l'écran (capture, clavier, souris) : ses outils
  /// passent par les garde-fous (confirmation, simulation, journal).
  screen?: boolean;
}

interface McpConfig {
  servers?: McpServerConfig[];
}

export default async function (api: ExtensionAPI): Promise<void> {
  // ── 0. Messages différés vers l'interface ──
  // La factory ne reçoit AUCUN `ctx` UI (fourni seulement dans les gestionnaires
  // d'événements) : les messages décidés ici (refus de clé, lancement sans clé,
  // serveur injoignable) sont mis en attente et délivrés au `session_start`.
  // Aucun ne contient une valeur de clé, ni une adresse, ni une commande.
  const pendingNotices: Array<{ text: string; level: string }> = [];
  let sessionCtx: ExtensionContext | null = null;
  const flushNotices = (): void => {
    const ui = sessionCtx && sessionCtx.ui;
    if (!ui || typeof ui.notify !== "function") return;
    while (pendingNotices.length) {
      const notice = pendingNotices.shift()!;
      try {
        ui.notify(notice.text, notice.level as never);
      } catch {
        /* fail-open : un message manqué ne bloque jamais pi. */
      }
    }
  };
  const notifyUser = (text: string, level: string): void => {
    pendingNotices.push({ text, level });
    flushNotices();
  };
  api.on("session_start", (_event, ctx) => {
    sessionCtx = ctx;
    flushNotices();
  });

  // ── 1. Lecture de la config MCP via la variable d'environnement ──
  const configPath = process.env.PILOT_MCP_CONFIG;
  if (!configPath) {
    return; // MCP désactivé — fail-open silencieux.
  }

  let config: McpConfig;
  try {
    config = JSON.parse(await readFileText(configPath)) as McpConfig;
  } catch {
    return; // Config illisible — fail-open.
  }

  const targetId = (process.env.PILOT_MCP_SERVER || "").trim();

  // ══════════════════════════════════════════════════════════════════════════
  // 2. SESSION D'UN AGENT — UN serveur désigné (PILOT_MCP_SERVER), inchangé.
  // `PILOT_MCP_SERVER` est posé par Pilot quand un agent demande explicitement
  // un serveur (run_agents / mcp_server). Sans lui, un agent ne voit AUCUN outil
  // MCP : le chargement de tous les serveurs est réservé à l'Assistant (§ 3).
  // ══════════════════════════════════════════════════════════════════════════
  if (targetId) {
    // Serveur cible (brique B) : si PILOT_MCP_SERVER désigne un serveur enabled de
    // la config, on le prend ; sinon fail-back sur le 1er enabled. Mêmes règles
    // que `select_session_server` côté Rust : la clé transmise par Pilot (E2) est
    // celle du serveur que l'extension retient ici.
    const enabledServers = (config.servers ?? []).filter((s) => s.enabled !== false);
    const server =
      enabledServers.find((s) => (s.id ?? "") === targetId) ?? enabledServers[0];
    if (!server) {
      return; // Aucun serveur enabled (ni cible valide) — fail-open.
    }

    const serverId = mcpServerId(server);

    // ── 2 quater. Nom d'outil non ambigu (identifiant de serveur unique) ──
    // Deux entrées ACTIVÉES portant le même identifiant produiraient exactement
    // les mêmes noms d'outils (`mcp_<id>_<outil>`) : impossible de savoir lequel
    // des deux serveurs serait appelé, et le second serait ignoré en silence.
    // Le cas ambigu est donc refusé EXPLICITEMENT, en nommant les deux serveurs
    // (fail-closed : aucun outil n'est enregistré).
    const sameIdServers = serverIdOwners(enabledServers, serverId);
    if (sameIdServers.length > 1) {
      notifyUser(
        serverIdClashMessage(serverId, sameIdServers) ?? "Identifiant MCP ambigu",
        "warning"
      );
      return;
    }

    // ── 2 bis. Garde-fous du contrôle de l'écran ──
    // Un serveur « écran » peut piloter la machine : il n'est proposé à l'agent
    // que si l'utilisateur l'a autorisé. Désactivé (ou arrêt d'urgence actif), le
    // serveur n'est même pas lancé et AUCUN de ses outils n'est enregistré.
    const isScreen = isScreenServer(server);
    if (isScreen && !(await readScreenGuard(configPath)).enabled) {
      return; // Contrôle de l'écran coupé — fail-closed (rien ne part).
    }

    // ── 2 ter. Clé du coffre : périmètre PAR SERVEUR (tâche 399) ──
    const strict = await readMcpSecretStrict(configPath);
    const keyScope = scopeMcpSecret(process.env, { declared: declaresSecret(server), strict });
    if (keyScope.blocked) {
      // Référence déclarée introuvable (décision de Rust en mode strict) : ce
      // serveur n'est PAS lancé et aucun de ses outils n'est enregistré.
      notifyUser(keyScope.reason, "warning");
      return;
    }
    if (keyScope.notice) {
      notifyUser(keyScope.notice, "warning");
    }

    // ── 2. Transport + découverte des outils ──
    const connection = await connectServer(server, keyScope);
    if (!connection.ok) {
      return; // Serveur indisponible — fail-open (comportement historique).
    }
    const { client, transport, secret } = connection;

    // ── 3. Enregistrement d'un outil pi par outil MCP découvert ──
    // Un `tools/list` qui déclare deux fois le même nom d'outil ne doit pas faire
    // écraser en silence la première déclaration par la seconde (pi range ses
    // outils dans une table par nom) : la première est conservée, le doublon est
    // signalé. Aucun nom d'outil déjà en service ne change.
    const declaredTwice = duplicateToolNames(connection.tools);
    if (declaredTwice.length > 0) {
      notifyUser(
        duplicateToolNameMessage(serverId, declaredTwice) ?? "Outil MCP déclaré deux fois",
        "warning"
      );
    }
    for (const tool of firstDeclarationOnly(connection.tools)) {
      const toolName = tool.name;
      try {
        api.registerTool({
          ...toolDescriptor(serverId, tool),
          async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
            return runTool(client, toolName, params as Record<string, unknown>, secret);
          },
        } as never);
      } catch {
        // Échec d'enregistrement (concurrence d'extensions) : fail-open.
      }
    }

    // ── 4. Garde-fous du contrôle de l'écran (porte pré-action) ──
    // Pour un serveur « écran » : chaque action est relue en DIRECT, confirmée
    // par l'utilisateur, et journalisée. Un refus (réglage coupé, arrêt
    // d'urgence, réponse de l'utilisateur, mode simulation) BLOQUE l'action :
    // rien n'est envoyé au serveur et l'agent reçoit la raison.
    if (isScreen) {
      api.on("tool_call", async (event, ctx) => {
        if (!isScreenTool(event.toolName, serverId)) {
          return; // Outil d'un autre serveur MCP : hors de cette porte.
        }
        return screenGate(configPath, ctx, event);
      });
    }

    // ── Nettoyage à la fin de session (fermeture du serveur local ou distant) ──
    api.on("session_shutdown", async () => {
      await safeClose(transport, client);
    });
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. SESSION DE L'ASSISTANT — TOUS les serveurs ACTIVÉS (décision du
  //    2026-11-02 : plus de « un seul serveur à la fois »).
  //
  // Ce que la session charge :
  //   - tous les serveurs `enabled !== false` de `mcp.json`, ENSEMBLE ;
  //   - jamais un serveur désactivé (il n'est pas chargé, et si l'utilisateur le
  //     désactive en cours de route, ses outils refusent tout appel et le
  //     serveur est refermé) ;
  //   - deux entrées de même identifiant sont refusées ENSEMBLE et EXPLIQUÉES.
  // L'Assistant choisit ensuite le serveur en raisonnant : ce n'est plus une
  // limite technique.
  //
  // Robustesse : la connexion de chaque serveur a son propre délai borné et son
  // propre échec. Un serveur lent, cassé ou injoignable donne UN message clair,
  // les autres serveurs restent disponibles, la conversation continue.
  // ══════════════════════════════════════════════════════════════════════════
  const loaded = new Map<string, LoadedServer>();
  const loading = new Set<string>();
  const attempted = new Map<string, string>(); // id → empreinte déjà tentée
  const toolOwners = new Map<string, LoadedServer>(); // nom enregistré → serveur
  const notified = new Set<string>(); // messages déjà dits (aucun doublon)
  const notifyOnce = (key: string, text: string, level = "warning"): void => {
    if (notified.has(key)) return;
    notified.add(key);
    notifyUser(text, level);
  };

  /// Retire un serveur de la session : ses outils ne sont plus exposés (le modèle
  /// reçoit une phrase actionnable s'il les appelle) et la connexion est fermée.
  const dropServer = async (serverId: string): Promise<void> => {
    const record = loaded.get(serverId);
    if (!record) return;
    loaded.delete(serverId);
    attempted.delete(serverId);
    for (const [name, owner] of [...toolOwners]) {
      if (owner === record) toolOwners.delete(name);
    }
    await safeClose(record.transport, record.client);
  };

  /// Lit la config à neuf (le fichier peut changer sans redémarrer Pilot).
  const readConfig = async (): Promise<McpConfig | null> => {
    try {
      return JSON.parse(await readFileText(configPath)) as McpConfig;
    } catch {
      return null; // Illisible/partiel : on ne touche à rien.
    }
  };

  let strictCache: boolean | null = null;
  /// Relit le réglage du mode strict (jamais deviné : un fichier absent vaut
  /// strict, comme côté Rust). Mis en cache pour la session : la table des clés a
  /// été calculée par Pilot AU LANCEMENT de la session, la relire ici ne pourrait
  /// pas la changer.
  const strictMode = async (): Promise<boolean> => {
    if (strictCache === null) strictCache = await readMcpSecretStrict(configPath);
    return strictCache;
  };

  /// Aligne la session sur la liste des serveurs ACTIVÉS (chargement, retrait,
  /// apparition de nouveaux outils). Appelé au démarrage puis avant CHAQUE tour :
  /// un serveur activé dans les Options ou par l'Assistant est pris en compte
  /// sans redémarrer Pilot.
  const refresh = async (): Promise<void> => {
    const cfg = await readConfig();
    if (!cfg) return;
    const plan = planMcpSessionServers(cfg, {});
    for (const ambiguous of plan.ambiguous) {
      notifyOnce(
        `ambiguous:${ambiguous.id}`,
        mcpAmbiguousIdNotice(ambiguous.id, ambiguous.owners)
      );
    }
    const wanted = new Set(plan.servers.map((s) => mcpServerId(s)));
    for (const serverId of [...loaded.keys()]) {
      if (!wanted.has(serverId)) await dropServer(serverId);
    }
    if (plan.servers.length === 0) {
      notifyOnce("no-server", mcpNoServerNotice(), "info");
    }

    const secrets = parseSecretMap(process.env[MCP_SECRETS_VAR] || "");
    const blocks = parseSecretMap(process.env[MCP_SECRET_BLOCKS_VAR] || "");
    if (strictCache === null) strictCache = await readMcpSecretStrict(configPath);
    const strict = await strictMode();

    // Connexions manquantes. Un serveur déjà tenté avec la MÊME fiche n'est pas
    // retenté à chaque tour (aucune attente répétée) ; une fiche modifiée l'est.
    const diff = planMcpRefresh(plan, { loaded: [...loaded.keys()], loading: [...loading] });
    for (const server of diff.load) {
      const serverId = mcpServerId(server);
      const fingerprint = mcpServerFingerprint(server);
      if (attempted.get(serverId) === fingerprint) continue;
      if (server.screen === true || isScreenServer(server)) {
        // Contrôle de l'écran coupé → ce serveur n'est pas lancé (fail-closed).
        if (!(await readScreenGuard(configPath)).enabled) continue;
      }
      const keyScope = scopeMcpSecretForServer(process.env, {
        serverId,
        server,
        declared: declaresSecret(server),
        strict,
        secrets,
        blocks,
      });
      if (keyScope.blocked) {
        attempted.set(serverId, fingerprint);
        notifyOnce(`blocked:${serverId}`, keyScope.reason);
        continue;
      }
      if (keyScope.notice) notifyOnce(`notice:${serverId}`, keyScope.notice);
      loading.add(serverId);
      try {
        attempted.set(serverId, fingerprint);
        const connection = await connectServer(server, keyScope);
        if (!connection.ok) {
          notifyOnce(
            `failed:${serverId}:${connection.reason}`,
            mcpServerUnavailableNotice(serverId, connection.reason)
          );
          continue;
        }
        const declaredTwice = duplicateToolNames(connection.tools);
        if (declaredTwice.length > 0) {
          notifyOnce(
            `duplicate:${serverId}`,
            duplicateToolNameMessage(serverId, declaredTwice) ?? "Outil MCP déclaré deux fois"
          );
        }
        loaded.set(serverId, {
          id: serverId,
          client: connection.client,
          transport: connection.transport,
          secret: connection.secret,
          screen: isScreenServer(server),
          tools: firstDeclarationOnly(connection.tools),
          fingerprint,
        });
      } finally {
        loading.delete(serverId);
      }
    }

    // ── Répartition des noms d'outils entre serveurs ──
    // Deux serveurs ne peuvent se disputer un nom que si leurs identifiants sont
    // identiques (`mcp_<id>_<outil>`) — cas déjà refusé ci-dessus — sauf si deux
    // OUTILS de serveurs différents portent le même nom d'outil et le même
    // identifiant de serveur… c'est-à-dire le même nom enregistré. `resolveToolNames`
    // tranche alors EN NOMMANT les deux serveurs : le premier garde l'outil, le
    // second n'est pas exposé. Jamais un remplacement silencieux.
    const records = [...loaded.values()];
    const resolution = resolveToolNames(
      records.map((record) => ({ serverId: record.id, tools: record.tools }))
    );
    for (const clash of resolution.clashes) {
      notifyOnce(`clash:${clash.name}`, crossServerToolClashMessage(clash.name, clash.owners) ?? "");
    }
    records.forEach((record, index) => {
      for (const tool of resolution.entries[index]?.tools ?? []) {
        const registeredName = registeredToolName(record.id, tool.name);
        // Un nom déjà enregistré garde son enregistrement pi (on ne peut pas le
        // retirer), mais il suit désormais le serveur RECHARGÉ : la propriété est
        // mise à jour, et l'exécution relit la fiche vivante par identifiant.
        if (toolOwners.has(registeredName)) {
          toolOwners.set(registeredName, record);
          continue;
        }
        try {
          api.registerTool({
            ...toolDescriptor(record.id, tool),
            async execute(_toolCallId, params) {
              const live = loaded.get(record.id);
              if (!live) {
                // Serveur déchargé (désactivé, ou panne) : phrase actionnable,
                // aucun envoi au serveur.
                return errorText(mcpToolUnavailableMessage(record.id, registeredName));
              }
              return executeOnLoadedServer(live, tool.name, params);
            },
          } as never);
          toolOwners.set(registeredName, record);
        } catch {
          // Échec d'enregistrement (concurrence d'extensions) : fail-open.
        }
      }
    });
  };

  /// Exécution d'un outil d'un serveur chargé. Contrôle AVANT tout envoi que le
  /// serveur est encore ACTIVÉ (désactivation depuis les Options ou la
  /// conversation, en cours de session) : un serveur désactivé n'exécute rien.
  const executeOnLoadedServer = async (
    record: LoadedServer,
    toolName: string,
    params: unknown
  ) => {
    const cfg = await readConfig();
    const stillEnabled = cfg !== null && mcpServerStillEnabled(cfg, record.id);
    if (!stillEnabled) {
      await dropServer(record.id);
      return errorText(
        mcpToolUnavailableMessage(record.id, registeredToolName(record.id, toolName))
      );
    }
    return runTool(record.client, toolName, params as Record<string, unknown>, record.secret);
  };

  // ── Porte du contrôle de l'écran, pour TOUS les serveurs écran chargés ──
  // Enregistrée une seule fois ; elle ne s'active que pour un outil dont le
  // serveur propriétaire est un serveur « écran ».
  api.on("tool_call", async (event, ctx) => {
    const record = toolOwners.get(event.toolName);
    if (!record || !record.screen) {
      return; // Outil d'un autre serveur (ou non MCP) : hors de cette porte.
    }
    return screenGate(configPath, ctx, event);
  });

  // ── Chargement initial + mise à jour sans redémarrage ──
  let queue: Promise<void> = Promise.resolve();
  const scheduleRefresh = (): Promise<void> => {
    queue = queue.then(refresh).catch(() => undefined); // jamais deux à la fois
    return queue;
  };
  await scheduleRefresh();
  api.on("before_agent_start", async () => {
    await scheduleRefresh();
  });

  api.on("session_shutdown", async () => {
    for (const record of [...loaded.values()]) {
      await dropServer(record.id);
    }
  });
}

// ── Serveurs MCP : types, connexion, enregistrement, porte de l'écran ──

/** Outil tel que déclaré par un serveur dans `tools/list`. */
interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Résultat d'une tentative de connexion à UN serveur. */
type ConnectOutcome =
  | { ok: false; reason: "no-command" | "no-url" | "bad-url" | "timeout" | "connect" }
  | {
      ok: true;
      client: Client;
      transport: Transport;
      secret: string;
      tools: DiscoveredTool[];
    };

/** Un serveur MCP effectivement chargé dans la session (Assistant). */
interface LoadedServer {
  id: string;
  client: Client;
  transport: Transport;
  secret: string;
  /// Serveur de contrôle de l'écran : ses outils passent par les garde-fous.
  screen: boolean;
  /// Outils déclarés (première déclaration de chaque nom).
  tools: DiscoveredTool[];
  /// Empreinte de la fiche au moment du chargement (détection des changements).
  fingerprint: string;
}

/// Vrai si l'erreur vient de `withTimeout` (message `timeout (…ms): …`).
function isTimeoutFailure(err: unknown): boolean {
  return /^timeout \(/.test(String((err as { message?: unknown } | null)?.message ?? err));
}

/// Établit la connexion à UN serveur et découvre ses outils. Ne lève jamais :
/// chaque échec est rendu sous forme de cause (`reason`), la connexion est
/// refermée, et l'appelant décide du message. Un serveur lent, cassé ou
/// injoignable ne bloque donc jamais la session (ni l'Assistant, ni un agent).
async function connectServer(
  server: McpServerConfig,
  keyScope: { env: Record<string, string>; secret: string }
): Promise<ConnectOutcome> {
  // ── 2. Choix du transport selon le type du serveur (E3) ──
  // `http` / `https` = serveur distant joignable par le réseau ; toute autre
  // valeur reste un serveur local (programme), comportement du POC inchangé.
  const transportName = (server.transport ?? "").trim().toLowerCase();
  const isRemote = transportName === "http" || transportName === "https";
  // Clé d'accès du serveur (décidée par `scopeMcpSecret`, posée par Pilot E2).
  // Elle est présentée dans un EN-TÊTE d'authentification : JAMAIS dans
  // l'adresse, jamais journalisée, jamais renvoyée au modèle (cf. redactSecret).
  const secret = keyScope.secret;

  let transport: Transport;
  try {
    if (isRemote) {
      const url = (server.url ?? "").trim();
      if (!url) {
        return { ok: false, reason: "no-url" };
      }
      transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: secret
          ? { headers: { Authorization: `Bearer ${secret}` } }
          : undefined,
      });
    } else {
      if (!server.command) {
        return { ok: false, reason: "no-command" };
      }
      transport = new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
        // Variables d'environnement déclarées pour ce serveur (tâche 308) :
        // l'environnement hérité du process pi est transmis SANS la clé du
        // coffre quand ce serveur ne la déclare pas (tâche 399) ; les valeurs
        // déclarées écrasent les homonymes. La table des clés des AUTRES
        // serveurs (PILOT_MCP_SECRETS) a déjà été retirée par
        // `scopeMcpSecretForServer` : un serveur ne lit jamais la clé d'un autre.
        env: { ...keyScope.env, ...(server.env ?? {}) } as Record<string, string>,
      });
    }
  } catch {
    return { ok: false, reason: "bad-url" }; // Adresse illisible — fail-open.
  }

  const client = new Client({ name: "pilot-mcp", version: "0.1.0" });
  let tools: DiscoveredTool[] = [];
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, "MCP handshake");
    const toolsResult = await withTimeout(
      client.listTools(),
      CONNECT_TIMEOUT_MS,
      "MCP tools/list"
    );
    tools = (toolsResult.tools ?? []) as DiscoveredTool[];
  } catch (err) {
    // Fail-open : on ne fait jamais planter pi, on ne bloque pas le démarrage.
    await safeClose(transport, client);
    return { ok: false, reason: isTimeoutFailure(err) ? "timeout" : "connect" };
  }
  return { ok: true, client, transport, secret, tools };
}

/// Descripteur d'outil pi pour un outil MCP découvert. Le nom exposé est
/// `mcp_<serverId>_<outil>` (source unique : `mcp-tool-names.js`) et le schéma
/// est celui RÉELLEMENT déclaré par le serveur (`tools/list` → `inputSchema`) :
/// sans lui, le modèle ne voit ni les noms des paramètres ni leurs types.
function toolDescriptor(serverId: string, tool: DiscoveredTool) {
  const toolName = tool.name;
  const registeredName = registeredToolName(serverId, toolName);
  return {
    name: registeredName,
    label: `MCP ${toolName}`,
    description:
      tool.description ?? `Outil MCP \`${toolName}\` fourni par le serveur \`${serverId}\`.`,
    promptSnippet: `${registeredName}: appeler l'outil MCP ${toolName}`,
    promptGuidelines: [
      `Use ${registeredName} to call the MCP tool \`${toolName}\` on the "${serverId}" server. Pass the arguments expected by the MCP tool (as an object of properties). Results are returned as text (JSON where applicable).`,
    ],
    parameters: toolParametersSchema(tool.inputSchema),
    executionMode: "sequential" as const,
  };
}

/// Porte du contrôle de l'écran pour UN outil de serveur « écran » : l'action
/// est relue en DIRECT, confirmée par l'utilisateur, et journalisée. Un refus
/// (réglage coupé, arrêt d'urgence, réponse de l'utilisateur, mode simulation)
/// BLOQUE l'action : rien n'est envoyé au serveur et l'agent reçoit la raison.
async function screenGate(
  configPath: string,
  ctx: ExtensionContext,
  event: { toolName: string; input?: unknown }
): Promise<{ block: true; reason: string } | undefined> {
  // Réglages relus à CHAQUE action : l'arrêt d'urgence (ou une coupure du
  // réglage) prend effet immédiatement, sans redémarrer la session.
  const guard = await readScreenGuard(configPath);
  const outcome = screenGateOutcome(guard);
  if (outcome.action !== "confirm") {
    await journalScreenAction(ctx, event.toolName, SCREEN_JOURNAL_REFUSED, outcome.reason);
    return { block: true, reason: outcome.reason };
  }
  if (!ctx.hasUI) {
    // Session autonome : aucune interface pour confirmer → refus.
    await journalScreenAction(ctx, event.toolName, SCREEN_JOURNAL_REFUSED, SCREEN_NO_UI_MESSAGE);
    return { block: true, reason: SCREEN_NO_UI_MESSAGE };
  }
  const input = (event.input ?? {}) as Record<string, unknown>;
  const accepted = await askScreenConfirmation(ctx, event.toolName, input, outcome.simulated);
  if (!accepted) {
    await journalScreenAction(ctx, event.toolName, SCREEN_JOURNAL_REFUSED, SCREEN_REFUSED_MESSAGE);
    return { block: true, reason: SCREEN_REFUSED_MESSAGE };
  }
  if (outcome.simulated) {
    // Mode simulation : l'accord ne déclenche AUCUNE action réelle.
    await journalScreenAction(ctx, event.toolName, SCREEN_JOURNAL_SIMULATED, summarizeScreenAction(input));
    return { block: true, reason: SCREEN_SIMULATION_MESSAGE };
  }
  // Action réelle autorisée cette fois-ci : journal, puis exécution.
  await journalScreenAction(ctx, event.toolName, SCREEN_JOURNAL_ACCEPTED, summarizeScreenAction(input));
  return undefined;
}

// ── Utilitaires ──

/// Schéma TypeBox des paramètres d'un outil MCP, construit depuis le JSON Schema
/// `inputSchema` annoncé par le serveur (`tools/list`). Le schéma est transmis
/// tel quel (`Type.Unsafe`) : le modèle voit alors les vrais noms de paramètres
/// et leurs types. Un schéma absent ou non-objet retombe sur le schéma générique
/// historique (fail-open : l'outil reste appelable).
function toolParametersSchema(inputSchema: unknown) {
  const schema = inputSchema as { type?: string } | null;
  if (schema && typeof schema === "object" && schema.type === "object") {
    try {
      return Type.Unsafe(schema as never);
    } catch {
      // TypeBox indisponible/incompatible → repli générique ci-dessous.
    }
  }
  return Type.Record(Type.String(), Type.Unknown());
}

async function runTool(
  client: Client,
  toolName: string,
  params: Record<string, unknown>,
  secret: string
): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  if (!client) {
    return errorText("Client MCP non connecté.");
  }
  try {
    const res = await withTimeout(
      client.callTool({ name: toolName, arguments: params }),
      CALL_TIMEOUT_MS,
      `MCP call ${toolName}`
    );
    return formatMcpResult(res);
  } catch (err) {
    // Masquage avant tout retour à l'agent : une erreur ne doit jamais
    // transporter la clé d'accès.
    return errorText(redactSecret(`MCP ${toolName} échec: ${String(err)}`, secret));
  }
}

/// Retire toute occurrence de la clé d'un texte (erreur renvoyée à l'agent).
function redactSecret(text: string, secret: string): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join("[clé masquée]");
}

// Une erreur locale de l'outil MCP (client absent, exception, échec de
// callTool) est toujours signalée comme telle à l'agent (`isError`).
function errorText(msg: string): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  return { content: [{ type: "text", text: msg }], isError: true };
}

function formatMcpResult(res: unknown): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  // Un outil MCP signale son échec DANS le résultat (`isError: true`), pas par
  // une erreur de protocole : sans propagation de ce drapeau, un refus arrive à
  // l'agent comme une réussite.
  const isError = (res as { isError?: unknown } | null)?.isError === true;
  try {
    const r = res as {
      content?: Array<{ type?: string; text?: string; [k: string]: unknown }>;
      structuredContent?: unknown;
    };
    const parts: string[] = [];
    if (Array.isArray(r.content)) {
      for (const c of r.content) {
        if (typeof c.text === "string") {
          parts.push(c.text);
        } else if (c.type === "json") {
          parts.push(JSON.stringify(c, null, 2));
        } else {
          parts.push(JSON.stringify(c));
        }
      }
    }
    if (r.structuredContent !== undefined) {
      parts.push(JSON.stringify(r.structuredContent, null, 2));
    }
    if (parts.length === 0) {
      parts.push(JSON.stringify(res));
    }
    return { content: [{ type: "text", text: parts.join("\n") }], isError };
  } catch {
    return { content: [{ type: "text", text: JSON.stringify(res) }], isError };
  }
}

async function readFileText(path: string): Promise<string> {
  // node:fs/promises disponible dans l'environnement pi (node runtime).
  const fs = await import("node:fs/promises");
  return fs.readFile(path, "utf8");
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout (${ms}ms): ${what}`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

async function safeClose(
  transport: Transport,
  client: Client | null
): Promise<void> {
  try {
    if (client) {
      await client.close();
    }
  } catch {
    /* ignore */
  }
  try {
    await transport.close();
  } catch {
    /* ignore */
  }
}

// ── Garde-fous du contrôle de l'écran ──

/// Dossier d'un chemin de fichier (``G:\a\mcp.json`` → ``G:\a``), sans dépendre
/// d'un module supplémentaire.
function dirOf(filePath: string): string {
  return String(filePath || "").replace(/[\\/][^\\/]*$/, "");
}

/// Chemin d'un fichier relatif à un dossier de base (vide si la base est vide).
function pathIn(base: string, relative: string): string {
  const b = String(base || "").replace(/[\\/]+$/, "");
  return b ? `${b}/${relative}` : "";
}

/// Mode STRICT de la clé du coffre, relu depuis `config.json` (même dossier que
/// `mcp.json`). Fichier absent ou illisible → `true` (défaut sûr de Pilot).
async function readMcpSecretStrict(configPath: string): Promise<boolean> {
  const dir = dirOf(configPath);
  if (!dir) {
    return parseSecretStrict("");
  }
  try {
    return parseSecretStrict(await readFileText(pathIn(dir, "config.json")));
  } catch {
    return parseSecretStrict("");
  }
}

/// Réglages du contrôle de l'écran, relus en DIRECT depuis `config.json`
/// (même dossier que `mcp.json`). Un fichier illisible retombe sur les défauts
/// sûrs (contrôle activé, mais en SIMULATION) : jamais une autorisation nue.
/// Ne contient aucun contenu sensible (trois booléens).
async function readScreenGuard(configPath: string): Promise<ScreenGuard> {
  const dir = dirOf(configPath);
  if (!dir) {
    return parseScreenGuard("");
  }
  try {
    return parseScreenGuard(await readFileText(pathIn(dir, "config.json")));
  } catch {
    return parseScreenGuard("");
  }
}

/// Demande l'accord de l'utilisateur pour une action sur l'écran. La réponse
/// attendue est un VRAI booléen : le contrat RPC `confirm` de pi lit une
/// réponse sans champ `confirmed` comme un refus, d'où le sentinel reconnu par
/// `src/js/agent-pi.js` (qui répond `{ confirmed, cancelled }`).
/// Fail-closed : toute erreur (pas d'UI, dialogue impossible) vaut refus.
async function askScreenConfirmation(
  ctx: ExtensionContext,
  toolName: string,
  input: Record<string, unknown>,
  simulated: boolean
): Promise<boolean> {
  const payload = {
    tool: toolName,
    args: summarizeScreenAction(input),
    simulated,
  };
  try {
    const answer = await ctx.ui.confirm(
      SCREEN_CONFIRM_TITLE,
      SCREEN_GATE_SENTINEL + JSON.stringify(payload)
    , PILOT_UI_OPTS);
    return answer === true;
  } catch {
    return false;
  }
}

/// Ajoute une ligne au journal des actions écran du projet
/// (`.pilot/screen-actions.log`) : heure, outil, résultat, détail REDACTÉ (le
/// texte saisi n'y figure jamais). Le journal ne bloque jamais une action.
async function journalScreenAction(
  ctx: ExtensionContext,
  toolName: string,
  outcome: string,
  detail: string
): Promise<void> {
  try {
    const path = pathIn(ctx.cwd, SCREEN_JOURNAL_RELATIVE_PATH);
    if (!path) {
      return;
    }
    const fs = await import("node:fs/promises");
    await fs.mkdir(dirOf(path), { recursive: true });
    const line = formatScreenJournalLine({ tool: toolName, outcome, detail }) + "\n";
    await fs.appendFile(path, line, "utf8");
  } catch {
    /* Le journal est un garde-fou d'information, jamais un point de blocage. */
  }
}
