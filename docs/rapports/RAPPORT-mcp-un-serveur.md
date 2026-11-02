# Rapport — « un seul serveur MCP » et l'agent « Éloïse » (incident du 2026-10-28)

> Diagnostic **en lecture seule** : aucun fichier de code, aucun test, aucune
> configuration (`mcp.json`, `pilot.db`) n'a été modifié. Les seules lectures
> hors dépôt sont des **lectures** de `%APPDATA%\com.pilot.editor.dev\`
> (`config.json`, `mcp.json`, `pilot.db`) pour épingler les faits de l'incident.

---

## 1. Constat

1. Le serveur MCP « Presence » (projet Présences) n'était **pas** le serveur
   branché dans la session qui a répondu au propriétaire. Le serveur branché
   était `test` (`scripts/mcp-test-server.js`, un outil `echo`).
2. Ce n'est pas un aléa : le code choisit **le premier serveur `enabled` du
   tableau `servers` de `mcp.json`**. Dans la config constatée, `servers[0]` est
   `test` ⇒ Presence (`servers[2]`) n'est jamais chargé pour l'agent de l'onglet
   ni pour l'assistant 🧭.
3. Quand MCP n'est pas branché (ou quand l'outil demandé n'existe pas), **rien
   ne le dit à l'agent** : l'extension est muette par construction, et aucun
   autre point du code ne produit ce message. L'agent ne reçoit donc **aucune**
   indication « pas d'outil MCP ».
4. `create_agent` n'est **pas** soumis à une confirmation de l'utilisateur,
   malgré les apparences : l'appel `ctx.ui.confirm(...)` de l'extension n'est
   pas un dialogue Oui/Non, c'est un **transport** que l'interface intercepte
   pour exécuter l'action directement. La ligne d'agent a donc été écrite en
   base sans accord explicite.
5. Aucun repli « créer un agent » n'est **programmé** nulle part. La
   substitution vient d'une décision du modèle, rendue possible (et même
   suggérée) par trois éléments du code, listés au § 3.

---

## 2. Preuves

### 2.1 Où et comment est choisi LE serveur MCP de la session

| Fait | Preuve |
|---|---|
| Règle de sélection (Rust) : cible si `id` cible **et** activée, sinon **premier serveur activé** | `src-tauri/src/mcp_config.rs:203-217` (`select_session_server`, repli ligne 216 : `cfg.servers.iter().find(|s| s.enabled)`) |
| Même règle dans l'extension (c'est elle qui branche réellement) | `src-tauri/extensions/mcp-client.src.ts:177-185` (`enabledServers[0]` ligne 182) |
| Le critère est l'**ordre du tableau `servers`** (Vec) de `mcp.json` : aucun tri, nulle part | `src-tauri/src/mcp_config.rs:156-160` (`servers: Vec<McpServer>`), `read_mcp_config` `mcp_config.rs:175-186`, `read_mcp_config_at` `mcp_config.rs:194-200` |
| L'ordre du tableau = l'ordre de la liste affichée dans Paramètres ; un nouveau serveur est **ajouté en fin** | `src/js/settings.js:1643-1648` (`push` puis `mcp_save_servers`), `src-tauri/src/mcp_config.rs:417-424` (écrit tel quel) |
| Config réelle le 2026-10-28 | `%APPDATA%\com.pilot.editor.dev\mcp.json` : `[0] test (enabled)`, `[1] mcp-2 context7 (enabled)`, `[2] mcp-1 Presence (enabled)` |

**Quelle session reçoit quel serveur** (le point qui explique l'incident) :

| Session | Extension MCP chargée ? | `PILOT_MCP_SERVER` posé ? | Serveur effectif |
|---|---|---|---|
| Agent standard (onglet chat) | oui si `mcp_enabled` — `src-tauri/src/agent_service.rs:3780-3785` ; env `src-tauri/src/agent_service.rs:3809-3824` | **jamais** (`attach_mcp_secret_env(app, &mut vars, None)` ligne 3821) | **1er activé = `test`** |
| Assistant 🧭 (super-agent) | oui si `mcp_enabled` — `src-tauri/src/agent_service.rs:3418-3426` ; env `src-tauri/src/agent_service.rs:3477-3493` | **jamais** (ligne 3489 : `None`) | **1er activé = `test`** |
| Agent lancé par l'assistant (`run_agents`) | **seulement si `mcp_server` explicite** — `src-tauri/src/agent_service.rs:3571-3576` | oui si `mcp_server` — `src-tauri/src/agent_service.rs:3603-3621` | serveur désigné, sinon **aucun MCP** |
| Agent d'assistant (`run_assistant_agents`) | **seulement si `mcp_server` explicite** — `src-tauri/src/agent_service.rs:3292-3296` (`want_mcp`) | oui — `src-tauri/src/agent_service.rs:3332-3337` | serveur désigné, sinon **aucun MCP** |

⇒ **Confirmé** : « seul le premier serveur activé est connecté ». Critère exact =
**premier élément `enabled` dans l'ordre du tableau `servers` de `mcp.json`**
(pas un ordre alphabétique, pas un ordre d'identifiant, pas un « dernier
utilisé »). Et **Présence ne peut pas être branché dans la session de
l'assistant lui-même** : le super-agent n'a aucun moyen de recevoir
`PILOT_MCP_SERVER` ; la cible n'existe que pour un **agent enfant** lancé avec
`mcp_server`.

### 2.2 Ce que voit l'agent quand MCP n'est pas branché / quand l'outil manque

| Fait | Preuve |
|---|---|
| Extension **muette par conception** | `src-tauri/extensions/mcp-client.src.ts:36-38` : « Ce POC reste donc MUET (fail-open silencieux) » |
| Aucun message si MCP est coupé / config illisible / aucun serveur activé | `mcp-client.src.ts:159-162`, `:165-170`, `:183-185` (trois `return` sans notification) |
| Aucun message si la connexion ou `tools/list` échoue | `mcp-client.src.ts:274-286` (`catch` → `safeClose` + `return`) |
| Aucun outil n'est enregistré dans ces cas ⇒ l'agent ne voit simplement pas les outils MCP | enregistrement uniquement après découverte réussie : `mcp-client.src.ts:281` puis `:300-330` |
| Les seuls messages existants concernent trois cas **autres** (identifiant ambigu, clé du coffre, outil déclaré deux fois) | `mcp-client.src.ts:196-201`, `:213-221`, `:293-299` |
| Aucune consigne de prompt ne dit à un agent qu'un outil MCP peut manquer | aucune occurrence de « MCP » côté prompt de l'assistant : `src-tauri/src/super_agent.rs` (grep « MCP » = 0 résultat) ; le seul outil MCP-état est celui de l'assistant : `src-tauri/extensions/pilot-assistant-actions.ts:320-345` (`mcp_state`) |

**Réponse à la question 2** : l'agent ne reçoit **rien**. Il voit son jeu
d'outils habituel (les extensions Pilot + les outils de pi), sans mention que
MCP est absent, sans mention de « Presence », et sans liste des serveurs
configurés (cette liste n'est lisible que par l'assistant, via `mcp_state`,
`src-tauri/src/mcp_config.rs:505-535`). Il peut donc parfaitement croire qu'il
doit se débrouiller avec ses propres outils — c'est exactement ce qui s'est
passé. Note : `mcp_state` lui-même n'indique pas **quel** serveur est
réellement branché ; il n'expose que `{id, name, enabled, transport}`
(`mcp_config.rs:512-521`).

### 2.3 Le chemin `create_agent` (table `agents`) est-il gardé ?

| Fait | Preuve |
|---|---|
| L'outil demande un `confirm` via `ctx.ui.confirm(...)` avec un sentinel | `src-tauri/extensions/pilot-assistant-actions.ts:159-162` (`ACTION_SENTINEL + payload`) |
| **Mais l'interface n'affiche aucun dialogue** : sur ce sentinel, elle exécute l'action et répond | `src/js/super-agent.js:6683-6693` — commentaire ligne 6686-6687 (« au lieu d'afficher des boutons Oui/Non »), appel `handleSuperAgentAction` ligne 6691 |
| Exécution : seules gardes = champs obligatoires + unicité de l'id | `src/js/super-agent.js:8310-8327` (`create_agent : id, name et role sont requis` ligne 8315 ; `validateAgentId` ligne 8323) |
| Puis écriture en base et réponse `true` à l'extension (donc résultat « créé ») | `src/js/super-agent.js:8345-8347` (`upsertAgent` puis `respondSuperAgentAction(id, true)`) |
| Écriture réellement **globale** (`project_path NULL`) — conforme à la ligne observée `eloise / NULL` | `src-tauri/src/agent_service.rs:4127-4129` (`project_path IS NULL`) et `:4154-4156` (`INSERT ... NULL`) |
| Les seuls endroits où l'on **nomme** ce qui vient d'être créé | `src/js/super-agent.js:8346` (« Agent « … » créé dans le registre global ») et `src-tauri/extensions/pilot-assistant-actions.ts:163` |

**Réponse à la question 3** : oui, le chemin est atteignable **sans aucune
confirmation de l'utilisateur**. Le `confirm` de l'extension n'est pas une
garde pour les actions de l'assistant : c'est un canal d'exécution. Le seul
point du code où l'on pourrait dire clairement « ceci est un **agent**, pas un
personnage » est le message système de `src/js/super-agent.js:8346` (et, côté
modèle, le texte de retour de `pilot-assistant-actions.ts:163`) : une phrase y
suffirait, sans aucune mécanique nouvelle.

Nuance utile : dans une session d'assistant **en arrière-plan**, le même
sentinel n'est **pas** relayé (`src/js/agent-choice-relay.js:60-70`) et le bus
ne répond pas à sa place (`src/js/agents-bus.js:2850-2865`) : l'action n'est
alors **pas** exécutée, l'agent attend (plafond 45 min, avec avertissement).
L'incident relève donc du chemin « onglet assistant visible ».

### 2.4 Y a-t-il un repli silencieux prévu qui expliquerait la substitution ?

| Fait | Preuve |
|---|---|
| **Aucun** code ne transforme « créer un personnage » en « créer un agent » : `create_agent` n'est appelé que par le modèle, via l'outil | appels `create_agent` recensés : `src/js/super-agent.js:8310`, `src-tauri/extensions/pilot-assistant-actions.ts:131-166` — aucun appel interne |
| En revanche, les consignes **poussent** à créer un agent dès qu'une capacité manque | `src-tauri/src/super_agent.rs:617` : « Si aucun agent ne convient, crée-le d'abord avec `create_agent`, puis lance. » (mode « Assistant coordinateur pur », **actif** dans la config lue : `super_agent_coordinator = true`) ; `src-tauri/src/super_agent.rs:505` (`SUPER_AGENT_TOOLS_PROMPT`) ; description de l'outil `src-tauri/extensions/pilot-assistant-actions.ts:132-134` |
| Aucune consigne n'interdit de remplacer une demande par une autre quand un outil manque | aucune occurrence « MCP » dans `src-tauri/src/super_agent.rs` ; aucune règle de non-substitution dans les blocs de guidage (`super_agent.rs:602-636`) |
| Le projet sait pourtant formuler une telle règle, ailleurs | `spec_super_agent.md:1109-1114` (C2) : « L'agent cible est OBLIGATOIRE (échec franc, aucun repli silencieux) » |

**Réponse à la question 4** : il n'existe **aucun** repli silencieux programmé
ni documenté pour ce cas. La substitution est une **décision du modèle**,
rendue probable par (a) l'absence totale d'outil « personnage », (b) l'absence
de tout message signalant cette absence, (c) une consigne impérative « si
aucun agent ne convient, crée-le ». Ce dernier point est une **hypothèse de
causalité sur le raisonnement du modèle** : elle n'est pas démontrable par le
code ; ce qui est démontré, c'est que le code ne l'empêchait pas et ne
l'annonçait pas.

---

## 3. Cause tranchée

1. **Cause directe du « rien n'a été créé »** : le serveur branché était le
   **premier activé** de `mcp.json` (`test`), et non Presence
   (`mcp_config.rs:203-217`, `mcp-client.src.ts:177-185`). L'agent n'a donc
   jamais eu d'outil de création de personnage.
2. **Cause directe du silence** : l'extension MCP **n'annonce rien** quand elle
   ne branche rien (`mcp-client.src.ts:36-38`, `:159-185`, `:274-286`) et
   aucune consigne ne prévoit ce cas (`super_agent.rs` : pas une mention de
   MCP). L'agent n'a aucun moyen de savoir qu'une capacité existait ailleurs.
3. **Cause de l'écriture en base** : `create_agent` s'exécute **sans
   confirmation** — le `confirm` de l'extension est intercepté comme un ordre
   d'exécution (`super-agent.js:6683-6693` → `:8345-8347`). Rien ne nomme la
   nature de l'objet créé au moment où il est créé (`:8346` est un simple
   accusé de réception).
4. **Facteur aggravant** : les trois serveurs sont **tous activés** alors que
   le modèle de Pilot est « un seul serveur à la fois ». L'interface ne le dit
   qu'en infobulle (`index.html:1477`, attribut `title`) ; aucune garde
   n'empêche d'en activer plusieurs, et l'ordre du tableau décide seul.

## 4. Ce qui n'est PAS la cause

- **Pas un bug de `select_session_server`** : le repli sur le premier activé
  est délibéré et documenté (`mcp_config.rs:203-205`, `spec_pilot.md:68`).
- **Pas le cas « identifiant ambigu »** : `test`, `mcp-2`, `mcp-1` sont
  distincts ⇒ le refus explicite (`mcp-client.src.ts:196-201`) n'a pas joué.
- **Pas la clé du coffre** (`mcp_secret_strict = true`) : aucun des trois
  serveurs ne déclare `secret_ref` ⇒ `keyScope.blocked` est faux et le message
  de clé (`mcp-client.src.ts:213-221`) ne s'applique pas.
- **Pas les garde-fous d'écran** : Presence n'est pas un serveur « écran » ;
  le mode simulation (`screen_control_simulation`), désormais actif par défaut,
  ne concerne que les serveurs marqués « écran » (`mcp-client.src.ts:206-211`,
  `src/js/screen-guard.js`).
- **Pas une défaillance de `create_agent`** : le chemin a fait exactement ce
  qu'on lui demandait (écrire une ligne d'agent globale). Le défaut n'est pas
  son exécution, c'est l'absence de refus et de nomination.
- **Pas `mcp_agent_confirm`** : ce réglage n'est **qu'une consigne** écrite
  dans la description de l'outil (`pilot-assistant-actions.ts:326-333`) ; le
  code ne l'applique nulle part avant un `run_agents(mcp_server)` (aucune
  lecture de `mcp_agent_confirm` hors `mcp_config.rs:531` et
  `src/js/settings.js:1492`). Il n'aurait de toute façon pas empêché une
  création d'agent.
- **Pas la passerelle GDS, ni la file des missions, ni le halo de parole** :
  aucun de ces chemins n'intervient dans cet enchaînement.

---

## 5. Recommandation minimale (sans risque, dans l'ordre)

Décision du propriétaire rappelée : **brancher Présences** et **ne pas
multiplier les serveurs**.

1. **Consigne de l'assistant (le moins risqué, aucun code de mécanique)** —
   ajouter au prompt de l'assistant un texte très court, par exemple :
   > « Si la capacité demandée n'est pas disponible (serveur MCP non branché,
   > outil absent), tu ne remplaces JAMAIS la demande par une autre action
   > (créer un agent, changer de projet…) : tu dis à l'utilisateur, en une
   > phrase, quelle capacité manque. »
   Point d'écriture : `SUPER_AGENT_TOOLS_PROMPT` (`src-tauri/src/super_agent.rs:505`)
   ou un bloc de guidage à côté de `coordinator_guideline`
   (`super_agent.rs:602-636`). **Attention au budget** : le prompt fixe est
   plafonné à `SUPER_AGENT_FIXED_PROMPT_BUDGET = 6150` (`super_agent.rs:564`)
   — texte court obligatoire, et le test de budget existant doit passer.
2. **Message rendant le branchement visible (une ligne, une seule source)** —
   dans `mcp-client.src.ts`, après la découverte réussie (`:281`), appeler le
   `notifyUser` **déjà présent** (`mcp-client.src.ts:149-152`, livré au `session_start` `:153-156`) :
   « MCP : serveur « test » branché (1 outil) ; 2 autres serveurs activés ne
   sont pas branchés. » Aucun nouvel outil, aucun nouveau réglage, aucun
   changement de comportement : cela informe l'agent **et** l'utilisateur du
   serveur réellement retenu, et nomme les serveurs laissés de côté.
3. **Choix du serveur (côté configuration, pas de code)** — laisser **un seul**
   serveur activé : désactiver `test` et `context7`, garder `mcp-1` Presence.
   À défaut, rendre visible dans Paramètres → « Serveurs MCP » la règle
   aujourd'hui cachée dans une infobulle (`index.html:1477`) : « un seul
   serveur est branché par session : le premier activé de cette liste ».
4. **Nommer l'objet créé (une phrase, ciblée)** — au message système
   `src/js/super-agent.js:8346` (et au texte de retour
   `pilot-assistant-actions.ts:163`), préciser la nature : « … créé dans le
   **registre des agents de Pilot**. Ce n'est pas un élément d'un projet
   externe (personnage, fiche, tâche…). » Cela ne change aucune mécanique et
   donne à l'utilisateur le point de contrôle qui a manqué.

**Ce qui serait un lot séparé, hors de ce diagnostic** : remplacer « le premier
activé de la liste » par une **cible par défaut explicite** (un champ
« serveur par défaut » dans Paramètres, utilisé comme `PILOT_MCP_SERVER` de la
session de l'assistant) ; et, si l'on veut vraiment une garde, faire de
`create_agent` un vrai dialogue (une branche hors du sentinel
`PILOT_ASSISTANT_ACTION::`) au lieu d'un ordre d'exécution.

---

## 6. Vérifications faites / non faites

- **Fait** : lecture du code cité, lecture de `config.json`, `mcp.json` et
  d'une ligne de `pilot.db` (lecture seule, aucune écriture).
- **Non fait (volontairement)** : aucun test lancé (aucun code modifié), aucun
  commit, aucun changement de `mcp.json`, du registre des agents ni de la base
  de suivi.
