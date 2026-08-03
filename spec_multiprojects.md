# Spec — Multi-projets (gestionnaire de projets)

> Une seule instance de Pilot, capable d'ouvrir **plusieurs projets simultanément**,
> chacun piloté par son propre agent pi/plh. Vision produit « Pilot = gestionnaire
> de projets » — pilier V1 (voir section Vision de `plan_dev.md`).

## 1. Objectif

L'état actuel de Pilot est **mono-projet** : une seule instance manipule un seul
projet à la fois (`AppState.project_path` unique, une seule session RPC agent).
Cette spec décrit la migration vers un **gestionnaire multi-projets** :

- Une seule instance Pilot.
- **N projets ouverts simultanément**, chacun avec **son propre agent** et **ses
  propres onglets** (dont son onglet agent).
- **Un seul projet actif à la fois** — le panneau principal (explorateur, onglets,
  éditeur) affiche le projet actif, sélectionnable dans un afficheur.
- Le **web-remote** liste les projets ouverts et permet d'en sélectionner un.

## 2. Comportement

### Afficheur de projets (UI desktop)
- **Bandeau horizontal au-dessus de l'explorateur de fichiers** listant les projets
  ouverts (nom = dernier segment du chemin). Le projet **actif** est mis en
  surbrillance.
- Actions : **« + Ouvrir un projet »** (dialogue natif existant), **« ✕ Fermer »**
  sur le projet actif, clic sur un projet → devient **actif**.
- Au changement de projet actif, l'UI (arborescence, onglets, état agent) se
  recharge pour afficher ce projet.

### Un agent par projet
- Chaque projet ouvert possède **sa propre session d'agent** (processus pi/plh
  dédié, `ProjectState.rpc`).
- **Un onglet « π » par projet**, lié au projet actif. L'état de l'agent
  (`agent-pi.js`) est instancié **par projet**, pas global.
- Les onglets d'édition et l'état agent sont **persistés par projet** (réutilise
  la persistance existante `restoreTabs` / historique sessions).

### Fermeture d'un projet
- Fermer un projet **arrête proprement son agent** (équivalent à la fermeture
  manuelle de l'onglet agent : `stop_agent_session` + session sauvegardée), puis
  supprime le watcher et retire le projet de la collection. Ne ferme pas l'app.

### Web-remote
- Nouvelle route `GET /api/projects` → liste des projets ouverts (et lequel est
  actif).
- Les routes agent/fichier existantes gagnent un paramètre **`project`** (défaut =
  projet actif) pour cibler l'agent / l'arborescence du bon projet.
- Sélection d'un projet sur le remote → bascule la vue distante sur ce projet
  (équivalent `set_active_project`, notifié au desktop via `project_changed`).

## 3. Architecture backend (Rust — `lib.rs`)

### État actuel (mono-projet)
```rust
struct AppState {
    project_path: Mutex<Option<String>>,          // UN seul projet
    watch_state: Mutex<Option<(Arc<AtomicBool>, JoinHandle)>>, // un watcher
    rpc_state: Mutex<Option<RpcSession>>,         // UNE session agent
    ...
}
```

### État cible (multi-projets)
```rust
struct ProjectState {
    path: String,                                 // clé = chemin normalisé
    rpc: Option<rpc_manager::RpcSession>,         // agent de CE projet
    watcher: Option<(Arc<AtomicBool>, JoinHandle<()>)>, // watcher de CE projet
}

struct AppState {
    projects: Mutex<HashMap<String, ProjectState>>, // projets ouverts
    active_project: Mutex<Option<String>>,          // projet affiché/actif
    config: Mutex<AppConfig>,
    ... // rpc_reviewer, agent_sessions, event_tx, auth, guard, audit, web_shutdown restent globaux
}
```

- **Clé** = chemin normalisé (même canonicalisation que le code actuel).
- Les commandes qui lisaient « le projet courant » lisent désormais
  `active_project` puis `projects[active]`. Helper central `fn active_project(&self)`.

### Commandes Tauri
| Commande | Rôle |
|---|---|
| `open_project(path)` | Ajoute le projet (s'il n'existe pas) et le rend actif. Compatible avec le flux existant |
| `close_project(path)` | Arrête proprement l'agent, supprime watcher, retire de la collection |
| `set_active_project(path)` | Bascule `active_project` |
| `list_open_projects()` | Projets ouverts + projet actif (pour l'afficheur UI et le web-remote) |

### Sécurité remote
- La logique existante (`open_project_shared`, validation canonicalize + starts_with
  root) est **réutilisée**. Chaque route remote cible un `project` (défaut = actif)
  et valide son chemin.

## 4. Frontend

### Fichiers impactés
| Fichier | Rôle |
|---|---|
| `src/js/sidebar.js` | Bandeau afficheur de projets + logique open/close/set-active |
| `src/js/main.js` | Orchestration : gestion du projet actif, notification aux modules |
| `src/js/agent-pi.js` | État agent instancié par projet (onglet π lié au projet actif) |
| `src/js/tabs.js` | Persistance/restauration des onglets par projet |
| `index.html`, `src/css/style.css` | UI de l'afficheur |

### État agent par projet
- `agent-pi.js` : le module-level `state` (messages, contextInjected, session) doit
  devenir **pérenne par projet** (ex: `Map<projectPath, agentState>`), restauré au
  passage sur un projet, au lieu d'un état global unique.

## 5. Points de vigilance / décisions

- **Migration des accès** : `project_path`/`rpc_state`/`watch_state` sont lus dans
  ~8 endroits de `lib.rs` + `rpc.rs` + `web_server.rs`. Centraliser via un helper
  `active_project()` pour limiter les changements et le risque de régression.
- **Multi-agents simultanés** : N processus pi en parallèle (coût mémoire/CPU).
  `rpc_manager` gère déjà plusieurs sessions (`agent_sessions`), donc réutilisable.
- **Watcher** : un watcher par projet.
- **Compatibilité** : le cas « 1 seul projet ouvert » doit se comporter exactement
  comme aujourd'hui (rétro-compatibilité totale).
- `agent_sessions` (H2 V2) et `rpc_reviewer` restent globaux dans un 1er temps.

## 6. Étapes de mise en œuvre

1. **Backend (prototype)** : refactor `AppState` (HashMap projects + active),
   commandes `open_project`/`close_project`/`set_active_project`/`list_open_projects`,
   helper `active_project()`, migration des accès existants. **Rétro-compatibilité**
   maintenue : `open_project` remplace `open_project_path`.
2. **Frontend afficheur** : bandeau de projets + open/close/set-active.
3. **État agent par projet** : instanciation de l'état agent par projet.
4. **Web-remote** : `GET /api/projects` + paramètre `project` sur les routes.
