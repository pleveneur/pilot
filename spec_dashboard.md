# Spécification — Tableau de bord projet

> Onglet **📊 Tableau de bord** : vue détaillée du **projet actif**, alimentée
> par les métriques fichiers/Git (Rust) + la base de suivi de l'assistant
> (super-agent) + l'index de sessions (session_history). **Lecture seule** : ne
> modifie aucun fichier du projet. Issue #51.

<!-- HELP:dashboard -->
## Aide utilisateur — Tableau de bord

L'onglet **📊 Tableau de bord** (bouton **📊** de la barre latérale) affiche une
vue d'ensemble du **projet actif** : stockage, Git, langages, activité de
l'agent IA, vélocité et documentation. Tout est **en lecture seule** : le
tableau de bord n'édite jamais vos fichiers.

Le tableau de bord a **deux volets** :
- **Volet Assistant** (toujours visible) : activité & métriques de l'agent IA.
- **Volet Projet** (visible seulement quand un projet est ouvert) : stockage,
  Git, langages, vélocité, contexte, alertes.

Quand **aucun projet n'est ouvert**, seul le volet Assistant est affiché (le
volet Projet est masqué) et l'onglet **📊** reste ouvert dans la barre
d'onglets.

### Ce que vous voyez
- **En-tête** : nom du projet, chemin local, client associé (si renseigné dans
  l'onglet 🧭 Assistant) et horodatage du dernier rafraîchissement.
- **Stockage & Poids** : taille totale du répertoire, nombre de fichiers et de
  dossiers, poids du **code source pur** (hors dépendances/caches comme
  `node_modules`, `target`, `.git`…) et les fichiers les plus lourds. Une **taille réelle sur disque** (tout compris, y compris `node_modules`/`target`/`.git`) est affichée à côté du donut, pour connaître la vraie empreinte du projet.
- **Purge des fichiers inutiles** : le tableau de bord détecte automatiquement les éléments purgeables selon le type de projet (dépendances, caches, sorties de build…). Cochez ce que vous voulez supprimer, confirmez, et l'espace est libéré. Le dossier `.git` n'est jamais supprimé (seule une compaction `git gc` est proposée, qui ne touche pas à l'historique).
- **État Git** : branche active, fichiers modifiés, non suivis (untracked) et
  prêts à être commités (staged).
- **Analyse du Code & Langages** : répartition des langages en % (camembert + barres),
  métriques globales (lignes, fonctions, classes), marqueurs TODO/FIXME et écosystème de
  dépendances détecté (Node.js, Rust/Cargo, Python…).
- **Activité & Métriques de l'Agent IA** : nombre de sessions, tokens consommés sur 7 jours,
  total de messages échangés, actions exécutées (Bash, éditions, écritures) et date de la
  dernière session. Graphiques : **barres** tokens/messages par jour et **camembert** de la
  répartition des actions.
- **Évolution & Vélocité (7 jours)** : commits, fichiers modifiés, lignes et taille modifiées
  sur la période, avec **barres** de l'évolution des commits et des fichiers modifiés par jour.
- **Contexte & Documentation** : extrait du README **rendu en Markdown**, fichiers de mémoire /
  décisions d'architecture, derniers fichiers modifiés avec horodatage relatif.
- **Bandeau d'Alertes & Suggestions** : badges des points d'attention (fichiers volumineux,
  éléments non commités, langage principal).

Chaque graphique (camemberts et barres) est dessiné en **SVG inline** (sans bibliothèque
externe), avec **tooltips** au survol, **légendes**, pourcentages et une **ligne d'insight**
(« lecture intelligente ») qui résume le point clé (ex : « Le projet est dominé par Rust
(45%) »).

### Actualiser
Le bouton **Actualiser** relance l'analyse du projet. L'analyse peut prendre
quelques secondes sur les gros projets (parcours du répertoire + Git).

Le tableau de bord se **rafraîchit automatiquement** tant que son onglet est
actif : par défaut toutes les **10 secondes**. Vous pouvez désactiver ce
comportement ou modifier l'intervalle dans **Paramètres → Général** (« Activer
le rafraîchissement automatique du tableau de bord » + durée en secondes).

### Suivi multi-projets
Quand plusieurs projets sont ouverts, une section **Suivi multi-projets**
apparaît en tête du tableau de bord : un tableau récapitulatif (projet, client,
statut, tâches ouvertes/total, agent occupé ou prêt, dernière session). Le
projet actif est mis en évidence (📍). Cela permet de superviser d'un coup
 d'œil tous les projets en cours et l'activité de leurs agents respectifs.

### Afficher le Tableau de bord systématiquement
Dans **Paramètres → Général**, l'option **« Afficher le Tableau de bord
systématiquement »** (désactivée par défaut) permet d'ouvrir automatiquement
l'onglet **📊** au démarrage de Pilot, **uniquement si un projet est ouvert**
(le tableau de bord est lié au projet actif). Quand elle est activée, l'onglet
**📊** est **verrouillé en position** dans la barre d'onglets : juste après
l'onglet **🧭 Assistant** et avant le bouton **＋** d'ajout d'agents, et il n'est
plus déplaçable au glisser-déposer. Désactivez l'option pour retrouver le
comportement normal (onglet déplaçable, ouvert via le bouton **📊** de la barre
latérale).

L'onglet **📊** n'est **pas fermé** quand on ferme le projet actif : il reste
affiche dans la barre d'onglets (à côté de l'onglet **🧭 Assistant**) et bascule
automatiquement sur le volet Assistant seul. Il se rafraîchit au changement de
projet (ouverture, fermeture, bascule).
<!-- /HELP:dashboard -->

---

## Architecture

| Couche | Rôle |
|---|---|
| **Backend** `src-tauri/src/dashboard.rs` | Commande `get_project_dashboard` : scan du répertoire (stockage, langages, métriques code), état Git, activité agent, vélocité, contexte, alertes. Réutilise `crate::run_captured` (git), `session_history::read_session_index` / `project_sessions_dir` / `project_to_session_folder` (activité) et la config (client associé). Retourne `has_project: false` + volet Assistant seul quand aucun projet n'est ouvert (au lieu d'une erreur). Commande `get_project_tracking` : état de suivi de tous les projets ouverts (client, statut, tâches ouvertes/total, agent occupé, dernière session) — croise la base de l'assistant (`super_agent::open_db`), la config (clients) et `agent_activity` (activité agent). |
| **Frontend** `src/js/dashboard.js` | `createDashboard(container)` : rend les sections, bouton Actualiser, appel `invoke("get_project_dashboard")` + `invoke("get_project_tracking")`. Masque le volet Projet quand `has_project` est faux ; expose `refresh` (rechargement si le projet actif a changé) et `setActive(active)` (activation/désactivation de l'auto-refresh). Auto-refresh configurable (timer `setInterval` piloté par la config, actif seulement quand l'onglet est l'onglet courant). |
| **Onglet** `src/js/tabs.js` | Mode `dashboard` (`_openDashboard`), bouton 📊 dans `index.html` + câblage `main.js`. Position verrouillée (après 🧭, avant ＋) et non-déplaçable quand `dashboard_auto_open` est activé (`_renderTabButton`, `_repositionDashboardTab`). Rafraîchit l'onglet au changement de projet via `dashboardRefresh` (appelé dans `switchTab`). |
| **CSS** `src/css/style.css` | Classes `.dash-*` (cartes, métriques, barres de langages, alertes). |

## Ouverture systématique (Évolution)

- **Config** : champ `dashboard_auto_open` (bool, défaut `false`) dans `AppConfig`
  (`src-tauri/src/lib.rs`), avec `#[serde(default)]`.
- **Paramètres** : case à cocher « Afficher le Tableau de bord systématiquement »
  (`#setting-dashboard-auto-open`) dans `index.html`, chargée/sauvegardée dans
  `src/js/settings.js` (à côté de l'option multi-onglets agents).
- **Démarrage** : dans `src/js/main.js`, après l'ouverture de l'onglet 🧭
  Assistant, si `dashboard_auto_open` est vrai **et** qu'un projet est chargé
  (`window._pilotProjectPath`), ouvrir l'onglet 📊 via `tabs.openFile("Tableau de
  bord", "dashboard")`.
- **Persistance** : dans `src/js/sidebar.js` (`_closeAllTabs`), l'onglet 📊 n'est
  **pas fermé** à la fermeture/bascule de projet (comme l'onglet 🧭 Assistant) :
  il reste affiché et se rafraîchit au changement de projet.
- **Rafraîchissement** : dans `src/js/tabs.js` (`switchTab`), quand l'onglet 📊
  devient actif, `tab.dashboardRefresh()` recharge les données si le projet
  actif a changé depuis le dernier affichage.
- **Position & verrouillage** : dans `src/js/tabs.js`, quand l'option est
  activée, l'onglet 📊 est inséré après l'onglet 🧭 (`.tab-superagent`) et avant
  le bouton ＋ (`.tab-add-agent`), et exclu du drag & drop. Ordre visé :
  🧭 → 📊 → ＋ → π. Quand l'option est désactivée, comportement normal.

## Rafraîchissement automatique (Évolution)

- **Config** : champs `dashboard_auto_refresh` (bool, défaut `true`) et
  `dashboard_auto_refresh_seconds` (u32, défaut `10`) dans `AppConfig`
  (`src-tauri/src/lib.rs`), avec `#[serde(default = …)]`.
- **Paramètres** : case « Activer le rafraîchissement automatique du tableau de
  bord » (`#setting-dashboard-auto-refresh`) + champ durée
  `#setting-dashboard-auto-refresh-seconds` (min 2, max 3600) dans `index.html`,
  chargés/sauvegardés dans `src/js/settings.js`.
- **Frontend** (`src/js/dashboard.js`) : un `setInterval` recharge les données
  tant que l'onglet 📊 est l'onglet actif. Le timer est (re)planifié par
  `scheduleAuto()` à partir de la config ; il est arrêté quand l'onglet devient
  inactif (`setActive(false)` appelé par `tabs.js` dans `switchTab`) et
  relancé à l'activation (`setActive(true)`). La config est rechargée à chaud
  sur l'événement `pilot-config-changed` (réagit au changement de paramètres
  sans redémarrage). Un chargement en cours (bouton Actualiser désactivé) ne
  lance pas de double requête.

## Suivi multi-projets (Évolution)

- **Commande Rust** `get_project_tracking` (`src-tauri/src/dashboard.rs`) :
  retourne `{ projects: […], active }` pour tous les projets ouverts (ou le
  projet actif seul si la liste est vide). Pour chaque projet : chemin, nom,
  client associé (config `super_agent_project_client`), `active` (projet
  actif ?), `agent_busy` (activité agent via `agent_activity` + fenêtre de
  grâce `ACTIVITY_GRACE_SECS`), `task_count` / `open_tasks` (depuis la base de
  l'assistant `super_agent::open_db`), `status` et `last_session` (dernier
  horodatage indexé via `session_history::read_session_index`).
- **Frontend** (`src/js/dashboard.js`) : section « Suivi multi-projets » rendue
  en tête de grille dès qu'au moins un projet est suivi. Tableau récapitulatif
  (projet, client, statut, tâches ouvertes/total, agent occupé/prêt, dernière
  session) + ligne d'insight (nombre de projets, tâches ouvertes, agents
  actifs). Styles `.dash-tracking-*` dans `src/css/style.css`.
- **Réutilisabilité** : `super_agent::open_db` est `pub(crate)` ;
  `rpc::ACTIVITY_GRACE_SECS` est `pub(crate)` (partagé avec le tableau de bord).

## Supervision des agents (P8)

- **Commande Rust** `get_agent_supervision` (`src-tauri/src/dashboard.rs`) :
  vue agrégée des agents en cours sur **tous les projets**, par projet, avec
  leur état. **Réutilise** `AgentService::list_agent_sessions` (P2) — ne
  réinvente pas la supervision. Mapping d'état depuis la machine à états du
  registre : vivant + actif → `running`, vivant + parké → `paused`, processus
  mort → `stopped` (l'état `compacting` n'existe pas encore dans le registre ;
  le frontend l'affiche tel quel s'il apparaît). Retourne `{ projects: […] }`
  avec, par projet : `path`, `name` et `agents` (agent, mode, état, vivant,
  visible, actif).
- **Indicateur circulaire (haut droite)** (`src/js/agent-activity.js`) :
  cercle d'activité respirant dès qu'un agent travaille + liste déroulante au
  clic (poll 2 s de `get_agent_supervision` + push `agent-state-changed`),
  avec fiche et bouton « Afficher l'onglet ». **Filtrage de la liste** : un
  agent de projet dont l'onglet a été fermé (`visible = false`) et qui est au
  repos (ni `running` ni `compacting`) n'apparaît pas dans la liste — il n'est
  qu'une entrée du registre. Un agent **en travail en arrière-plan** reste
  listé même sans onglet (cas d'un agent « parké » lors d'une bascule de
  projet). Le superagent (assistant) et les agents d'assistant ne sont jamais
  filtrés ; un `visible` absent (backend ancien) est traité comme visible.
- **Frontend** (`src/js/dashboard.js`) : carte « Supervision des agents »
  rendue dans la grille dès qu'au moins une session d'agent existe. Tableau
  (projet, agent, état, mode) + ligne d'insight (nombre d'agents en cours).
  États colorés via `.dash-chip-running/-paused/-compacting/-stopped` dans
  `src/css/style.css`.
- **Enregistrement** : commande ajoutée dans `lib.rs` (bloc Tableau de bord).

## Sections & sources de données

| Section | Source |
|---|---|
| En-tête (nom, chemin, client, rafraîchissement) | `state.project_path` + config `super_agent_project_client` + horodatage local |
| Stockage & Poids | Scan récursif du répertoire (exclusion des dossiers de dépendances/caches) + donut code vs non-code + **taille réelle sur disque** (`disk_total_size`, tout compris) |
| Purge des fichiers inutiles | `list_purgeable_items` (détection par écosystème + taille) / `purge_project_items` (suppression validée, .git protégé) |
| État Git | `git rev-parse` / `git status --porcelain` (via `run_captured`) |
| Analyse Code & Langages | Scan des fichiers code (extension → langage), comptage lignes/fonctions/classes, TODO/FIXME, détection des manifests de dépendances + donut de répartition |
| Activité Agent | Index `.pilot/sessions.jsonl` (sessions, tokens 7 j, messages) + scan des fichiers de session pi (actions d'outils) + barres tokens/messages par jour + donut des actions |
| Évolution & Vélocité | `git log --since=7 days ago` (commits) + fichiers modifiés sur 7 j (mtime) + barres commits/fichiers par jour |
| Contexte & Documentation | README (extrait, rendu Markdown), fichiers mémoire/décisions, derniers fichiers modifiés |
| Alertes & Suggestions | Règles : fichiers volumineux, éléments non commités, langage principal, taille globale |

## Purge des fichiers inutiles

Le tableau de bord propose une **purge des fichiers inutiles**, par projet, pour libérer de l'espace disque.

### Détection automatique par écosystème
La commande `list_purgeable_items(project_path)` détecte les éléments purgeables selon l'écosystème du projet (réutilise la détection des manifests) :
- **Node.js** → `node_modules`
- **Rust** → `target`
- **Python** → `__pycache__`, `.venv`, `venv`
- **Tous** → `dist`, `build`, `out`, `logs`, `.cache`, caches éditeurs (`.idea/caches`, `.vscode/.tmp`), fichiers `*.log`, `*.tmp`
- **Git** → option `git gc` (compaction, ne supprime PAS l'historique)

Chaque élément retourné porte `{ name, path, size, category }` (taille calculée par parcours récursif léger).

### Suppression sécurisée
La commande `purge_project_items(project_path, items)` retourne `{ freed, details }` :
- **Sécurité** : chaque chemin est validé (résolu dans le projet ET dans la liste autorisée). Tout le reste est refusé avec une erreur explicite.
- **`.git` est JAMAIS supprimé** (seul `git gc` est proposé, catégorie `git_gc`, exécuté via `run_captured`).
- Suppression par `fs::remove_dir_all` / `fs::remove_file`, avec gestion d'erreur par item (un échec n'arrête pas les autres).
- Retourne la taille libérée et le détail par item (succès/échec + taille).

### Frontend
- Section « Purge des fichiers inutiles » dans la carte Stockage, visible si au moins un élément purgeable est détecté.
- Checkbox + libellé (nom + chemin relatif) + taille pour chaque élément. L'item `git_gc` est affiché à part (« Compacter le dépôt Git (git gc) — ne supprime pas l'historique »).
- Bouton « Purger la sélection » (désactivé si rien coché) → dialogue de confirmation avec récap (liste + taille totale à libérer, action irréversible) → au confirm, `purge_project_items` → feedback « X libérés » + détail → rafraîchissement du dashboard.

### Enregistrement
Commandes `list_purgeable_items` et `purge_project_items` enregistrées dans `src-tauri/src/lib.rs` (bloc Tableau de bord).

## Graphiques (camemberts & barres)

Les graphiques sont dessinés en **SVG inline** (donut via `stroke-dasharray`, barres via
`<rect>`), **sans dépendance externe**, pour un contrôle total du style et la cohérence avec
le CSS existant (classes `.dash-*`). Ils sont générés côté frontend (`src/js/dashboard.js`)
par les helpers purs `donutChart`, `barChart`, `legend` et `insight`.

| Graphique | Données | Emplacement |
|---|---|---|
| Camembert langages | `languages.distribution` (name, percent, files) | Carte Analyse du Code |
| Camembert stockage | `storage.code_size` vs `storage.total_size - code_size` | Carte Stockage & Poids |
| Barres commits / fichiers par jour | `evolution.commits_by_day` / `evolution.files_by_day` | Carte Évolution & Vélocité |
| Barres tokens / messages par jour | `activity.by_day` (date, tokens, messages) | Carte Activité Agent |
| Camembert actions | `activity.actions` (bash, edit, write, autres = total − bash − edit − write) | Carte Activité Agent |

Chaque graphique affiche un **tooltip** au survol, une **légende**, les **pourcentages** et
une **ligne d'insight** (« lecture intelligente ») résumant le point clé.

### Séries temporelles par jour (backend `dashboard.rs`)

- `commits_by_day` : `git log --since=7 days ago --format=%ad --date=short`, agrégé par jour.
- `files_by_day` : mtime des fichiers modifiés sur 7 jours, agrégé par date locale.
- `activity.by_day` : tokens & messages par jour depuis l'index `.pilot/sessions.jsonl`.

Les trois séries couvrent **toujours 7 jours** (les jours sans donnée valent 0), du plus
ancien au plus récent. `scan_project` stocke désormais le mtime (epoch secs) dans
`files_modified_7d` (triplet chemin, taille, mtime).

## Règles

- **Lecture seule stricte** : aucune commande ne modifie les fichiers du projet.
- **Robustesse** : le scan ignore les dossiers exclus (`node_modules`, `target`,
  `.git`, `dist`, `build`, `.venv`, `__pycache__`, `.pilot`, …) et tolère les
  fichiers illisibles / binaires (métriques code limitées aux fichiers texte
  < 2 Mo).
- **Non bloquant** : l'analyse est exécutée dans la commande Tauri (le frontend
  affiche un état « Analyse… » pendant le chargement).
- **Pas de doublon de l'onglet 🧭 Assistant** : l'Assistant est un chat de
  suivi multi-projets ; le Tableau de bord est une vue de métriques du projet
  actif. Le dashboard s'appuie sur la base de l'assistant (client) mais ne
  remplace pas sa conversation.
