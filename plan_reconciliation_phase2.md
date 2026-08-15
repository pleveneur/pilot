# Plan de réconciliation — Phase 2 : AgentService propriétaire unique des sessions

> **Objectif** : faire converger tous les « homes » de sessions RPC éparpillés dans
> `AppState` vers un **AgentService unique** (cahier §3.2, §4.4), sans casser le
> démarrage, l'arrêt, la délégation inter-agents ni le multi-projets en cours de route.
>
> **Portée** : document de plan uniquement. Aucun fichier de code n'est modifié ici.

---

## 1. Cartographie de l'état actuel

### 1.1 Homes de sessions dans `AppState` (`src-tauri/src/lib.rs`)

| # | Champ | Type | Ligne | Rôle | Géré par |
|---|-------|------|-------|------|----------|
| 1 | `rpc_state` | `Mutex<Option<RpcSession>>` | `lib.rs:109` | Session **active affichée** (chat Agent Pi / onglet π) | `rpc.rs` |
| 2 | `active_agent_id` | `Mutex<Option<String>>` | `lib.rs:113` | Id de l'agent actif dans `rpc_state` (`"default"` ou `"agent-N"`) | `rpc.rs` |
| 3 | `rpc_reviewer` | `Mutex<Option<RpcSession>>` | `lib.rs:116` | Reviewer orchestration **H2 V1** (`pi --no-session`, canal séparé) | `rpc.rs` |
| 4 | `projects[*].rpc` | `HashMap<String, RpcSession>` (dans `ProjectState`) | `lib.rs:86-88` | Sessions **parkées** par projet/agent (multi-projets + multi-onglets) | `rpc.rs` |
| 5 | `agent_sessions` | `Mutex<HashMap<String, RpcSession>>` | `lib.rs:119` | Agents multi-rôles **H2 V2** (canal `rpc-event-agents`) | `agents.rs` |
| 6 | `rpc_superagent` | `Mutex<Option<RpcSession>>` | `lib.rs:149` | Session **Assistant** (onglet 🧭, canal `rpc-event-superagent`) | `super_agent.rs` |

### 1.2 Fonctions de pilotage (backend)

| Fonction | Fichier:ligne | Rôle |
|----------|---------------|------|
| `do_start_agent_session` | `rpc.rs:270` | Démarre/reprend la session active (reprise depuis `projects[*].rpc`) |
| `do_park_agent_session` | `rpc.rs:446` | Parke la session active dans `projects[active].rpc[agent_id]` (processus vivant) |
| `do_stop_agent_session` | `rpc.rs:481` | Arrête la session active ou une session parkée + reviewer |
| `do_shutdown_all_sessions` | `rpc.rs:538` | Arrêt complet (issue #14) : `rpc_state` + `rpc_reviewer` + `projects[*].rpc` + `agent_sessions` + `rpc_superagent` |
| `send_agent_command_to` | `rpc.rs:592` | Route une commande vers la bonne session (active → parkée → `agent_sessions`) |
| `do_send_agent_prompt` | `rpc.rs:706` | Prompt vers la session active |
| `do_get_agent_state` / `do_get_session_stats` | `rpc.rs:636` / `655` | État/stats de la session active |
| `do_start_agent_process` | `agents.rs:139` | Démarre un agent multi-rôles (H2 V2) dans `agent_sessions` |
| `do_stop_agent_process` | `agents.rs:162` | Arrête un agent multi-rôles |
| `do_stop_all_agent_processes` | `agents.rs:175` | Arrête tous les agents multi-rôles |
| `do_send_agent_process_prompt` | `agents.rs:188` | Prompt vers un agent multi-rôles |
| `do_new_agent_process_session` | `agents.rs:202` | `new_session` vers un agent multi-rôles |
| `do_set_agent_process_model` | `agents.rs:216` | `set_model` vers un agent multi-rôles |
| `do_abort_agent_process` | `agents.rs:235` | `abort` vers un agent multi-rôles |
| `do_send_agent_process_command` | `agents.rs:249` | Commande arbitraire (ex: `extension_ui_response`) |
| `do_get_agent_process_state` | `agents.rs:262` | État d'un agent multi-rôles |
| `do_compact_agent_context` | `agents.rs:380` | Compaction (utilise `rpc_state`) |
| `do_start_super_agent_session` / `stop_super_agent_session` | `super_agent.rs:221` / `226` | Cycle de vie de la session Assistant |

### 1.3 Frontend

| Module | Rôle | Commandes utilisées |
|--------|------|--------------------|
| `src/js/agent-pi.js` | Chat Agent Pi (session active) | `start_agent_session`, `stop_agent_session`, `send_agent_command_to` |
| `src/js/tabs.js` | Multi-onglets agents | `park_agent_session`, `start_agent_session`, `stop_agent_session`, `stop_all_agent_processes` |
| `src/js/sidebar.js` | Bascule de projet | `park_agent_session`, `stop_agent_session`, `start_agent_session` |
| `src/js/super-agent.js` | Assistant (relais choix) | `send_agent_command_to`, `stop_agent_session` |
| `src/js/agents-bus.js` | **Bus d'exécution inter-agents (H2 V2)** : ordonnanceur séquentiel + parallèle, parsing `[[CALL]]`/`[[PARALLEL]]`, garde-fous, buffers par agent | `start_agent_process`, `send_agent_process_prompt`, `new_agent_process_session`, `set_agent_process_model`, `abort_agent_process`, `stop_all_agent_processes` |

### 1.4 AgentService actuel (`src-tauri/src/agent_service.rs`)

- **Phase 1 (fait)** : registre persistant (table `agents`) — `list_agents`, `get_agent`, `upsert_agent`, `replace_agents`, `set_visible`, `set_state`.
- **Phase 2 (stubs)** : `start`, `pause`, `stop`, `send` retournent `Err("non implémenté (Phase 2)")`.
- Commentaire d'intention : `// Phase 2 : sessions: Mutex<HashMap<String, RpcSession>>` et « propriétaire unique des sessions RPC (start/pause/stop/send/session_of) ».

---

## 2. Cible : AgentService unique propriétaire des sessions

Conformément au cahier §3.2 (une session par agent, contextes séparés) et §4.4
(protocole d'appel inter-agents), l'AgentService devient **la seule source de
vérité des sessions RPC** :

```rust
pub struct AgentService {
    // Phase 1 (existant)
    // Phase 2 (cible)
    sessions: Mutex<HashMap<String, RpcSession>>,   // indexé par agent_id
    active:   Mutex<Option<String>>,                 // agent_id actuellement affiché
    // + association projet par session (voir §3, conflit n°2)
}
```

Méthodes cibles (remplacent les stubs) :

| Méthode | Rôle | Remplace |
|---------|------|----------|
| `start(app, agent_id)` | Démarre/reprend la session d'un agent | `do_start_agent_session` + `do_start_agent_process` |
| `pause(app, agent_id)` | Parke la session (état Paused, processus vivant) | `do_park_agent_session` |
| `stop(app, agent_id)` | Arrête la session (état Stopped) | `do_stop_agent_session` + `do_stop_agent_process` |
| `send(app, agent_id, command)` | Route une commande (une seule indirection) | `send_agent_command_to` + `do_send_agent_process_*` |
| `session_of(app, agent_id)` | Accès à la session (lecture) | accès directs aux maps |
| `shutdown_all(app)` | Arrêt complet (issue #14) | `do_shutdown_all_sessions` |

Les commandes Tauri exposées au frontend **gardent leurs signatures actuelles**
(`start_agent_session`, `park_agent_session`, `stop_agent_session`,
`start_agent_process`, `send_agent_process_prompt`, …) : seul le **stockage
sous-jacent** change. Le frontend n'est pas modifié dans sa logique d'appel.

---

## 3. Décision par élément

### 3.1 `rpc_state` + `active_agent_id` — **REFACTORER**

- **Décision** : fusionner dans l'AgentService. `rpc_state` devient la session de
  l'agent actif ; `active_agent_id` devient le pointeur `active` du service.
- **Justification** : c'est le cœur du cahier §4.4. Le chat Agent Pi (agent-pi.js)
  ne change pas : il continue d'appeler `start_agent_session`/`stop_agent_session`,
  qui délèguent à `AgentService.start/stop`.
- **Risque** : le chat suppose **une seule session active**. Le service doit
  conserver la notion d'« agent actif » comme pointeur, pas comme map séparée.

### 3.2 `rpc_reviewer` (H2 V1 orchestration) — **SUPPRIMER (fusionner)**

- **Décision** : migrer dans l'AgentService sous un id d'agent dédié (ex: `reviewer`).
- **Justification** : H2 V2 a déjà généralisé le reviewer en `agent_sessions`. Le
  reviewer d'orchestration (spec_orchestration_reviewer.md) est un cas particulier
  d'agent `readonly` avec son propre canal. Le stockage unique ne change pas sa
  sémantique de cycle de vie (lié à la session principale).
- **Conflit franc** : collision de nommage — le reviewer H2 V1 (orchestration) et
  l'agent `reviewer` H2 V2 (multi-rôles) sont **deux entités distinctes**. Il faut
  des ids distincts (ex: `reviewer` pour H2 V2, `orch-reviewer` pour H2 V1) pour
  éviter qu'une session écrase l'autre dans la map unique.

### 3.3 `projects[*].rpc` (sessions parkées) — **REFACTORER**

- **Décision** : le parking devient un **état** géré par l'AgentService (actif vs
  parké), avec association projet portée par la session.
- **Justification** : le parking est la mécanique multi-projets/multi-onglets. Il
  doit survivre dans le service pour que la bascule de projet continue de
  reprendre les processus vivants.
- **Conflit franc (le plus structurant)** : l'AgentService tel que conçu est
  indexé **par `agent_id` seul**, mais les sessions parkées sont indexées par
  **(projet, agent)**. Deux projets peuvent avoir chacun un agent `codeur`. Il faut
  soit (a) une clé composite `(project_path, agent_id)`, soit (b) conserver la
  dimension projet dans le service. **Recommandation : clé composite** — c'est la
  seule façon de préserver le multi-projets sans fuite de session.

### 3.4 `agent_sessions` (H2 V2) — **REFACTORER (cœur)**

- **Décision** : c'est le **noyau naturel** de l'AgentService. La map
  `agent_sessions` devient le registre de sessions du service.
- **Justification** : les commandes `agents.rs` (`start_agent_process`, …) sont
  déjà indexées par `agent_id` et utilisent le canal `rpc-event-agents`. Leur
  migration est la plus directe.

### 3.5 `rpc_superagent` (Assistant) — **REFACTORER**

- **Décision** : migrer dans l'AgentService sous un id dédié (ex: `superagent`).
- **Justification** : c'est une session RPC comme les autres.
- **Conflit franc** : l'Assistant a un **canal dédié** (`rpc-event-superagent`),
  une base SQLite propre et des extensions spécifiques. La migration doit
  préserver l'isolation du canal et le `--no-session` + modèle par défaut. Ne pas
  le confondre avec un agent multi-rôles.

### 3.6 `agents-bus.js` — **REFACTORER (transport uniquement)**

- **Décision** : la logique d'orchestration (pile, parsing `[[CALL]]`/`[[PARALLEL]]`,
  garde-fous, buffers) **reste en JS**. Seul le transport change : les commandes
  `agents.rs` deviennent des appels à l'AgentService.
- **Justification** : le bus est un ordonnanceur frontend ; il n'a pas besoin de
  savoir où vivent les sessions, seulement de pouvoir les démarrer/arrêter/envoyer.

### 3.7 `park_agent_session` — **REFACTORER**

- **Décision** : devient `AgentService.pause`. La commande Tauri garde son nom et
  sa signature pour ne pas casser `tabs.js`/`sidebar.js`.

### 3.8 `send_agent_command_to` — **REFACTORER**

- **Décision** : devient `AgentService.send` (une seule indirection). Le routage en
  3 étapes (active → parkée → `agent_sessions`) s'effondre en **une seule
  consultation** de la map du service.

### 3.9 Questions spécifiques

**`[[CALL:agent_id]]` du coordinateur H2 V2 — compatible ?**
- **OUI, compatible.** C'est un **protocole texte frontend** parsé par
  `agents-bus.js` (`parseCallMarker`). Il est orthogonal à l'endroit où vivent les
  sessions. Tant que l'AgentService fournit `start`/`send` par `agent_id`, le
  protocole fonctionne inchangé. **GARDER le protocole, refactorer le transport.**

**Mode parallèle de `spec_gestion_agents.md` — compatible ?**
- **OUI, compatible.** `dispatchParallel`/`startParallelRun`/`runAgentsForAssistant`
  sont de l'orchestration frontend. L'AgentService étant une `HashMap`, il peut
  tenir **plusieurs sessions simultanées** (une par agent parallèle). Aucun conflit
  structurel. **GARDER le mode parallèle.**

**Conflits à assumer franchement :**
1. **Dimension projet** : l'AgentService indexé par `agent_id` seul ne suffit pas
   pour le multi-projets → clé composite `(project, agent)`.
2. **Collision `reviewer`** : H2 V1 (orchestration) vs H2 V2 (multi-rôles) → ids
   distincts.
3. **Canal superagent** : isolation à préserver lors de la fusion.
4. **Notion d'« actif »** : le chat suppose une session active unique → pointeur
   `active` dans le service, pas une map séparée.

---

## 4. Plan d'attaque ordonné (migration par sous-étapes)

Chaque sous-étape est **indépendamment non-cassante** : à la fin de chacune, le
démarrage, l'arrêt et la délégation fonctionnent toujours.

### Étape 0 — Préparation (aucun comportement changé)
- Ajouter au `AgentService` le registre de sessions (`Mutex<HashMap<String, RpcSession>>`),
  le pointeur `active` et l'association projet (clé composite).
- Implémenter réellement `start`/`pause`/`stop`/`send`/`session_of`/`shutdown_all`
  en **lisant/écrivant le nouveau registre**, mais **sans encore déplacer les
  homes existants** (double écriture temporaire ou lecture seule).
- **Vérif** : `cargo test --lib` + build OK ; aucune commande Tauri modifiée.

### Étape 1 — Migrer `agent_sessions` (H2 V2) en premier
- Le plus autonome. Les commandes `agents.rs` (`do_start_agent_process`, …)
  délèguent à `AgentService.start/send/stop` au lieu de toucher `agent_sessions`.
- **Vérif** : une run 🎭 Agents séquentielle (`[[CALL]]`) et parallèle
  (`[[PARALLEL]]` + mode utilisateur) fonctionne ; `stop_all_agent_processes` arrête
  tout.

### Étape 2 — Migrer `rpc_reviewer` (H2 V1 orchestration)
- Créer une session `orch-reviewer` dans le service ; `do_stop_agent_session`
  arrête cette session via le service.
- **Vérif** : une review d'orchestration (spec_orchestration_reviewer.md) se
  lance et se termine ; le reviewer est arrêté avec la session principale.

### Étape 3 — Migrer `rpc_state` + `active_agent_id` (chat principal)
- **Étape la plus risquée** (agent-pi.js, tabs.js, sidebar.js).
- `do_start_agent_session`/`do_park_agent_session`/`do_stop_agent_session`
  délèguent à `AgentService.start/pause/stop`. Les signatures Tauri restent
  identiques → **aucun changement frontend**.
- **Vérif** : ouvrir/fermer le chat Agent Pi, basculer d'onglet agent, basculer de
  projet — la session est reprise (processus vivant) et non relancée.

### Étape 4 — Migrer le parking `projects[*].rpc`
- Le parking devient un état du service (clé composite `(project, agent)`).
- `do_park_agent_session` → `AgentService.pause` ; la reprise lit le registre.
- **Vérif** : multi-projets — basculer A→B→A reprend les sessions parkées de A ;
  aucun processus orphelin.

### Étape 5 — Migrer `rpc_superagent`
- Session `superagent` dans le service, canal `rpc-event-superagent` préservé.
- **Vérif** : l'onglet 🧭 Assistant démarre, répond, s'arrête ; le relais des choix
  (`send_agent_command_to`) route vers le bon agent.

### Étape 6 — Effondrer `send_agent_command_to` en `AgentService.send`
- Le routage en 3 étapes devient une consultation unique.
- **Vérif** : un bouton de question rendu dans l'assistant répond au bon agent
  (multi-agents en attente).

### Étape 7 — Nettoyage
- Retirer les champs `rpc_state`, `active_agent_id`, `rpc_reviewer`,
  `agent_sessions`, `rpc_superagent` et `projects[*].rpc` de `AppState`.
- `do_shutdown_all_sessions` → `AgentService.shutdown_all` (issue #14).
- **Vérif** : fermeture de l'app → aucun processus `pi`/`plh` résiduel.

### Étape 8 — Documentation
- Mettre à jour `spec_gestion_agents.md`, `spec_rpc.md`,
  `spec_orchestration_reviewer.md`, `spec_super_agent.md`, `AGENTS.md` (arborescence
  + navigation) et le bloc `<!-- HELP:* -->` concerné, puis relancer
  `npm run build:handbook`.

---

## 5. Critères de non-régression (scénarios à valider après Phase 2)

| # | Scénario | Doit toujours marcher |
|---|----------|-----------------------|
| 1 | **Démarrage** : ouvrir un projet, lancer le chat Agent Pi, envoyer un prompt, recevoir le streaming | ✅ |
| 2 | **Arrêt** : `stop_agent_session` arrête la session active ; fermeture de l'app ne laisse aucun processus résiduel (issue #14) | ✅ |
| 3 | **Multi-onglets agents** : basculer entre onglets parke/reprend la session (processus vivant, pas de relance) | ✅ |
| 4 | **Multi-projets** : basculer A→B→A reprend les sessions parkées de A ; pas de fuite de session | ✅ |
| 5 | **Reviewer orchestration (H2 V1)** : se lance, relit, se termine, arrêté avec la session principale | ✅ |
| 6 | **Agents multi-rôles (H2 V2) séquentiel** : coordinateur délègue via `[[CALL:agent_id]]`, résultats renvoyés à l'appelant | ✅ |
| 7 | **Agents multi-rôles parallèle** : `[[PARALLEL]]` + mode utilisateur ⚡ + `runAgentsForAssistant` | ✅ |
| 8 | **Garde-fous** : profondeur max, budget total/par agent, détection de cycle, timeout d'inactivité, `stopAgentsRun` abort tous les agents actifs | ✅ |
| 9 | **Relais des choix** : `send_agent_command_to` route la réponse vers le bon agent (multi-agents en attente) | ✅ |
| 10 | **Assistant (🧭)** : session dédiée démarre/répond/s'arrête ; canal `rpc-event-superagent` isolé | ✅ |
| 11 | **Accès distant web** : les prompts distants routent vers la bonne session (web_server.rs) | ✅ |
| 12 | **Compaction** : `do_compact_agent_context` fonctionne sur la session active | ✅ |
| 13 | **Registre (Phase 1)** : `list_agents`/`upsert_agent`/`replace_agents`/`set_visible`/`set_state` inchangés | ✅ |

---

*Document de plan — aucune modification de code effectuée.*
