# Rapport — visibilité des agents qui travaillent sans onglet (tâche 364)

## 1. Symptôme

Un agent lancé en arrière-plan par `run_agents` (aucun onglet ouvert, `visible = false`)
n'apparaissait pas dans la liste d'activité du cercle `#agent-activity-dot`
(`src/js/agent-activity.js` → `flattenAgents`) dès qu'il était **au repos entre deux
tours** (`state: "idle"`). L'utilisateur ne pouvait donc ni le voir, ni le suivre, ni
rouvrir son onglet, alors que son processus `pi` était bel et bien vivant.

## 2. Cause tranchée (vérifiée par lecture, diagnostic déjà posé)

**Côté frontend (cause du symptôme, déjà corrigée par le commit `64d41ac`)** :
le filtre de `flattenAgents` excluait tout agent `visible === false` non `busy`
**sans regarder `alive`** :

```js
if (!isSuper && !isAssistant && a.visible === false && !busy) continue; // ancien filtre
```

→ un agent vivant mais idle sans onglet était écarté.
Correctif en place : `src/js/agent-activity.js` L96-99 (filtre assoupli, l'agent n'est
écarté que si `a.alive` est faux).

**Côté Rust : RIEN à corriger — vérifié, la donnée est complète.** Chaîne vérifiée :

| Point | Fichier:ligne | Constat |
|---|---|---|
| Toute session enregistrée est listée | `src-tauri/src/agent_service.rs:3308` (`collect_session_states`) | itère `sessions` quel que soit `state` (`Active` **et** `Parked`) et `mode` (`main` / `agent_process` / `assistant_agent`) → une session sans onglet est listée |
| Vivacité réelle | `agent_service.rs:3318-3323` | `alive = entry.session.child.try_wait().map(\|s\| s.is_none())` → `true` pour un agent `run_agents` vivant |
| Exposition des champs | `agent_service.rs:1747` (`list_agent_sessions`) | expose `project`, `agent`, `mode`, `state`, `alive`, `visible`, `active`, `prompt`, `busy`, `toolInProgress`, `isWorking`, `sessionId` |
| `toolInProgress` alimenté pour les agents délégués | `agent_service.rs:3001-3007` (`spawn_agent_process`) → `anomaly::make_observer(..., clé "project\u{1f}agent")` | l'observateur d'anomalie est branché sur le canal `rpc-event-agents` pour **tous** les modes d'agent ; `anomaly.rs:312-315` pose `tool_in_progress` sur `tool_execution_start` et le lève sur `tool_execution_end` |
| Supervision | `src-tauri/src/dashboard.rs:1259-1341` (`get_agent_supervision`) | part de `list_agent_sessions`, ne filtre AUCUNE session invisible/sans onglet, transmet `state/alive/visible/active/prompt/toolInProgress` tel quel |

→ **Aucune modification Rust n'a été nécessaire** (changement évité, seuils intacts).

## 3. Le vrai défaut restant : le verrou de test était incomplet

Dans `src/js/agent-activity.test.js`, le cas « agent de projet sans onglet au repos »
utilisait une fixture **sans `alive`** (donc falsy) : il validait l'**exclusion**, pas la
règle 6. Aucun test ne couvrait `{ alive: true, visible: false, state: "idle" }`, ni la
propagation de `toolInProgress` pour un agent invisible.

## 4. Correctif livré

Unique fichier modifié : `src/js/agent-activity.test.js` (+89 lignes, ajout seul, aucun
test existant touché). Nouveau bloc `describe("flattenAgents — règle 6 : tout agent
VIVANT reste listé (même sans onglet)")` :

| Test | Ce qui est verrouillé |
|---|---|
| (a) `{ alive: true, visible: false, state: "idle" }` | reste listé (agent vivant sans onglet), `busy: false`, `anyBusy === false` |
| (b) `{ alive: false, visible: false }` | reste exclu (pas de faux positif d'agent terminé) |
| (c) `{ alive: true, visible: false, state: "running", toolInProgress: true, prompt }` | listé, `busy: true`, `toolInProgress` **propagé**, `prompt` propagé, `anyBusy === true`, mission visible via `buildRunningMissions` |
| (c bis) `{ alive: true, visible: false, busy: false, toolInProgress: true }` | outil long silencieux (build/tests) : listé et suivi même sans `busy` |
| (d) espace `__assistant__` (`alive: true` **et** `alive: false`) | jamais filtré, `kind: "assistant"`, `projectPath: "__assistant__"` |

## 5. Preuve d'échec du verrou (test de la règle 6)

Ancien filtre rétabli temporairement dans `src/js/agent-activity.js`
(`if (!isSuper && !isAssistant && a.visible === false && !busy) continue;`), puis
`npx vitest run src/js/agent-activity.test.js` :

```
numTotal 64  passed 58  failed 6   (exit 1)
failed | garde un agent délégué VIVANT au repos (agent_process, visible=false) …
failed | garde aussi les agents d'assistant délégués vivants (assistant_agent, visible=false)
failed | garde un agent de mode main VIVANT sans onglet, même au repos …
failed | (a) garde un agent de projet VIVANT sans onglet au repos ({ alive: true, visible: false, state: 'idle' })
failed | (c bis) un outil long et silencieux (busy=false, toolInProgress=true) reste listé et visible
failed | liste DÉPLOYÉE : un agent délégué qui démarre ensuite apparaît automatiquement …
```

Filtre correct restauré → `agent-activity.js` est **byte-identique** à l'état committé
(`git diff --stat` ne montre que le fichier de test) et les 64 tests repassent.

## 6. Vérifications

- `npx vitest run src/js/agent-activity.test.js` : **64/64 passés** (dont les 5 nouveaux).
- `npm test` (suite complète) : **111 fichiers / 1923 tests passés**, exit 0.
- Aucun fichier Rust, aucun fichier de production modifié ; aucun push, aucun tag, aucune
  compilation release.
