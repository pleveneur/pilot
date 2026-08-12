# Spécification — Super-agent (assistant de suivi multi-projets)

> Onglet **🧭 Super-agent** : un assistant nommé, **lecture seule**, qui suit
> l'ensemble des projets (par client) de la demande jusqu'à la livraison, apprend
> en continu des sessions d'agents, et répond à toute question sur les projets.

<!-- HELP:super-agent -->
## Aide utilisateur — Super-agent

L'onglet **🧭 Super-agent** est un assistant dédié qui **suit tous vos projets**
(organisés par client) sans jamais modifier vos fichiers. Il lit, observe,
apprend et répond.

### Donner un nom à votre assistant
- **Paramètres ⚙️ → onglet « Super-agent »** : donnez un nom à votre assistant
  (ex: « Aria », « Chef de projet »). Ce nom s'affiche dans le titre de l'onglet
  🧭 et dans ses réponses.

### Gérer les clients
- **Paramètres ⚙️ → onglet « Super-agent » → Clients** : saisissez la liste de
  vos clients.
- Chaque projet ouvert peut être **attaché à un client** (sélection dans la
  barre « Projets en cours » ou dans l'onglet Super-agent).

### Suivre les projets
- Le Super-agent suit chaque projet **de la demande jusqu'à la livraison** :
  il enregistre les tâches, leur état, les décisions et l'historique.
- Il **n'effectue aucune action** sur les projets : il ne modifie, ne crée ni
  ne supprime aucun fichier. Il est **lecture seule**.
- Il construit **sa propre base de données locale** (SQLite) pour organiser
  clients, projets et tâches, et s'enrichit au fil du temps.

### Apprendre en continu
- À chaque **fin de session d'un agent** (chat ou orchestration), un **résumé**
  est envoyé automatiquement au Super-agent : il apprend ainsi ce qui a été fait,
  décidé et livré, sans que vous ayez à le lui demander.
- Pour un **projet déjà existant**, utilisez le bouton **« Initialiser »** :
  le Super-agent analyse le projet (structure, documentation, historique des
  sessions) puis pose les questions nécessaires à son fonctionnement.

### Poser des questions
- Dans l'onglet 🧭, posez **n'importe quelle question sur tous les projets**
  (ex: « Où en est le projet X pour le client Y ? », « Quelles tâches sont en
  attente ? », « Qu'a-t-on décidé sur Z ? »).
- Le Super-agent consulte sa base et les projets pour répondre.

### Choisir le modèle
- Un **sélecteur de modèle** est disponible dans la barre d'outils de l'onglet
  🧭 (même liste que les agents de coding). Le changement s'applique à la
  session du Super-agent.

### Position et persistance de l'onglet
- L'onglet 🧭 est **toujours le plus à gauche** de la barre d'onglets, avant
  même le bouton « + » d'ajout d'agents. Il ne peut pas être déplacé par
  glisser-déposer (et aucun onglet ne peut être placé avant lui).
- **Global (multi-projets)** : l'onglet Super-agent existe **une seule fois pour
  Pilot**, pas par projet. Fermer ou basculer un projet **ne le ferme pas**.
- **Persistance** : si l'onglet Super-agent est ouvert à la fermeture de Pilot,
  il est **rouvert automatiquement au démarrage** (état `super_agent_open`
  persisté dans la config globale, pas par projet).

### Lecture seule — garantie
- Le Super-agent est **strictement en lecture seule** : il ne peut pas écrire
  dans vos projets. Seule sa propre base de données (dans `~/.pilot/`) est
  modifiée par lui.
<!-- /HELP:super-agent -->

---

## 1. Objectifs

- Fournir un **assistant de suivi** nommé, distinct des agents de coding.
- Suivre **tous les projets** (organisés par **client**) de la demande à la
  livraison, **sans aucune action** sur les projets (lecture seule stricte).
- **Apprendre en continu** : à chaque fin de session d'agent, un résumé est
  injecté automatiquement au Super-agent.
- Répondre à **toute question** sur l'ensemble des projets.
- Construire **sa propre organisation interne** (base SQLite locale) pour suivre
  l'évolution de chaque tâche.
- Être conçu en vue d'un **futur lien avec un serveur de sources** (gestionnaire
  de source, pilier V2).

## 2. Concepts

| Concept | Description |
|---|---|
| **Super-agent** | Assistant nommé, lecture seule, qui suit tous les projets. |
| **Client** | Entité commerciale à laquelle sont rattachés des projets. Liste saisissable. |
| **Projet** | Projet ouvert dans Pilot, attaché à un client (optionnel). |
| **Tâche** | Unité de suivi (demande → livraison) extraite des sessions d'agents. |
| **Base interne** | Base SQLite locale (`~/.pilot/super-agent.db`) gérée par le Super-agent. |

## 3. Architecture

```
Sessions d'agents (chat / orchestration)
        │  résumé à la fin de session
        ▼
   Super-agent (session pi/plh dédiée, lecture seule)
        │  lit / écrit
        ▼
   Base SQLite locale  ~/.pilot/super-agent.db
   (clients, projets, tâches, décisions, historique)
        ▲
        │  lit
   Projets ouverts (fichiers, docs, historique sessions)
```

- **Session dédiée** : un processus `pi --mode rpc` (ou `plh`) séparé, canal
  d'événements propre `rpc-event-superagent` (ne pollue pas les canaux existants).
- **Lecture seule stricte** : le Super-agent reçoit une consigne système
  interdisant toute écriture dans les projets. Seule sa base interne est
  modifiable (via des commandes Tauri dédiées, pas via les outils de l'agent).

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

- La base est **gérée par le Super-agent** via des commandes Tauri dédiées
  (pas par les outils d'écriture de l'agent, pour garantir la lecture seule).
- Le Super-agent peut **créer ses propres tables** au fil de ses besoins
  (organisation interne auto-construite), dans la limite de la base dédiée.

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
  capture H9 / synthèse d'orchestration) et l'**injecte** au Super-agent via un
  prompt système ou un message dédié.
- Le Super-agent met à jour sa base : tâches, décisions, état d'avancement.
- **Ne pas bloquer** : l'injection est asynchrone et ne ralentit pas la session
  d'origine.

## 6. Initialisation d'un projet existant

- Bouton **« Initialiser »** dans l'onglet 🧭 (ou par projet).
- Le Super-agent **analyse le projet** : structure, documentation, historique
  des sessions (H9), puis **pose les questions nécessaires** à son fonctionnement
  (contexte, objectifs, client, jalons).
- Il apprend ensuite de l'analyse des discussions avec les agents individuels.

## 7. Interface

### Onglet 🧭 Super-agent
- Chat avec le Super-agent (nom affiché dans le titre).
- **Sélecteur de modèle** dans la barre d'outils (même liste que les agents de
  coding, via `list_agent_models` / `get_available_models_list`).
- Bouton **« Initialiser »**.
- Vue des **clients** et des **projets** suivis (avec leur état).

### Position et persistance de l'onglet
- L'onglet 🧭 est **toujours le plus à gauche** de la barre d'onglets, avant
  même le bouton « + » d'ajout d'agents. Il ne peut pas être déplacé par
  glisser-déposer (et aucun onglet ne peut être placé avant lui).
- **Global (multi-projets)** : l'onglet Super-agent existe **une seule fois pour
  Pilot**, pas par projet. Fermer ou basculer un projet **ne le ferme pas**.
- **Persistance** : si l'onglet Super-agent est ouvert à la fermeture de Pilot,
  il est **rouvert automatiquement au démarrage** (état `super_agent_open`
  persisté dans la config globale, pas par projet).

### Paramètres ⚙️ → onglet « Super-agent »
- **Nom** de l'assistant.
- **Liste des clients** (ajout / suppression / renommage).
- Association **projet → client**.

## 8. Garde-fous

- **Lecture seule stricte** : consigne système + absence d'outils d'écriture
  (write/edit) pour le Super-agent. Seule la base interne est modifiable.
- **Isolation** : canal d'événements séparé, session dédiée, arrêt propre à la
  fermeture de l'onglet / du projet / de l'application.
- **Anti-régression** : ne pas toucher à `rpc_state`, `rpc_reviewer`,
  `agent-pi.js`, `orchestration.js`, `agents.js`.

## 9. Perspective — lien futur avec un serveur de sources

- Le Super-agent est conçu pour s'appuyer plus tard sur le **gestionnaire de
  source** (pilier V2, dev multi-utilisateurs via git ou gestionnaire intégré).
- La base interne (clients, projets, tâches) est le socle de données qui
  alimentera ce lien : suivi de livraison, jalons, statuts synchronisables avec
  le serveur de sources.
- L'architecture (session dédiée + base SQLite + API de suivi) est pensée pour
  être étendue sans refonte.

## 10. Backend Rust (esquisse)

- `super_agent.rs` : session dédiée, injection de résumés, commandes de base.
- Commandes Tauri (esquisse) :
  - `get_super_agent_config()` / `set_super_agent_config(config)`
  - `start_super_agent_session()` / `stop_super_agent_session()`
  - `send_super_agent_prompt(message)`
  - `inject_session_summary(project_id, summary)`
  - `initialize_super_agent(project_path)`
  - `list_clients()` / `add_client(name)` / `remove_client(id)` / `rename_client(id, name)`
  - `set_project_client(project_path, client_id)`
  - `query_super_agent(question)` (recherche dans la base + projets)

## 11. Frontend (esquisse)

| Fichier | Rôle |
|---|---|
| `src/js/super-agent.js` | Onglet 🧭 : chat, initialisation, vue clients/projets. |
| `src/js/super-agent-config.js` | Paramètres ⚙️ : nom, clients, association projet→client. |

## 12. Anti-régression

- Session et canal dédiés (`rpc-event-superagent`).
- Lecture seule garantie (pas d'outils d'écriture).
- Base interne isolée dans `~/.pilot/`.
- Ne pas modifier les modules existants d'agents.

---

*Voir aussi : `plan_dev.md` (roadmap), `spec_multiprojects.md` (gestionnaire de
projets), `spec_session_history.md` (historique H9), `spec_gestion_agents.md`
(agents multi-rôles).*
