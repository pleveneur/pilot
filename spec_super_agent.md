# Spécification — Assistant (assistant de suivi multi-projets)

> Onglet **🧭 Assistant** : un assistant nommé, **lecture seule**, qui suit
> l'ensemble des projets (par client) de la demande jusqu'à la livraison, apprend
> en continu des sessions d'agents, et répond à toute question sur les projets.

<!-- HELP:super-agent -->
## Aide utilisateur — Assistant

L'onglet **🧭 Assistant** est un assistant dédié qui **suit tous vos projets**
(organisés par client) sans jamais modifier vos fichiers. Il lit, observe,
apprend et répond.

### Donner un nom à votre assistant
- **Paramètres ⚙️ → onglet « Assistant »** : donnez un nom à votre assistant
  (ex: « Aria », « Chef de projet »). Ce nom s'affiche dans le titre de l'onglet
  🧭 et dans ses réponses.
- Le nom est **injecté dans le prompt système** envoyé à chaque tour :
  l'assistant sait toujours qui il est et qu'il est l'assistant de suivi
  multi-projets (pas l'agent d'un projet). Même sans prompt personnalisé, il
  reçoit un prompt système par défaut qui rappelle son rôle (suivi de plusieurs
  projets par client, lecture seule).

### Gérer les clients
- **Paramètres ⚙️ → onglet « Assistant » → Clients** : saisissez la liste de
  vos clients.
- **Créer un client à la volée** : dans l'onglet 🧭 Assistant, le bouton **🏢
  (Projets & clients)** permet aussi de **créer un nouveau client** directement
  (champ « Nom du nouveau client » + bouton **+ Ajouter un client**), sans
  passer par les Paramètres. Le nouveau client est aussitôt disponible dans les
  sélecteurs.
- Chaque projet suivi peut être **attaché à un client** : dans le panneau
  **🏢 (Projets & clients)**, choisissez le client de chaque projet dans le menu
  déroulant. L'association est enregistrée immédiatement.

### Rendu de la conversation (harmonisé avec l'agent)
- La conversation avec l'Assistant utilise **le même rendu que l'agent
  standard** : bulles, cadres, **pensée/réflexion**, **outils utilisés** et
  **boutons de choix** (avec l'accent **violet** dédié à l'Assistant au lieu du
  bleu).
- **Paramétrer** : **Paramètres ⚙️ → onglet « Assistant »** → cochez/décochez
  « Afficher la réflexion de l'Assistant » et « Afficher les outils de
  l'Assistant » pour masquer (ou montrer) ces blocs.

### Notifications natives
- **Paramètres ⚙️ → onglet « Assistant » → « Notifier quand l'Assistant a
  terminé une tâche déléguée ou signale une anomalie »** : recevez une
  **notification native** (bannière OS) quand l'Assistant signale un événement
  **important** : une **tâche déléguée** à un agent du projet **est terminée**, ou
  une **anomalie** de suivi (ex: connexion au super-agent perdue).
- **Désactivé par défaut** pour éviter la sur-notification : les réponses
  banales de l'Assistant ne déclenchent **aucune** notification.

### Réponses courtes
- **Paramètres ⚙️ → onglet « Assistant » → « Réponses courtes (informer sans
  détailler, sauf demande explicite) »** : quand activé, l'Assistant répond de
  façon **concise** — il **informe et prend des décisions** sans détailler tout
  ce qui se fait, **sauf si vous lui demandez explicitement** de détailler.
- **Désactivé par défaut**.

### Purge de la conversation de l'agent (à la demande)
- La conversation de l'agent d'un projet est **conservée** entre les demandes
  déléguées par l'Assistant : chaque délégation s'appuie sur l'historique
  existant de l'agent.
- L'Assistant peut **purger à la demande** la conversation de l'agent (outil
  `purge_agent_conversation`) — équivalent au clic sur « + » de l'onglet agent
  (départ d'une conversation vierge). Il l'utilise **au début d'une
  conversation** ou **quand il faut arrêter l'agent**, pas avant chaque
  demande.
- Le modèle actif de l'agent est **préservé** lors de la purge (le mécanisme
  `new_session` réinitialise le modèle par défaut de pi ; Pilot le ré-applique).

### Suivre les projets
- L'Assistant suit chaque projet **de la demande jusqu'à la livraison** :
  il enregistre les tâches, leur état, les décisions et l'historique.
- Il **n'effectue aucune action** sur les projets : il ne modifie, ne crée ni
  ne supprime aucun fichier. Il est **lecture seule**.
- Il construit **sa propre base de données locale** (SQLite) pour organiser
  clients, projets et tâches, et s'enrichit au fil du temps.

### Espace d'écriture dédié (fichiers de suivi)
- L'Assistant dispose d'un **dossier de travail dédié** `~/.pilot/assistant/`
  pour ses **fichiers libres** (notes, analyses, exports), organisé par
  **client puis par projet** : `~/.pilot/assistant/<client>/<projet>/`.
- Il **crée lui-même** ses fichiers au fil de l'usage (pas de création
  systématique). Le dossier projet utilise le **nom du projet** (dernier
  segment du chemin), avec repli sur le chemin complet en cas de collision
  entre clients.
- **Garantie technique** : l'Assistant ne peut **jamais** écrire hors de
  `~/.pilot/assistant/` (une extension dédiée bloque toute écriture dans les
  projets). La base SQLite reste la **source de vérité** pour le suivi
  structuré (tâches, décisions, statuts).

### Poser des questions à l'utilisateur
- Quand des informations manquent (client inconnu, données de suivi
  incomplètes), l'Assistant peut **poser des questions** directement dans le
  chat : choix, confirmation Oui/Non, ou saisie libre, via des **boutons**
  inline. Répondez en cliquant ; l'Assistant reprend son raisonnement avec
  votre réponse.

### Ouvrir un projet discuté
- Quand vous **discutez d'un projet**, l'Assistant peut **l'ouvrir** pour le
  rendre **actif** (projet en cours de traitement), comme si vous l'aviez
  ouvert manuellement. S'il a un doute sur le projet, il vous **demande**
  d'abord.

### Suivre le projet en cours de discussion
- L'Assistant **sait quel projet est actuellement ouvert** dans Pilot et **sur
  quel projet il travaillait** (le dernier projet qu'il a ouvert).
- Si vous **changez de projet** en cours de discussion, il ne confond pas : il
  continue de suivre le projet dont vous parlez, et **vous demande de préciser**
  s'il a un doute.
- Il **apprend où se trouvent les projets** au fil des discussions et des
  sessions d'agents (liste des projets connus injectée à chaque tour).

### Déléguer le code à l'agent du projet
- Si vous demandez une **modification de code**, l'Assistant **ne modifie pas**
  lui-même : il **délègue la demande à l'agent standard du projet** (pi/plh de
  coding).
- Il **démarre l'agent en arrière-plan** et lui **envoie la demande dans sa
  session de discussion**, en précisant qu'elle vient de l'Assistant projets.
  Vous **restez sur l'onglet Assistant** pour attendre son retour (la demande
  déléguée est visible dans la conversation de l'agent quand vous y basculez).

### L'Assistant, coordinateur de la redistribution des tâches
L'Assistant est le **coordinateur** de la redistribution des tâches entre les
agents du registre (`~/.pilot/agents.json`). Il peut :

1. **Créer un agent sur mesure** (outil `create_agent`) s'il estime que les
   agents disponibles ne conviennent pas à la tâche : il définit lui-même le
   rôle (system prompt), le nom, l'icône, la description, les modèles (pi/plh),
   la lecture seule, le budget et la profondeur. L'agent est ajouté au registre
   global et devient aussitôt sélectionnable.
2. **Choisir quels agents utiliser** (outil `run_agents`) : il sélectionne les
   agents disponibles (par leur id) qui lui semblent les plus adaptés et leur
   confie une tâche. Pilot les lance (en parallèle si plusieurs) et renvoie le
   résultat agrégé à l'Assistant, qui continue son raisonnement.

Ainsi, au lieu de tout déléguer à l'agent standard, l'Assistant constitue
l'équipe la plus adaptée à chaque demande (codeur, testeur, reviewer, ou un
agent qu'il a lui-même créé).

### Relayer les questions des agents du projet (tâche #22)
- Quand un **agent du projet** (ex: agent de contrôle) a besoin d'une décision
  de votre part pendant son travail (choix d'une approche, confirmation,
  saisie…), c'est **l'Assistant qui sert d'interface** : tant que vous êtes sur
  l'onglet 🧭, la question de l'agent est **affichée dans la conversation de
  l'Assistant**, avec les options proposées.
- Vous pouvez **annoter / modifier / valider** votre réponse avant qu'elle soit
  envoyée à l'agent (champ de précision optionnel + bouton de validation).
- La réponse est transmise au **bon agent** (chaque agent est identifié : ses
  réponses ne sont pas mélangées), qui poursuit son travail débloqué.

### Apprendre en continu
- À chaque **fin de session d'un agent** (chat ou orchestration), un **résumé**
  est envoyé automatiquement à l'Assistant : il apprend ainsi ce qui a été fait,
  décidé et livré, sans que vous ayez à le lui demander.
- Pour un **projet déjà existant**, utilisez le bouton **« Initialiser »** :
  l'Assistant analyse le projet (structure, documentation, historique des
  sessions) puis pose les questions nécessaires à son fonctionnement.

### L'assistant gère son propre suivi
- L'Assistant est **responsable de son suivi des projets** : il met à jour
  lui-même sa base de données (SQLite `~/.pilot/super-agent.db`) et ses fichiers
  personnels (`~/.pilot/assistant/`) au fil des discussions.
- Il dispose d'outils **`db_query`** (lecture SELECT) et **`db_execute`**
  (écriture : CREATE TABLE, INSERT, UPDATE, DELETE…) sur **sa base uniquement**.
  Il **construit ses propres tables** de suivi selon ses besoins, et fait le
  maximum pour que ses données soient à jour (il vérifie dans les projets ou
  réfléchit sur vos demandes).
- Il ne touche **jamais** aux fichiers des projets (lecture seule stricte,
  garantie technique).
- Il **adapte son propre prompt** au fil des discussions : via l'outil
  `update_my_prompt`, il met à jour ses instructions durables (préférences,
  règles, contexte) pour prendre systématiquement en compte ce qu'il apprend.
  Le changement est persisté et pris en compte dès le message suivant.
- S'il a besoin d'**installer des outils** pour gérer au mieux certaines tâches,
  il vous **demande d'abord** (validation utilisateur requise).

### Poser des questions
- Dans l'onglet 🧭, posez **n'importe quelle question sur tous les projets**
  (ex: « Où en est le projet X pour le client Y ? », « Quelles tâches sont en
  attente ? », « Qu'a-t-on décidé sur Z ? »).
- L'Assistant consulte sa base et les projets pour répondre.

### Dicter sa question
- Un bouton **micro 🎙️** est disponible dans la barre d'outils de l'onglet 🧭 :
  il vous permet de **dicter votre question** au lieu de la taper (Web Speech
  API, langue `fr-FR`, comme le chat de l'agent standard). La transcription est
  insérée dans la zone de saisie ; validez ensuite avec Entrée.

### Choisir le modèle
- Un **sélecteur de modèle** est disponible dans la barre d'outils de l'onglet
  🧭 (même liste que les agents de coding). Le changement s'applique à la
  session de l'Assistant.

### Personnaliser le prompt
- **Paramètres ⚙️ → onglet « Assistant » → Prompt système** : définissez le
  prompt qui cadre le comportement de l'Assistant à chaque tour (rôle,
  consignes, ton). Il est préfixé à chaque question.

### Position et persistance de l'onglet
- L'onglet 🧭 est **toujours le plus à gauche** de la barre d'onglets, avant
  même le bouton « + » d'ajout d'agents. Il ne peut pas être déplacé par
  glisser-déposer (et aucun onglet ne peut être placé avant lui).
- **Global (multi-projets)** : l'onglet Assistant existe **une seule fois pour
  Pilot**, pas par projet. Fermer ou basculer un projet **ne le ferme pas**.
- **Persistance** : si l'onglet Assistant est ouvert à la fermeture de Pilot,
  il est **rouvert automatiquement au démarrage** (état `super_agent_open`
  persisté dans la config globale, pas par projet).
- **Bascule automatique (issue #46)** : à l'ouverture d'un projet (et au
  démarrage de Pilot), une fois le projet entièrement chargé, Pilot bascule
  automatiquement sur l'onglet Assistant **si celui-ci est ouvert** (assistant
  activé). Si l'utilisateur n'utilise pas l'assistant, rien n'est forcé.

### Lecture seule — garantie
- L'Assistant est **strictement en lecture seule** sur vos projets : il ne
  peut pas écrire dedans. Seul son **espace dédié** `~/.pilot/assistant/` et
  sa base de données (dans `~/.pilot/`) sont modifiables par lui.
- Cette garantie est **technique** (extension qui bloque toute écriture hors
  de l'espace dédié), pas seulement une consigne système.

### Détection de boucle (issue #55)
- Si l'Assistant se met à **répéter en boucle** le même texte (réflexion ou
  réponse) **ou les mêmes appels d'outils** (ex: la même commande bash enchaînée
  sans avancer), Pilot **arrête la génération** et affiche un message :
  « ⚠️ L'assistant a tourné en boucle… Veuillez reformuler votre demande. »
- Il n'y a **pas de reprise automatique** : l'Assistant est un outil de suivi,
  pas un codeur. Reformulez simplement votre question pour relancer.
<!-- /HELP:super-agent -->

---

## 1. Objectifs

- Fournir un **assistant de suivi** nommé, distinct des agents de coding.
- Suivre **tous les projets** (organisés par **client**) de la demande à la
  livraison, **sans aucune action** sur les projets (lecture seule stricte).
- **Apprendre en continu** : à chaque fin de session d'agent, un résumé est
  injecté automatiquement à l'Assistant.
- Répondre à **toute question** sur l'ensemble des projets.
- Construire **sa propre organisation interne** (base SQLite locale) pour suivre
  l'évolution de chaque tâche.
- Être conçu en vue d'un **futur lien avec un serveur de sources** (gestionnaire
  de source, pilier V2).

## 2. Concepts

| Concept | Description |
|---|---|
| **Assistant** | Assistant nommé, lecture seule, qui suit tous les projets. |
| **Client** | Entité commerciale à laquelle sont rattachés des projets. Liste saisissable. |
| **Projet** | Projet ouvert dans Pilot, attaché à un client (optionnel). |
| **Projet de travail** | Projet sur lequel l'assistant travaille (dernier projet ouvert via `open_project`). Distinct du projet actif : quand l'utilisateur change de projet, le projet de travail reste celui de la discussion en cours. |
| **Tâche** | Unité de suivi (demande → livraison) extraite des sessions d'agents. |
| **Base interne** | Base SQLite locale (`~/.pilot/super-agent.db`) gérée par l'Assistant, source de vérité du suivi structuré. |
| **Espace d'écriture** | Dossier dédié `~/.pilot/assistant/<client>/<projet>/` pour les fichiers libres (notes, analyses, exports). |

## 3. Architecture

```
Sessions d'agents (chat / orchestration)
        │  résumé à la fin de session
        ▼
   Assistant (session pi/plh dédiée, lecture seule)
        │  lit / écrit
        ▼
   Base SQLite locale  ~/.pilot/super-agent.db   (source de vérité structurée)
   (clients, projets, tâches, décisions, historique)
        │
        ▼
   Espace d'écriture dédié  ~/.pilot/assistant/<client>/<projet>/  (fichiers libres)
        ▲
        │  lit
   Projets ouverts (fichiers, docs, historique sessions)
```

- **Session dédiée** : un processus `pi --mode rpc` (ou `plh`) séparé, canal
  d'événements propre `rpc-event-superagent` (ne pollue pas les canaux existants).
- **Lecture seule stricte (technique)** : l'extension `pilot-assistant-files`
  intercepte les outils `write`/`edit` et **bloque toute écriture hors de
  `~/.pilot/assistant/`** (création automatique de l'arborescence client/projet
  au besoin). L'extension `pilot-choices` fournit les outils de question
  (ask_choice, ask_confirm, ask_input, ask_multi_choice). L'extension
  `pilot-assistant-actions` fournit les outils `open_project` (ouvrir un projet
  pour le rendre actif), `delegate_to_coder` (déléguer une demande de code à
  l'agent standard du projet), `purge_agent_conversation` (purger à la demande
  la conversation de l'agent, en préservant le modèle actif), `stop_agent`
  (arrêter immédiatement l'agent du projet actif — coupe la session en cours,
  visible ou en arrière-plan / « agent invisible »), `create_agent`
  (créer un agent sur mesure dans le registre global `~/.pilot/agents.json`
  quand les agents disponibles ne conviennent pas) et `run_agents` (choisir
  quels agents disponibles utiliser et lancer une tâche sur eux, en parallèle,
  en renvoyant le résultat agrégé à l'Assistant). La demande déléguée est affichée dans la
  discussion de l'agent du projet (à droite, comme un message utilisateur, mais
  en violet pour montrer qu'elle provient de l'Assistant — issue #45). La
  délégation ne bascule PAS sur l'onglet de l'agent (issue #49) : l'utilisateur
  reste sur l'onglet Assistant pour attendre le retour de l'agent (la session
  agent est démarrée en arrière-plan). Quand
  l'agent a terminé la tâche déléguée, un feedback est renvoyé à l'Assistant
  (issue #47) : à l'`agent_end`, le résumé injecté au super-agent est marqué
  `[Tâche déléguée terminée]` avec la demande transmise, pour que l'Assistant
  mette à jour son suivi (tâches, décisions) et décide des prochaines étapes
  (boucle de feedback agent → assistant).
  **Garde anti-compaction (issue #54)** : pendant une compaction de fond, pi
  peut émettre un `agent_end` parasite (le tour réel n'est pas fini). Ce
  `agent_end` ne consomme PAS la délégation en attente (`pendingDelegation`) :
  l'injection du résumé au super-agent est ignorée tant que `isCompacting` est
  vrai. Le vrai `agent_end` post-compaction (repris par
  `orchestrationCompactionResumePending`) consommera correctement la délégation,
  évitant que l'Assistant croie la tâche terminée et renvoie des instructions
  alors que l'agent travaille encore. L'extension `pilot-assistant-db` fournit les
  outils `db_query` / `db_execute` (accès contrôlé à la base de suivi de
  l'assistant). L'extension `pilot-assistant-prompt` fournit l'outil
  `update_my_prompt` (auto-adaptation du prompt personnalisé). Les cinq sont
  chargées dès que le backend supporte `--extension`.
- **Détection de boucle (issue #55)** : le flux de l'Assistant (text_delta +
  thinking_delta) est accumulé dans un buffer et analysé par
  `detectRepeatedBlock` (loop-detection.js, issue #37), comme pour l'agent
  standard. Les **appels d'outils** (ex: commandes bash) sont aussi accumulés
  (empreinte `tool::nom::args`) et détectés par `detectRepeatedToolCalls` : un
  agent qui enchaîne le même outil en boucle sans streamer de texte est donc
  arrêté. Contrairement à l'agent (qui se relance avec une correction),
  l'Assistant **s'arrête** sur boucle : `abort_super_agent` est appelé et un
  message clair est affiché (« ⚠️ L'assistant a tourné en boucle… Veuillez
  reformuler votre demande. »). Pas de reprise automatique : l'Assistant est un
  outil de suivi, pas un codeur.
- **Relais des choix d'agent (tâche de suivi #22)** : quand un agent du projet
  émet une demande pilot-choices (`extension_ui_request` select/confirm/input via
  pilot-choices), et que l'onglet 🧭 est **ouvert et actif** (hors Mode
  Orchestration, hors demandes internes edit-gate / actions assistant), la
  demande n'est plus rendue dans l'onglet agent mais **relayée dans le chat de
  l'Assistant** : agent-pi.js détecte la demande (`isRelayableAgentChoice`),
  l'identifie (agentId + projet courant) et déclenche l'événement
  `pilot-agent-relay-request` ; super-agent.js la rend (`relayAgentChoiceRequest`)
  avec un en-tête « 🤖 L'agent « X » du projet attend une réponse » + les options.
  L'utilisateur peut **annoter / modifier / valider** sa réponse (champ de
  précision + bouton de validation, validation utilisateur avant transmission).
  La réponse est routée vers **LA bonne session agent** via la commande Rust
  `send_agent_command_to(project_path, agent_id, command)`, effondrée en une
  **consultation unique** du registre de l'AgentService (`AgentService.send`,
  clé composite `(projet, agent)`) → chaque agent est identifié, les réponses ne
  sont jamais mélangées (multi-agents).
- **Chat sur session persistante** : le chat de l'onglet 🧭 utilise la session
  du super-agent, stockée dans le **registre unique de l'AgentService** sous
  l'id dédié `superagent` avec un **projet pseudo-global `""`** (globale
  multi-projets, insensible à la fermeture de projet). Streaming + mémoire de
  conversation, canal isolé `rpc-event-superagent`, ce qui permet de charger les
  extensions et de poser des questions.

## 4. Données

### Base SQLite locale `~/.pilot/super-agent.db`

Tables (V1) :

| Table | Rôle |
|---|---|
| `clients` | `id`, `name`, `notes`, `created_at`, `updated_at` |
| `projects` | `id`, `path`, `name`, `client_id` (nullable), `status`, `created_at`, `updated_at` |
| `tasks` | `id`, `project_id`, `title`, `description`, `status` (demande/en cours/livré), `created_at`, `updated_at` |
| `decisions` | `id`, `project_id`, `task_id` (nullable), `summary`, `source_session`, `created_at` |
| `session_summaries` | `id`, `project_id`, `session_id`, `summary`, `created_at` |

- La base est **gérée par l'Assistant** via des commandes Tauri dédiées
  (pas par les outils d'écriture de l'agent, pour garantir la lecture seule).
- L'Assistant peut **créer ses propres tables** au fil de ses besoins
  (organisation interne auto-construite), dans la limite de la base dédiée.

### Espace d'écriture dédié `~/.pilot/assistant/`

- Arborescence par **client puis par projet** :
  `~/.pilot/assistant/<client>/<projet>/…` (fichiers libres : notes, analyses,
  exports). `~/.pilot/assistant/` est la racine pour les fichiers propres à
  l'assistant.
- Le dossier projet utilise le **nom du projet** (dernier segment du chemin),
  avec repli sur le chemin complet en cas de collision entre clients.
- **Création à la demande** : l'Assistant crée ses fichiers lui-même au fil de
  l'usage (pas de création systématique). L'extension `pilot-assistant-files`
  crée les dossiers parents au besoin et **bloque toute écriture hors de cette
  racine** (garantie technique de lecture seule sur les projets).

### Registre de configuration `~/.pilot/super-agent.json`

```json
{
  "name": "Aria",
  "clients": ["Client A", "Client B"],
  "project_client_map": { "/path/proj1": "Client A" }
}
```

## 5. Apprentissage en continu

- À chaque **fin de session d'agent** (chat standard `agent_end`, ou fin de
  tâche d'orchestration), Pilot génère un **résumé** (réutilise la logique de
  capture H9 / synthèse d'orchestration) et l'**injecte** à l'Assistant via un
  prompt système ou un message dédié.
- L'Assistant met à jour sa base : tâches, décisions, état d'avancement.
- **Ne pas bloquer** : l'injection est asynchrone et ne ralentit pas la session
  d'origine.
- **Contexte projet à chaque tour** : le prompt système injecte le **projet
  actif** (ouvert dans Pilot), le **projet de travail** (dernier projet ouvert
  via `open_project`) et la **liste des projets connus** de la base. L'Assistant
  sait ainsi quel projet est en cours de discussion, ne confond pas les projets
  quand l'utilisateur en change, et apprend où se trouvent les projets au fil
  des discussions.

## 6. Initialisation d'un projet existant

- Bouton **« Initialiser »** dans l'onglet 🧭 (ou par projet).
- L'Assistant **analyse le projet** : structure, documentation, historique
  des sessions (H9), puis **pose les questions nécessaires** à son fonctionnement
  (contexte, objectifs, client, jalons).
- Il apprend ensuite de l'analyse des discussions avec les agents individuels.

## 7. Interface

### Onglet 🧭 Assistant
- Chat avec l'Assistant (nom affiché dans le titre).
- **Sélecteur de modèle** dans la barre d'outils (même liste que les agents de
  coding, via `list_agent_models` / `get_available_models_list`).
- Bouton **« Initialiser »**.
- Vue des **clients** et des **projets** suivis (avec leur état).

### Position et persistance de l'onglet
- L'onglet 🧭 est **toujours le plus à gauche** de la barre d'onglets, avant
  même le bouton « + » d'ajout d'agents. Il ne peut pas être déplacé par
  glisser-déposer (et aucun onglet ne peut être placé avant lui).
- **Global (multi-projets)** : l'onglet Assistant existe **une seule fois pour
  Pilot**, pas par projet. Fermer ou basculer un projet **ne le ferme pas**.
- **Persistance** : si l'onglet Assistant est ouvert à la fermeture de Pilot,
  il est **rouvert automatiquement au démarrage** (état `super_agent_open`
  persisté dans la config globale, pas par projet).

### Paramètres ⚙️ → onglet « Assistant »
- **Nom** de l'assistant.
- **Prompt système** personnalisé (préfixé à chaque tour).
- **Liste des clients** (ajout / suppression / renommage).
- Association **projet → client**.

## 8. Garde-fous

- **Lecture seule stricte (technique)** : l'extension `pilot-assistant-files`
  bloque toute écriture hors de `~/.pilot/assistant/` (les projets sont
  inaccessibles en écriture, indépendamment de la consigne système).
- **Espace d'écriture dédié** : `~/.pilot/assistant/<client>/<projet>/` pour
  les fichiers libres ; la base SQLite reste la source de vérité structurée.
- **Questions** : l'Assistant peut poser des questions (choix/confirmation/
  saisie) via `pilot-choices`, rendues en boutons inline dans le chat.
- **Actions sur les projets (TÂCHE 2)** : l'extension `pilot-assistant-actions`
  fournit `open_project` (ouvrir un projet → le rendre actif via
  `openProjectByPath`), `delegate_to_coder` (déléguer une demande de code à
  l'agent standard du projet → ouvrir son onglet via `tabs.openFile("", "agent")`
  puis envoyer la demande via `send_agent_prompt`), `purge_agent_conversation`
  (purger à la demande la conversation de l'agent via la commande Rust
  `purge_agent_conversation`, en préservant le modèle actif) et `stop_agent`
  (arrêter l'agent du projet actif via `stop_agent_session` + nettoyage du
  suivi de l'agent invisible). Ces actions sont exécutées
  par Pilot (pas par l'agent), donc compatibles avec la lecture seule stricte.
- **Accès à la base de suivi (responsabilité de l'assistant)** : l'extension
  `pilot-assistant-db` fournit `db_query` (SELECT) et `db_execute` (CREATE/INSERT/
  UPDATE/DELETE/ALTER/DROP/PRAGMA) sur **la base de l'assistant uniquement**
  (`~/.pilot/super-agent.db`), via des commandes Rust (`super_agent_db_query` /
  `super_agent_db_execute`). L'assistant construit et met à jour ses propres
  tables de suivi ; il ne touche jamais aux fichiers des projets.
- **Auto-adaptation du prompt** : l'extension `pilot-assistant-prompt` fournit
  l'outil `update_my_prompt` qui remplace le prompt personnalisé de l'assistant
  (commande Rust `set_super_agent_prompt`, persistée dans la config + historique
  `prompt-history.md`). L'assistant l'utilise pour prendre systématiquement en
  compte ce qu'il apprend des discussions et des choix de l'utilisateur.
- **Installation d'outils (validation utilisateur)** : si l'assistant a besoin
  d'installer des outils pour gérer certaines tâches, il **demande d'abord** à
  l'utilisateur, qui doit valider (via `ask_confirm` / `ask_choice`).
- **Isolation** : canal d'événements séparé (`rpc-event-superagent`), session
  dédiée `superagent` dans le registre de l'AgentService (projet pseudo-global
  `""`), arrêt propre à la fermeture de l'onglet / du projet / de l'application.
- **Anti-régression** : ne pas toucher à `agent-pi.js`, `orchestration.js`,
  `agents.js`. `ask_pi_caged_timed` (partagé par help/review/agents_md) n'est
  pas modifié. Toutes les sessions passent par l'AgentService (le champ
  `rpc_superagent` d'`AppState` a été retiré en phase 2).

## 9. Perspective — lien futur avec un serveur de sources

- L'Assistant est conçu pour s'appuyer plus tard sur le **gestionnaire de
  source** (pilier V2, dev multi-utilisateurs via git ou gestionnaire intégré).
- La base interne (clients, projets, tâches) est le socle de données qui
  alimentera ce lien : suivi de livraison, jalons, statuts synchronisables avec
  le serveur de sources.
- L'architecture (session dédiée + base SQLite + API de suivi) est pensée pour
  être étendue sans refonte.

## 10. Backend Rust (esquisse)

- `super_agent.rs` : session dédiée, injection de résumés, commandes de base.
- Extensions pi : `pilot-assistant-files.ts` (espace d'écriture restreint
  `~/.pilot/assistant/`), `pilot-choices.ts` (questions),
  `pilot-assistant-actions.ts` (open_project / delegate_to_coder /
  purge_agent_conversation / create_agent / run_agents),
  `pilot-assistant-db.ts` (db_query / db_execute sur la base de suivi) et
  `pilot-assistant-prompt.ts` (update_my_prompt), chargées dans la session
  super-agent dès que le backend supporte `--extension`.
- Commandes Tauri (esquisse) :
  - `get_super_agent_config()` / `set_super_agent_config(config)`
  - `start_super_agent_session()` / `stop_super_agent_session()`
  - `send_super_agent_prompt(message)` (chat sur session persistante)
  - `send_super_agent_command(command)` (réponses aux questions, ex:
    `extension_ui_response`)
  - `inject_session_summary(project_id, summary)`
  - `initialize_super_agent(project_path)`
  - `list_clients()` / `add_client(name)` / `remove_client(id)` / `rename_client(id, name)`
  - `set_project_client(project_path, client_id)`
  - `list_super_agent_projects()` (liste les projets suivis + leur client)
  - `set_super_agent_working_project(path)` (projet de travail de la discussion)
  - `super_agent_db_query(sql)` / `super_agent_db_execute(sql)` (accès contrôlé à
    la base de suivi de l'assistant)
  - `set_super_agent_prompt(prompt)` (auto-adaptation du prompt personnalisé,
    avec historique `prompt-history.md`)
  - `query_super_agent(question)` (recherche dans la base + projets)

## 11. Frontend (esquisse)

| Fichier | Rôle |
|---|---|
| `src/js/super-agent.js` | Onglet 🧭 : chat (session persistante + streaming), questions (boutons pilot-choices), actions (open_project / delegate_to_coder), initialisation, panneau Projets & clients (association projet→client). |
| `src/js/super-agent-config.js` | Paramètres ⚙️ : nom, clients, association projet→client. |

## 12. Anti-régression

- Session et canal dédiés (`rpc-event-superagent`).
- Lecture seule garantie techniquement (extension `pilot-assistant-files`).
- Base interne isolée dans `~/.pilot/` + espace d'écriture `~/.pilot/assistant/`.
- Ne pas modifier les modules existants d'agents ni `ask_pi_caged_timed`.

---

*Voir aussi : `plan_dev.md` (roadmap), `spec_multiprojects.md` (gestionnaire de
projets), `spec_session_history.md` (historique H9), `spec_gestion_agents.md`
(agents multi-rôles).*
