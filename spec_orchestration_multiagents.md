# Spécification — Orchestration multi-agents projets

> **Statut** : Phase 0 implémentée (T1-T5) · **Module** : super-agent (onglet 🧭) + bus d'agents
> (`agents-bus.js`) + `AgentService` (Rust)
>
> Cette spec formalise l'orchestration **multi-agents parallèles** que l'assistant
> de suivi multi-projets (le super-agent) pilote sur un ou plusieurs projets. Elle
> vient en complément de `spec_super_agent.md` (délégation) et de
> `spec_gestion_agents.md` (agents multi-rôles H2 V2).
>
> ---
>
> ## Phase 0 — Fondations (implémentée)
>
> - **T1 — Classification codeur/spécialiste + prompt enrichi** : `classifyAgent(agent)`
>   (`src/js/agents.js`) → `{ isCoder, isReadonly, capabilities }` (codeur si
>   `capabilities` contient `write`/`edit` ET `readonly=false`). `buildAgentPrompt`
>   injecte désormais un bloc `SPÉCIALITÉ` (role + capabilities) et un bloc `RÔLE`
>   (codeur = peut modifier les fichiers / spécialiste = lecture seule sur les
>   fichiers réservés au codeur). Le prompt reste complet et autonome.
> - **T2 — Dossier de session isolé `.pilot/sessions/`** : dossier créé à
>   l'indexation (`session_history.rs`). Les fichiers de session pi restent isolés
>   par agent (sous-dossiers existants) et l'index H9 `.pilot/sessions.jsonl` est
>   inchangé (recherche `search_sessions` intacte).
> - **T3 — Porte pré-écriture `pilot-reserve-gate.ts`** : extension pi chargée pour
>   les agents spécifiques (`spawn_agent_process`). Lit `.pilot/reservations.json`
>   (`{ coder, files }`), bloque automatiquement (sans confirmation) les `write`/`edit`
>   sur les fichiers réservés pour les non-codeurs, avec message d'orientation. Le
>   codeur n'est jamais bloqué (identité via `PILOT_AGENT_ID`). Fail-open sur erreur.
- **T4 — Exclusivité des spécialités par projet** : un seul agent de chaque
  spécialité (`agent_id`) peut tourner à la fois sur un même projet. Deux garde-fous :
  (1) **Rust** — `AgentService::start` refuse (`SpawnMode::AgentProcess`) un second
  agent déjà vivant pour `(project, agent_id)` via `agent_process_alive` (invariant
  garanti en cas de course ; la session principale `MainSession` n'est pas comptée) ;
  (2) **Frontend** — `agents-bus.js` (`dispatchParallel`) détecte un agent déjà actif
  sur le projet (`isAgentActiveOnProject`, état local + `list_agent_sessions`) et met
  la demande en attente au lieu de la lancer en double.
- **T5 — File d'attente en cas de conflit** : en cas de conflit d'exclusivité, la
  demande est mise en file d'attente par clé `project\u{1f}agent_id`
  (`exclusivity-queue.js`, fonctions pures testées). Quand le créneau se libère
  (`finishAgentTurn`/`failAgentTurn`), `launchNextQueued` relance réellement la
  demande en attente (elle reste dans le groupe parallèle courant, `pending` conservé
  → la run ne se termine pas avant son exécution). L'assistant est notifié de la mise
  en attente (⏳) et du démarrage effectif (▶️) via le callback de notification
  (`setBusNotifyCallback`, `super-agent.js`) et son prompt système l'enjoint de ne
  pas relancer une demande mise en attente.
>
> **Hors périmètre Phase 0** : estimation (T6), notification (T7), visibilité,
> streaming des réflexions.
>
> ---

## 1. Objectif

Aujourd'hui, l'assistant peut lancer des agents via `run_agents`, mais chaque
lancement est un cas ponctuel : aucune notion formelle d'orchestration parallèle,
de spécialité exclusive par projet, de hiérarchie codeur/spécialistes, ni de
protection anti-conflit sur les fichiers.

L'objectif est de faire de l'assistant un **orchestrateur multi-agents** capable
de :

- lancer **plusieurs agents en parallèle**, sur un même projet ou des projets
  différents, en toute indépendance ;
- respecter **l'exclusivité des spécialités par projet** (un seul agent de chaque
  spécialité par projet à la fois) ;
- garantir la **primauté du codeur** (agent principal du projet) sur les fichiers
  de code, les autres spécialistes restant en lecture seule ;
- éviter les **conflits d'écriture** grâce à une **estimation préalable** des
  fichiers réservés au codeur ;
- notifier l'assistant **par événement de fin** (au lieu d'un polling), pour qu'il
  informe l'utilisateur et consigne dans son suivi.

---

## 2. Terminologie

| Terme | Définition |
|---|---|
| **Agent spécifique / agent de spécialité** | Agent du registre (table `agents`), créé à la volée par l'utilisateur ou l'assistant. Sa **spécialité** est portée par son `role` (système prompt) + ses `capabilities` (ex : `write`, `edit`, `review`, `plan`, `test`, `doc`). Agents par défaut : coordinateur, architecte, codeur, reviewer, testeur, documenteur, plan-maker. |
| **Spécialité** | Couple « (`id` d'agent, `role`/`capabilities`) ». L'unité d'exclusivité par projet. |
| **Agent principal / codeur** | L'agent qui a le rôle de **modification du code** du projet (`capabilities` contient `write`/`edit`, `readonly=false`). C'est l'agent de référence d'un projet pour les fichiers de code. Il est **prioritaire** et **exclusif** sur les fichiers qu'il modifie. |
| **Agent d'estimation / analyseur** | Agent **lecture seule** (`readonly=true`) qui, **avant** le lancement du codeur, analyse la demande et renvoie la liste des fichiers que le codeur va probablement toucher. Peut être l'agent `plan-maker` existant (il produit déjà un plan JSON avec `files`) ou un agent dédié. |
| **Projet** | Répertoire de travail (clé `project_path`). L'unité de scope de l'exclusivité. |

---

## 3. Principes

### 3.1 Lancement multi-agents parallèle
- L'assistant peut lancer **plusieurs agents en même temps**, sur le **même projet**
  ou sur des **projets différents**.
- Chaque agent est **indépendant** : à ce stade, **aucune dépendance** entre agents
  (pas d'ordonnancement, pas de chaînage). Chacun reçoit sa propre demande et
  travaille de son côté.

### 3.2 Spécialités → prompt enrichi
- Les **spécialités** sont les agents spécifiques du registre, créables à la volée.
  Leur système prompt (`role`) EST la spécialité.
- Quand l'assistant choisit un agent de spécialité, il **enrichit automatiquement**
  le prompt de la demande avec les instructions propres à cette spécialité (son
  `role`, ses `capabilities`).
- Le prompt reste **complet et autonome** : contexte, objectif, contraintes, format
  de sortie attendu. L'agent ne doit **rien deviner**.

### 3.3 Exclusivité des spécialités par projet
- **Un seul agent de chaque spécialité par projet à la fois.**
- **Deux agents de la même spécialité ne tournent jamais en même temps sur un même
  projet.**
- **Plusieurs projets** peuvent être traités en parallèle : un agent par spécialité
  **par projet**.

### 3.4 Codeur = agent principal du projet
- Le **codeur** est l'**agent principal** (rôle de super-agent du projet), prioritaire
  sur les fichiers de code.
- Les **autres spécialistes** :
  - peuvent **LIRE** les fichiers du projet (analyse, lecture seule) ;
  - ne doivent **JAMAIS** modifier les fichiers que le codeur modifie.

### 3.5 Anti-conflit par estimation préalable
- **Avant** de lancer le codeur, l'assistant lance un **agent d'estimation**
  (analyse/plan, lecture seule) qui évalue **rapidement quels fichiers** le codeur
  va toucher et renvoie cette liste.
- Cette liste (« fichiers réservés au codeur ») sert à **bloquer les autres
  spécialistes en écriture** sur ces fichiers.
- Un spécialiste en **lecture seule** reste autorisé à les lire/analyser.

### 3.6 Notification de fin (au lieu du polling)
- L'assistant lance les agents puis **attend passivement** (pas de polling).
- C'est **l'agent** qui **prévient l'assistant à la fin de sa tâche**.
- À la réception : si c'est un **point d'avancement** ou une **nouveauté mise en
  place**, l'assistant **informe l'utilisateur** (notification + son) et **consigne
  dans son suivi** (base `clients`/`projets`/`tâches`).

### 3.7 Visibilité (REPORTÉ)
- L'affichage visible/caché des agents de chantier est **différé** : il sera traité
  dans la **refonte graphique**. Mentionné ici pour traçabilité, **hors périmètre**
  de cette spec.

---

## 4. Comportement attendu — scénarios types

### Scénario A — Lancement de N agents sur N projets
1. L'utilisateur demande à l'assistant une action multi-projets (ex : « audite le
   projet X et le projet Y »).
2. L'assistant décompose en tâches et choisit, pour chaque projet, un ou plusieurs
   agents de spécialité.
3. Il construit pour chacun un prompt **enrichi** de sa spécialité et **autonome**.
4. Il lance tous les agents en **parallèle** via `run_agents` (bus d'agents,
   `runAgentsForAssistantAsync`), non bloquant.
5. L'assistant finit son tour ; chaque agent l'informe à la **fin de sa tâche**
   (événement) → compte-rendu + notification + suivi.

### Scénario B — Deux spécialités sur le même projet (séquentiel)
1. L'utilisateur demande une modification de code ET une mise à jour de la doc sur
   le même projet.
2. L'exclusivité impose qu'un seul agent de chaque **spécialité** tourne par projet.
   Le **codeur** et le **documenteur** sont deux spécialités différentes → ils
   pourraient tourner en parallèle.
3. Mais la doc dépend souvent du code : l'assistant peut décider d'un **séquentiel**
   (codeur d'abord, documenteur ensuite). Le **codeur reste prioritaire** sur les
   fichiers de code.
4. Si deux demandes arrivent sur la **même spécialité** du même projet → la seconde
   est **refusée/attente** (règle d'exclusivité), pas lancée en double.

### Scénario C — Codeur + analyseur (lecture seule) en parallèle
1. Un **analyseur** (spécialité lecture seule, ex : reviewer, architecte) travaille
   sur le projet pendant que le codeur modifie du code.
2. L'analyseur peut **lire** les fichiers (même ceux réservés au codeur) pour
   analyser.
3. Il ne **modifie rien** (`readonly=true` + blocage d'écriture sur fichiers
   réservés) → aucun conflit possible.

### Scénario D — Conflit : un spécialiste veut écrire sur un fichier réservé au codeur
1. L'agent d'estimation a réservé `src/lib.rs` et `src/editor.js` au codeur.
2. Un **testeur** (capable d'écrire des tests) tente d'écrire dans `src/editor.js`.
3. Le mécanisme de blocage **refuse l'écriture** (écritures dans ces fichiers
   interdites hors codeur), et **oriente** le spécialiste (ex : écrire le test dans
   `tests/`).
4. Le spécialiste reste autorisé à **lire** `src/editor.js`.

---

## 5. Points techniques à préciser (analyse — à trancher avant implémentation)

> Aucune de ces décisions n'est prise ici ; elles sont listées pour être étudiées
> dans le code avant implémentation.

### 5.1 Où placer la logique d'exclusivité par spécialité/projet ?
- **Constat** : `AgentService` (Rust) est le propriétaire unique des sessions, indexées
  par clé composite `(project, agent)` (`session_key`). C'est l'endroit naturel pour
  vérifier si une session d'une spécialité donnée tourne déjà sur un projet.
- **Question** : faut-il un garde-fou **Rust** dans `AgentService.start`
  (refus de démarrer un second agent de même `agent_id`/`project`), ou un contrôle
  **frontend** dans `agents-bus.js` avant le lancement de la run ? (probablement les
  deux : frontend pour une erreur claire, Rust pour garantir l'invariant).
- **Question** : comment identifier la « spécialité » pour l'exclusivité — par
  `agent_id`, par `role`, ou par ensemble de `capabilities` ?

### 5.2 Comment l'assistant enrichit le prompt selon la spécialité ?
- **Constat** : `agents-bus.js` construit le prompt via `buildAgentPrompt(agent,
  brief, ...)` et le `brief` est `qualityGateInstruction() + task`. Le `role` de
  l'agent est déjà injecté dans le prompt du processus.
- **Question** : faut-il un enrichissement **statique** (concaténer `role` +
  `capabilities` + la demande) côté `agents-bus.js`, ou un enrichissement **dynamique**
  piloté par l'assistant (c'est lui qui compose le prompt enrichi avant `run_agents`) ?
  La spec veut que le prompt soit **complet et autonome** → plutôt côté assistant
  (qui assemble contexte/objectif/contraintes/sortie), avec relecture du `role`.

### 5.3 Comment l'agent d'estimation produit la liste de fichiers, et où la stocker ?
- **Constat** : l'agent `plan-maker` existe déjà (`readonly=true`, `capabilities`
  `["plan"]`) et produit un **plan JSON** avec `files` par tâche. C'est un candidat
  naturel pour le rôle d'agent d'estimation.
- **Question** : réutiliser `plan-maker` (et parser son JSON pour extraire les
  fichiers) ou créer un agent `estimateur` dédié qui ne renvoie qu'une liste de
  fichiers ?
- **Question** : où stocker la liste des fichiers réservés — en mémoire frontend
  (variable du bus d'agents), dans le registre `AgentService`, ou dans une table
  dédiée (ex : `.pilot/reservations.json` par projet) ? Durée de vie : le temps du
  chantier, avec nettoyage à la fin.

### 5.4 Mécanisme de blocage en écriture sur fichiers réservés
- **Constat** : les agents ont un champ `readonly` (mais c'est un tout-ou-rien). Il
  existe une extension **`pilot-edit-gate.ts`** qui, pour l'agent standard, intercepte
  les tool calls `write`/`edit` et demande une confirmation via `ctx.ui.confirm`.
- **Piste** : étendre ce mécanisme de porte pré-écriture pour les agents spécifiques
  lancés via `run_agents` : avant d'autoriser un `write`/`edit`, vérifier si le fichier
  cible est dans la liste réservée au codeur et au projet concerné → refus automatique
  (pas de confirmation utilisateur, juste un refus + message d'orientation).
- **Question** : l'extension `pilot-edit-gate.ts` est-elle applicable aux processus
  `AgentProcess` (actuellement elle n'est chargée que pour la session principale) ?
  Faut-il une extension dédiée `pilot-reserve-gate.ts` ?

### 5.5 Mécanisme de notification de fin vers l'assistant
- **Constat** : à la fin d'une run, `super-agent.js` appelle
  `injectRunAgentsResultToSuperAgent` pour injecter le résultat à l'assistant
  (déjà le cas pour `run_agents`). La notification desktop existe
  (`notifySuperAgentDone`, `desktop-notify.js`, réglage `notify_super_agent_done`)
  et le son via `~/.pilot/assistant/notify.ps1` (`assistant_sound_enabled`).
- **Question** : la notification actuelle est-elle déclenchée pour une **run multi-
  agents** (et pas seulement `delegate_to_coder`) ? Comment distinguer un **point
  d'avancement** d'une **fin de tâche** pour décider d'informer l'utilisateur ?
- **Question** : le suivi (consigner dans `clients`/`projets`/`tâches`) est-il déjà
  alimenté à la fin d'une run, ou faut-il ajouter une étape de consignation ?

---

## 6. Non-périmètre

- **Visibilité** des agents de chantier (affichage visible/caché) → **reporté** à la
  refonte graphique (point 3.7).
- **Dépendances entre agents** (chaînage, ordonnancement, pipelines agent → agent)
  → **exclu** à ce stade (agents indépendants).
- Aucune modification du **mode Orchestration** historique (non concerné ici).
- Pas de résolution de **conflits de merge** entre agents (les fichiers réservés
  rendent le conflit improbable, pas de fusion de branches prévue).

---

## 7. Questions ouvertes

1. **Définition de la spécialité pour l'exclusivité** : par `agent_id`, `role`, ou
   `capabilities` ? (impacte 5.1)
2. **Agent d'estimation** : réutiliser `plan-maker` ou créer un agent `estimateur`
   dédié ? Le plan-maker renvoie déjà des `files` — faut-il normaliser un format de
   sortie « liste de fichiers » ? (impacte 5.3)
3. **Durée de vie et nettoyage** des fichiers réservés (fin de chantier, annulation,
   arrêt d'agent) ? (impacte 5.3)
4. **Comportement en cas de conflit d'exclusivité** (5.1) : refus explicite à
   l'assistant, mise en file, ou lancement différé automatique ?
5. **Blocage d'écriture** : refus silencieux ou message orientant le spécialiste
   (ex : proposer un autre répertoire) ? Peut-on étendre `pilot-edit-gate.ts` aux
   agents spécifiques ? (impacte 5.4)
6. **Notification** : comment distinguer « point d'avancement » de « fin de tâche »,
   et faut-il consigner chaque événement dans le suivi ? (impacte 5.5)
7. **Le codeur est-il identifié par un `agent_id` fixe (ex : `codeur`) ou par
   détection de `capabilities`** (`write`/`edit` + `readonly=false`) ? (impacte 3.4)
