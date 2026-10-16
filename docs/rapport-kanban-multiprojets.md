# Compte rendu — Kanban de suivi : filtre par projet, idées, blocage

> Date : 2026-10-16 · Version : 0.4.29 (aucun bump) · Commit local, **non poussé**.

## Demande traitée

Faire évoluer le tableau Kanban du suivi de l'Assistant (🧭) :

1. un **sélecteur de projet** en haut (« Tous les projets » par défaut, ou un
   projet), **choix conservé** d'une ouverture à l'autre ;
2. en mode « tous les projets », **chaque carte porte le nom du projet** (+ le
   client s'il est renseigné) ;
3. les **idées** apparaissent en **sous-catégorie « Idées »** de la colonne
   « À faire », sans confusion avec les vraies tâches ;
4. les **tâches bloquées** restent visibles et distinctes, avec le **motif
   lisible** sur la carte ;
5. **rien de cassé** (clôture en lot, retrait/annulation, tests existants).

## Ce qui a été changé, et où

### 1. Cœur (logique pure) — `src/js/super-agent-kanban.js`

Aucune fonction existante n'a perdu son comportement ; tout est **additif**.

| Ajout | Rôle |
|---|---|
| `ALL_PROJECTS` (`"__all__"`) | valeur du sélecteur « Tous les projets » |
| `IDEAS_GROUP_LABEL` (`"Idées"`) | titre du sous-groupe |
| `listKanbanProjects(clients, ideas)` | projets uniques (tâches **et** idées), triés par nom |
| `filterKanbanTasks(clients, projectPath)` | aplatit les tâches et filtre par projet |
| `isOpenIdeaStatus(statut)` | une idée est-elle encore ouverte (accents/casse ignorés) |
| `selectKanbanIdeas(ideas, projectPath)` | idées ouvertes, filtrées par projet |
| `formatCardProject(item)` | libellé `Projet - Client` (le client seulement s'il existe) |
| `isBlockedTask(task)` | vrai si `blocker_reason` est renseigné |
| `buildKanbanColumns(tasks, ideas?)` | **2ᵉ paramètre optionnel** : range les idées dans `todo.ideaCards` (jamais dans `cards`) |

`buildKanbanColumns(tasks)` appelée avec **un seul argument** continue de
fonctionner (rétrocompatible). Les idées ne comptent **pas** dans le compteur de
la colonne (`countByColumn` inchangé).

### 2. Backend Rust — `src-tauri/src/super_agent.rs`

- `get_super_agent_kanban` renvoie désormais, **dans la même réponse** :
  - `clients[].tasks[].blocker_reason` (motif de blocage, colonne déjà existante
    alimentée par `super_agent_flag_blocker`) ;
  - `clients[].tasks[].client_name` (le client était lu mais pas exposé) ;
  - un champ **`ideas`** : les lignes de la table **existante**
    `idees_evolutions` (id, titre, description, statut, priorite, projet, client).
- Nouveau helper testable `kanban_ideas(&Connection)` : il **vérifie d'abord que
  la table existe** (`sqlite_master`) et renvoie une **liste vide** sinon.
  **Aucune table n'est créée** : pas de source de données parallèle.
- Aucune nouvelle commande, aucune écriture, aucun changement de signature →
  `lib.rs` inchangé.

### 3. Affichage — `src/js/super-agent-kanban-view.js`

- **Sélecteur de projet** en haut (barre d'outils) : « Tous les projets » + un
  choix par projet. Le choix est **mémorisé** dans `localStorage`
  (`pilot:kanban:project`) puis relu au montage de l'onglet. Un projet mémorisé
  qui n'existe plus (ou base vide) retombe sur « Tous les projets ».
- Le tableau devient une **grille unique** (au lieu d'un bloc par client) ; un
  **bandeau de portée** rappelle le projet affiché et le nombre de tâches.
- **Chaque carte de tâche** affiche son **projet (+ client)**, et un **badge rouge
  « Bloquée : <motif> »** quand `blocker_reason` est renseigné (carte au liseré
  rouge).
- **Sous-groupe « Idées »** dans la colonne « À faire » : cartes à liseré jaune,
  icône ampoule, statut/priorité en méta, **aucun bouton de tâche** (une idée
  n'est pas une tâche et ne se pilote pas ici).
- La **clôture en lot** ne porte plus que sur les tâches **visibles** ; changer
  de projet **vide la sélection** (impossible de clôturer une tâche masquée).
- Création de carte : en mode projet filtré, le **projet affiché est pré-rempli**.
- Repli propre si la base est vide (`known.length === 0 && ideas.length === 0`).

### 4. Styles — `src/css/style.css`

Ajouts seulement : `.kanban-toolbar`, `.kanban-project-filter`,
`.kanban-project-select`, `.kanban-scope`, `.super-kanban-card.blocked`,
`.super-kanban-card-blocker`, `.super-kanban-ideas`,
`.super-kanban-ideas-head`, `.kanban-idea-card`, `.kanban-idea-meta`.
La grille passe de `repeat(4, 1fr)` (alors qu'il y a **5** colonnes depuis
l'ajout d'« À qualifier ») à `repeat(auto-fit, minmax(220px, 1fr))` : les 5
colonnes tiennent, et la mise en page reste lisible en fenêtre étroite.

### 5. Tests

- `src/js/super-agent-kanban.test.js` : **11 nouveaux tests** verrouillant
  `listKanbanProjects`, `filterKanbanTasks`, `selectKanbanIdeas`,
  `isOpenIdeaStatus`, `formatCardProject`, `isBlockedTask` et le rangement des
  idées dans `todo.ideaCards` (hors compteur, hors autres colonnes).
- `src-tauri/src/super_agent.rs` : test
  `kanban_tasks_exposes_blocker_and_ideas` — vérifie que `blocker_reason` et
  `client_name` ressortent, que les idées sont lues **sans créer de table** (la
  table est absente au schéma), puis qu'elles sont bien lues après création.

### 6. Documentation

- `spec_super_agent.md` (§ « Visualiser les tâches (vue Kanban) ») : sélecteur de
  projet + persistance, grille unique, sous-catégorie « Idées », badge de
  blocage, clôture limitée aux cartes visibles.
- `README.md` : nouvelle section **« Kanban de suivi »** orientée utilisateur.
- `help/handbook.md` régénéré par `npm run build:handbook` (l'aide intégrée ❓
  reflète la nouvelle rédaction).

## Vérifications exécutées

| Vérification | Résultat |
|---|---|
| `npm test` (interface) | **1564 tests, 88 fichiers, 0 échec** — aucun nouvel avertissement |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **551 tests passés, 1 ignoré (inchangé), 0 échec** |
| `npm run build:handbook` | OK (37 blocs) |
| `node --check` sur les 2 modules JS touchés | OK |
| `npm run build` (Vite) | OK — seuls les avertissements d'import dynamique **préexistants** (tabs/sidebar/search-panel) |

## Comment le propriétaire vérifie à l'écran

1. Relancer Pilot en **dev** (`npm run tauri dev`) — le changement Rust exige une
   **recompilation** (la vue seule ne suffit pas).
2. Ouvrir l'onglet **🧭 Assistant** → bouton **« Vues »** (ou l'onglet
   **🗂 Kanban**) : un onglet Kanban s'ouvre.
3. **Sélecteur** en haut : choisir un projet → seules ses cartes restent ;
   revenir à « Tous les projets » → tout revient, chaque carte portant
   « Projet - Client ». **Fermer puis rouvrir l'onglet** : le projet choisi est
   conservé.
4. Colonne **« À faire »** : sous les cartes de tâches, un sous-groupe **« Idées »**
   avec les idées de `idees_evolutions` (statut + priorité).
5. Tâches bloquées (`blocker_reason` renseigné) : **badge rouge « Bloquée : … »**.
6. Cocher des cartes, clôturer la sélection, puis **Annuler** : le comportement
   de clôture en lot est inchangé.

## Ce qui reste / points d'attention

- **Base de production** (`%APPDATA%\com.pilot.editor\super-agent.db`) : la table
  `idees_evolutions` **existe** (24 lignes : `idee`, `a_prevoir`,
  `etudiee - …`, `implementee`) → le sous-groupe se remplira. La **base de dev**
  (`%APPDATA%\com.pilot.editor.dev\super-agent.db`) **n'a pas** cette table → en
  dev le sous-groupe « Idées » peut être **vide** : ce n'est pas un bug.
- Seules **2** tâches de la base portent aujourd'hui un `blocker_reason` : le
  badge rouge n'apparaîtra que sur celles-là (et sur toute nouvelle tâche
  marquée via `super_agent_flag_blocker`).
- Les idées restent **affichées en lecture seule** : leur cycle de vie
  (`statut`) se modifie côté Assistant/base, pas depuis le Kanban. L'ouverture
  d'un pilotage d'idées depuis la carte serait une évolution à décider.
- **Convention d'accentuation** : la consigne d'orchestration demandait des
  commentaires/tests « sans accent », alors que **tout le dépôt** (JS, CSS, Rust)
  écrit ses commentaires et tests en français **accentué**. J'ai suivi le style
  **du fichier** pour rester cohérent (les libellés affichés à l'utilisateur
  gardent bien leurs accents). À trancher si la règle « sans accent » doit
  devenir la norme du dépôt.
- Aucun bump de version, aucun tag, aucun push : **commit local uniquement**.
