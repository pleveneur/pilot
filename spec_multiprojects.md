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
  surbrillance (fond accent + coche ✓) — c'est l'unique indicateur du projet courant
  (pas de bandeau titre rouge redondant).
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
    rpc: Option<rpc_manager::RpcSession>,         // agent de CE projet (parké en arrière-plan)
    watcher: Option<(Arc<AtomicBool>, JoinHandle<()>)>, // watcher de CE projet (réservé, V2)
}

struct AppState {
    projects: Mutex<HashMap<String, ProjectState>>, // projets ouverts
    active_project: Mutex<Option<String>>,          // projet affiché/actif
    config: Mutex<AppConfig>,
    ... // rpc_reviewer, agent_sessions, event_tx, auth, guard, audit, web_shutdown restent globaux
}
```

- **Clé** = chemin normalisé (même canonicalisation que le code actuel).
- `rpc_state`/`watch_state`/`project_path` restent l'état du **projet actif**
  (adaptateur progressif). `ProjectState.rpc` stocke la session **parkée** d'un
  projet inactif.

### Commandes Tauri
| Commande | Rôle |
|---|---|
| `open_project(path)` | Ajoute le projet (s'il n'existe pas) et le rend actif. Compatible avec le flux existant |
| `close_project(path?)` | Arrête proprement l'agent (actif + parké de CE projet), supprime watcher, retire de la collection |
| `set_active_project(path)` | Bascule `active_project` (+ relance le watcher) |
| `list_open_projects()` | Projets ouverts (pour l'afficheur UI et le web-remote) |
| `get_active_project()` | Chemin du projet actif |
| `restore_open_projects()` | Restaure au démarrage les projets ouverts persistés (collection, sans watcher) |
| `park_agent_session()` | « Parke » la session de l'agent du projet actif (processus pi vivant) dans `ProjectState.rpc` |
| `get_agent_event_channel()` | Canal d'événements Tauri dédié au projet actif (`rpc-event-<hash>`) |

### Sessions par projet (parking — vrai multi-agent)
- **Un seul agent « actif » à la fois** (celui du projet affiché, dans `rpc_state`).
- À la bascule, le frontend **parke** la session courante (`park_agent_session` :
  le processus pi **reste vivant** en arrière-plan, rangé dans `ProjectState.rpc`)
  puis bascule. Au retour, `start_agent_session` **reprend** la session parkée
  (retourne `true`) au lieu d'en relancer une → l'agent reprend exactement là où
  il en était (contexte, historique, processus).
- Chaque projet émet sur son **propre canal d'événements** (`rpc-event-<hash>`),
  calculé par `project_event_channel` (FNV-1a, cohérent avec le hash JS). Le
  frontend écoute le canal du projet actif → aucun chevauchement entre agents.
- À la fermeture d'un projet, sa session parkée est **tuée** proprement
  (`close_project`), sinon fuite de processus pi.

### Sécurité remote
- La logique existante (`open_project_shared`, validation canonicalize + starts_with
  root) est **réutilisée**. Le remote sélectionne un projet via
  `POST /api/project/select` (équivalent `set_active_project`, redémarre l'agent).
  La sélection distante bascule le projet actif partagé.

## 4. Frontend

### Fichiers impactés
| Fichier | Rôle |
|---|---|
| `src/js/sidebar.js` | Afficheur de projets (dropdown) + logique open/close/set-active/park |
| `src/js/main.js` | Orchestration : gestion du projet actif, restauration au démarrage |
| `src/js/agent-pi.js` | Onglet π lié au projet actif (canal d'événements par projet) |
| `src/js/tabs.js` | Persistance/restauration des onglets par projet, reprise de session |
| `index.html`, `src/css/style.css` | UI de l'afficheur (dropdown projets ouverts) |

### UI de l'afficheur
- **Barre « Projets en cours »** (toujours visible) sous le bouton Projets de la
  sidebar : liste des projets ouverts, projet actif en surbrillance, bascule au
  clic, fermeture par bouton ✕. (Divergence assumée vs la 1re esquisse « bandeau
  horizontal » : la barre est intégrée au sélecteur existant, sous le bouton.)
- Le **dropdown** Projets affiche les récents **sans dupliquer** les projets déjà
  ouverts : les projets en cours sont **exclus** de la liste « Récents » (ils ne
  sont visibles que dans la barre « Projets en cours »).

### État agent par projet
- **Parking de sessions** : au basculement, le frontend **parke** la session du
  projet sortant (`park_agent_session`, processus pi vivant) puis invoque
  `set_active_project`. Au retour, `start_agent_session` **reprend** la session
  parkée (`resumed=true` → `createAgentPi(container, true)` n'envoie pas
  `new_session`, donc l'historique est préservé). Le chat est re-rendu via
  `renderMessageHistory`.
- Chaque projet émet sur son **propre canal** (`rpc-event-<hash>` via
  `get_agent_event_channel`) → les événements d'un agent inactif ne polluent pas
  le chat du projet affiché.
- Au basculement (desktop), `_activateProject` : sauvegarde la session onglets,
  parke l'agent, ferme les onglets, invoque `set_active_project`, restaure les
  onglets du projet, rouvre l'onglet agent si le projet en avait un.

## 5. Points de vigilance / décisions

- **Adaptateur progressif (choisi)** : `project_path`/`watch_state`/`rpc_state`
  restent l'état du **projet actif** (les ~15 fonctions RPC et le watcher ne sont
  pas modifiées). `ProjectState.rpc` stocke les sessions **parkées** des projets
  inactifs (processus pi vivant). Pas de régression sur le cœur RPC.
- **Parking (vrai multi-agent)** : chaque projet ouvert garde son processus pi
  **vivant** en arrière-plan (parké). Un seul agent est « actif » (affiché) à la
  fois. Le coût en mémoire/CPU est proportionnel au nombre de projets ouverts.
  La session d'un projet fermé est tuée proprement.
- **Watcher** : un seul watcher actif (projet actif), relancé à chaque bascule.
  `ProjectState.watcher` est réservé (V2) pour N watchers simultanés.
- **Persistance** : la liste des projets ouverts + le projet actif sont sauvegardés
  dans la config et restaurés au démarrage (`restore_open_projects`).
- **Compatibilité** : le cas « 1 seul projet ouvert » se comporte exactement comme
  avant (rétro-compatibilité totale — `close_project` sans arg = fermer l'actif).
- `agent_sessions` (H2 V2) et `rpc_reviewer` restent globaux.

## 6. Mise en œuvre (implémentée)

1. **Backend** : `AppState` avec `projects: HashMap<String, ProjectState>` +
   `active_project` ; commandes `set_active_project`/`list_open_projects`/
   `get_active_project`/`restore_open_projects`/`park_agent_session`/
   `get_agent_event_channel` + `close_project(path?)` ; `open_project_shared`
   enregistre le projet et le rend actif. Helper `do_set_active_project` (réutilisé
   par le web).
2. **Persistance** : `open_projects` + `active_open_project` dans `AppConfig`,
   maintenus à l'ouverture/fermeture/bascule, restaurés au démarrage (`main.js`).
3. **Parking** : `park_agent_session` (processus pi vivant rangé dans `ProjectState.rpc`),
   reprise dans `start_agent_session` (sans `new_session`), canaux d'événements par
   projet (`project_event_channel`/`get_agent_event_channel`).
4. **Frontend afficheur** : barre « Projets en cours » toujours visible sous le
   bouton Projets de la sidebar (bascule au clic, fermeture ✕, projet actif en
   surbrillance) ; le dropdown « Récents » exclut les projets ouverts.
5. **État agent par projet** : parking de sessions (processus pi vivant par projet)
   + restauration des onglets par projet + re-rendu de l'historique
   (`renderMessageHistory`).
6. **Web-remote** : `GET /api/project` expose `open`/`active` ; nouvelle route
   `POST /api/project/select` (bascule le projet actif + redémarre l'agent si actif) ;
   UI web liste les projets ouverts avec sélection.
7. **Indicateur d'activité par projet (issue #13)** : chaque session projet est
   branchée sur un observateur d'événements RPC qui maintient une map d'activité
   (`AppState.agent_activity`, `agent_start` → occupé, `agent_settled` → libre) dans
   `rpc_manager.rs` (paramètre `observer` de `spawn_and_start`). La commande
   `get_project_agent_states()` retourne l'état de chaque projet ouvert ; la barre
   « Projets en cours » affiche une **pastille animée** par projet (frontend
   `_pollProjectActivities`, polling léger 2 s). Un agent **parké** (projet inactif)
   qui travaille en arrière-plan est donc visible. L'activité est remise à zéro à
   l'arrêt de la session et l'entrée retirée à la fermeture du projet.
8. **Fuite de processus `plh.exe` à la fermeture de projet (issue #14)** :
   - `close_project` arrête désormais **aussi** la session reviewer (`rpc_reviewer`,
     `pi`/`plh.exe` séparé `--no-session`) en plus de la session principale et des
     sessions parkées — sinon un reviewer lancé en orchestration restait en mémoire.
   - **Invariant « pas de session orpheline dans `rpc_state` »** : `open_project_shared`
     et `do_set_active_project` parkent défensivement la session active du projet
     précédent (helper `park_previous_active_if_switching`) avant de changer le
     projet actif. Cela couvre le cas où le parking frontend échoue ou où un chemin
     backend (ex: web-remote) bascule sans parker — sinon la session d'un projet
     restait vivante hors de tout slot traçable et n'était jamais tuée à la fermeture
     de son projet. Le web-remote capture `was_active` **avant** la bascule pour
     conserver son redémarrage d'agent.

---

<!-- HELP:multiprojets -->
## Projets multiples (multi-projets)

Pilot peut ouvrir **plusieurs projets en même temps** dans la même fenêtre et
basculer entre eux sans fermer l'application. Chaque projet garde **son agent
(pi/plh) actif en arrière-plan**, ses onglets et sa discussion.

- **Ouvrir** : sélecteur de projet en haut de la barre latérale → « Projets en cours ».
  La liste des projets ouverts est **conservée au redémarrage** (rouverte
automatiquement avec le projet actif).
- **Voir / basculer** : les projets ouverts sont listés **sous le bouton Projets**
  (toujours visibles, **projet actif en surbrillance avec une coche ✓**). Cliquer sur
  un projet → Pilot
  sauvegarde les onglets du projet courant, bascule l'affichage, puis restaure les
  onglets et **la discussion en cours** du projet ciblé.
- **Fermer** : bouton ✕ à droite d'un projet → son agent est arrêté proprement.
- **Agent par projet** : chaque projet a **sa propre session d'agent** (processus
pi/plh dédié, vivant en arrière-plan). En revenant sur un projet, l'agent reprend
exactement là où il en était (contexte et historique préservés).
- **Indicateur d'activité** : une pastille à côté de chaque projet de la barre
« Projets en cours » indique si **son agent travaille** (animée) ou **est en
attente**. Un projet inactif dont l'agent réfléchit en arrière-plan est donc visible.
- **Accès distant** : depuis le mode remote, la liste des projets ouverts est
visible et on peut basculer de projet (route `/api/project/select`).
<!-- /HELP:multiprojets -->
