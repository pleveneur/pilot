# Rapport — les quatre remarques du propriétaire sur l'écran Vocal (2026-10-03)

Source : `docs/rapports/REMARQUES-interface-ecran-vocal-20261003.md`.
État de départ : commit `a0daf4e` (`fix(vocal): l'etat nu ne masque ni le portrait,
ni le bouton, ni la saisie`), arbre de travail sans modification de code.
Suite de tests au départ : **4782 PASS / 0 FAIL** (`npx vitest run`).

Ce rapport est écrit **avant** les modifications. Les compteurs finaux sont
reportés à la fin (§ 6), après la mesure réelle.

---

## 1. Remarque 1 — « la colonne de gauche est trop proche du cercle »

### Ce qui se passait vraiment (mesuré sur le disque, pas supposé)

La scène est une grille à trois pistes :
`var(--vocal-side) | var(--vocal-orb-size) | var(--vocal-side)`, avec
`column-gap: 24px` (`--vocal-side` = 320 px à 1440 px de fenêtre, disque 336 px).

- la **couronne du halo** déborde de **88 px** (`--vocal-crown`) au-delà du disque ;
- la colonne de **droite** porte `width: var(--vocal-side-tasks)` = `track − (88 − 24)`
  = 256 px, alignée `end` : son **bord intérieur tombe donc exactement sur le bord de
  la couronne** (88 px du disque) ;
- la colonne de **gauche** n'avait **aucune largeur** : elle s'étirait (`justify-self:
  stretch`) sur toute la piste de 320 px, donc son bord droit tombait à **24 px** du
  disque — soit **64 px SOUS la lueur du halo**. Son texte, et lui seul, passait dans
  la couronne.

Autrement dit : la gêne n'était pas une impression, c'était une **asymétrie de 64 px**
entre les deux colonnes, et c'est la gauche qui mordait sur le halo.

### Ce qui change

- `src/css/style.css` — `.vocal-side-discussion` reçoit la **même largeur de contenu**
  que la colonne des tâches (`width: var(--vocal-side-tasks, 100%)`) et
  `justify-self: start` : la colonne est alignée vers l'extérieur de l'écran, donc
  **éloignée du disque**.
- `src/js/super-agent.js` — `vocalRenderDiscussion()` compte ses caractères par ligne
  sur `plan.taskTrack` (la largeur de contenu) et non plus sur `plan.track` (la piste
  de la grille) : sans cela, le budget de lignes (`vocalCharsPerLine`) aurait été plus
  large que le texte réellement peint, et un message aurait été coupé sans le dire.

Résultat : les deux colonnes s'arrêtent **exactement au bord de la couronne**
(88 px du disque, contre 24 px pour la gauche auparavant). L'espace libre autour du
cercle passe de 24 à 88 px de chaque côté, et la scène devient symétrique.

### Décision assumée (à valider)

La liste des tâches, elle, **ne bouge pas** : elle s'arrêtait déjà au bord de la
couronne (c'est ce que calcule `VOCAL_SIDE_CLEARANCE_PX`). « Repousser la liste plus à
droite » ne pouvait donc se faire qu'en consommant les ~200 px de vide qui restent
entre chaque colonne et le bord de l'écran — au prix d'un décollement des colonnes du
cercle (à 1440 px, elles seraient collées aux bords, à 300 px du disque). Le choix fait
est celui de l'**égalité des deux colonnes sur le bord de la lueur**, qui est la règle
déjà écrite pour la droite. Si le propriétaire veut un écartement plus grand, c'est un
**second** levier (un jeton d'écartement borné), volontairement pas introduit ici.

### Ce qui le verrouille

`src/js/vocal-colonnes-degagees.test.js` (nouveau) : la largeur de contenu est la même
pour les deux colonnes, la colonne de gauche est alignée vers l'extérieur, et
`vocalRenderDiscussion()` lit `plan.taskTrack`. Vérifié par mutation (§ 5).

---

## 2. Remarque 2 — « les deux voix ne se distinguent pas »

### Ce qui se passait

`.vocal-msg-user` (la parole du propriétaire) et `.vocal-msg-assistant` ne différaient
que par la **taille** (13 px / 15 px), le **gris** et une indentation de 12 px à gauche
— deux blocs de même largeur, alignés du même côté, sans repère de lecture.

### Ce qui change (`src/css/style.css`)

- `.vocal-msg-user` — **à droite** : `align-self: flex-end`, `max-width: 92%`,
  `text-align: end`, et une **bulle teintée** qui suit le thème
  (`background: color-mix(in srgb, var(--text-primary) 8%, transparent)`, rayon
  dissymétrique `14px 14px 3px 14px` qui pointe du côté de la réponse). **Aucune couleur
  en dur** : le mélange se fait sur `--text-primary`, donc sur les dix palettes.
- `.vocal-msg-assistant` — **à gauche** : `align-self: flex-start`, `max-width: 100%`,
  texte plein 15 px, **sans fond**.
- **Aucun `padding-block` ajouté** : la hauteur de ligne (23 px) et l'écart (14 px) sont
  le budget du module pur (`VOCAL_DISCUSSION_LINE_H`, `VOCAL_DISCUSSION_GAP`) ; une marge
  verticale aurait fait mentir le nombre de lignes calculé.
- L'indentation de 12 px à gauche de la question est **conservée** (`padding-inline-end:
  12px` l'équilibre) : c'est un verrou existant, et elle ne gêne pas l'alignement à
  droite.

### Ce qui le verrouille

`src/js/vocal-deux-voix.test.js` (nouveau) : côté, alignement, fond présent/absent, et
**aucune couleur en dur** dans les deux règles ; plus le refus de tout `padding-block`
non nul.

---

## 3. Remarque 3 — « la barre de saisie doit être invisible par défaut et revenir au mouvement »

### Ce qui se passait vraiment

Le mécanisme existait (2 500 ms, `vocal-chrome.js`), mais la **règle 4** — « le pointeur
est sur la zone du bas » — était une règle de **position**, pas de **geste**. Or la zone
du bas (ligne d'état + barre de saisie + bouton micro) couvre toute la bande basse de
l'écran, et une souris se pose là naturellement. Dès que le pointeur s'y trouvait, le
bas était retenu **indéfiniment** : il ne s'effaçait plus jamais, quel que soit le temps
d'inactivité. C'est exactement « le déclenchement ne correspond pas à l'attendu ».

### Ce qui change

- `src/js/vocal-chrome.js` — la règle 4 devient : le pointeur ne retient le bas que si
  son **dernier geste n'a pas expiré** (`if (f.pointeurActif === true && f.pointeurGeste
  !== false) return true;`). Une souris **posée** au-dessus d'une zone effacée ne la
  retient plus ; un mouvement ou un clic la retient. Le fait `pointeurGeste` absent vaut
  « geste récent », donc les appelants qui ne le fournissent pas ne changent pas de
  comportement.
- `src/js/super-agent.js` — le fait est alimenté par un seul drapeau,
  `vocalChromeGestePointeur` : posé à `true` par les deux gestes de pointeur
  (`pointermove` au-delà du seuil de 4 px, `pointerdown`), remis à `false` quand le
  décompte **expire** (dans le rappel du minuteur unique) et à l'entrée comme à la
  sortie du mode.

Le reste du déclenchement est **inchangé** : 2 500 ms, seuil de 4 px, quatre familles de
gestes (pointeur, clic, molette, clavier), Échap excepté, et le bas reste **visible et
utilisable dans les deux états du bouton de masquage** (`vocalBare ||`).

### Ce qui le verrouille

`src/js/vocal-saisie-declenchement.test.js` (nouveau) : la décision pure pour
`pointeurGeste` vrai / faux / absent, le branchement dans les faits, le drapeau posé par
les deux gestes, remis à zéro par l'expiration du minuteur et par l'entrée / la sortie,
et la ligne `vocalBare ||` toujours présente.

---

## 4. Remarque 4 — « le portrait est trop petit et semble appartenir à la liste »

### Ce qui se passait

Deux causes, cumulées :

1. le médaillon faisait **72 px** — la taille d'une ligne de liste (46 px) et demie, donc
   à l'échelle du bloc qu'il surplombait ;
2. il était placé **sous** le titre « TÂCHES » (`vocalColumnNode(..., "first")` insère le
   titre en tête de colonne) : le portrait apparaissait donc **dans** la section des
   tâches, entre son titre et sa liste.

### Ce qui change

- **Taille** : `96 px` (bloc du personnage : 96 + 8 + 20 + 12 d'air = **136 px**), dans
  `src/js/vocal-sides.js` (`VOCAL_PORTRAIT_PX`, `VOCAL_PORTRAIT_GAP_PX`,
  `VOCAL_PORTRAIT_AIR_PX`) et `src/css/style.css` (`.vocal-portrait`,
  `.vocal-portrait-name`).
- **Place** : le titre « TÂCHES » n'est plus le premier nœud de la colonne, il **ouvre la
  section des tâches**, juste au-dessus de la liste (`vocalColumnNode(colonne,
  ".vocal-tasks-title", "above-list")`). L'ordre devient : **portrait → nom → air →
  « TÂCHES » → zone d'image → liste**. Le portrait n'appartient plus à aucune section :
  il est en tête de colonne, donc en haut à droite de l'écran.
- **Détachement** : 12 px d'air sous le nom, et le médaillon garde son cercle
  (`border-radius: 50%`), centré, jamais cliquable (`pointer-events: none`).

### Coût dit et assumé

À `H = 512` px de colonne, la liste perd **une ligne** (7 → 6) : le budget de 363 px
tenait à 1 px près (`floor((363 − 40) / 46) = 7`), donc tout agrandissement du bloc du
personnage passe sous le seuil des 7 lignes. C'est le prix du portrait agrandi ; il est
écrit, et les tableaux de tests l'ont suivi (aucun test supprimé, les valeurs sont
recalculées).

### Ce qui le verrouille

`src/js/vocal-portrait-detache.test.js` (nouveau) : 136 px de bloc (96 + 8 + 20 + 12),
96 px dans la feuille de style, le nom **sous** l'image, et le titre créé **au-dessus de
la liste** et non plus en tête de colonne.

---

## 5. Vérification par mutation (les tests échouent-ils si le défaut revient ?)

Chaque mutation a été **appliquée à la source**, son verrou lancé seul, puis la source **restaurée**
(`git status` vérifié après chaque essai : aucune mutation ne subsiste). Les compteurs sont ceux
que Vitest a imprimés.

| # | Mutation appliquée | Verrou lancé | Résultat |
|---|---|---|---|
| 1 | **R1** : `.vocal-side-discussion` perd `width: var(--vocal-side-tasks)` et son alignement | `vocal-colonnes-degagees.test.js` | **ÉCHOUE** — 1 test en échec / 8 passés |
| 2 | **R2** : `.vocal-msg-user` perd `align-self: flex-end`, `max-width: 92%` et `text-align: end` | `vocal-deux-voix.test.js` | **ÉCHOUE** — 2 en échec / 9 passés |
| 3 | **R2 bis** : `.vocal-msg-assistant` reçoit le fond de la question | `vocal-deux-voix.test.js` | **ÉCHOUE** — 1 en échec / 10 passés |
| 4 | **R3** : la règle 4 redevient une règle de **position** (`if (f.pointeurActif === true) return true;`) | `vocal-saisie-declenchement.test.js` | **ÉCHOUE** — 1 en échec / 13 passés |
| 5 | **R3 bis** : le rappel du minuteur ne remet plus `vocalChromeGestePointeur` à `false` | `vocal-saisie-declenchement.test.js` | **ÉCHOUE** — 2 en échec / 12 passés |
| 6 | **R4** : le titre revient en tête de colonne (`"above-list"` → `"first"`) | `vocal-portrait-detache.test.js` | **ÉCHOUE** — 1 en échec / 12 passés |
| 7 | **R4 bis** : le médaillon repasse à 72 px dans la feuille de style (budget inchangé) | `vocal-portrait-detache.test.js` | **ÉCHOUE** — 1 en échec / 12 passés |

**Aucun verrou n'est mort** : les sept mutations font échouer le test qui prétend tenir le point.
La mutation 7 est celle qui compte pour le point 4 : elle ne touche **que** le CSS, et le test
l'attrape parce qu'il lit la taille aux **deux** endroits (feuille de style et budget) et exige
qu'ils disent la même chose.

---

## 6. Résultats mesurés

| Mesure | Avant (`a0daf4e`) | Après |
|---|---|---|
| `npx vitest run` | **4 782 PASS / 0 FAIL** | **4 829 PASS / 0 FAIL** |
| Fichiers de test | — | **4 fichiers ajoutés** (+47 tests), **4 fichiers mis à jour** |
| Tests supprimés ou affaiblis | — | **aucun** (0 suppression, 0 `toBeLessThan` relâché) |

Détail des 47 tests ajoutés : `vocal-colonnes-degagees.test.js` **9**,
`vocal-deux-voix.test.js` **11**, `vocal-saisie-declenchement.test.js` **14**,
`vocal-portrait-detache.test.js` **13**. Les 4 fichiers existants mis à jour le sont par
**recalcul** de valeurs, jamais par relâchement : `98` → `136` (bloc du personnage), `363` →
`325` (hauteur de liste à `H = 512`), et les 7 fenêtres du tableau § 7bis.4 (cases
« personnage » et totaux de lignes) ; les cases « aucune zone » et « avatar » sont
**inchangées** — c'est la preuve que seule la place du portrait a bougé.

Aucun fichier Rust n'a été touché : `cargo test` n'est pas concerné par ce lot (la suite
frontend est la seule concernée). L'aide intégrée a été régénérée (`npm run build:handbook`)
parce que le bloc `<!-- HELP:vocal-colonnes-portrait -->` de
`spec_modes_ecran_vocal.md` a suivi les quatre remarques.

### Points de jugement signalés

1. **Remarque 1** — la liste des tâches **ne s'est pas déplacée** : elle s'arrêtait déjà au bord
de la couronne. Le dégagement vient de l'**égalité** des deux colonnes sur ce bord. Un
écartement plus grand est possible, mais il demanderait un **second** levier (un jeton
d'écartement borné), volontairement non introduit ici (§ 1).
2. **Remarque 3** — l'écart est un **fait de geste** (`pointeurGeste`) et non un changement de
durée : les 2 500 ms, le seuil de 4 px et les quatre familles de gestes sont intacts. Un
appelant qui ne transmet pas le fait garde le comportement d'avant (absent = geste récent),
choix explicite pour qu'un oubli ne rende pas le bas masquable par accident.
3. **Remarque 4** — à `H = 512` la liste perd **une ligne** (7 → 6) parce que le budget tenait
à 1 px près (§ 4). À la plus petite fenêtre (`720 × 520`), il reste **44 px** de liste :
**une** ligne rognée, jamais zéro. Le prix est dit, pas caché.

---

## 7. Reprise — re-vérification par la mesure (2026-10-30)

La session précédente s'est arrêtée sans commit. **Aucune ligne de code n'a été reprise à zéro :
rien n'a été supprimé, rien n'a été recommencé.** Le disque a été relu, puis chaque affirmation
ci-dessus a été **rejouée** plutôt que crue sur parole.

### 7.1 Ce que le disque porte réellement (relu, pas supposé)

| Point | Ancrage mesuré dans la source |
|---|---|
| 1 | `.vocal-side-discussion` : `width: var(--vocal-side-tasks, 100%)` + `justify-self: start` ; `vocalRenderDiscussion()` lit `track: plan.taskTrack` (`super-agent.js`) |
| 2 | `.vocal-msg-user` : `align-self: flex-end`, `max-width: 92%`, `text-align: end`, `background: color-mix(in srgb, var(--text-primary) 8%, transparent)` ; `.vocal-msg-assistant` : `background` **absent**, `align-self: flex-start`. Les messages sont **enfants directs** de `.vocal-side-body` (`flex-direction: column`), donc l'alignement s'applique bel et bien |
| 3 | `vocalChromeVisible` règle 4 : `if (f.pointeurActif === true && f.pointeurGeste !== false) return true;` ; `vocalChromeGestePointeur` posé par `pointermove` / `pointerdown`, remis à `false` par l'expiration du minuteur et aux entrée/sortie ; `const visible = vocalBare || vocalChromeTimer !== 0 || vocalChromeVisible(faits);` |
| 4 | `VOCAL_PORTRAIT_PX = 96`, `VOCAL_PORTRAIT_BLOCK_PX = 96 + 8 + 20 + 12 = 136` ; `.vocal-portrait { width: 96px; height: 96px }` ; `vocalColumnNode(colonne, ".vocal-tasks-title", "above-list")` |

Aucun écart avec ce que le présent rapport décrit : **les quatre points sont tenus par le code
présent**, il n'y avait rien à finir.

Le point 1 est en outre **mesuré par la formule**, pas seulement décrit : le test P2 de
`vocal-colonnes-degagees.test.js` rejoue les sept fenêtres du tableau § 7bis.4 et exige, sur
chacune, que `taskTrack === track − 64` et que le bord intérieur des **deux** colonnes tombe
exactement sur le bord de la couronne (`bordInterieur − couronne === 0` des deux côtés). L'écart
au disque est donc **88 px de chaque côté**, contre 24 px à gauche avant le correctif.

### 7.2 Décision d'interprétation ajoutée — « invisible par défaut »

La remarque 3 dit « invisible **par défaut** ». Tranché ainsi, et écrit ici parce que c'est un
choix et non une évidence : **le bas est visible pendant les 2 500 ms qui suivent l'entrée dans le
mode** (`enterVocal()` appelle `vocalRestartChromeTimer()`, le compte à rebours part de
l'ouverture), **puis il s'efface sans qu'aucun geste n'ait eu lieu**. « Par défaut » veut donc dire
**l'état de repos**, c'est-à-dire le seul état *stable* de l'écran — pas le tout premier instant.

Motif : entrer dans un écran et n'y trouver aucune barre de saisie, sans savoir qu'un mouvement de
souris la fait revenir, ferait passer le mode pour cassé. Ce délai n'introduit **aucun réglage**
(`VOCAL_CHROME_IDLE_MS` inchangé, aucune constante nouvelle, aucune mémoire) et il ne retarde rien
d'utile : taper au clavier, cliquer ou bouger la souris rallume immédiatement.

### 7.3 Les six mutations rejouées (source mutée, verrou lancé seul, source restaurée)

Chaque essai a été **réappliqué à la source**, son verrou lancé seul (`npx vitest run <fichier>`,
rapport JSON), puis la source **restaurée** — `git status --short` vérifié après chaque essai :
**aucune mutation ne subsiste**. Les compteurs sont ceux du rapport JSON de Vitest.

| # | Mutation appliquée | Verrou lancé | Résultat mesuré |
|---|---|---|---|
| 1 | **R1** : `.vocal-side-discussion` perd `width` et `justify-self` | `vocal-colonnes-degagees.test.js` | **9 tests : 8 PASS / 1 ÉCHEC** |
| 2 | **R2** : `.vocal-msg-user` perd `align-self`, `max-width` et `text-align` | `vocal-deux-voix.test.js` | **11 tests : 9 PASS / 2 ÉCHECS** |
| 3 | **R2 bis** : `.vocal-msg-assistant` reçoit le fond de la question | `vocal-deux-voix.test.js` | **11 tests : 10 PASS / 1 ÉCHEC** |
| 4 | **R3** : la règle 4 redevient une règle de **position** | `vocal-saisie-declenchement.test.js` | **14 tests : 13 PASS / 1 ÉCHEC** |
| 5 | **R4** : le titre revient en tête de colonne (`"above-list"` → `"first"`) | `vocal-portrait-detache.test.js` | **13 tests : 12 PASS / 1 ÉCHEC** |
| 6 | **R4 bis** : le médaillon repasse à 72 px **dans la feuille de style** | `vocal-portrait-detache.test.js` | **13 tests : 12 PASS / 1 ÉCHEC** |

Les mutations 2 à 6 couvrent **les points 2, 3 et 4**, avec pour chacun deux mutations dont une par
la seule feuille de style : le verrou ne dépend donc pas d'un unique fichier. La mutation 1 couvre
le point 1. **Aucun verrou n'est mort** — chacune fait échouer le test qui prétend tenir son point —
et **aucune autre** n'échoue : le verrou est précis, pas un échec en bloc.

### 7.4 Compteurs finaux réels (mesurés sur ce disque)

| Mesure | Valeur |
|---|---|
| `npx vitest run` (suite complète) | **4 829 PASS / 0 FAIL** (`numTotalTests 4829`, `numPassedTests 4829`, `numFailedTests 0`) |
| Les quatre verrous, lancés seuls | **47 PASS / 0 FAIL** (9 + 11 + 14 + 13) |
| Tests supprimés ou assouplis | **aucun** |
| Fichiers Rust touchés | **aucun** (le lot est frontend : `cargo test` n'est pas concerné) |
| Aide intégrée | régénérée (`help/handbook.md` fait partie du même commit) |
| Commit unique du lot (au-dessus de `a0daf4e`) | **un seul**, en tête de branche (`git log --oneline -1`) ; il porte ce rapport, les 4 fichiers de verrou, les 3 sources et la spec — **aucun bump de version, aucun tag, aucun push** |
