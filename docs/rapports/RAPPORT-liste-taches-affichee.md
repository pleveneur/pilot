# Rapport — la liste de tâches affichée et le suivi réel

Date : 2026-11-16 · Portée : volet « Tâches » du panneau du suivi du travail
(`#agent-activity-pane-tasks`) + onglet Kanban (`superagent-kanban`).

## 1. Ce que le propriétaire constate

1. Créer / annuler / regrouper une tâche **dans le suivi** ne change rien à l'écran.
2. Le nombre affiché ne correspond pas aux tâches ouvertes réelles.
3. Impossible de distinguer une tâche **seulement suivie** d'un travail **en cours**
   ou **en attente**.
4. Après l'arrêt manuel d'un agent, la file semble vide : aucune tâche en attente,
   aucune tâche déclenchée.

## 2. Cause réelle (lue dans le code, mesurée sur la base)

### Cause A — l'écran ne lit pas la base de suivi (symptômes 1, 2 et 3)

Deux sources différentes alimentent ce que l'on appelle « les tâches » :

| Ce qui est affiché | Ce qui le calcule | Source |
|---|---|---|
| Volet « Tâches » (et colonne de droite du mode Vocal) | `buildRunningMissions` → `splitMissions` → `renderMissionsPanelHtml` (`agent-activity.js`) | store d'activité des agents (missions **en cours / en démarrage / en attente**) |
| Onglet Kanban | `get_super_agent_kanban` → `kanban_tasks` (`super_agent.rs`) | base de suivi `~/.pilot/super-agent.db` |

Le volet « Tâches » **ne lit jamais la base de suivi** : `renderSuperMissions`
(`super-agent.js`) ne compose que `renderMissionsPanelHtml(missions)`, où
`missions` vient de `buildRunningMissions(getAgentActivitySnapshot().list, …)`.
Aucun appel à `get_super_agent_kanban` n'existe sur ce chemin.

Le pont était pourtant prévu et déjà écrit : `super-agent-kanban.js` exporte
`isOpenTaskStatus` (« L'onglet « Tâches » du suivi du travail ne montre que le
travail qui reste à faire »), `filterOpenTasksByClient` et
`filterUnqualifiedTasksByClient`. Ces trois fonctions pures **n'ont aucun
appelant en production** (uniquement `super-agent-kanban.test.js`). Le
branchement n'a jamais été fait.

Conséquences directes, sans supposition :

- une tâche créée / annulée / regroupée dans le suivi n'a **aucun** effet sur ce
  volet : il ne relit pas la base ;
- le nombre affiché ne peut être qu'un nombre de **missions**, jamais un nombre
  de tâches suivies : les deux nombres ne peuvent donc pas coïncider ;
- une tâche seulement suivie (jamais confiée à un agent) n'apparaît nulle part
  dans ce volet : elle ne peut pas être distinguée d'un travail en cours.

### Cause B — aucune reprise automatique après un changement venu d'ailleurs (symptôme 1)

L'onglet Kanban, seul écran qui lit la base, n'a **aucun abonnement** : `refresh`
n'est appelé qu'à l'ouverture de l'onglet (`tabs.js`), à la bascule sur celui-ci
et par ses propres écritures (`loadSuperKanban()` après création / déplacement /
suppression / clôture en lot). Une tâche créée par l'Assistant pendant la
conversation, ou par une autre vue, n'apparaît qu'après une bascule d'onglet.

### Cause C — le compteur « tâches ouvertes » du Tableau de bord était faux (symptôme 2)

`src-tauri/src/dashboard.rs` comptait les tâches ouvertes en SQL :

```sql
SUM(CASE WHEN t.status NOT IN ('done','cancelled','closed') THEN 1 ELSE 0 END)
```

Liste de statuts **anglais**, alors que la base stocke du **texte libre
français**. Mesure : pour le projet `G:\IA_PL\pilot`, la requête annonçait
**325 « ouvertes » sur 325** là où la règle du Suivi en compte **21**. Le nombre
affiché (`ouvertes / total`) ne pouvait donc pas correspondre aux tâches
ouvertes réelles.

### Cause D — arrêt manuel et file d'attente (symptôme 4) : déjà verrouillé, non régressé

Vérifié dans le code et par les verrous existants :

- un arrêt **ciblé** (`stop_agent`) **conserve** la file et la trace en nommant la
  mission — `src/js/file-attente-arret-conserve.test.js` (régression du
  2026-10-20 : une mission #14 avait été détruite) ;
- un arrêt **global** (« tout arrêter ») vide les files, mais chaque demande
  perdue est **journalisée** (`.pilot/agent-stops.log`, `reason=queue-abandoned`,
  `detected=clear-all-runs`) **et annoncée dans la conversation** (`emit("notify")`,
  affiché par le panneau et le chat) — `src/js/regle-4-file-jamais-perdue.test.js`.
  Après un arrêt global, la file est donc vide **volontairement** et l'arrêt est
  dit : aucune demande orpheline silencieuse.
- Aucun doublon possible entre les deux familles affichées : les missions en
  file sont produites par une seule source (`collectQueuedMissions`, cinq
  familles disjointes) et les tâches du suivi sont **dédoublonnées par
  identifiant** avant d'être peintes — une même tâche renvoyée deux fois par la
  base ne produit qu'une ligne (`openTrackedTasks`).

### Mesure sur la base locale (au moment du diagnostic)

`~/.pilot/super-agent.db` — 407 tâches, 19 projets. Règle unique « ouverte ou
close » (`classify_task_status`, miroir de `normalizeTaskStatus`) :

| Classe | Nombre |
|---|---|
| ouvertes (`demande` 27 + `en_cours` 5) | **32** |
| closes (`terminee` 309, `livree` 25, `livre_a_tester` 3, `fermee` 1, statut libre « terminee - … » 1) | 339 |
| annulées (`annulee`) | 30 |
| à qualifier (`reporte` 5, `en_attente_oubli_volontaire` 1) | 6 |

Projet `G:\IA_PL\pilot` seul : **21 ouvertes** (16 `demande` + 5 `en_cours`).
Le volet « Tâches » affichait **0** de ces tâches : il n'en lit aucune.

## 3. Correction (la plus petite possible)

Aucun écran redessiné, aucun calcul existant remplacé, aucun test assoupli.

1. **Nouveau module `src/js/taches-suivies-ecran.js`** (décisions pures +
   un chargeur fail-open) :
   - `openTrackedTasks(kanban)` : lit la réponse `get_super_agent_kanban`,
     applique la **règle unique** `isOpenTaskStatus`, **dédoublonne par id de
     tâche** (une tâche ne peut pas apparaître deux fois, même si elle est
     renvoyée deux fois) et rend `{ id, titre, statut, libellé, projet, client }` ;
   - `renderTrackedTasksGroupHtml(tasks)` : un **troisième groupe** explicite
     « Suivi (n) — suivi seul, aucun agent ne travaille dessus », chaque ligne
     portant le libellé de son statut (« À faire », « En cours », « À valider ») ;
     liste vide ⇒ **rien** (aucun en-tête vide, aucun message ajouté) ;
   - `loadTrackedTasks({ force })` : mémoire courte (5 s), une seule requête en
     vol, échec ⇒ dernière liste connue (jamais d'exception, jamais d'écran vide
     sur une panne) ;
   - `notifyTrackedTasksChanged()` / `onTrackedTasksChanged(cb)` : un seul signal
     « le suivi a changé » (aucun second mécanisme).
2. **`super-agent.js`** : `renderSuperMissions` compose désormais
   `renderMissionsPanelHtml(missions) + renderTrackedTasksGroupHtml(tasks)` et
   rafraîchit le groupe (mémoire courte). Le compteur du bouton « Travail »
   n'est **pas** touché : il continue de compter les missions
   (`splitMissions`), et le groupe « Suivi » s'annonce comme tel.
3. **`super-agent-kanban-view.js`** : chaque écriture (création, édition,
   déplacement, suppression, clôture en lot, annulation de lot) appelle le même
   signal, et la vue réagit au signal venu d'ailleurs (assistant, autre vue) en
   relisant la base. Plus de photo périmée tant que l'onglet est ouvert.
4. **`src-tauri/src/dashboard.rs`** : le nombre de tâches **ouvertes** n'est plus
   compté en SQL. La requête rend une ligne par tâche et le compte suit la règle
   unique `is_open_task_status` (qui délègue à `super_agent::classify_task_status`,
   miroir de `normalizeTaskStatus`) : ouvertes = à faire, en cours, à valider.
   Une tâche close, annulée ou à qualifier n'est plus jamais annoncée ouverte.
5. **`src/css/style.css`** : deux règles pour le groupe « Suivi » (couleur
   neutre, curseur par défaut — une ligne de suivi n'est pas cliquable).

## 4. Différence visible

- Le volet « Tâches » montre maintenant **trois familles distinctes** :
  « En cours (n) » (avec son rang et sa durée), « Démarrage (n) », « En attente
  (n) » — les missions — puis **« Suivi (n) »** : les tâches du suivi qui restent
  à faire, chacune avec son statut. Une tâche seulement suivie ne peut donc plus
  être confondue avec un travail en cours ou en attente.
- Le nombre de tâches du suivi est enfin **lisible à l'écran** : il peut être
  comparé aux tâches ouvertes de la base (même règle « ouverte ou close »).
- Créer / annuler / regrouper une tâche **depuis le Kanban** met à jour le volet
  immédiatement ; une tâche créée **par l'Assistant** apparaît sans rebasculer
  d'onglet (au plus tard au prochain rafraîchissement du volet, ≤ 5 s).
- Le **Tableau de bord** affiche enfin le bon rapport `ouvertes / total` (21/325
  pour le projet Pilot, au lieu de 325/325).

## 5. Verrou

`src/js/taches-suivies-affichees.test.js` : échoue si

- une tâche close / annulée / à qualifier est affichée comme « suivie » ;
- une tâche peut apparaître deux fois (doublon) ;
- le volet cesse de composer le groupe « Suivi » après les missions
  (ancres de source dans `super-agent.js`) ;
- le Kanban cesse de signaler ses écritures ou de réagir au signal
  (ancres de source dans `super-agent-kanban-view.js`).

Côté Rust, `dashboard::tests::une_tache_ouverte_suit_la_regle_du_suivi` échoue si
le compte des tâches ouvertes redevient une comparaison de chaînes (statuts
français réels contre liste anglaise).

## 6. Tests réels

| Suite | Résultat |
|---|---|
| `npx vitest run` (front) | **5560 tests passés, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **901 passés, 3 ignorés, 0 échec** |
| `node ./node_modules/vite/bin/vite.js build` | build OK |

## 7. Re-vérification (2026-11-04)

Le lien entre l'affichage et le suivi est relu sur le code réellement présent,
puis éprouvé par MUTATION (le verrou doit tomber) ; rien n'a été modifié dans le
code, la correction est en place telle que décrite ci-dessus.

**Les quatre branchements existent, un seul point chacun :**

| Point | Emplacement |
|---|---|
| composition du volet | `super-agent.js` — `renderMissionsPanelHtml(missions) + renderSuperTrackedTasksHtml()` (missions PUIS suivi, un seul `innerHTML`) |
| relecture de la base | `super-agent.js` — `refreshSuperTrackedTasks` → `loadTrackedTasks` (mémoire 5 s, une requête en vol) |
| signal unique | `super-agent.js` (abonnement `onTrackedTasksChanged`, fin de tour `agent_end`) + `super-agent-kanban-view.js` (chaque écriture → `notifyTrackedTasksChanged`) |
| règle « ouverte ou close » | `taches-suivies-ecran.js` (`isOpenTaskStatus`) et `dashboard.rs` (`is_open_task_status` → `classify_task_status`) |

**Mutation mesurée** — retirer le groupe « Suivi » de la composition du volet
(`renderMissionsPanelHtml(missions) + renderSuperTrackedTasksHtml();` →
`renderMissionsPanelHtml(missions);`) fait ÉCHOUER le verrou :

```
AssertionError: expected '// super-agent.js — Assistant de suiv…'
  to contain 'renderMissionsPanelHtml(missions) + r…'
  at src/js/taches-suivies-affichees.test.js:250:17
FAIL (1) — PASS (18)
```

Le fichier a été restauré aussitôt (`git diff --stat` vide) : l'écran ne peut
donc pas cesser de refléter le suivi sans que la suite le dise.

**Chiffres réels du jour :**

| Suite | Résultat |
|---|---|
| `npx vitest run` (front, complet) | **5594 passés, 0 échec** |
| `npx vitest run src/js/taches-suivies-affichees.test.js` | **19 passés, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **902 passés, 3 ignorés, 0 échec** |

Les deux verrous du symptôme 4 (file conservée à l'arrêt ciblé, demande perdue
journalisée et annoncée à l'arrêt global) sont présents et verts :
`src/js/file-attente-arret-conserve.test.js`, `src/js/regle-4-file-jamais-perdue.test.js`.
