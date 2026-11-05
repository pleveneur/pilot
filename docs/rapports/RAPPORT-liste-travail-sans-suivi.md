# Rapport — la liste de travail ne montre plus le suivi

Décision du propriétaire (2026-11-05, réaffirmée deux fois, sans appel) : le
panneau **« Travail »** (bouton `#agent-activity`, onglets Agents / Tâches /
Événements, présent en mode **Détaillé** **et** en mode **Vocal**) est le **plan
de travail des agents**. Il ne montre **que** les missions d'agents : celles qui
tournent et celles qui attendent dans la file.

## Ce qui a été retiré

Le groupe **« Suivi (n) — suivi seul, aucun agent ne travaille dessus »**, inséré
sous les missions par un correctif antérieur (RAPPORT-liste-taches-affichee.md).
Le propriétaire y voyait défiler ses tâches internes, anciennes et terminées,
dans la liste qui doit dire **qui travaille**.

Le retrait porte sur **l'insertion à l'écran**, pas sur le suivi :

| Élément | État |
|---|---|
| `src/js/taches-suivies-ecran.js` (module) | **INTACT** — aucune fonction retirée |
| `openTrackedTasks` / règle `isOpenTaskStatus` | **inchangée** |
| `renderTrackedTasksGroupHtml` | **conservé** (plus aucun appelant dans le volet) |
| `loadTrackedTasks` (mémoire 5 s, une requête en vol) | **inchangé** |
| `notifyTrackedTasksChanged` / `onTrackedTasksChanged` | **inchangés**, toujours posés par le Kanban et la fin de tour de l'Assistant |
| Kanban de l'assistante, base de suivi, statuts | **aucune modification**, aucune donnée supprimée |

Dans `src/js/super-agent.js` (seul fichier de production touché) :

- l'import du module se réduit à `notifyTrackedTasksChanged` (le signal que le
  Kanban écoute) ;
- `renderSuperMissions` ne compose plus que les missions :
  `superTasksList.innerHTML = renderMissionsPanelHtml(missions);` ;
- `renderSuperTrackedTasksHtml`, `refreshSuperTrackedTasks`, l'état
  `superTrackedTasks` / `superTrackedHtml` / `superTrackedUnsub`, l'abonnement au
  signal dans `startSuperMissionsWatch` et la relecture forcée à l'ouverture du
  volet sont supprimés.

## Ce qui est conservé

- Les **missions d'agents** : groupes « En cours », « Démarrage », « En attente »,
  avec libellé, rang et durée — rendu inchangé (`renderMissionsPanelHtml`).
- Le **message honnête** quand il n'y a rien : « **Aucune mission en cours.** »
  (déjà produit par `renderMissionsPanelHtml`) — jamais une liste vide muette,
  jamais le suivi en remplacement.
- Le **compteur** du bouton « Travail » : il n'a jamais compté le suivi, il compte
  les missions (en cours + en attente). Aucun changement.
- Le **suivi** et son onglet **Kanban** : création, statuts, filtres, idées.
- Le panneau **Vocal** : mise en page et boutons inchangés ; seule la
  composition du volet « Tâches » change, comme en mode Détaillé.

## Tests

| Commande | Résultat |
|---|---|
| `npx vitest run` (suite front complète) | **5614 tests, 0 échec** |

### Verrou remplacé

`src/js/taches-suivies-affichees.test.js` exigeait la **présence** du groupe
(`... + renderSuperTrackedTasksHtml()`). Il a été **inversé** : il exige
désormais l'**absence** et échoue si quelqu'un réintroduit le groupe.

Il vérifie maintenant :

1. la composition du volet vaut `renderMissionsPanelHtml(missions);` seule et
   n'est **jamais** concaténée à autre chose ;
2. **aucune** trace du groupe dans l'écran : ni `renderTrackedTasksGroupHtml`,
   ni `renderSuperTrackedTasksHtml`, ni `refreshSuperTrackedTasks`, ni
   `loadTrackedTasks`, ni `onTrackedTasksChanged`, ni les variables d'état, ni la
   phrase « aucun agent ne travaille dessus » ;
3. le **module reste intact** (règle « ouverte ou close », dédoublonnage, mémoire
   courte, signal) et le Kanban continue de signaler ses écritures ;
4. une tâche du suivi **n'apparaît jamais** dans le HTML du volet, alors que le
   groupe — s'il était concaténé — l'afficherait (preuve que l'absence est un
   choix, pas un oubli) ; les missions, elles, sont bien là ;
5. sans mission, le volet dit « Aucune mission en cours. » et ne contient aucune
   tâche du suivi ;
6. le compteur ne joint **jamais** `get_super_agent_kanban`.

**Preuve par mutation** : en réintroduisant la concaténation
`renderMissionsPanelHtml(missions) + renderSuperTrackedTasksHtml()`, **2 tests
échouent** ; le code restauré, les 24 passent.

### Test existant adapté (et pourquoi)

`src/js/panneau-suivi-trois-onglets.test.js` (« volet Taches : missions reelles +
mention « en attente » ») vérifiait la concaténation exacte
`renderMissionsPanelHtml(missions) + renderSuperTrackedTasksHtml()` : c'était le
seul autre endroit qui **dépendait du comportement retiré**. Il exige maintenant
la composition seule et l'absence de `renderSuperTrackedTasksHtml()` ; toutes ses
autres assertions (groupes, « en attente », rangs numérotés) sont conservées à
l'identique — le verrou n'est pas affaibli, il change de sens.

Aucun autre test ne dépendait de l'ancien groupe.

## Documentation

- `spec_super_agent.md` : la section d'aide « Voir les tâches suivies dans le
  panneau « Travail » » devient « Le panneau « Travail » ne montre que le travail
  des agents » (bloc `<!-- HELP:super-agent -->`) ; la description du volet
  « Tâches » dit désormais que le suivi n'y est **pas** inséré.
- `help/handbook.md` **régénéré** par `npm run build:handbook`.
- `AGENTS.md` : description du module `taches-suivies-ecran.js` mise à jour
  (module intact, plus inséré, verrou inversé, nouveau rapport).
