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
| `src/js/agent-pi.js` | Onglet π lié au projet actif (session RPC propre par projet via pi) |
| `src/js/tabs.js` | Persistance/restauration des onglets par projet |
| `index.html`, `src/css/style.css` | UI de l'afficheur (dropdown projets ouverts) |

### État agent par projet
- **Session isolée par pi** : `do_start_agent_session` calcule `session_dir` depuis
  le cwd du projet → chaque projet a **son répertoire de session pi** (résumé,
  historique). Au basculement, l'onglet agent est fermé (`stop_agent_session`),
  puis rouvert (`start_agent_session` sur le nouveau cwd) → pi reprend la session
  du projet ciblé. Les messages/contextes des projets sont donc **isolés** sans
  dupliquer d'état JS.
- Au basculement (desktop), `_activateProject` : sauvegarde la session onglets,
  ferme les onglets, invoque `set_active_project`, restaure les onglets du projet,
  rouvre l'onglet agent si le projet en avait un.

## 5. Points de vigilance / décisions

- **Adaptateur progressif (choisi)** : `project_path`/`watch_state`/`rpc_state`
  restent l'état du **projet actif** (les ~15 fonctions RPC et le watcher ne sont
  pas modifiées). Les `ProjectState` de la collection stockent les autres projets
  ouverts (seul `path` est rempli pour l'instant). Pas de régression sur le cœur RPC.
- **Multi-agents** : un seul processus pi actif à la fois (celui du projet actif) ;
  chaque projet a son répertoire de session pi. Si l'on veut N agents simultanés
  (en arrière-plan), ce sera une évolution ultérieure.
- **Watcher** : un seul watcher actif (projet actif), relancé à chaque bascule.
- **Compatibilité** : le cas « 1 seul projet ouvert » se comporte exactement comme
  avant (rétro-compatibilité totale — `close_project` sans arg = fermer l'actif).
- `agent_sessions` (H2 V2) et `rpc_reviewer` restent globaux.

## 6. Mise en œuvre (implémentée)

1. **Backend** : `AppState` avec `projects: HashMap<String, ProjectState>` +
   `active_project` ; commandes `set_active_project`/`list_open_projects`/
   `get_active_project` + `close_project(path?)` ; `open_project_shared` enregistre
   le projet et le rend actif. Helper `do_set_active_project` (réutilisé par le web).
2. **Frontend afficheur** : section « Projets ouverts » dans le dropdown de la
   sidebar (bascule au clic, fermeture ✕, projet actif en surbrillance).
3. **État agent par projet** : via les sessions pi par répertoire projet (pas
   d'état JS dupliqué) + restauration des onglets par projet.
4. **Web-remote** : `GET /api/project` expose `open`/`active` ; nouvelle route
   `POST /api/project/select` (bascule le projet actif + redémarre l'agent si actif) ;
   UI web liste les projets ouverts avec sélection.
