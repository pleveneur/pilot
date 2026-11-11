# Rapport — « un agent qui travaille sans onglet doit apparaître dans la liste »

Date : 2025 (session courante) — Tâche : visibilité des agents en arrière-plan.
Périmètre respecté : **uniquement l'affichage**. Aucune modification du
lancement des agents, de la file d'attente, des règles d'arrêt ni des trois
points d'audit en cours (abandons de file, marqueurs d'arrêt, matrice).

## 1. Symptôme et cause réelle

Symptôme : un agent lancé en arrière-plan (ou dont l'onglet a été fermé)
travaille réellement, mais l'utilisateur ne voit rien et conclut que rien ne se
passe.

Diagnostic (sur le code, pas sur l'impression) :

1. **Liste du cercle d'activité** (`src/js/agent-activity.js`,
   `flattenAgents`) : la règle de filtrage portait sur `busy` et `alive`, jamais
   sur « il travaille ». Un agent en train d'exécuter un **outil long**
   (compilation, tests) est silencieux (`busy === false`) ; s'il n'avait pas
   d'onglet et que son processus n'était pas encore vu vivant, il était
   **écarté alors qu'il travaillait**. Inversement, une session vivante au repos
   restait listée sans qu'on puisse distinguer « au repos » de « en train de
   travailler ».
2. **Panneau « Activité » de l'onglet 🎭 Agents** (`src/js/agents-ui.js`) :
   il n'était alimenté QUE par les événements du bus d'agents. Un agent lancé en
   arrière-plan par l'assistant, ou une run qui n'a pas été lancée depuis cet
   écran, n'y apparaissait **jamais** : l'écran affichait « Aucune run en
   cours. » alors qu'un agent travaillait. C'est la cause principale du constat
   utilisateur sur cet écran.
3. Rien n'indiquait, dans l'entrée, que la session travaillait **sans onglet** :
   l'utilisateur devait deviner.

Côté Rust, **aucune correction nécessaire** : `get_agent_supervision`
(`src-tauri/src/dashboard.rs`) transmet déjà `state`, `alive`, `visible`,
`active`, `busy` sémantique via `state`, `toolInProgress` et `isWorking`. Le
défaut était purement frontend (source de données incomplète + règle de vérité
mal formulée).

## 2. Règle retenue

La seule vérité est **« la session travaille »**, jamais « un onglet est
ouvert » :

- `isAgentWorking(agent)` (pure) : vrai si `working` (calculé) ou `busy` ou
  `toolInProgress` ou `isWorking`. Un agent **vivant au repos n'est jamais
  travaillant**.
- `isWorkingWithoutTab(agent)` (pure) : `isAgentWorking` **et**
  `visible === false`. Visibilité inconnue (backend ancien) → on n'affirme rien
  (aucun badge erroné).
- **Filtrage** (`flattenAgents`) : une session qui **travaille** est **toujours
  listée**, avec ou sans onglet. Une session qui ne travaille pas n'apparaît que
  si son onglet est ouvert (`visible`) ou si son processus pi est encore vivant
  (`alive`). Morte **et** sans onglet → écartée (aucune entrée fantôme).
  L'assistant (projet `""`) et les agents d'assistant (`__assistant__`) ne sont
  jamais filtrés.

## 3. Ce qui a été fait

### 3.1 Socle partagé (une seule vérité, zéro duplication)

`src/js/agent-activity.js` :

- `flattenAgents` calcule `working` (travail effectif) et propage `working` et
  `visible` dans chaque entrée ; le filtre applique la règle du §2.
- Nouvelles fonctions **pures** exportées : `isAgentWorking`,
  `isWorkingWithoutTab`, `buildBackgroundWorkMissions`,
  `renderBackgroundWorkersHtml`.
- `buildRunningMissions` (volet « En cours » du panneau de la cloche) utilise
  désormais `isAgentWorking` au lieu de `busy || toolInProgress` : une session
  `isWorking` est comptée comme travaillante. Comportement inchangé sur les
  charges actuelles (additif).
- `renderDropdown` : l'entrée d'une session qui travaille sans onglet porte
  **`working-background`** et un badge dédié **`agent-activity-item-bg`**
  (« arrière-plan », infobulle explicite), pastille respirante. Nom + projet
  restent affichés.
- `renderCard` : la fiche dit **« Travail (arrière-plan) »** et
  **« Onglet : Aucun (arrière-plan) »** (ou « Repos » / « Ouvert »).

### 3.2 Panneau « Activité » de l'onglet 🎭 Agents

`src/js/agents-ui.js` :

- Abonnement à `subscribeAgentActivity` (le **store partagé déjà utilisé** par
  le cercle d'activité et par le volet « En cours »), pas un polling propre, pas
  d'appel à `list_agent_sessions`.
- Le bloc **« Travail en arrière-plan (aucun onglet ouvert) »** liste chaque
  session qui travaille sans onglet : **agent + projet + mission**, via
  `buildBackgroundWorkMissions` / `renderBackgroundWorkersHtml`.
- Le bloc est calculé **avant** la sortie anticipée : il s'affiche même si le
  bus n'a vu aucune run (`isRunning` faux, `agentStates` vide). L'en-tête dit
  alors « ▶ Travail en arrière-plan ».
- Désabonnement dans `cleanup()` (`activityUnsub()`), à côté de
  `destroyAgentsBus()` : aucun abonné fantôme après fermeture de l'onglet.
- Le bloc est **purement informatif** : aucun `<button>`, aucun appel
  d'ouverture d'onglet, aucun changement d'onglet actif, aucun focus volé.

### 3.3 Style

`src/css/style.css` : `.agent-activity-item-bg` (badge), mise en valeur
`.agent-activity-item.working-background`, et `.agent-status-card.working-background`
(bordure accentuée). Variables de thème existantes, dark/light respectés.

### 3.4 Documentation

- `spec_gestion_agents.md` (bloc `<!-- HELP:agents -->`, aide utilisateur) :
  bloc « Travail en arrière-plan » du panneau Activité + règle « travailler sans
  onglet reste visible » (repère « arrière-plan », disparition à l'arrêt, repos
  jamais présenté comme travaillant, ouverture d'onglet toujours manuelle).
- `spec_dashboard.md` § Supervision des agents (P8) : règle de filtrage reformulée
  (« la session travaille », `isAgentWorking` / `isWorkingWithoutTab`), socle
  partagé et branchement du panneau Activité.
- `help/handbook.md` **régénéré** via `npm run build:handbook` (42 blocs).

## 4. Preuve — tests

Fichiers : `src/js/agent-activity.test.js` (complété) et
`src/js/agents-ui-travail-arriere-plan.test.js` (nouveau, 6 tests).

Cas exigés par la demande :

| Exigence | Test |
|---|---|
| Une session qui **travaille sans onglet apparaît** | `flattenAgents` propage `working`/`visible` ; `renderDropdown` contient `agent-activity-item-bg` + « arrière-plan » + pastille `breathing` ; `buildBackgroundWorkMissions` produit l'entrée `{agentId, kind, agent, project, mission}` ; `renderBackgroundWorkersHtml` contient agent + projet + mission |
| Une session **vivante au repos n'apparaît pas comme travaillante** | `working === false`, `anyBusy === false`, `isWorkingWithoutTab === false`, aucun badge, aucune pastille `breathing`, bloc arrière-plan vide, `renderCard` dit « Repos » |
| Une session **morte disparaît** | `flattenAgents` → `[]`, `buildBackgroundWorkMissions` → `[]`, HTML `""` |
| L'entrée dit **projet + agent + arrière-plan** | assertions sur `codeur`, `pilot`, badge/libellé ; `renderCard` → « Travail (arrière-plan) » / « Aucun (arrière-plan) » |
| **Jamais d'onglet ouvert** automatiquement | `updateActivity` ne contient ni `_openAgent`, ni `openFile`, ni `setActiveTab` ; le bloc rendu ne contient aucun `<button>` ; l'ouverture reste le bouton manuel « Afficher l'onglet » |
| Branchement réel (pas de code mort) | tests lisant la source (`agents-ui.js`, lecture normalisée CRLF) : import des helpers, `activityUnsub = subscribeAgentActivity(`, alimentation de `backgroundMissions`, rendu **avant** la sortie anticipée, `${backgroundHtml}` dans le HTML, désabonnement dans `cleanup()` |

### Contre-preuve (obligatoire) — vérifiée par neutralisation

Neutralisation temporaire de la production (sauvegardes puis restauration) :

1. retour à l'ancienne règle de filtre (`visible === false && !busy` puis
   `!alive`) → **rouge** : « une session qui TRAVAILLE est listee… » ;
2. suppression du badge `agent-activity-item-bg` → **rouge** : « affiche le
   badge arriere-plan pour une session qui travaille sans onglet » ;
3. suppression de l'abonnement `subscribeAgentActivity` dans `agents-ui.js` →
   **rouge** : « s'abonne a subscribeAgentActivity et alimente
   backgroundMissions ».

Résultat : 3 tests virent au rouge, 83 passent → les tests mordent vraiment.
Après restauration : **86/86** sur les deux fichiers.

Remarque de méthode : la première version du test « badge » vérifiait la chaîne
« arrière-plan », également présente dans l'infobulle → elle passait même badge
supprimé. Elle a été **resserrée** sur l'élément `agent-activity-item-bg` avant
la contre-preuve.

## 5. Commandes exécutées

```
npx vitest run src/js/agent-activity.test.js src/js/agents-ui-travail-arriere-plan.test.js
npm test          -> 120 fichiers, 2049 tests, 0 échec
npm run build     -> exit 0, « built in 11.93s »
npm run build:handbook -> handbook régénéré (42 blocs)
```

`npm run build` ne produit **aucun nouvel avertissement** : seuls les
avertissements préexistants apparaissent (imports dynamiques signalés par
`vite:reporter`, taille de chunk > 500 kB). Aucune dépendance ajoutée, aucun
`cargo` exécuté (aucun changement Rust).

## 6. Ce qui n'a pas été touché

- `agents-bus.js`, `dashboard.rs`, `agent_service.rs`, `super_agent.rs` : aucun
  changement (lancement, file d'attente, verrou, règles d'arrêt intacts).
- Aucun onglet ouvert, aucun onglet activé, aucun focus déplacé, aucun appel à
  l'outil assistant `list_agent_sessions`.
- Aucune suppression, aucun contournement de garde-fou, aucune commande de
  nettoyage/réinitialisation Git, aucun `git push` ni tag.

## 7. Limites connues

- Si le backend ne transmet pas `visible` (charge ancienne), aucune mention
  « arrière-plan » n'est ajoutée : préférence assumée pour l'absence de badge
  erroné.
- Le bloc « Travail en arrière-plan » s'appuie sur le store partagé actualisé
  toutes les 2 s + événements : une session très brève peut n'être visible qu'au
  tick suivant.
- L'entrée n'ouvre pas l'onglet (choix : aucun onglet ouvert automatiquement) ;
  l'ouverture reste le bouton « Afficher l'onglet » de la fiche.
