# Rapport — une sentinelle machine s'affichait telle quelle dans une demande de confirmation

Date : 2026-11-14
Symptôme rapporté (propriétaire, poste autre que celui de développement) :

> Une demande de confirmation s'affiche avec un texte technique brut
> (`PILOT_ASSISTANT_SCHEDULE::{"op":"list"}`), avec deux boutons « valider /
> annuler ». L'utilisateur ne comprend pas ce qu'on lui demande.

---

## 1. Diagnostic (écrit avant toute correction)

### 1.1 Où la sentinelle est émise

`PILOT_ASSISTANT_SCHEDULE::<JSON>` est émise par l'extension embarquée de
l'assistant, `src-tauri/extensions/pilot-assistant-schedule.ts` :

| Ligne | Outil | Requête |
|---|---|---|
| `pilot-assistant-schedule.ts:41` | — | `const SCHEDULE_SENTINEL = "PILOT_ASSISTANT_SCHEDULE::";` |
| `:84` | `schedule_create` | `PILOT_ASSISTANT_SCHEDULE::{"op":"create",…}` |
| `:105` | `schedule_list` | `PILOT_ASSISTANT_SCHEDULE::{"op":"list"}` ← **la chaîne observée** |
| `:129` | `schedule_set_enabled` | `PILOT_ASSISTANT_SCHEDULE::{"op":"set_enabled",…}` |
| `:152` | `schedule_delete` | `PILOT_ASSISTANT_SCHEDULE::{"op":"delete",…}` |

Le mécanisme (documenté en tête du fichier) : `ctx.ui.input(SENTINELLE + JSON,
"", …)` émet un `extension_ui_request` RPC dont le **titre** porte la sentinelle,
puis pi **bloque** jusqu'à ce que Pilot réponde. Ce n'est pas une question :
c'est un appel de fonction déguisé en dialogue.

### 1.2 Où elle est censée être interceptée

Une seule interception existe aujourd'hui, et elle ne couvre **que la session de
l'assistant lui-même** :

- `src/js/super-agent.js:8666` — `const SCHEDULE_SENTINEL = "PILOT_ASSISTANT_SCHEDULE::";`
- `src/js/super-agent.js:9771` — `if (title.startsWith(SCHEDULE_SENTINEL))` →
  `super_agent_schedule_create|list|delete|set_enabled`, puis réponse RPC.
- Entrée unique de ce chemin : `src/js/super-agent.js:8390`
  (`type === "extension_ui_request"` → `handleSuperAgentExtensionUiRequest`),
  alimentée par le canal `rpc-event-superagent` (`src-tauri/src/rpc_manager.rs`,
  session du super-agent lancée par `agent_service.rs:3374`
  `spawn_superagent_session`, extensions écrites ligne `:3406`).

Autrement dit : **l'interception est dans le gestionnaire d'événements du
super-agent, pas dans l'affichage.** Tout autre canal qui reçoit le même
`extension_ui_request` affiche le titre brut.

### 1.3 Hypothèses vérifiées

#### (a) « une extension assistant n'est pas chargée (ou pas à jour) sur ce poste » — ÉCARTÉE

- Les extensions sont **embarquées dans le binaire** (`include_str!`) et
  **réécrites à chaque démarrage de session** : `agent_service.rs:3181-3215`
  (`write_assistant_extensions`) et `:3399-3435` (`spawn_superagent_session`),
  via `crate::extension_write::write_embedded_batch` (`extension_write.rs`, qui
  compare le contenu, réécrit, et **n'expose jamais un fichier périmé**).
- Si les extensions n'étaient pas chargées, l'outil `schedule_list` n'existerait
  pas → **aucune sentinelle ne serait émise**. Une sentinelle qui s'affiche
  prouve au contraire que l'extension **est** chargée.
- Conclusion : la cause n'est pas « extension absente ou périmée » ; c'est
  « sentinelle émise **et** aucun intercepteur sur le chemin d'affichage ».

#### (b) « version installée plus ancienne que le code du dépôt » — ÉCARTÉE

- Émission et interception sont arrivées dans le **même commit** :
  `git log -S "SCHEDULE_SENTINEL" -- src/js/super-agent.js` et
  `git log -- src-tauri/extensions/pilot-assistant-schedule.ts` renvoient tous
  deux `96d7656 feat(super-agent): schedule tool (deferred + periodic reminders)`.
- Une version plus ancienne **n'a pas l'outil** : elle ne peut pas produire
  `PILOT_ASSISTANT_SCHEDULE`, et n'affiche donc jamais cette chaîne.
- Une version plus récente est la seule possible, et elle contient
  l'interception (voir 1.4 : le défaut existe **dans le code actuel**).

#### (c) « un chemin d'affichage générique qui transforme toute chaîne `PILOT_*` en question de confirmation » — RETENUE (cause principale)

Il n'existe **aucun transformateur générique** : au contraire, il existe des
**chemins d'affichage génériques qui ne reconnaissent rien** et affichent le
titre tel quel. Le chemin qui produit exactement le symptôme (deux boutons
« Valider / Annuler ») est le **relais des questions d'agents** :

1. `src/js/agents-bus.js:3075` — `handleExtensionUiRequest()` : toute demande
   `confirm` / `select` / `input` d'un agent est relayée ;
2. `src/js/agent-choice-relay.js:70-79` — `isRelayableAgentChoice()` répond
   **`true` pour toute méthode `input`**, sans aucune notion de sentinelle ;
3. `src/js/agents-bus.js:3129-3131` — événement `pilot-agent-relay-request` ;
4. `src/js/super-agent.js:11013` — `relayAgentChoiceRequest()` ;
5. `src/js/super-agent.js:11075` — branche `input` :
   `renderSuperAgentInput(…, payload.title, …)` → **titre brut** ;
6. `src/js/super-agent.js:11168-11185` — `renderInputPendingBar()` affiche
   `q.title` puis deux boutons **« ✓ Valider » / « Annuler »** ⇒ **le symptôme
   exact**.

**Pourquoi ce chemin est atteignable** : les agents lancés par l'assistant
(`run_assistant_agents`) tournent dans l'espace assistant et reçoivent la
**même liste d'extensions que l'assistant**, dont `pilot-assistant-schedule.ts` :
`agent_service.rs:3188` (`write_assistant_extensions` :3158, appelée par
`spawn_assistant_session` :3282, utilisée par `start_assistant_agent` :3003), et
`src/js/super-agent.js:9391` (`PILOT_ASSISTANT_RUN_ASSISTANT_AGENTS`) →
`runAgentsForAssistantAsync(…, {purge:true})` avec `project = ASSISTANT_SPACE`.
Leurs événements arrivent par le canal `rpc-event-agents`, donc dans
`agents-bus.js` — **jamais** dans `handleSuperAgentExtensionUiRequest`.

C'est ce qui explique « sur un autre poste » : le défaut est **déterministe mais
conditionnel au chemin pris**. Si l'assistant appelle `schedule_list` lui-même,
l'interception de `super-agent.js:9771` s'applique (rien ne s'affiche) ; si la
relance de rappels est confiée à un **agent d'assistant** (ou si un agent de
l'assistant utilise un outil de planification), la même sentinelle part au
relais et s'affiche brute. Le poste de développement n'a simplement jamais pris
ce chemin.

#### (d) « le canal web distant n'a pas l'interception » — ÉCARTÉE

- `grep -n "extension_ui\|ui_request\|question" src-tauri/src/web_server.rs`
  → **0 occurrence** : le serveur web ne transmet aucune demande d'interaction
  d'extension au navigateur.
- `web/js/chat.js` est un simple `export {};` (placeholder) et `web/js/app.js`
  ne traite aucun `extension_ui_request`.
- Le canal web distant **ne peut donc pas** afficher une sentinelle : il
  n'affiche aucune question d'extension. (La règle est néanmoins verrouillée par
  un test, pour qu'un futur affichage web ne puisse pas régresser.)

#### Facteur aggravant (retenu) — la même sentinelle fuit aussi dans le libellé d'alerte

`src/js/agent-choice-relay.js:84-101` (`agentQuestionLabel`) renvoie le titre
**brut**. `src/js/agents-bus.js:3136-3141` l'injecte dans le message
« ❓ L'agent … attend votre réponse : « … » ». La sentinelle s'affiche donc
**deux fois** : en question et en alerte.

#### Facteur aggravant (retenu) — aucun filet de sécurité à l'affichage

Aucune fonction ne vérifie, au moment de peindre, que le texte contient une
sentinelle machine : `super-agent.js:11223` (`renderSuperAgentConfirm`),
`11246` (`renderSuperAgentInput`), `11197` (`renderSuperAgentChoice`),
`9942` (repli `input` de la session assistant), et côté onglet chat
`agent-pi.js:8976` (`input` → `renderInlineInput`), `9008`, `9100`.
Une sentinelle **inconnue** de la chaîne d'interception (famille
`PILOT_ASSISTANT_*` : outils de suivi, base de suivi, sessions, MCP, mémoire,
Git, Telegram, documentation, file…) atteint donc toujours l'écran.

### 1.4 Conclusion du diagnostic

Le défaut n'est pas une question mal formulée : c'est **un appel de fonction
interne qui, sur un chemin d'affichage générique, perd son intercepteur et
devient une question**. Trois manques, tous dans l'affichage :

1. le relais des questions d'agents ne connaît pas les sentinelles ;
2. le libellé d'alerte les recopie ;
3. aucune fonction d'affichage ne refuse de peindre une sentinelle.

---

## 2. Correction

### 2.1 Un module unique, appliqué au moment de PEINDRE

Nouveau module **`src/js/machine-sentinel.js`** (pur : aucun DOM, aucune I/O) —
source unique de la règle :

| Fonction | Rôle |
|---|---|
| `hasMachineSentinel` / `machineSentinelOf` | reconnaître `PILOT_<FAMILLE>::<charge>` |
| `isAssistantSentinel` | la demande appartient à la famille de l'assistant |
| `scheduleRequestFrom` / `scheduleSentence` | lire une demande de planification et la dire en français |
| `isSelfAnsweredMachineRequest` | action interne **exécutée** par le relais (aucune réponse attendue) |
| `readableMachineText` | **filet** : famille connue → phrase française ; famille inconnue → formulation neutre ; **texte sans sentinelle → inchangé** |
| `readableQuestion` | nettoie le couple titre + message d'une demande |

Les phrases (aucune ne contient d'identifiant machine ni de JSON) :

- `list` → « Je vais relever la liste de mes rappels programmés. Je continue ? »
- `create` → « Je vais programmer un nouveau rappel qui reviendra dans notre
  conversation. Je continue ? »
- `delete` → « Je vais supprimer un rappel programmé. Je continue ? »
- `set_enabled` → « Je vais suspendre ou réactiver un rappel programmé. Je
  continue ? »
- famille inconnue → « Pilot a besoin de votre accord pour continuer une action
  interne. Je continue ? »

### 2.2 Réponse aux trois exigences

**(a) une sentinelle n'est jamais affichée brute** — le filet est appliqué dans
tous les rendus : `super-agent.js` `renderSuperAgentChoice` / `…Confirm` /
`…Input`, **et** les trois barres de `#pendingBar` (`renderChoicePendingBar`,
`renderConfirmPendingBar`, `renderInputPendingBar`, c'est-à-dire le point exact
du symptôme) ; `agent-pi.js` `renderInlineChoice` / `…Confirm` / `…Input` ;
`agent-choice-relay.js` `agentQuestionLabel` (libellé d'alerte).

**(b) si une confirmation est nécessaire, elle est en français clair** — c'est
ce que produisent les phrases ci-dessus : pas de JSON, pas d'identifiant, une
question compréhensible, et les boutons gardent leur rôle.

**(c) si aucune confirmation n'est nécessaire, l'action s'exécute** — la
planification ne demande rien : `runSuperAgentScheduleOp` est le **point unique
d'exécution** (extrait de `handleSuperAgentExtensionUiRequest`), appelé par
**deux** chemins : la session de l'assistant (comportement inchangé) et le
**relais** (`relayAgentChoiceRequest`), qui exécute puis répond à la bonne
session agent — sans jamais créer de widget. Le message d'attente du bus devient
honnête : « … elle est exécutée automatiquement, aucune réponse de votre part
n'est attendue. »

**(d) filet de sécurité générique** — `readableMachineText` remplace **toute**
sentinelle non reconnue par une formulation neutre (jamais de silence, jamais de
texte machine, jamais de fausse promesse). Une autre sentinelle de la famille
assistant reçue par le relais reçoit de plus une réponse explicite en français
(« … doit être demandée dans la conversation de l'assistant … Rien n'a été
modifié. »), donc aucune erreur cachée.

### 2.3 Ce qui n'a PAS été touché

- Aucune confirmation supprimée : le widget Oui/Non, le choix et la saisie libre
  restent disponibles et fonctionnent comme avant pour les **vraies** questions.
- Aucune réponse décidée à la place de l'utilisateur pour une question réelle.
- Aucun fichier de l'**écran Vocal** modifié (les trois correctifs en attente
  d'essai sont intacts).
- `group-assistant.js` n'a pas été modifié : il ne peint jamais une sentinelle
  (sentinelle inconnue ⇒ réponse d'erreur explicite).

---

## 3. Tests (échouent si la règle régresse)

`src/js/sentinelle-jamais-affichee-brute.test.js` — **18 tests**, règle protégée
nommée dans l'en-tête du fichier. Contrôle négatif effectué : en neutralisant le
filet et en retirant une garde de rendu, **10 tests sur 18** passent au rouge.

| Test | Ce qu'il protège |
|---|---|
| « la chaîne observée devient une phrase française » | `PILOT_ASSISTANT_SCHEDULE::{"op":"list"}` ⇒ phrase exacte, **aucun** `::`, `{`, `"` |
| « chaque opération … a sa phrase » | les 4 opérations, 4 phrases distinctes |
| « famille INCONNUE ne fuit jamais » | formulation neutre, aucune fausse promesse |
| « texte légitime jamais réécrit » | le relais des questions réelles n'est pas altéré |
| « texte AVANT la sentinelle conservé » | rien n'est perdu de ce que l'agent disait |
| « sentinelle de PRÉSENTATION » | `PILOT_CONFIRM::` garde la question de l'auteur |
| `readableQuestion` | titre **et** message nettoyés |
| libellé d'alerte | le message « l'agent attend votre réponse » ne recopie plus la sentinelle |
| action interne | aucune réponse réclamée à tort (message honnête) |
| rendus de l'Assistant | `render*` + les 3 barres de `#pendingBar` appliquent le filet |
| relais | la planification est **exécutée avant** tout rendu |
| point unique | `runSuperAgentScheduleOp` existe et sert les **deux** canaux |
| onglet chat | `renderInline*` appliquent le filet |
| garde structurelle | **toute** nouvelle fonction `render*Choice/Confirm/Input` sans filet fait échouer le test |
| **canal web distant** | si `web/` ou `web_server.rs` se dote d'un affichage de question d'extension, il **doit** passer par `machine-sentinel.js` ; aujourd'hui il n'en affiche aucune |
| **canal web distant** | aucune copie locale de la règle dans `web/js/` |

Les découpages de source utilisent `sliceSource` (`source-slice.js`, 3ᵉ audit,
point 4) : une ancre absente **échoue** au lieu de rendre l'assertion vraie par
construction.

---

## 4. Vérifications et livraison

| Suite | Résultat |
|---|---|
| `npm test` (Vitest) | **269 fichiers**, **4 997 tests** — tous verts |
| `cargo test --workspace` | **991 tests** verts, 12 ignorés (6 suites) |
| `npm run build:handbook` | handbook régénéré (47 blocs) |

Documentation mise à jour : `spec_super_agent.md` (§ « Une action interne ne
devient jamais une question technique », bloc d'aide utilisateur),
`AGENTS.md` (arborescence : `src/js/machine-sentinel.js`), `help/handbook.md`
(généré).

Aucune publication, aucun bump de version, aucun tag : hors périmètre de la
demande.
