# Rapport — mission « écran Vocal » : la présentation

> **⚠️ PÉRIMÉ SUR UN POINT — correction du 2026-10-31.** Ce rapport décrit un état du
> code qui n'est plus le code livré : le portrait n'est **pas au centre du cercle**. Sur
> décision du propriétaire, la mission « écran Vocal » du 2026-10-30 est **annulée** — le
> personnage est **en haut à droite de l'écran**, dans la colonne de droite, **au-dessus**
> de la liste, et le **disque ne porte ni image ni nom**. Fait foi :
> `spec_modes_ecran_vocal.md` § 3ter et § 4ter, et l'encadré de tête de l'**AVENANT** de
> `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`. Ce qui suit reste un
> **témoignage daté** : à lire pour l'histoire des décisions, pas pour décrire le code.



> **Nature** : rapport de mission (code livré, tests, documentation).
> **Périmètre** : quatre ajustements de **présentation** de l'écran Vocal, décidés par le
> propriétaire à l'oral, exécutés après la mission « zone d'image ».
> **Interdits respectés** : le **disque**, le **halo**, le **micro** et les **trois sorties**
> (le logo, `Échap`, la fermeture de l'onglet) n'ont pas été touchés ; aucun nouveau
> réglage, aucune case, aucun `localStorage`, aucune minuterie nouvelle ; aucun numéro de
> version changé ; rien n'a été publié.

---

## 1. La ligne d'activité du bas de la colonne est RETIRÉE

Le texte du pied de la colonne de droite (« *X* réfléchit », « *X* exécute une opération »,
« *N* missions en attente ») **n'existe plus**, et sa place **n'est pas réoccupée**.

Ce qui est parti, **ensemble** (une fonctionnalité, un nœud, une règle, ses tests) :

| Parti | Où il vivait |
|---|---|
| `vocalNowLine(missions)` — les six cas de la phrase (aucun jeton propre : ses valeurs venaient des libellés déjà présents) | `src/js/vocal-sides.js` |
| le nœud `.vocal-now` peint à chaque rafraîchissement | `vocalRenderColumn()` (`super-agent.js`) |
| la règle `.vocal-now` (`margin-block-start: 12px`, 18 px de haut, ellipse) | `src/css/style.css` |
| sa ligne dans le bloc d'effacement `.vocal-bare` (deux blocs : normal et mouvement réduit) | idem |

**Ce qui n'a pas bougé** : la **ligne d'état** de l'écran (`vocal-status`, la phrase sous le
cercle) — c'est un autre texte, à un autre endroit, et elle n'a pas été demandée. Les deux
n'ont jamais été la même chose : la première décrivait ce que fait **un agent** ; la seconde
dit où en est **l'écran** (repos, écoute, réflexion, parole).

**Les tests qui décrivaient la ligne d'activité ont été RETIRÉS avec elle**, et non
assouplis. Ils sont nommés ici pour que la trace soit complète (fichier
`src/js/vocal-taches-en-haut-portrait-en-bas.test.js`) :

- `un agent qui travaille, une operation ou une reflexion` ;
- `plusieurs agents, un demarrage, une file d'attente` ;
- `jamais vide, jamais deux phrases`.

Ils sont remplacés par une garde **d'absence**, plus courte et plus forte : la fonction ne
doit plus exister nulle part (`vocalNowLine` absent de `vocal-sides.js`), le nœud ne doit plus
être peint (`vocal-now` absent de `super-agent.js` et du rendu), la règle ne doit plus être
écrite (`\.vocal-now` absent de la feuille), et le bloc d'effacement ne doit plus la citer.
Même garde dans `ecran-vocal-bouton-affichage.test.js`, qui vérifiait la présence du
sélecteur et vérifie désormais son **absence**.

Conséquence mesurée : la colonne ne réserve plus que **51 px** en haut et en bas
(14 + 11 + 14 de titre + 12 d'air du bas), au lieu de **170 px** — les 18 px de la ligne et
les 6 px d'écart qui allaient avec, plus les 98 px du médaillon, sont rendus à la liste.

## 2. La liste des tâches ne passe JAMAIS sous le cercle

La colonne de droite n'a plus la largeur de la piste de la grille. `vocalSyncSides()` —
**seul point d'écriture** de la géométrie — écrit une **seconde** valeur, `--vocal-side-tasks`,
qui vaut :

```
taskTrack = track − (VOCAL_CROWN_PX − 24) = track − (88 − 24) = track − 64
```

88 px est la couronne du halo (`--vocal-crown`), 24 px le jour déjà compté entre la piste et
le disque (`column-gap`). La colonne s'arrête donc **au bord de la lueur**, jamais dessous.

C'est une **largeur**, pas une marge : un titre long ne peut ni déborder ni pousser la boîte,
il est **coupé par sa boîte** (`white-space: nowrap` + `text-overflow: ellipsis`, sur le titre
comme sur chaque tâche). `min-width: 0` et `justify-self: end` la gardent collée au disque, et
la colonne de gauche garde `--vocal-side` (rien ne la menace de son côté). Le calcul ne rend
jamais une largeur négative (`Math.max(0, …)`).

Vérifié par un test dédié (`vocal-sides.test.js`) : `taskTrack` vaut toujours `track −
VOCAL_CROWN_PX + 24`, la valeur écrite par `vocalSyncSides` est celle que le CSS consomme
(`width: var(--vocal-side-tasks, 100%)`), et aucun autre endroit n'écrit cette variable.

## 3. Le portrait est au CENTRE du cercle, son nom juste dessous

Renversement assumé de la décision du 2026-10-29 : **le personnage quitte la colonne**. Il est
désormais :

- **dans** `.vocal-orb`, en **premier enfant** — donc **sous** le halo et **sous** le bouton
  « Réveiller <Nom> », qui se peignent par-dessus ;
- **centré** (`position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%)`) ;
- **au plus la moitié de l'intérieur du cercle** : `calc(var(--vocal-orb-size) / 2)`, soit
  168 px pour un disque de 336 ; il ne prend aucune place dans la grille, le disque ne bouge
  d'aucun pixel ;
- **sans aucun repli** : pas de personnage ⇒ `hidden`, **jamais** le logo.

**Un seul nom à l'écran.** `.vocal-orb-name` quitte le dessous du bouton-cercle et passe
**juste sous l'image**, à l'intérieur du disque : `top: calc(75% + 6px)` — `50 % + 25 %` est le
bas exact du portrait (il est centré et vaut la moitié du disque), plus les 6 px d'écart déjà
utilisés. Il tient sur **une seule ligne** (`white-space: nowrap`, `text-overflow: ellipsis`),
`max-width: 66 %` du disque (222 px pour 336 ; la corde du cercle à cette hauteur en vaut 284,
la pastille ne touche donc jamais l'anneau). Le nom est celui du personnage, à défaut celui de
l'assistant, par la **seule** règle existante `superAgentDisplayLabel()` — jamais deux noms,
**rien d'autre sous l'image**. Le libellé ne capte aucun clic (`pointer-events: none`), ne
déplace rien et ne se règle pas.

Ordre d'application inchangé dans `applyAssistantPersonaUi()` : bouton de relance → nom →
portrait, une seule peinture, aucun clic capté, aucune IO.

## 4. Le bas s'efface au repos — c'était DÉJÀ en place, et rien n'a été ajouté

Vérifié plutôt que réécrit : l'effacement de la barre du bas existe et fonctionne comme
demandé. `vocalSyncChrome(state)`, **dernière ligne** de `applyVocalState`, pose ou retire la
classe `vocal-chrome-hidden` d'après la décision pure `vocalChromeVisible()`
(`src/js/vocal-chrome.js`), avec :

- **un seul** minuteur, `vocalChromeTimer`, `setTimeout(…, VOCAL_CHROME_IDLE_MS)` = **2 500 ms** ;
- un seuil de mouvement de **4 px** (`VOCAL_CHROME_MOVE_PX`) : tout mouvement de souris la
  ramène — donc jamais de disparition sous le curseur pendant un clic ;
- cinq règles qui **interdisent** le masquage, dans l'ordre : micro fermé, champ occupé,
  état écoute/parole, pointeur sur le bas, question affichée — et le repos avec la dictée
  armée mais silencieuse **masque**, cas voulu.

**Aucune minuterie, aucun réglage, aucun état n'a été ajouté** pour ce point. La seule chose
écrite est la phrase d'aide qui le dit à l'utilisateur (bloc `HELP` de
`spec_modes_ecran_vocal.md`, § 3ter).

## 5. Une régression interceptée et réparée (à dire)

La réécriture de `src/js/vocal-sides.js` avait **emporté la queue du fichier** : les fonctions
pures de la **colonne de gauche** (`planVocalDiscussion`, `vocalDiscussionView`,
`vocalDiscussionMoreText`, `vocalCharsPerLine`, `vocalExcerpt`, `vocalSideClipped`) avaient
disparu. Les six fonctions de la colonne de gauche ont disparu d'un coup. Rien dans la production ne s'en plaignait ; seuls
`vocal-colonne-discussion.test.js` et les tests de la colonne de gauche l'auraient crié.

Réparé par **restauration littérale** de la queue de `HEAD` (le marqueur
`return "Tout est au repos";` jusqu'à la fin), jamais par réécriture à la main : 175 lignes
réinjectées, `planVocalDiscussion` de retour, `vocalNowLine` bien absent, fichier à 647
lignes. Le module expose **46** symboles : les **51** de `HEAD`, moins les **7** que l'ancienne
disposition seule justifiait (`VOCAL_PORTRAIT_PX`, `VOCAL_PORTRAIT_BLOCK_PX`,
`VOCAL_IMAGE_GAP_PX`, `VOCAL_IMAGE_PORTRAIT`, `VOCAL_IMAGE_AVATAR_PORTRAIT`,
`VOCAL_TASKS_MAX_BARE`, `vocalNowLine`), plus les **2** jetons neufs (`VOCAL_CROWN_PX`,
`VOCAL_SIDE_CLEARANCE_PX`).

## 6. Les tests

```
npx vitest run   →   PASS (4727)   FAIL (0)
```

Point de départ de la mission : **PASS (4726)**, **FAIL (0)**. Le solde de **+1** vient des
gardes ajoutées moins les trois tests retirés avec la ligne d'activité (§ 1).

**Aucun test n'a été assoupli.** Cinq fichiers ont été **réécrits** parce que la disposition
qu'ils décrivaient a changé, et chacun dit désormais la **nouvelle** règle, au pixel :

| Fichier | Ce qu'il verrouille maintenant |
|---|---|
| `vocal-sides.test.js` (10) | `listHeight = H − 51` (et `− 180` avec la fenêtre du visage) ; `taskTrack = track − 64`, jamais négatif |
| `vocal-taches-en-haut-portrait-en-bas.test.js` (22) | l'ordre titre → zone d'image → liste et **plus d'activité** ; le tableau des sept fenêtres en `H − 51` ; le plafond de 8 ; le seuil des en-têtes à 86 px |
| `ecran-vocal-zone-image.test.js` (16) | **deux** cas seulement (fenêtre du visage à 180 px, sinon rien) ; `H = 277` comme seuil ; l'avatar n'est jamais un nœud |
| `ecran-vocal-portrait.test.js` (17) | le portrait **dans** le disque, centré, moitié du disque, premier enfant ; le nom **dans** le cercle ; un seul nom |
| `ecran-vocal-bouton-affichage.test.js` (42) | l'absence de `.vocal-now`, son retrait des deux blocs d'effacement |

Trois autres fichiers (`ecran-vocal-bouton-relance.test.js`, `ecran-vocal-lot2.test.js`,
`vocal-halo-128-et-etat-au-dessus-saisie.test.js`, 91 tests ensemble) ne vérifiaient qu'un
point : **l'ordre des enfants du disque**. Le portrait étant devenu le **premier** enfant, la
liste attendue a été corrigée — c'est la disposition voulue, pas une exception.

## 7. Documentation mise à jour

- **`spec_modes_ecran_vocal.md`** : § 3ter réécrit (deux cas de zone d'image, 51 px de fixe,
  `H − 51` / `H − 51 − 180`, liste qui s'arrête avant la couronne, ligne d'activité retirée,
  portrait et nom dans le cercle, bas qui s'efface au repos) ; § 4ter révisé (§ 7 ci-dessous) ;
  le bloc d'**aide embarquée** `HELP:vocal-colonnes-portrait` réécrit et `help/handbook.md`
  régénéré (`npm run build:handbook`).
- **`docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`** : un **AVENANT**
  (mission « écran Vocal », 2026-11) en tête, qui **prime** et dit les quatre décisions, la
  nouvelle table des hauteurs, et les sections qu'il amende (§ 1.2, § 2.1, § 2.2, § 2.3,
  § 2.4, § 2.5, § 3.1, § 3.3, § 3.4, § 6.7, § 7bis).
- **`docs/conceptions/CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md`** : bandeau
  « périmé sur trois points » en tête, avec renvoi à l'avenant.

## 8. Une conséquence à faire trancher par le propriétaire

La décision du 2026-10-29 « **tout masquer d'un geste, sauf le portrait** » avait un objet
parce que le portrait vivait dans la colonne, loin du disque. Depuis qu'il vit **dans** le
disque, il en fait partie : son anneau, sa couronne, son enveloppe de parole et son arc sont
peints par le **même** nœud. Le bloc d'effacement l'éteint donc **avec le disque**, et la seule
exception du document tombe **parce qu'elle n'a plus d'objet** — aucun test n'a été touché
pour cela (`ecran-vocal-bouton-affichage.test.js` vérifie toujours que le portrait n'est pas
**nommé**, et que « sans personnage il ne reste que le bouton »).

Deux lectures possibles, **non tranchées ici** (la mission interdisait de toucher au disque) :

1. **Le disque et le portrait s'éteignent ensemble** (ce que fait le code aujourd'hui). C'est
   cohérent avec « tout masquer », mais l'infobulle du bouton-œil dit encore « cliquer pour ne
   garder que le portrait » — **le texte n'a pas été changé**, précisément pour que la
   décision reste lisible.
2. **Le portrait reste seul** pendant que le disque s'éteint. Il faut alors **démembrer** le
   bloc d'effacement : nommer séparément l'anneau, la couronne, l'enveloppe, l'arc et le bouton
   de relance, et faire disparaître le fond et le filet du disque par `background` /
   `border-color` plutôt que par `opacity` (une opacité sur le parent emporterait l'enfant).
   Cela change la forme du bloc et demande de réécrire le test « sans personnage, le disque ne
   reste pas ».

Le choix 1 est en place ; le choix 2 est décrit ici pour être exécuté sans réfléchir si le
propriétaire le demande.

---

## Fichiers modifiés

**Code** (3) : `src/js/super-agent.js`, `src/js/vocal-sides.js`, `src/css/style.css`.

**Tests** (8) : `vocal-sides.test.js`, `vocal-taches-en-haut-portrait-en-bas.test.js`,
`ecran-vocal-zone-image.test.js`, `ecran-vocal-portrait.test.js`,
`ecran-vocal-bouton-affichage.test.js`, `ecran-vocal-bouton-relance.test.js`,
`ecran-vocal-lot2.test.js`, `vocal-halo-128-et-etat-au-dessus-saisie.test.js`.

**Documentation** (4) : `spec_modes_ecran_vocal.md`,
`docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`,
`docs/conceptions/CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md`,
`help/handbook.md` (généré).
