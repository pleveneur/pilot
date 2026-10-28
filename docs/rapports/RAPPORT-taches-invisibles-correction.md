# RAPPORT — « Aucune mission dans la liste des tâches » : correction A appliquée

> Diagnostic d'origine : `docs/rapports/RAPPORT-taches-invisibles.md` (session en
> lecture seule). Ce rapport-ci ne décrit que ce qui a été **corrigé**, comment,
> et ce qui **reste à faire**.

## 1. Cause corrigée (défaut n°1 du diagnostic)

La liste du volet « Tâches » n'était vivante **que tant que l'onglet 🧭 Assistant
existait** :

- l'abonnement au store d'activité était posé dans la fabrique de l'onglet
  (`createSuperAgent`) et **coupé à sa fermeture** ;
- l'écouteur des onglets du panneau (qui repeint le volet quand il devient
  visible) était posé au même endroit et coupé au même endroit ;
- `.sa-tasks-list` est **vide dans le HTML** (aucun message par défaut).

Conséquences : onglet 🧭 jamais ouvert → volet **blanc** ; onglet fermé →
**photo périmée** (mission démarrée ensuite jamais affichée, mission finie
restée « en cours ») — alors que le compteur du bouton « Travail », lui, restait
vrai (abonnement permanent). Le bouton pouvait afficher « 1/1 » devant un volet
vide, ce que le code s'interdit par écrit.

## 2. Ce qui a été changé (2 fichiers de code, 0 Rust, 0 CSS, 0 HTML)

### `src/js/super-agent.js`
- `startSuperMissionsWatch()` est désormais **exportée**, **idempotente** et
  **permanente**. Elle pose, une seule fois chacune :
  - l'abonnement au store d'activité partagé (`superMissionsUnsub`) ;
  - l'écouteur des changements d'onglet du panneau
    (`superMissionsPanelUnsub = onAgentPanelTabChange(onPanelTabChanged)`), qui
    repeint le volet **au moment exact** où il devient visible (ouverture du
    panneau, bascule sur « Tâches ») ;
  - puis fait un **premier rendu** (donc à l'ouverture le volet est juste du
    premier coup, et dit « Aucune mission en cours. » s'il n'y a rien).
- `stopSuperMissionsWatch()` est **supprimée** (elle n'était appelée qu'à la
  fermeture de l'onglet 🧭 ; la surveillance ne doit plus jamais être coupée).
- La variable `stopPanelTabWatch` est **supprimée** : plus de second écouteur
  d'onglets posé par la fabrique de l'onglet 🧭, plus de coupure à sa fermeture.
  La fabrique se contente d'appeler `startSuperMissionsWatch()` (qui n'ajoute
  rien si tout est déjà posé).
- Le nettoyage de fermeture de l'onglet 🧭 ne touche **plus** ces abonnements ;
  il rappelle `startTaskCounter()` (idempotent) comme avant.
- **Inchangé** : `renderSuperMissions()` conserve la garde
  `isAgentPanelPaneVisible("tasks")` — la **donnée** est toujours à jour, la
  **peinture** n'a lieu que si le volet est à l'écran. Toujours **un seul**
  calcul (`publishSuperMissionsCount`) et **un seul** rendu
  (`renderMissionsPanelHtml`).

### `src/js/main.js`
- Import de `startSuperMissionsWatch` et appel **juste après**
  `startTaskCounter()`, au démarrage de l'application (dans le même `try/catch`
  : une surveillance indisponible ne bloque pas le démarrage).

## 3. Le vrai repos se dit (vérifié dans les deux cas)

- **Onglet 🧭 jamais ouvert** : la surveillance est posée au démarrage ;
  l'ouverture du panneau sur « Tâches » déclenche `loadSuperMissions()` →
  premier rendu → « Aucune mission en cours. » (jamais de blanc).
- **Onglet 🧭 fermé puis rouvert** : rien n'a été coupé ; au retour sur le volet,
  l'écouteur d'onglets repeint avec la donnée courante (jamais l'ancienne photo).
- Le panneau déjà ouvert sur « Tâches » au démarrage (état mémorisé) est peint
  par le premier rendu de `startSuperMissionsWatch()`.

## 4. Ce qui n'est PAS corrigé (annoncé explicitement)

- **Défaut n°2 du diagnostic (fenêtre « démarrage »)** : une mission **acceptée
  mais pas encore démarrée** (session en cours de spawn, état publié encore
  `idle` tant que `agent_anomaly` n'a pas d'entrée) n'apparaît dans **aucun** des
  deux groupes. **Ce point B n'a pas été implémenté** : ni la famille front
  « démarrage » (B1), ni la publication d'un état `missionPending` côté Rust
  (B2). Il fera l'objet d'une mission séparée.
- Aucune autre modification : pas de nouveau réglage, pas d'historique dans la
  liste, pas de second abonnement/calcul/rendu, aucun fichier Rust touché, rien
  touché au mode Vocal, au cercle, au micro, aux seuils, au délai d'envoi, au
  bouton « Outils », à la longueur des réponses, ni au masquage des fenêtres
  noires.

## 5. Tests

Nouveau fichier `src/js/taches-visibles-sans-onglet.test.js` (lecture des
sources **fins de ligne normalisées**, piège CI Windows, quality-gate § 3.4) :

- (i) `main.js` importe et appelle `startSuperMissionsWatch()` **après**
  `startTaskCounter()`, hors de la fabrique de l'onglet 🧭 ;
- (ii) la fonction d'arrêt a disparu et le nettoyage de fermeture de l'onglet 🧭
  ne touche plus aux abonnements des missions (ni `superMissionsUnsub`, ni
  `superMissionsPanelUnsub`), et la fabrique ne pose plus de second écouteur ;
- (iii) `renderSuperMissions()` conserve la garde de visibilité et consomme le
  calcul unique ; la surveillance fait un premier rendu ; le conteneur HTML est
  bien vide au départ ; sans mission le volet dit « Aucune mission en cours. » ;
- (iv) test pur : une mission d'un agent **occupé sans onglet** (`visible:false`)
  reste listée (`flattenAgents` + `buildRunningMissions` +`splitMissions` +
  rendu), tandis qu'un agent au repos sans onglet est écarté ;
- (v) idempotence : le premier appel pose l'abonnement (`true`), les suivants
  n'en créent aucun (`false`) — les deux chemins (démarrage, onglet 🧭) peuvent
  appeler.

**Preuve que les tests mordent** : correction neutralisée (appel retiré de
`main.js`, `stopSuperMissionsWatch()` remis dans le nettoyage de fermeture) →
`npx vitest run src/js/taches-visibles-sans-onglet.test.js` :

```
PASS (12) FAIL (3)
  AssertionError: startSuperMissionsWatch() absent de main.js: expected -1 to be greater than -1
  AssertionError: expected '// super-agent.js — Assistant de suiv…' not to match /stopSuperMissionsWatch\(\)/
  AssertionError: expected 'window._pilotSuperAgentOpen = false;\…' not to match /stopSuperMissionsWatch/
```

Correction restaurée → `PASS (15) FAIL (0)`.

### Suite complète

Commandes exécutées après rédaction de ce rapport :

```
npx vitest run
```

Résultat (compteurs réels) :

```
PASS (3978) FAIL (0)
```

Rapport JSON de la même exécution (`npx vitest run --reporter=json`) :

```
numTotalTestSuites: 1244   numPassedTestSuites: 1244   numFailedTestSuites: 0
numTotalTests:      3978   numPassedTests:      3978   numFailedTests:      0
```

Aucun fichier Rust n'a été modifié : `cargo test` n'est pas concerné par cette
correction.

## 6. Documentation

- `spec_super_agent.md` : § « Onglet « Tâches » du panneau du suivi du travail »
  (la surveillance ne dépend plus de l'affichage ni de l'onglet 🧭 ; seule la
  peinture est conditionnée), § technique du compteur « Travail » (surveillance
  permanente, idempotente, `stopSuperMissionsWatch` supprimée), bloc
  `<!-- HELP:super-agent-panneau-taches -->` (la liste est toujours à jour, même
  sans avoir jamais ouvert l'onglet 🧭 ; « Aucune mission en cours. » plutôt
  qu'un volet vide).
- `npm run build:handbook` relancé (`help/handbook.md` régénéré).
