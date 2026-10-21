# Spécification — Gestion d'agents (H2 V2)

> Onglet **🎭 Agents** : **écran de configuration** de l'équipe d'agents (registre : liste, éditeur, compétences) + affichage de l'**activité** des runs en cours. Les lancements se font depuis l'onglet 🧭 **Assistant** (délégation) et les **onglets d'agents** du projet.

<!-- HELP:agents -->
## Aide utilisateur — Agents

L'onglet **🎭 Agents** sert à **configurer l'équipe d'agents** et à **suivre** ce qu'elle fait. Pour lancer une tâche, utilisez l'onglet **🧭 Assistant** (ou la discussion d'un agent).

### L'écran
- **Colonne de gauche : l'équipe.** Chaque carte montre le nom, l'identifiant, les **modèles demandés** (`π` = pi, `ℓ` = plh ; « non réglé » si le champ est vide), et des badges : **lecture seule** et le **nombre de compétences**. Le **niveau de réflexion demandé** (`π` / `ℓ`) est affiché sur la carte dès qu'un niveau est réglé.
  - Attention : les modèles affichés sont **demandés**, pas **employés**. Au démarrage d'une session, Pilot applique le modèle du **backend actif**, sinon celui de l'**autre backend** (repli croisé), sinon le **modèle par défaut** du registre de modèles — et une session **déjà lancée** garde le modèle qu'elle utilise (modifier la carte ne la change pas). L'infobulle de la carte le rappelle.
- **Colonne de droite : l'activité.** Tableau de bord des runs en cours : qui travaille, sur quel outil, la **chaîne des appels**, le **budget restant** et la **profondeur**. L'agent en cours est surligné. Le bilan reste visible après la fin de la run.
  - **Un agent qui travaille sans onglet ouvert** (lancé en arrière-plan, ou dont vous avez fermé l'onglet) y apparaît quand même, dans un bloc **« Travail en arrière-plan (aucun onglet ouvert) »** : nom de l'agent, projet et tâche en cours. Ce bloc est purement informatif : **aucun onglet ne s'ouvre** tout seul.
- **➕ Ajouter** crée un agent ; **✏️ Modifier** ouvre l'éditeur ; **🗑️ Supprimer** retire un agent.
- **🔄 Réinitialiser** restaure les **7 agents fournis** (coordinateur, architecte, codeur, reviewer, testeur, documenteur, plan-maker). **Vos agents personnalisés sont conservés.**

### Créer / modifier un agent
- L'éditeur s'ouvre dans une **fenêtre large** organisée en **deux colonnes** : à gauche l'**identité** et les **modèles**, à droite le **rôle**, les **compétences** et les **garde-fous**. Le champ **Rôle** est haut et **redimensionnable verticalement**. Sur une fenêtre étroite, les deux colonnes se replient en **une seule** (rien n'est coupé) et la fenêtre défile si la hauteur manque.
- **ID** : identifiant machine en kebab-case, non modifiable après création. Un identifiant fourni par Pilot (ex. `codeur`) est refusé à la création : la réinitialisation écraserait cet agent.
- **Nom, icône, description, rôle** : la **description** sert au coordinateur pour router les tâches ; le **rôle** est le prompt système de l'agent.
- **Modèles** : modèle `π` (pi) et `ℓ` (plh) séparés ; « Modèle par défaut » laisse Pilot choisir. Ce réglage est une **intention** pour les sessions à venir (cf. l'encadré ci-dessus) : il n'est pas réappliqué à une session en cours.
- **Niveau de réflexion (`π` / `ℓ`)** : combien le modèle réfléchit avant de répondre (Désactivé → Maximal). Le menu ne propose que les paliers **réellement supportés** par le modèle ; « Non réglé » suit le réglage général de Pilot. Un modèle incapable de raisonner (ex. `llama-cpp`) affiche un sélecteur **désactivé** avec la raison. Au lancement, le niveau est **ajusté** aux capacités du modèle (jamais un palier supérieur).
- **Lecture seule** : consigne stricte de ne pas écrire de fichiers. **Garder le contexte** : la session n'est pas remise à zéro entre deux appels.
- **Max appels / run** et **Profondeur max** : garde-fous propres à l'agent.

### Compétences par agent
- Les compétences (skills) forment une **bibliothèque commune** dans `~/.pilot/skills/` : un dossier par compétence, contenant un fichier `SKILL.md`.
- Cochez dans l'éditeur les compétences que **cet** agent peut voir. Un agent ne voit **que** les compétences cochées (filtrage strict) — plus la compétence `quality-gate`, jamais filtrée.
- Compétence absente de la liste mais déjà cochée = dossier introuvable dans `~/.pilot/skills` : elle reste affichée pour ne pas disparaître sans que vous le sachiez.
- Pour en ajouter une : créez le dossier `<nom>/SKILL.md` dans `~/.pilot/skills`, puis rouvrez l'éditeur de l'agent.

### Suivre et arrêter
- Une tâche lancée sur un agent **peut en appeler un autre** : Pilot relaie le résultat à l'appelant, un seul agent travaille à la fois (hors sous-tâches parallèles).
- **Détection de cycle** : un agent déjà dans la chaîne ne peut pas être rappelé.
- **Consulter n'est jamais une boucle** : relire `git status`, `git diff`, `git log`, `ls`, `grep`/`rg`, `sed -n`… entre deux corrections est un travail normal — ces lectures **ne déclenchent aucun arrêt**, quel que soit l'écran d'où la tâche a été lancée (onglet d'agent, bus d'agents, Assistant). Seules les **modifications** (écriture d'un fichier, commande qui écrit ou exécute) et la répétition d'un même **texte** peuvent fonder un arrêt.
- **Chaque arrêt automatique laisse une trace** dans `.pilot/agent-stops.log` du projet (cause, type de détection, agent, session) : boucle, inactivité, plafond de tours, agent bloqué, libération de verrou. Rien ne s'arrête sans motif écrit.
- **Timeout d'inactivité** : si un agent reste silencieux trop longtemps (**10 min par défaut**, soit 600 000 ms), la run s'arrête et un message le signale. Réglable dans **Paramètres → Agents** (champ « Timeout d'inactivité (ms) », de 10 s à 30 min) ; la nouvelle valeur est relue à l'ouverture de l'onglet Agents ou au redémarrage de Pilot.
- **⏹ Arrêter** arrête tous les processus d'agents. Fermer l'onglet les arrête aussi.
- **Travailler sans onglet reste visible** : dans la **liste des agents** (cercle en haut à droite) et dans le panneau de la cloche, une session qui travaille sans onglet ouvert porte le repère **« arrière-plan »** — vous voyez qu'elle travaille, sur quel projet, même sans onglet. Elle reste listée **tant qu'elle travaille** (ou que son processus tourne) et **disparaît** dès qu'elle s'arrête : aucune entrée fantôme. Une session simplement **au repos** n'est jamais présentée comme travaillante. Ouvrir son onglet reste **votre** décision (bouton « Afficher l'onglet ») : rien ne s'ouvre ni ne change d'onglet tout seul.

### Conseils
- Donnez un modèle puissant au coordinateur : c'est lui qui route les tâches.
- Le codeur et le testeur peuvent utiliser un modèle local plus léger.

### File d'attente du projet
- Sur un projet, **une seule tâche tourne à la fois**. Les demandes suivantes ne sont **pas perdues** : elles **attendent leur tour** et démarrent **automatiquement** dès que la place se libère.
- Un **bloc discret** sous la barre d'outils de l'onglet de l'agent montre la file : la tâche **en cours**, puis les demandes **en attente** avec leur rang (« en attente (2e) »). Il n'apparaît que s'il y a quelque chose à dire.
- La commande **`/file`** affiche la file complète du projet dans la discussion ; **`/file vide`** abandonne les demandes **en attente** et annonce **combien** ont été abandonnées (la tâche en cours n'est jamais arrêtée).
- **Aucune demande ne disparaît en silence** : une demande en attente dont la tâche porteuse s'est arrêtée reste **visible** et **relançable** ; si elle est abandonnée (par vous, par le chien de garde ou par « tout arrêter »), son libellé est écrit dans `.pilot/agent-stops.log` et l'écran vous le signale.
<!-- /HELP:agents -->

### Agent `plan-maker` (planificateur)

Le `plan-maker` est un agent **lecture seule** qui ne modifie jamais le code : il
analyse une demande et produit un **plan structuré en JSON** (tâches + fichiers
concernés + coût estimé en tokens + contraintes suggérées + dépendances).

- **Rôle** : découper la demande en micro-tâches (1 à 3 fichiers par tâche),
  estimer le coût en tokens de chaque tâche, et proposer des contraintes
  (ex : « ne pas modifier `lib.rs` », « budget max 2000 tokens »).
- **Format de sortie** : un JSON valide
  ```json
  {"plan": [{"id": 1, "title": "...", "description": "...",
            "files": ["..."], "estimated_tokens": 0,
            "suggested_constraints": ["..."], "depends_on": []}]}
  ```
- **Quand l'utiliser** : pour les demandes importantes nécessitant un découpage
  et une validation avant délégation au codeur — **sur demande** uniquement. Il
  n'est **jamais lancé automatiquement** avant un codeur : un lancement démarre
  exactement les agents demandés (mission 381).
- **Livrable obligatoire (mission 384)** : nommé seul dans une mission, il doit
  produire un **plan exploitable** (au moins une tâche, chacune avec un intitulé
  et des fichiers) ; la session **reste ouverte** tant que le plan n'est pas
  arrivé. Une session qui se termine **sans livrable** est rapportée en **échec**
  explicite nommant l'agent — jamais un faux succès. Une mission de **lecture**
  ne prouve jamais son travail par le disque (un commit tombé pendant la run
  vient d'ailleurs).
- **Utilisation par l'Assistant (Magnus)** : l'Assistant peut appeler le
  `plan-maker` via `run_agents` (extension `pilot-assistant-actions`) pour
  obtenir un plan structuré, le présenter à l'utilisateur (via `ask_multi_choice`
  pour cocher les tâches à exécuter + `ask_confirm` pour valider), puis déléguer
  au codeur avec le plan approuvé et les contraintes.

---

## 1. Objectifs

- Définir des agents nommés dans un **registre global** persisté en base SQLite (`pilot.db`, tables `agents` / `agent_views`) — et non dans un fichier `~/.pilot/agents.json` (voir § 3).
- Chaque agent a un rôle (system prompt), un modèle par backend (`pi` / `plh`), un **niveau de réflexion** par backend (colonnes `thinking_pi` / `thinking_plh` ; voir `spec_rpc.md` § 4ter) et une liste de **compétences** (skills) visibles.
- Un coordinateur reçoit la demande utilisateur et déclenche les agents spécialisés.
- Protocole séquentiel `[[CALL:agent_id]]` / `[[RESULT from agent_id]]`.
- Garde-fous : profondeur, budget, cycle, timeout, stop global.

## 2. Architecture

```
Utilisateur
   │
   ▼
Coordinateur (session longue)
   │ [[CALL:architecte]]
   ▼
Agent cible (session vierge ou conservée)
   │
   ▼
Pilot renvoie le résultat à l'appelant
```

- **Une session `pi --mode rpc` par agent** (généralisation du reviewer H2 V1).
- Canal d'événements unique `rpc-event-agents` avec enveloppe `{agent_id, event}`.
- Toutes les sessions vivent dans le **registre unique de l'AgentService** (`agent_service.rs`), indexé par clé composite `(projet, agent)`. Les agents multi-rôles H2 V2 y sont stockés avec un `SpawnMode::AgentProcess` (canal `rpc-event-agents`), distincts de la session principale (`MainSession`).

## 3. Données

### Registre global (base SQLite)

Le registre global vit dans la base SQLite de l'application (`pilot.db`, dossier de configuration Pilot), tables `agents` et `agent_views` :

- `agents` : objet agent (id, nom, icône, description, rôle, modèles, **compétences**, drapeaux, limites d'appel) avec `project_path IS NULL` pour le périmètre global (les agents rattachés à un projet portent leur chemin).
- **Clé de projet canonique (`chemin_normalise`)** : toutes les lectures/écritures du registre passent par `crate::normalize_project_path` (`/` vs `\`, casse, slash final) et l'index `UNIQUE (id, chemin_normalise)` — le même projet écrit sous deux formes ne crée plus deux fiches. Migration automatique dans `init_db` : copie de sûreté `pilot.db.bak-chemins-normalises` (jamais écrasée) puis fusion des doublons existants (fiche la plus ancienne conservée) et alignement de `agents.project_path` + `agent_views.project_path`.
- `agent_views` : vues d'onglets (ordre, nom affiché, onglet actif).
- La colonne `skills` est un tableau JSON de noms de dossiers de `~/.pilot/skills` (migration idempotente `NOT NULL DEFAULT '[]'`).
- Un ancien fichier `~/.pilot/agents.json` peut subsister sur une installation ancienne : il **n'est plus lu ni écrit** et peut être supprimé sans risque (retiré de l'installation de référence, avec sauvegarde datée, point 333).

```jsonc
// forme sérialisée d'un agent (colonne → JSON)
{
  "id": "coordinateur",
  "name": "Coordinateur",
  "icon": "🧠",
  "description": "Pilote l'équipe d'agents.",
  "role": "Tu es le chef d'orchestre...",
  "models": { "pi": "deepseek/deepseek-chat", "plh": "deepseek/deepseek-chat" },
  "capabilities": ["delegate", "synthesize"],
  "skills": ["quality-gate"],
  "readonly": false,
  "keep_context": true,
  "max_calls_per_run": 20,
  "call_depth": 0
}
```

### Champs

| Champ | Description |
|---|---|
| `id` | Identifiant machine unique (kebab-case). Un id fourni par Pilot n'est pas créable (D4). |
| `name` | Nom affiché. |
| `icon` | Emoji/icône. |
| `description` | Description fonctionnelle utilisée par le coordinateur pour router. |
| `role` | Instructions système injectées en début de chaque prompt. |
| `models.pi` / `models.plh` | Modèle selon le backend actif. |
| `skills` | Noms de dossiers de `~/.pilot/skills` que **cet** agent voit (filtrage strict, § 3.1). |
| `readonly` | `true` → agent qui ne doit pas écrire. |
| `keep_context` | `true` → ne pas faire `new_session` entre deux appels. |
| `max_calls_per_run` | Limite d'appels pour cet agent dans une run. |
| `call_depth` | Profondeur max à laquelle cet agent peut être appelé (0 = coordinateur). |

### 3.1 Compétences par agent (skills)

- **Bibliothèque commune** : `~/.pilot/skills/<nom>/SKILL.md` (dossier utilisateur Pilot, résolu cross-platform). Un dossier sans `SKILL.md` lisible est ignoré. Aucun fichier n'est créé par Pilot (création à l'usage, par l'utilisateur).
- **Un skill n'ajoute pas d'outil** : c'est un document de consignes (frontmatter `name`, `description`, `disable-model-invocation`) chargé dans le prompt système.
- **Filtrage STRICT (D6)** : un agent ne voit que les compétences de sa liste. Pilot passe à la session pi les chemins `--skill` correspondants (`common_skill_path` refuse tout nom vide ou contenant `/`, `\`, `..`) et exporte `PILOT_AGENT_SKILLS` (JSON des noms). L'extension embarquée `pilot-skills.ts` (`filterSkillsForAgent`), chargée dans TOUTES les sessions d'agent (jamais conditionnée à un autre réglage), retire alors de `event.systemPromptOptions.skills` toute compétence auto-découverte non listée.
- **`quality-gate` n'est jamais filtré** : il reste disponible même s'il n'est pas listé (il est aussi chargé via `--skill` par les sessions concernées).
- **Fail-open** : si `PILOT_AGENT_SKILLS` est absent (session non-agent), aucun filtrage n'a lieu.
- Les agents **fournis** n'ont pas de compétence par défaut : la liste se remplit dans l'éditeur de l'onglet 🎭.

### Commandes Tauri (compétences)

- `list_common_skills() → [{ name, description }]` : inventaire de `~/.pilot/skills` pour le sélecteur de l'éditeur (lecture seule).
- `default_agent_ids() → [String]` : identifiants des 7 agents fournis (source unique, sert au garde-fou de création).

## 4. Protocole inter-agents

### Appel sortant (dans la réponse d'un agent)

```text
Voici mon analyse.

[[CALL:codeur]]
{
  "task": "Crée la route GET /api/search...",
  "files": ["src/routes/search.js"],
  "context": "Utilise Express."
}
[[/CALL]]
```

- Prendre le **dernier** bloc `[[CALL:...]]`.
- JSON optionnel ; si invalide, le brief reste le texte brut entre les marqueurs.

### Résultat renvoyé à l'appelant

```text
[[RESULT from codeur (status: done)]]
DONE: Route GET /api/search créée.
[[/RESULT]]
```

- `status` : `done`, `need_help`, `timeout`, `error`.
- Contenu tronqué selon le budget configuré.

### Délégation parallèle (H2 V2 parallèle)

Pour des sous-tâches **indépendantes**, un agent (typiquement le coordinateur) peut
lancer plusieurs agents **simultanément** via un bloc `[[PARALLEL]]` :

```text
[[PARALLEL]]
agent: codeur
task: Implémente la route GET /api/search.
---
agent: testeur
task: Écris les tests de la route GET /api/search.
---
agent: documenteur
task: Documente la nouvelle route dans le README.
[[/PARALLEL]]
```

- Chaque bloc `agent:` + `task:` est une sous-tâche confiée à un agent distinct,
  exécutée **en parallèle** (chacun dans son propre processus pi).
- Les agents parallèles sont des agents « feuille » : ils exécutent leur brief et
  retournent leur résultat (pas de délégation `[[CALL]]` imbriquée en V1).
- Quand tous ont terminé, leurs résultats sont **agrégés** et renvoyés à
  l'appelant via `[[RESULT from parallel (status: done)]]`.
- Garde-fous appliqués par agent : budget (`max_calls_per_run`), budget total,
  timeout d'inactivité. `stopAgentsRun` abort **tous** les agents actifs.

### Mode parallèle piloté par l'Assistant

Le mode parallèle de l'onglet 🎭 (sélection d'agents + envoi depuis un champ de saisie) **n'existe plus** : la colonne « discussion » a été retirée de l'écran de configuration. Les runs parallèles restent possibles via le bloc `[[PARALLEL]]` du coordinateur et via `runAgentsForAssistant(assignments)` (bus d'agents), utilisés par l'Assistant.

### L'Assistant comme coordinateur (spec_super_agent.md)

L'**Assistant** (onglet 🧭) est le **coordinateur de la redistribution des
tâches** entre les agents du registre. Via les outils `create_agent` et
`run_agents` (extension `pilot-assistant-actions`), il peut :

1. **Créer un agent sur mesure** dans le registre global (base SQLite) s'il
   estime que les agents disponibles ne conviennent pas (rôle construit selon
   son besoin).
2. **Choisir quels agents utiliser** (sélection par id) et lancer une tâche sur
   eux (en parallèle), en recevant le résultat agrégé pour continuer son
   raisonnement.

Le bus d'agents expose `runAgentsForAssistant(assignments)` (Promise résolue
avec le résultat agrégé) pour ce cas d'usage, distinct de l'UI de l'onglet 🎭.

## 5. Backend Rust

### AgentService (propriétaire unique des sessions)

Les sessions des agents multi-rôles H2 V2 vivent dans le **registre unique de
l'AgentService** (`agent_service.rs`), indexé par clé composite `(project, agent)`,
au même titre que la session principale (chat Agent Pi), le reviewer
`orch-reviewer` et le super-agent `superagent`. Elles y sont marquées
`SpawnMode::AgentProcess` (canal `rpc-event-agents`) pour être arrêtées par
`stop_all_agent_processes` et distinctes des sessions `MainSession`.

```rust
// agent_service.rs
sessions: Mutex<HashMap<String, SessionEntry>>,  // clé composite (project, agent)
active:   Mutex<Option<String>>,                 // agent_id actuellement affiché
```

Les commandes `agents.rs` (`do_start_agent_process`, …) délèguent à
`AgentService.start` / `AgentService.send` / `AgentService.stop` au lieu de
toucher une map `agent_sessions` d'`AppState` (champ retiré en phase 2).

### Commandes Tauri

- `start_agent_process(agent_id, cwd, pi_path, no_session)`
- `stop_agent_process(agent_id)`
- `stop_all_agent_processes()`
- `send_agent_process_prompt(agent_id, message)`
- `new_agent_process_session(agent_id)`
- `set_agent_process_model(agent_id, provider, model_id)`
- `abort_agent_process(agent_id)`
- `get_agent_process_state(agent_id)`
- `load_agent_registry()` / `save_agent_registry(registry)` : anciennes commandes fichier ; elles persistent désormais en base via `list_agents` / `replace_agents`.
- `list_common_skills()` : inventaire des compétences de `~/.pilot/skills`.
- `default_agent_ids()` : identifiants des agents fournis.

### Dossier global

`~/.pilot/` résolu cross-platform (dossier utilisateur Pilot). Il contient la base du registre (`pilot.db`), la bibliothèque de compétences (`skills/`) et les espaces de l'Assistant.

## 6. Frontend

### Modules

| Fichier | Rôle |
|---|---|
| `src/js/agents.js` | Fonctions pures : registre, modèles, prompts, parsing (`[[CALL]]`, `[[PARALLEL]]`), agrégation, garde-fous. |
| `src/js/agents-bus.js` | Bus d'exécution : pile, timeouts, envois/réceptions, dispatch parallèle (`dispatchParallel`, `startParallelRun`), buffers par agent. |
| `src/js/agents-ui.js` | Rendu de l'onglet Agents : **configuration** (liste + éditeur, dont le sélecteur de compétences) et panneau d'**activité** des runs. |
| `src/js/project-task-queue.js` | File d'attente **par projet** (mission 385) : rangs et libellés en français (purs), vue de la file, textes affichés, et état de la file des **commandes manuelles** du chat (mise en file + démarrage automatique à la libération). |
| `src/js/project-queue-view.js` | Composition de la file **visible** d'un projet à partir des files réelles (commandes, missions, délégations, agents en file) + abandon des demandes en attente (`/file vide`). Aucune logique de lancement. |

### File d'attente des tâches par projet (mission 385)

**Invariant** : sur un projet, une seule tâche tourne à la fois ; les suivantes
attendent leur tour, avec leur rang, et démarrent **automatiquement** à la
libération de la place. La place est rendue sur **réussite, erreur, arrêt
utilisateur, mort de session et par le chien de garde** ; une activité résiduelle
sans session vivante ne bloque plus le projet.

La file **n'invente aucune file parallèle** : elle compose celles qui existent
(dans l'ordre de démarrage observé) et n'ajoute que celle qui manquait, les
**commandes manuelles** du chat d'agent (auparavant un refus sec perdait la place).

| Famille | Source de vérité (existante) | Rejeu |
|---|---|---|
| Commande manuelle du chat | `project-task-queue.js` (nouvelle file) | sonde périodique `QUEUE_TICK_MS` (5 s) |
| Mission de l'assistant (`run_agents`) | `runAgentsQueueByProject` (`super-agent.js`) | `armQueueReplay` (existant) |
| Délégation (`delegate_to_coder`, #66) | `delegationState(p).queue` (`super-agent.js`) | `armDelegationQueueReplay` (existant) |
| Demande d'agent (spécialité occupée) | `exclusivityQueue` (`agents-bus.js`) | `launchNextQueued` / drains (existants) |

- **Sonde d'admission** : la politique existante `canSendManualCommandAsync(...)`
  (`isRunInProgress` + activité réelle de l'agent + `releaseOrphanRunLock`).
  **Fail-closed** : sonde en échec ou absente → rien ne démarre, la demande
  reste en file. Une commande en file ne démarre donc jamais en parallèle d'une
  tâche en cours.
- **Le lanceur d'une commande en file réutilise `sendPrompt()` à l'identique** :
  aucune modification du lancement d'agent, de l'estimation préalable ni du
  plan-maker (périmètre strict de la mission).
- **Démarrage non confirmé** (toujours libre après `QUEUE_CONFIRM_MS` = 10 s, ou
  lanceur en échec) : la demande est remise **en tête** de file ; après
  `QUEUE_MAX_ATTEMPTS` (3) elle est abandonnée **avec un message** — jamais en
  silence. Une demande identique déjà en file n'est jamais dupliquée ; la file
  est plafonnée à `QUEUE_MAX_LENGTH` (50).
- **Affichage** : bloc discret `.agent-queue-block` sous la barre d'outils de
  l'onglet de l'agent (masqué si la file est vide), titré « 🧾 File d'attente —
  N en cours · M en attente », lignes « en cours : … », « en attente (2e) : … ».
  Rafraîchi par l'événement `pilot-queue-changed` (émis par la boucle) et aux
  `agent_start` / `agent_end`.
- **Commandes de chat** : `/file` affiche la file (`formatProjectQueueReport`) ;
  `/file vide` abandonne les demandes **en attente** et annonce les décomptes par
  famille (`formatQueueClearedMessage`). Traitées **localement** (jamais envoyées
  au moteur), sur le modèle de `/verrou`.
- **Tests** : `src/js/project-task-queue.test.js` (ordre, une seule tâche
  démarre, la suivante démarre seule, place rendue, rien perdu) et
  `src/js/project-queue-wiring.test.js` (composition de la file visible,
  `/file vide`, câblage de l'onglet, style).

#### Fiche d'agent (éditeur, deux colonnes)

L'éditeur d'agent (`.modal-content.agent-editor-content` : largeur 900 px plafonnée à `92 vw`, `max-height: 88 vh`) présente la fiche sur **deux colonnes** (`.agent-form-cols`, grille `minmax(0, 1fr) minmax(0, 1.1fr)`) :

- **colonne gauche** — identité et modèles : `#ae-id`, `#ae-name`, `#ae-icon`, `#ae-description`, `#ae-model-pi` + `#ae-thinking-pi` (+ note), `#ae-model-plh` + `#ae-thinking-plh` (+ note) ;
- **colonne droite** — rôle, compétences et garde-fous : `#ae-role` (textarea haut, `resize: vertical`), `#ae-skills`, `#ae-readonly`, `#ae-keep`, `#ae-max-calls`, `#ae-depth`.

Les identifiants `#ae-*` sont **inchangés** : l'enregistrement relit exactement les mêmes valeurs (aucune perte). Sous `max-width: 900px`, la grille repasse en **une seule colonne** (aucun champ coupé) ; l'`overflow-y` de `.agent-form` conserve le défilement quand la hauteur manque. Test de cablage : `src/js/agents-editor-layout.test.js`.

### Résolution du modèle

1. `backendKind()` → `"pi"` / `"plh"`.
2. `models.{backend}` → fallback sur l'autre backend → fallback modèle par défaut du backend → modèle courant.

### Garde-fous (configurables dans Paramètres)

- Profondeur max d'appel : 3 (défaut).
- Budget total d'appels : 30.
- Timeout d'inactivité : **600 000 ms (10 min, défaut)** — `default_agent_timeout_ms()` (`src-tauri/src/lib.rs`), même valeur côté front (`DEFAULT_TIMEOUT_MS`, `src/js/agents-bus.js`), dans le champ de l'interface (`index.html`, `min="10000"`, `max="1800000"`) et au repli d'enregistrement (`src/js/settings.js`). Réglable par `agent_timeout_ms` ; relevé de 120 s → 300 s (issue #10) puis de 300 s → 600 s (issue #19, commit `31707a9`) parce que les agents enchaînent des outils longs (codeur/builds). À l'échéance, un message d'erreur clair est affiché et la run s'arrête SANS message « arrêtée par l'utilisateur » (issue #10). Garde-fou : `src/js/help-delai-inactivite.test.js` compare la valeur annoncée ici et dans l'aide intégrée à la valeur réelle du code.
- Taille max résultat renvoyé : 4000 tokens.
- Détection de cycle : interdit de rappeler un agent déjà dans la pile.

## 7. Cycle de vie

- `stop_all_agent_processes()` à la fermeture de l'onglet Agents, au changement de projet et à la fermeture de l'application.
- Sous-agents avec `keep_context: false` reçoivent `new_session` avant chaque appel.
- Le coordinateur garde son contexte pendant toute la run.

## 8. Anti-régression

- Ne pas toucher à `agent-pi.js`, `orchestration.js`, `agents-bus.js` (logique d'orchestration frontend).
- Toutes les sessions passent par l'AgentService (une seule indirection `send`), jamais par un accès direct à une map dans `AppState`.
- Utiliser un canal séparé `rpc-event-agents` pour ne pas polluer les canaux existants.
- Tous les agents sont lazy et arrêtés proprement.
- Les sessions d'agents reçoivent leurs `--skill` + `PILOT_AGENT_SKILLS` dans `spawn_agent_process` (agent_service.rs) : ne pas revenir à un spawn sans compétences.
- **Réinitialiser** ne doit jamais faire de `DELETE` du périmètre global (D5) : un upsert par agent fourni, sans toucher aux agents personnalisés. Le frontend doit **réafficher le registre réel relu en base** (`list_agents`), jamais le retour de `reset_agent_registry` (qui ne contient que les fournis) : sinon les agents personnalisés disparaissent à l'écran, puis en base à la sauvegarde suivante (le frontend redessine et renvoie la liste affichée).
- **D4 (création avec l'id d'un fourni) refusé aussi dans le cœur** : la commande `upsert_agent` refuse la création d'un agent GLOBAL dont l'id est celui d'un agent fourni (mise à jour d'un fourni existant et agents de projet restent autorisés). Un appel IPC direct ne doit pas pouvoir contourner la règle appliquée par l'interface.

---

*Voir aussi : `plan_gestion_agents.md` (plan d'implémentation détaillé).*
