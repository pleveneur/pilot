# RAPPORT — POINT B / B1 (front seul) : la fenêtre « démarrage » de la liste des tâches

> Base : commit `9023c1d` (arbre propre, 4 016 tests verts).
> **Aucune ligne de Rust, aucun réglage, aucun nouvel élément d'interface, rien
> touché au mode Vocal, au cercle, au micro, au halo, à la barre, ni aux fenêtres
> noires.**

## 1. Le défaut corrigé (rappel exact)

Diagnostic : `docs/rapports/RAPPORT-taches-invisibles.md` § 3 cas (c).

Une mission **acceptée mais pas encore démarrée** n'apparaissait dans **aucun**
groupe de la liste des tâches :

- le prompt est enregistré côté cœur dès l'envoi (`src-tauri/src/agent_service.rs`
  `record_prompt`, appelé par `send`) et publié par `get_agent_supervision`
  (champs additifs `prompt` / `resume`) ;
- mais l'état publié reste **`idle`** tant que le moteur n'a pas inscrit la
  session dans son observateur d'anomalie (`src-tauri/src/dashboard.rs`) ;
- donc `isAgentWorking` est **faux** (`src/js/agent-activity.js`) : l'entrée était
  **filtrée** par `buildRunningMissions` → la liste ne montrait **rien**.

La fenêtre dure le temps du spawn de la session (sonde backend jusqu'à 2 × 5 s à
froid) plus 2 s de poll : on lance une mission et, pendant plusieurs secondes,
la liste est vide — l'utilisateur croit que rien n'est parti.

## 2. Ce qui change (2 fichiers de code + 1 test)

| Fichier | Changement |
|---|---|
| `src/js/agent-activity.js` | **Famille « démarrage »** : `MISSION_START_MAX_MS`, `MISSION_START_GROUP_LABEL`, `missionStartSignature`, `trackMissionStarting`, `buildStartingMissions`. `flattenAgents` marque d'un champ **additif** `starting` (présent **seulement** quand c'est vrai) l'entrée d'une mission acceptée pas encore démarrée. `buildRunningMissions` **conserve** le drapeau `starting` des entrées de file. `renderMissionsPanelHtml` rend un **troisième groupe** « Démarrage (n) », entre « En cours » et « En attente ». |
| `src/js/super-agent.js` | **FAMILLE 5** dans `collectQueuedMissions()` (une ligne de lecture : `buildStartingMissions(getAgentActivitySnapshot().list)`), avec dédoublonnage « même projet + même texte déjà dans les familles 1 à 4 ». |
| `src/js/taches-demarrage.test.js` | Nouveau fichier dédié (famille, affichage, dédoublonnage, expiration, cohérence compteur ↔ liste, compatibilité). |

### D'où vient l'information (aucune donnée nouvelle)

La famille n'invente **rien** : elle lit la **supervision déjà reçue** (store
d'activité partagé, poll 2 s + push `agent-state-changed`). Une session qui porte
une mission (`prompt` / `resume` publiés dès l'envoi) et qui **ne travaille pas
encore** est exactement le cas (c). Aucun appel au moteur supplémentaire, aucune
commande Rust, aucune structure métier dupliquée.

### Un seul calcul, un seul rendu

`publishSuperMissionsCount()` reste **le seul** calcul
(`buildRunningMissions(...)` → `splitMissions(...)`) et `renderMissionsPanelHtml`
**le seul** rendu ; la nouvelle famille est ajoutée **dans**
`collectQueuedMissions()`, donc elle entre dans ce calcul unique. Aucun second
compteur, aucune seconde liste. Les lignes verrouillées par
`compteur-taches-travail.test.js` et `panneau-suivi-trois-onglets.test.js` ne
sont **pas** modifiées (`setAgentPanelTaskCount(running.length, waiting.length)`,
`buildRunningMissions(getAgentActivitySnapshot().list, collectQueuedMissions())`).

## 3. Dédoublonnage strict (le point fragile)

Le drapeau `starting` est calculé **par mission** (signature = résumé fourni +
prompt publié) et il est exclusif :

- l'agent **travaille** (ou a travaillé) pour cette mission ⇒ la mémoire passe
  `started = true` et `starting` devient **faux** ;
- l'agent ne travaille pas et n'a **jamais** travaillé pour cette mission ⇒
  `starting` est **vrai** (dans la borne, voir § 4).

Comme `buildRunningMissions` ne liste « En cours » que les agents qui
**travaillent**, et que la famille « Démarrage » ne contient que ceux qui **ne
travaillent pas**, les deux ensembles sont **disjoints par construction** : une
mission ne peut pas figurer deux fois. Un test le prouve sur le passage
`idle` → `running` (une seule occurrence du texte de mission dans le volet, et
elle est dans « En cours »).

## 4. La borne d'expiration, et pourquoi

`MISSION_START_MAX_MS = 30 000` (30 s), mesurée depuis le **premier passage** du
front sur cette mission (le poll suivant l'envoi : ≤ 2 s après, donc la fenêtre
réellement visible reste ≥ 28 s).

Justification :

- **ne disparaît pas trop tôt** : la fenêtre réelle du défaut est le spawn + la
  sonde backend, soit **jusqu'à 2 × 5 s = 10 s à froid**, plus **2 s de poll**
  = **12 s au pire**. La borne vaut **2,5 × ce pire cas** : une mission qui a
  réellement démarré bascule bien avant, et l'utilisateur a au moins une
  vingtaine de secondes pour voir la ligne ;
- **ne reste pas éternellement** : un lancement qui n'aboutit jamais (spawn en
  échec, agent tué avant son premier tour) ne laisse **aucune ligne fantôme**
  au-delà de 30 s. C'est une borne **dite** (constante exportée, testée) et non
  un effet de bord du poll ;
- **30 s et pas 5 min** : le groupe est une information **transitoire**, pas un
  historique. Au-delà, la vérité est « cet agent ne travaille pas », et
  l'inventaire des sessions reste consultable dans l'onglet « Agents ».

La borne est **testable** : `trackMissionStarting(map, agent, now)` accepte
l'horloge, et les tests utilisent `vi.setSystemTime` sur `flattenAgents`.

## 5. Cohérence compteur ↔ liste

Le compteur « Travail » reste `en cours / (en cours + en attente)` et les
missions de démarrage restent, dans `splitMissions`, du côté **« pas encore en
cours »** (`waiting: true`) : elles sont donc **comptées dans le total** et
**pas** dans les tâches en cours.

Conséquence vérifiée par test (cas « démarrage seul ») :

- bouton : `0/1` (une tâche prévue, aucune en cours) ;
- volet : « Démarrage (1) », **jamais** « Aucune mission en cours. » ;
- `En cours (n) + Démarrage (n) + En attente (n) = total du bouton`.

Le défaut interdit (« 1/1 » devant une liste vide) reste impossible : sans
mission, le bouton est **vide** et le volet écrit « Aucune mission en cours. ».

## 6. Preuves de neutralisation (morsure obligatoire)

Deux morsures, faites sur le code réel puis restaurées (sauvegarde binaire du
fichier, aucune modification résiduelle).

### Morsure 1 — la famille est neutralisée (`buildStartingMissions` retourne `[]`)

`npx vitest run src/js/taches-demarrage.test.js` →

```
PASS (14) FAIL (4)

1. (2) une mission acceptée, pas encore démarrée, est affichée avec la famille, elle apparaît dans « Démarrage » et nulle part ailleurs
   AssertionError: expected [] to have a length of 1 but got +0
2. (2) une mission acceptée, pas encore démarrée, est affichée la même mission, une fois démarrée, passe dans « En cours » — jamais deux fois
   AssertionError: expected '<div class="dash-muted">Aucune missio…' to contain 'Démarrage (1)'
3. (4) l'expiration se comporte comme annoncé la ligne est visible AVANT la borne et disparaît APRÈS (jamais de fantôme)
   AssertionError: expected [] to have a length of 1 but got +0
4. (5) le compteur et la liste disent la même chose cas « démarrage seul » : 0 en cours et 1 prévue — et surtout PAS une liste vide
   AssertionError: expected [] to have a length of 1 but got +0
```

Restauration → `PASS (18) FAIL (0)`.

### Morsure 2 — seul le RENDU du groupe est retiré (famille intacte)

`return ...group("En cours"...)+group("En attente"...)` (sans le groupe
« Démarrage ») → `npx vitest run src/js/taches-demarrage.test.js` :

```
PASS (12) FAIL (6)

[…] (5) le compteur et la liste disent la même chose cas « démarrage seul » : 0 en cours et 1 prévue — et surtout PAS une liste vide
   AssertionError: expected '' to contain 'Démarrage (1)'
```

Restauration → `PASS (18) FAIL (0)`.

Les deux morsures sont donc **vues** : la famille est couverte à la fois sur le
calcul (mission affichée, dédoublonnage, expiration, cohérence du compteur) et
sur le rendu (le groupe est réellement peint).

## 7. Campagne de tests

- Nouveau fichier : `src/js/taches-demarrage.test.js` — **18 tests**, tous verts.
- Fichiers de la liste **non modifiés** et verts :
  `panneau-suivi-trois-onglets.test.js`, `compteur-taches-travail.test.js`,
  `agent-activity.test.js`, `travail-visible.test.js`,
  `taches-visibles-sans-onglet.test.js` → **249 tests verts avec le nouveau
  fichier** (231 sans).
- Suite complète `npx vitest run` : **PASS (4034) FAIL (0)** — base `9023c1d` :
  **4 016** verts, soit **+18** (exactement le nouveau fichier), aucune
  régression.
- Aucun test Rust touché, aucun code Rust modifié (`cargo test` non requis par
  ce lot, mais l'arbre Rust est intact : `git diff --stat` ne contient aucun
  fichier `.rs`).

### Piège des fins de ligne

Le fichier de test lit le source deux fois (`agent-activity.js`,
`super-agent.js`) et **normalise** la lecture (`.replace(/\r\n/g, "\n")`) avant
chaque assertion textuelle, conformément au quality-gate § 3.4 (runner Windows
`core.autocrlf=true`).

## 8. Ce qui n'a pas bougé

- Aucune ligne de Rust. Aucun seuil vocal, aucun fichier du mode Vocal, du
  cercle, du halo, du micro, de la barre (`9023c1d`), des fenêtres noires.
- Aucun réglage, aucun bouton, aucun onglet : le groupe « Démarrage » est une
  **ligne de la liste existante** (mêmes classes, même disposition figée
  « agent et projet au-dessus, mission en dessous »).
- Tests existants de la liste : `panneau-suivi-trois-onglets.test.js`,
  `compteur-taches-travail.test.js`, `agent-activity.test.js`,
  `travail-visible.test.js`, `taches-visibles-sans-onglet.test.js` — **non
  modifiés**.
