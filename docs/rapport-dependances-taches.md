# Rapport — Dépendances entre tâches du suivi (« attend la tâche X »)

> Date : session courante. Périmètre : `G:\IA_PL\pilot` uniquement.
> Commit **local** uniquement (aucun push, aucun tag, aucune publication, aucune
> modification de version). Document rédigé en français avec accents ; le code,
> les tests et les commentaires de code sont en français **sans accents**.

---

## 1. Ce qui a changé, et où

### 1.1 Cœur — schéma et logique (`src-tauri/src/super_agent.rs`)

- **Colonne ajoutée** : `tasks.depends_on_task_id` (INTEGER, référence faible vers
  `tasks.id`), posée par **migration additive** via le mécanisme **existant**
  `ensure_column` (inspection `PRAGMA table_info` puis `ALTER TABLE ... ADD COLUMN`
  idempotent). **Aucune table nouvelle**, **aucune donnée détruite** : une base
  ancienne s'ouvre normalement et gagne la colonne au premier lancement.
- **Helpers purs** (lecture seule) ajoutés :
  - `task_status_of` / `task_title_of` — lecture ciblée d'une tâche ;
  - `dependency_is_waiting` — une dépendance freine tant que la tâche attendue
    existe et n'est **ni terminée ni annulée** (règle unique
    `classify_task_status`, donc un statut libre « à qualifier » freine encore) ;
  - `dependency_state_of` — état dérivé : `ready` / `waiting` / `unknown` ;
  - `dependency_would_cycle` — détection de cycle par parcours **borné**
    (`DEPENDENCY_MAX_DEPTH = 512`), jamais de boucle infinie.
- **`kanban_tasks`** : la requête lit désormais la dépendance en un seul passage
  (`LEFT JOIN tasks d ON d.id = t.depends_on_task_id`) et renvoie sur chaque tâche
  `depends_on_task_id`, `depends_on_title` et `dependency_state`. **Aucun état
  n'est stocké** : il est **recalculé à chaque lecture**, ce qui assure le
  déblocage **automatique** sans geste manuel.
- **Nouvelle commande Tauri** `super_agent_set_task_dependency(app, task_id,
  depends_on_task_id)` :
  - vérifie que les deux tâches existent (message clair sinon) ;
  - **refuse le lien sur soi-même** et **refuse un cycle** (champ libre ou `<= 0`
    = **efface** la dépendance) ;
  - écrit `depends_on_task_id` + `updated_at`, puis renvoie l'état calculé.
- **`super_agent_create_task`** accepte un paramètre optionnel
  `depends_on_task_id` (la tâche créée ne peut pas créer de cycle, mais la tâche
  attendue doit exister).
- **`super_agent_delete_task`** **détache** les dépendances qui pointaient vers la
  tâche supprimée (aucune tâche ne reste « en attente » d'une tâche disparue).
- **Export/import de la mémoire de suivi** : `serialize_tracking` exporte aussi
  `depends_on_task_id`, et `replace_tracking` le **réécrit** dans son second
  passage (même mécanisme que `source_task_id`) pour ne pas perdre la dépendance
  à un export/restauration.
- **Commande enregistrée** dans `src-tauri/src/lib.rs`.

### 1.2 Interface — Kanban (`src/js/super-agent-kanban.js`, `-view.js`, `src/css/style.css`)

- Helpers **purs** ajoutés (aucun DOM) : `taskDependencyState`, `isWaitingDependency`,
  `dependencyLabel`. Un champ absent (cœur plus ancien) est traité comme `ready` :
  l'interface **n'invente jamais** un « en attente ».
- La carte d'une tâche en attente affiche un **badge bleu « En attente de :
  <titre> »** (`super-kanban-card-dependency`, icône `link-2`) et la carte porte
  la classe `waiting-dep` (liseré bleu). C'est **visuellement distinct** du badge
  **rouge** de blocage par incident (`blocker_reason`, `super-kanban-card-blocker`).
- Styles ajoutés juste à côté de ceux du blocage (même structure, couleur
  `--accent` au lieu de `--danger`).

### 1.3 Outils de l'Assistant

- `src-tauri/extensions/pilot-assistant-tools.ts` :
  - `create_task` accepte un paramètre optionnel `dependsOnTaskId` ;
  - **nouvel outil `set_task_dependency`** (`taskId`, `dependsOnTaskId` optionnel)
    qui passe par le sentinelle habituel `PILOT_ASSISTANT_TOOLS::`.
- `src/js/super-agent.js` : l'intercepteur du sentinelle aiguille `create_task`
  vers le nouveau paramètre et gère le nouvel outil `set_task_dependency`
  (traduction camelCase → arguments `snake_case` de la commande Rust).

### 1.4 Tests ajoutés (verrouillage du nouveau comportement)

Cœur (`mod tests` de `super_agent.rs`) :
- `old_tracking_base_opens_and_gains_dependency_column` — **une base ancienne
  (table `tasks` sans la colonne) s'ouvre**, la colonne est **ajoutée**, la donnée
  existante est **conservée**, et `init_db` reste **idempotent** ;
- `dependency_state_follows_closure_without_stored_flag` — `ready` → `waiting` →
  `ready` **sans geste manuel** dès que la tâche attendue est terminée ou annulée ;
  un statut libre freine encore ; un lien mort (`unknown`) **ne freine pas** ;
- `dependency_cycle_and_self_link_are_refused` — chaîne A→B→C permise, cercle et
  auto-lien refusés, base déjà cyclique sans boucle infinie ;
- `kanban_tasks_exposes_dependency_state` — la carte reçoit bien
  `depends_on_task_id`, `depends_on_title` et `dependency_state`.

Interface (`src/js/super-agent-kanban.test.js`) : 3 blocs `describe` couvrant
`taskDependencyState`, `isWaitingDependency`, `dependencyLabel` (état fourni,
champ absent, valeur inconnue, libellé générique sans titre, `null`).

### 1.5 Documentation

- `spec_super_agent.md` : deux ajouts dans le bloc d'aide `HELP:super-agent`
  (bullet « Tâches en attente d'une dépendance » + mention des commandes/outils
  dans la partie pilotage) ; `help/handbook.md` **régénéré** via
  `npm run build:handbook` (ne pas l'éditer à la main).
- `README.md` : une puce utilisateur dans « Kanban de suivi ».

---

## 2. Vérification à l'écran (mode opératoire pour le propriétaire)

1. **Base ancienne conservée** : au premier lancement après cette évolution,
   ouvrir l'onglet **🧭 Assistant** → vue **Kanban** : les tâches existantes sont
   toujours là (la colonne de dépendance est ajoutée en silence).
2. **Poser une dépendance** :
   - via l'**Assistant** : « fais en sorte que la tâche 12 attende la tâche 10 »
     → l'outil `set_task_dependency` s'exécute et répond
     `{ ok, task_id, depends_on_task_id, depends_on_title, dependency_state }` ;
   - ou en créant une tâche avec un `dependsOnTaskId` (`create_task`).
3. **Voir l'état en attente** : la carte de la tâche 12 affiche le **badge bleu
   « En attente de : <titre de la tâche 10> »**, différent du badge **rouge** d'une
   tâche bloquée. Recharger l'onglet : l'état est recalculé (rien n'est figé en base).
4. **Déblocage automatique** : passer la tâche 10 en **terminée** (ou **annulée**,
   glisser-déposer ou menu statut de sa carte) → recharger la vue Kanban : le badge
   bleu de la tâche 12 **disparaît tout seul**.
5. **Refus propre** : demander à l'Assistant « la tâche 10 doit attendre la tâche
   12 » alors que 12 attend déjà 10 → l'outil répond une **erreur claire** de cycle,
   **rien n'est écrit**. Un lien d'une tâche sur elle-même est refusé de la même façon.
6. **Suppression** : supprimer la tâche attendue → aucune carte ne reste « en
   attente de » quelque chose qui n'existe plus.

---

## 3. Résultats des tests (session courante)

- `cargo test --workspace` : **696 passés, 1 ignoré, 0 échec**, et
  **10 avertissements** — **exactement le même nombre et la même liste qu'avant**
  (le module de tests de `super_agent.rs` est compilé hors `cfg(test)`, ce qui
  produit un avertissement d'imports inutilisés **préexistant** ; les 3 nouveaux
  symboles ont été importés **localement dans les tests** pour ne rien y ajouter).
- `npm test` : **88 fichiers, 1567 tests, 0 échec**.

---

## 4. Ce qui reste (et point d'honnêteté)

- **Tout est proprement réalisable** dans le périmètre demandé : aucune partie n'a
  nécessité de contournement fragile. La migration est additive, l'état de
  dépendance est **dérivé** (pas de drapeau à maintenir), les cycles sont refusés
  à l'écriture, et les outils de l'Assistant posent et effacent la dépendance.
- **Limite assumée (non demandée)** : la **modale de création/édition manuelle**
  du Kanban ne propose **pas** encore de champ « dépend de » — la dépendance se
  pose aujourd'hui par l'**Assistant** (outils `set_task_dependency` /
  `create_task`). Ajouter un sélecteur dans la modale demanderait de charger la
  liste des tâches du projet et d'ajouter un contrôle ; c'est un **complément
  possible**, pas un manque du périmètre confiné aux 3 zones demandées.
- **Cas « lien mort » (`dependency_state: "unknown"`)** : normalement impossible
  puisque la suppression détache les dépendances ; s'il apparaissait (base editée
  à la main), il est **signalé mais ne freine pas** et n'est **pas** affiché comme
  une attente — choix volontaire pour ne jamais bloquer sur un lien cassé.
- `docs/architecture-app.md` **n'existe pas** dans le dépôt (vérifié) ; les
  documents de référence utilisés sont `spec_super_agent.md`,
  `docs/rapport-kanban-multiprojets.md`, `docs/suivi-compat-omp.md` et le code.
