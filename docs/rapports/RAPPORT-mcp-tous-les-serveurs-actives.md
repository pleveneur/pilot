# Rapport — l'Assistant charge TOUS les serveurs MCP activés (décision du 2026-11-02)

> Mission : la conversation de l'Assistant doit disposer **directement** des
> outils des serveurs MCP qu'elle a activés, comme un agent, et **plus d'un
> serveur à la fois**. Remplace la règle « un seul serveur branché par session »
> qui avait été constatée le 2026-10-28 (`RAPPORT-mcp-un-serveur.md`).
>
> Aucune version n'a été publiée, aucun tag créé : la validation revient au
> propriétaire.

---

## 1. Ce qui change pour vous

- **Vous n'avez plus à choisir un serveur unique.** Tous les serveurs MCP
  **activés** sont connectés ensemble au début de la conversation de l'Assistant,
  et leurs outils lui sont proposés directement. Quand vous demandez « active le
  personnage Présences », l'Assistant appelle **lui-même** l'outil du bon
  serveur, sans passer par un agent.
- **Activer un serveur n'en coupe plus aucun autre.** L'Assistant vous dit
  lesquels restent activés ; il ne désactive personne dans votre dos.
- **Le changement est pris en compte tout de suite**, à la demande suivante de
  l'Assistant, sans redémarrer Pilot. Une session d'**agent** déjà lancée garde
  le serveur avec lequel elle a démarré (comportement inchangé).
- **Un serveur cassé, lent ou injoignable ne bloque rien** : un message clair le
  nomme, les autres serveurs restent disponibles, la conversation continue. Le
  même serveur n'est pas retenté à chaque tour ; il le sera si vous modifiez sa
  fiche.
- **Un serveur désactivé n'est jamais chargé** — ni au démarrage, ni plus tard :
  la liste est relue avant chaque tour, et si vous le désactivez en pleine
  conversation, ses outils refusent tout appel avec une phrase explicite (aucun
  envoi au serveur).
- **Aucun secret, aucune variable d'environnement, aucun contenu de `mcp.json`
  n'apparaît dans la conversation.** Chaque serveur ne reçoit que **sa** clé du
  coffre, jamais celle d'un autre.

---

## 2. Diagnostic — où les serveurs MCP étaient branchés, et pourquoi l'Assistant était exclu

| # | Point du branchement | Preuve (état d'avant) |
|---|---|---|
| 1 | **Un seul serveur choisi côté Rust au lancement** : cible si elle est activée, sinon **le premier serveur activé** | `src-tauri/src/mcp_config.rs:206` `select_session_server` (règle « cible, sinon premier activé ») |
| 2 | **L'extension ne connaissait qu'un serveur** : `PILOT_MCP_SERVER` désignait LE serveur, la branche unique connectait, listait les outils et enregistrait `mcp_<id>_<outil>` | `src-tauri/extensions/mcp-client.src.ts` (une seule branche, `const serverId = mcpServerId(server)`) |
| 3 | **L'Assistant n'avait aucune cible** : sa session passait `None` et recevait donc **la clé du premier serveur activé** — un serveur unique, imposé, sans rapport avec ce que l'utilisateur croyait | `src-tauri/src/agent_service.rs:3515-3520` avant cette mission : `Self::attach_mcp_secret_env(app, &mut vars, None)` (`None` = « pas de cible » ⇒ premier activé) |
| 4 | **Les agents, eux, désignaient une cible** (`mcp_server`) : leur comportement était correct et devait rester intact | `src-tauri/src/agent_service.rs:3358` et `:3639` (`PILOT_MCP_SERVER`) |
| 5 | **L'activation depuis la conversation appliquait l'exclusivité** : activer un serveur écrivait `enabled:false` pour tous les autres | `src/js/mcp-server-toggle.js:136` `planMcpServerToggle` (`disabledOthers`) |

Conséquence : l'Assistant ne pouvait, **par construction**, appeler l'outil que
d'un serveur — celui que Rust avait choisi, souvent `test` (`scripts/mcp-test-server.js`)
plutôt que le serveur réellement voulu. Ce n'était pas un défaut de raisonnement
du modèle : c'était un plafond technique.

**Point exact à changer** : il y avait **deux** verrous, et les deux sont tombés —
(a) la sélection d'un serveur unique côté Rust pour la session de l'Assistant,
(b) la branche unique de l'extension. Le verrou « un serveur » n'a pas été
supprimé pour les **agents** (où il est le comportement voulu : une cible).

---

## 3. Réalisation

### 3.1 Une seule décision : quelle liste de serveurs une session charge

Nouveau module **pur** (aucune I/O, aucun DOM, aucune dépendance Tauri),
`src/js/mcp-servers-session.js`, partagé par l'extension et par les tests :

| Fonction | Rôle |
|---|---|
| `mcpEnabledServers(config)` | `enabled !== false` (une fiche sans champ reste activée — règle historique) |
| `mcpAmbiguousServerIds(servers)` | deux entrées de **même identifiant** ⇒ refusées **ensemble**, avec les libellés `nom (id)` |
| `planMcpSessionServers(config, {})` | cible `PILOT_MCP_SERVER` ⇒ **UN** serveur (agents) ; cible vide ⇒ **TOUS** les serveurs activés (`MCP_SESSION_ALL`) |
| `planMcpRefresh(plan, state)` | charge ce qui manque, retire ce qui n'est plus voulu, ne double jamais une connexion en cours |
| `mcpServerFingerprint(server)` | une fiche inchangée n'est pas retentée à chaque tour |
| `mcpServerStillEnabled(config, id)` | un serveur désactivé en cours de session n'exécute plus rien |
| messages (`mcpAmbiguousIdNotice`, `mcpServerUnavailableNotice`, `mcpToolUnavailableMessage`, `mcpNoServerNotice`) | une phrase par cause ; ne nomme jamais une adresse, une commande ni une clé |

### 3.2 Extension MCP : deux modes, une seule politique

`src-tauri/extensions/mcp-client.src.ts` (source ; `pilot-mcp-client.ts` est
**généré** par `npm run build:mcp`, jamais édité) :

- **Mode agent** (`PILOT_MCP_SERVER` posé) : une cible, comportement inchangé
  (ligne 307 : la porte du contrôle de l'écran pour cette cible).
- **Mode Assistant** (aucune cible) : branche « tous les serveurs activés »
  à partir de la ligne 323 —
  `const loaded = new Map<string, LoadedServer>()` (339),
  `const refresh = async () => {…}` (386) qui appelle
  `planMcpSessionServers(cfg, {})` (389),
  `resolveToolNames(...)` (474) pour la répartition des noms,
  `executeOnLoadedServer` (514) qui **relit** `mcpServerStillEnabled` avant
  chaque appel, une **seule** porte `api.on("tool_call")` (533) qui n'active les
  garde-fous que pour les serveurs « écran » (`toolOwners.get(event.toolName)`),
  et `scheduleRefresh()` (543) exécuté au démarrage **et** sur
  `before_agent_start` (549) — c'est ce qui fait entrer un serveur activé en
  cours de conversation **sans redémarrer Pilot**.
- `connectServer` (602) : chaque serveur a **son** délai borné
  (`CONNECT_TIMEOUT_MS`) et **son** échec (`no-command`, `no-url`, `bad-url`,
  `timeout`, `connect`) ; l'échec ferme la connexion et rend une cause — jamais
  une exception qui remonterait à pi.
- `toolDescriptor` (670) reste le **seul** endroit qui pose le schéma
  (`parameters: toolParametersSchema(tool.inputSchema)`) et le nom
  `mcp_<id>_<outil>`.

### 3.3 Noms d'outils : jamais deux serveurs en silence

`src/js/mcp-tool-names.js` (source unique, inchangée dans son format) reçoit
deux fonctions nouvelles, qui **réutilisent** la règle existante
(`registeredToolName`) :

- `resolveToolNames(entries)` (`:198`) — répartit les noms entre les serveurs
  chargés ensemble ; le **premier** (`mcp.json`) garde l'outil, l'autre n'est pas
  exposé ; la liste des conflits est rendue.
- `crossServerToolClashMessage(name, owners)` (`:171`) — le message qui **nomme
  les deux serveurs** (« … n'est PAS exposé »).

Les cas déjà couverts restent couverts : identifiants identiques ⇒ refus des
deux (`mcp-servers-session.js`), outil déclaré deux fois par un serveur ⇒
première déclaration seulement (`duplicateToolNames` / `firstDeclarationOnly`).

### 3.4 Clés du coffre : une par serveur, jamais partagée

- Rust : `attach_mcp_secrets(vars, …)` (`src-tauri/src/mcp_config.rs:540`)
  construit **deux tables** `{ identifiant: clé }` — `PILOT_MCP_SECRETS` et
  `PILOT_MCP_SECRET_BLOCKS` — après avoir **retiré** les quatre variables de
  secret héritées, et rend un diagnostic **masqué**
  (`McpSecretsAttachment { enabled, ready, blocked, message }`, `:445`). La clé
  unique historique `PILOT_MCP_SECRET` n'est posée qu'en mode **non strict**.
  Clé d'un serveur : `mcp_secret_server_key` (`:629`).
- Appelant : `Self::attach_mcp_secrets_env(app, &mut vars)` (`agent_service.rs:3282`)
  utilisé **uniquement** par la session de l'Assistant (`:3515`) ; les agents
  gardent `attach_mcp_secret_env` (une cible, une clé).
- Extension : `scopeMcpSecretForServer(process.env, …)`
  (`src/js/mcp-secret-scope.js:221`) ne rend à chaque serveur **que sa** clé,
  et **retire** les tables de son environnement (`MCP_SECRETS_VAR` = 163) avant
  de lancer le programme. Un serveur ne peut pas lire la clé d'un autre.

### 3.5 Activation non exclusive

`src/js/mcp-server-toggle.js:136` (`planMcpServerToggle`) n'écrit plus qu'**un
seul** changement : celui du serveur **nommé**. `othersEnabled` nomme les
serveurs **restés activés** (visibilité, jamais d'effet de bord) ; `disabledOthers`
disparaît. `applyMcpServerToggle` inchangé dans sa portée : lit `mcp_get_state`,
écrit `mcp_set_servers_enabled`, ne touche **que** le champ `enabled`.

Côté Rust, `activation_n_est_plus_exclusive_les_autres_restent_actives`
(`mcp_config.rs:3045`) **prouve** le changement : activer `test` seul le laisse
seul modifié, `mcp-1` reste activé.

---

## 4. Robustesse (règle 3)

| Situation | Ce qui se passe |
|---|---|
| Serveur injoignable / commande absente / URL illisible | `connectServer` rend une cause, **un** message clair nommant le serveur ; la session continue |
| Serveur qui ne répond pas | `CONNECT_TIMEOUT_MS` borne l'attente **de ce serveur** ; `timeout` est une cause comme une autre |
| Serveur lent à chaque tour | l'**empreinte** de la fiche est mémorisée : pas de nouvelle tentative tant que la fiche ne change pas (aucune attente répétée) |
| Serveur désactivé en cours de conversation | il est **retiré** (`dropServer`), ses outils rendent une phrase explicite (« … est désactivé. Aucun appel n'a été envoyé. ») |
| Deux entrées de même identifiant | les **deux** sont refusées, **nommées**, les autres serveurs restent disponibles |
| `mcp.json` illisible ou en cours d'écriture | `readConfig` rend `null` : on ne touche à rien |

---

## 5. Sécurité (règle non négociable)

- Rien de secret ne remonte au modèle ni à l'écran : les messages ne contiennent
  que des **identifiants de serveur** et des causes (`timeout`, `no-command`…).
  Le diagnostic Rust est compté et masqué (`[mcp-secret] N clé(s) pour M
  serveur(s) activé(s)…`), vérifié par test : ni valeur de clé, ni référence de
  coffre, ni adresse n'y apparaissent.
- **Confirmation avant qu'un AGENT utilise un serveur MCP : inchangée**
  (`mcp_agent_confirm`, défaut actif). Cette mission n'a pas touché ce chemin.
- **Serveur désactivé jamais chargé** : exclu de `mcpEnabledServers`, donc du
  plan de session, et re-vérifié **avant chaque appel** d'outil.
- Le contrôle de l'écran (`screen`) reste actif : un serveur « écran » chargé
  dans la conversation passe par la **même** porte (confirmation + journal +
  arrêt d'urgence) qu'un serveur d'agent.

---

## 6. Tests — ce que chacun protège

Chaque test nomme la règle qu'il tient ; tous échouent si la règle est cassée.

| Fichier | Tests | Règle protégée |
|---|---|---|
| `src/js/mcp-servers-session.test.js` | 20 | **(1)** l'Assistant perd l'accès aux outils d'un serveur **activé** (plan ≠ `ALL`, identifiants manquants) ; **(2)** un serveur **désactivé** est chargé (présent dans `plan.servers`, ou `mcpServerStillEnabled` vrai) ; **(3)** activer un serveur en **coupe** un autre ; **(4)** deux serveurs se **masquent** en silence (identifiants identiques, outil de même nom) ; **+** chaîne complète Rust → env → extension (gardes de source) |
| `src/js/mcp-server-toggle.test.js` | 23 | activation **non exclusive** : `plan.changes` ne contient **jamais** un `enabled:false` pour un voisin, les autres sont **nommés** « restés activés », l'écriture ne change que `enabled` |
| `scripts/mcp-client-extension.test.js` | 17 | les **deux** branches de l'extension passent par la **même** porte (`isScreenTool` pour la cible, `toolOwners` pour les serveurs chargés ensemble) ; l'échec de connexion est **fail-open** |
| `src/js/mcp-tool-names.test.js` | 16 | un outil déclaré deux fois n'en remplace pas un autre ; les noms sont **répartis** entre serveurs chargés ensemble, un conflit **nomme les deux** |
| `src/js/mcp-secret-scope.test.js` | 13 | un serveur ne reçoit que **sa** clé ; les tables `PILOT_MCP_SECRETS` / `_BLOCKS` ne sont jamais transmises |
| `src/js/mcp-tool-schema.test.js` | 3 | le schéma réel du serveur est posé en **un seul** endroit (`toolDescriptor`) |
| `src/js/screen-guard-wiring.test.js` | 12 | le contrôle de l'écran reste branché sur les outils MCP |
| Rust `mcp_config` (`cargo test --lib mcp_config`) | 42 | **non exclusivité** de l'activation, **une clé par serveur jamais pour un désactivé**, portée de l'écriture (`enabled` seul), aucun secret dans le diagnostic |

Aucun test existant n'a été affaibli : ceux qui décrivaient l'exclusivité ou le
serveur unique ont été **réécrits pour vérifier la nouvelle règle** (et ils
échouent si l'ancienne revient).

---

## 7. Ce qui n'a PAS changé

- Les **agents** : une cible (`mcp_server`) ou le premier serveur activé, et la
  clé unique — exactement comme avant (`select_session_server`, `PILOT_MCP_SERVER`).
- La **confirmation** avant qu'un agent utilise un serveur MCP (défaut : demandée).
- Le **format** des noms d'outils `mcp_<id>_<outil>`.
- Les réglages MCP autres que `enabled` (`mcp_enabled`, `mcp_agent_confirm`,
  `mcp_secret_strict`, contrôle de l'écran) : aucun n'est écrit par la nouvelle
  voie.
- La case « Activé » des Paramètres reste une **simple bascule par serveur**.
- L'écran Vocal, les sentinelles `PILOT_ASSISTANT_*`, le registre d'agents :
  non touchés.

---

## 8. Vérifications exécutées

```
npm test                                     → 5041 tests passés / 272 fichiers, 0 échec
npm run build:mcp                            → pilot-mcp-client.ts généré (0 erreur)
cargo test --manifest-path src-tauri/Cargo.toml --lib   → 819 passés, 0 échec
cargo test --manifest-path src-tauri/Cargo.toml --lib mcp_config → 42 passés, 0 échec
npm run build:handbook                       → help/handbook.md régénéré (47 blocs)
```

Détail des fichiers MCP : `mcp-servers-session` 20, `mcp-server-toggle` 23,
`mcp-client-extension` 17, `mcp-tool-names` 16, `mcp-secret-scope` 13,
`mcp-tool-schema` 3, `screen-guard-wiring` 12.

---

## 9. Fichiers touchés

- Nouveaux : `src/js/mcp-servers-session.js`, `src/js/mcp-servers-session.test.js`.
- Modifiés : `src-tauri/extensions/mcp-client.src.ts` (source ; bundle régénéré),
  `src-tauri/extensions/pilot-assistant-actions.ts` (descriptions des outils),
  `src-tauri/src/mcp_config.rs`, `src-tauri/src/agent_service.rs`,
  `src/js/mcp-tool-names.js`, `src/js/mcp-secret-scope.js`,
  `src/js/mcp-server-toggle.js`, `src/js/super-agent.js` (commentaire),
  `index.html` (deux textes d'aide des Paramètres), et les tests associés.
- Documentation : `spec_pilot.md`, `spec_super_agent.md` (+ `help/handbook.md`
  régénéré), `AGENTS.md`.
