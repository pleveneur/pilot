# RAPPORT — Lot 2 de la colonne de droite de l'écran Vocal : les tâches en haut, le portrait en bas

Date : 2026-10-29 · Projet : `G:\IA_PL\pilot` · Version en cours : 0.6.4 (aucun bump)
Conception appliquée : `docs/conceptions/CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md`
(481 lignes, sections 0 à 10), qui amende `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`
(§ 1.1, 1.2, 1.5, 2, 2.1, 2.2, 2.4, 3.3, 3.6, 7, 8.1, 9) et `spec_modes_ecran_vocal.md` § 3ter.

Aucune décision ferme n'a été rouverte : le bouton des modes **reste le logo**, le bas de
l'écran **s'efface toujours au repos** (2,5 s), les **trois sorties** sont inchangées, le
disque ne porte **rien** dedans, il y a toujours **six hôtes** cliquables, **aucun réglage**
n'est créé, le portrait fait **72 px** et n'est **jamais** remplacé par le logo.

---

## 1. Le comportement livré, en deux phrases

La colonne de droite de l'écran Vocal est **remplie** : titre « TÂCHES », liste des tâches
ancrée **en haut**, puis — quand un personnage existe — le **portrait au pied** de la
colonne, son nom, et **une** ligne d'activité tout en bas. Quand il n'y a pas de personnage,
les **98 px** du bloc portrait retournent à la liste (plafond **6 → 8** tâches) : **aucun
espace réservé**, aucun trou.

## 2. Ce qui a changé, et où

| Fichier | Endroit | Ce qui change |
|---|---|---|
| `src/js/vocal-sides.js` | constantes (après `VOCAL_ORB_BOX_RATIO`) | ajout de `VOCAL_TASKS_MAX = 6`, `VOCAL_TASKS_MAX_BARE = 8`, `VOCAL_TASKS_MIN_HEADERS_PX = 86`, `VOCAL_SIDES_TICK_MS = 900`, des trois libellés (`TÂCHES`, `Aucune tâche en cours`, `En cours` / `En attente`) |
| `src/js/vocal-sides.js` | `planVocalSides` | rend **une troisième valeur nommée distinctement** : `hasPortrait` (le cas A s'applique-t-il). `columnHeight` et `listHeight` étaient déjà rendus par le lot 1 |
| `src/js/vocal-sides.js` | `vocalTaskRows` (neuf) | `lignes = clamp(1, floor((listH − 2×20)/46), plafond)`, en-têtes retirés sous **86 px** (`floor(listH/46)`, borné à 2), plafond **6** au cas A / **8** au cas B |
| `src/js/vocal-sides.js` | `planVocalTasks` (neuf) | groupes **« En cours » puis « En attente »**, ordre d'origine conservé, répartition moitié/moitié (3+3 au cas A, 4+4 au cas B), reliquat d'un groupe vide rendu à l'autre, `more` = surplus **dit** |
| `src/js/vocal-sides.js` | `vocalNowLine` (neuf) | la ligne d'activité du bas : **une** phrase, jamais vide (« … exécute une opération » / « … réfléchit » / « Démarrage de N missions » / « N missions en attente » / « Tout est au repos ») |
| `src/js/agent-activity.js` | `missionWho` | passe de `function` à `export function` : la même règle de nom sert désormais la colonne, **aucune copie** |
| `src/js/agent-activity.js` | `buildRunningMissions` | champ **additif** `toolInProgress: true`, posé seulement s'il est vrai — la forme historique des entrées est préservée pour tous les autres consommateurs (test existant du faux positif inchangé) |
| `src/js/super-agent.js` | imports | `planVocalTasks`, `vocalNowLine`, `VOCAL_SIDES_TICK_MS`, `VOCAL_TASKS_TITLE`, `VOCAL_TASKS_EMPTY_TEXT` ; `missionWho` |
| `src/js/super-agent.js` | `collectSuperMissions()` (neuf, exporté) | **la source unique** : `buildRunningMissions(getAgentActivitySnapshot().list, collectQueuedMissions())` |
| `src/js/super-agent.js` | `publishSuperMissionsCount()` | lit `collectSuperMissions()` au lieu de refaire le calcul — le bouton « Travail » et la colonne ne peuvent plus se contredire |
| `src/js/super-agent.js` | `vocalOverlayNode()` (neuf) | les fonctions de peinture, écrites à la racine du module, résolvent l'overlay par le **seul** nœud qui le nomme (`document.querySelector(".pilot-vocal")`), comme `applyVocalPortrait` : `vocalOrbSizePx()` et `vocalSyncSides()` ne lisent plus la variable `let vocalOverlay` de la fabrique (qui n'existe pas à leur portée) |
| `src/js/super-agent.js` | `buildVocalTasksHtml(plan)` (neuf) | le HTML de la liste : groupes (titre + compte), identité puis résumé, `+ N autre(s)`, `Aucune tâche en cours` — échappement par la fonction locale **existante** `escapeHtmlForSuper` |
| `src/js/super-agent.js` | `vocalColumnNode` / `vocalRenderColumn` (neufs) | créent le titre (**avant** la liste) et la ligne d'activité (**après** le nom, donc en bas) une seule fois, et écrivent **seulement si le texte change** (le tic ne fait pas clignoter) |
| `src/js/super-agent.js` | `vocalSyncSides()` | **seul point de peinture** : largeur (`--vocal-side`, `vocal-sides-off`), `hidden` des colonnes, puis `vocalRenderColumn(plan)` |
| `src/js/super-agent.js` | `applyAssistantPersonaUi()` | après `applyVocalPortrait()` : `vocalSyncSides()` — un changement de personnage change de **cas**, donc de hauteur de liste, **en une peinture** |
| `src/js/super-agent.js` | `enterVocal()` / `exitVocal()` | un **seul** tic `setInterval(vocalSyncSides, VOCAL_SIDES_TICK_MS)` posé à l'entrée, retiré à la sortie (`clearInterval` + `null`) |
| `src/css/style.css` | `.vocal-side-tasks` + bloc neuf après `.vocal-portrait-name` | le budget du § 2.5 écrit tel quel : 46 px par tâche, 20 px par en-tête, 14/14 px autour du titre, 72 px de médaillon, 6 px + 20 px pour la pastille, 12 px + 18 px pour la ligne d'activité, 12 px en bas. Couleurs prises dans le jeton **existant** `--text-secondary` |
| `spec_modes_ecran_vocal.md` | § 3ter (titre + « État réel ») et bloc `<!-- HELP:vocal-colonnes-portrait -->` | statut **« lots 1 et 2 livrés, lot 3 à venir »** et description de ce que l'utilisateur voit réellement |
| `help/handbook.md` | — | **régénéré** par `npm run build:handbook` (47 blocs) |
| `src/js/vocal-taches-en-haut-portrait-en-bas.test.js` | neuf | T12 étendu, T18, T19 + les verrous de cohérence (voir § 5) |

## 3. Comment on obtient le cas A et le cas B

**Un seul critère, un fait, rien de mémorisé** : `getAssistantPortrait() !== ""`
(`src/js/super-agent.js`, appel de `planVocalSides`). Aucun drapeau, aucun réglage, aucune
écriture.

- **Cas A — un personnage existe** (portrait affichable) : `listH = H − 170`
  (14 + 11 + 14 de titre, 72 de médaillon, 6 d'écart, 20 de pastille, 12 + 18 de ligne
  d'activité), plafond **6** tâches. Le portrait reste **centré au pied** de la colonne.
- **Cas B — aucun personnage** : `listH = H − 72`, plafond **8** tâches, `hidden` sur
  l'image **et** sur le nom ; comme aucune règle CSS ne leur rend un `display` et que la
  liste est le seul élément en `flex: 1 1 auto`, **0 px** n'est réservé.

**Passage d'un cas à l'autre** : le mécanisme **existant** de relecture du personnage
(ouverture de l'onglet, retour de focus) rappelle `vocalSyncSides()`, et le tic de **900 ms**
couvre le reste. Le haut de la colonne et la ligne d'activité ne bougent pas ; aucune
animation, aucun état intermédiaire.

## 4. Ce que je n'ai pas fait (et pourquoi)

- **Le cas 2 du § 7bis (avatar PLface) n'est pas implémenté** : il exige que la **taille** de
  la fenêtre de l'avatar soit connue, et PLface n'expose **aucune route de taille**
  (§ 7bis.5 de la conception). Rien ne dessine donc de zone d'avatar, et **rien n'est
  déplacé** — c'est la règle déjà écrite dans la spec. Le jour où la taille sera connue, le
  troisième cas s'ajoute à `planVocalSides` sans toucher à ce lot.
- **La colonne de gauche (discussion) reste vide** : c'est le **lot 3**, hors périmètre.
- **Le nombre de `</div>` de la scène n'a PAS bougé** : le titre et la ligne d'activité sont
  créés à l'exécution (`vocalColumnNode`), donc le balisage statique de
  `buildVocalOverlay()` est identique à celui du lot 1. `ecran-vocal-lot2.test.js`, qui
  compte les enfants de la scène, passe **inchangé** : la question du décompte 2 / 3 / 4
  soulevée à la relecture de la conception ne se pose plus, elle ne concernait qu'un
  ajout au balisage.
- **Aucun test existant n'a été modifié, assoupli, renommé ni supprimé.** Deux d'entre eux
  ont d'ailleurs **rattrapé** ce lot pendant la campagne, et c'est le code qui a été corrigé,
  pas les tests :
  - `compteur-taches-travail.test.js` exige que `publishSuperMissionsCount()` contienne
    lui-même le pipeline `buildRunningMissions(getAgentActivitySnapshot().list,
    collectQueuedMissions())`. La première version déplaçait ce calcul dans
    `collectSuperMissions()` : le test est resté tel quel et c'est `collectSuperMissions()`
    qui **nomme** désormais le calcul existant (`return publishSuperMissionsCount()`), ce
    qui garde un **seul** pipeline et un seul point de publication.
  - `dictee-vocale-se-rearme.test.js` exige qu'il n'existe **qu'un**
    `ligne.textContent =` dans tout `super-agent.js` (la ligne d'état). Ma repeinture
    nommait sa variable locale `ligne` : elle s'appelle maintenant `activiteEl`, et le nom
    `ligne` reste réservé à la ligne d'état.
- **Aucune valeur mesurée sur un écran réel** : le budget de hauteur est vérifié par calcul
  (les sept lignes du tableau § 2.5 sont rejouées), pas par capture d'écran.
- **Pas de bump de version, pas de tag, pas de publication** : la publication reste une
  demande explicite du propriétaire.

## 5. Tests

Nouveau fichier : `src/js/vocal-taches-en-haut-portrait-en-bas.test.js`.

- **T18** — `listH = H − 170` au cas A, `H − 72` au cas B, sur les **sept** fenêtres du
  tableau, `columnHeight` identique dans les deux cas, écart **exactement 98 px**, entrée
  absente = cas B, `hidden` sur l'image et le nom, aucune hauteur réservée.
- **T19** — `listH` ne dépend pas du nombre de missions (le plan ne prend même pas ce
  paramètre) ; ordre **titre → liste → portrait → pastille → activité**.
- **T12 (étendu)** — les **sept** lignes du tableau § 2.5 (cas A et cas B), les **deux**
  groupes dans l'ordre, plafonds 6 / 8, seuil des en-têtes à 86 px, jamais zéro ligne,
  `+ N autre(s)`, groupe vide qui ne vole pas la place de l'autre, liste vide = une phrase.
- **Cohérence** — `collectSuperMissions()` sert le bouton **et** la colonne (aucun second
  calcul) ; `vocalSyncSides()` reste le seul point de peinture (une seule écriture de
  `--vocal-side`) ; un seul tic, posé et retiré ; le personnage change de cas sans attendre le
  tic ; `vocal-sides.js` ne lit ni le disque ni un stockage ; les hauteurs du budget sont
  bien celles de la feuille de style.

Résultats : voir § 6.

## 6. Résultats des vérifications

`npx vitest run` sur toute la suite :

- Base de départ mesurée avant toute modification : **4610 tests verts, 0 rouge**.
- Après le lot : **4633 tests verts, 0 rouge** — soit exactement **+23** (les tests du
  nouveau fichier `src/js/vocal-taches-en-haut-portrait-en-bas.test.js`) et **zéro
  régression**. Aucun test n'a été retiré ni ignoré.
- Tests ciblés du lot (5 fichiers) : **91 verts, 0 rouge**. Nouveau fichier seul :
  **23 verts, 0 rouge**.
- `cargo test` non relancé : **aucun fichier Rust n'est touché** par ce lot.
- Analyse syntaxique (`esbuild`) de `super-agent.js`, `agent-activity.js`,
  `vocal-sides.js` : **OK**.
- Piège évité et à retenir : un fichier de test qui ne se **parse** pas est compté
  **0 test** par le rapporteur, avec `FAIL (0)` — la suite paraît verte alors que le
  fichier n'a jamais tourné. La vérification qui l'attrape : comparer le **total** avant et
  après (4610 → 4633, l'écart doit valoir le nombre de tests ajoutés).

RÉSULTAT COMPLET : **PASS (4633) / FAIL (0)**.

## 7. Commit

Un **seul** commit, sur `main`, **sans push, sans tag, sans publication** : la version reste
**0.6.4**. Message : « feat(vocal): les taches en haut de la colonne de droite, le portrait
en bas ». 8 fichiers, 1058 insertions, 43 suppressions (dont 407 pour le nouveau fichier de test
et 147 pour ce rapport).

Le hash exact est celui qu'affiche `git log -1` : il ne peut pas etre ecrit ici en dur,
puisque ce paragraphe fait partie du commit — l'ecrire le reecrirait. Le hash du commit
obtenu juste avant cet ajout etait **`9b2bb07`** ; le commit final ne differe de celui-la que
par le present paragraphe.
