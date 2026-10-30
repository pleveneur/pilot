# Rapport — point 7 : le cercle en haut, la photo du personnage dessous

Remarque du propriétaire, mot pour mot :

> « le cercle en haut, à sa taille actuelle, la **photo du personnage dessous**, sur
> le **même axe vertical**, **non rognée**, avec de **vraies marges** — et environ
> **trois fois** plus grande. Sans image, le cercle reste **centré** et la photo lui
> cède la place, sans redémarrer. Rien ne doit se chevaucher ni déborder, en petite,
> moyenne et grande fenêtre. »

Point de départ : `12bde11` (les deux cadres à la même taille, cercle centré), la
barre du bas qui s'efface (`8fbd27a`) étant déjà en amont.

---

## 1. Ce qui est livré, en une phrase

Le **milieu de l'écran est devenu UNE seule colonne de la grille** (`.vocal-center`) qui
porte, dans cet ordre, **le disque puis le médaillon du personnage et son nom** ; le
médaillon se mesure désormais sur la **hauteur disponible sous le disque** (et non plus
sur la largeur de la colonne des tâches), ce qui lui fait atteindre **288 px — trois fois
son plancher de 96 px — dès 1 440 × 900**, pendant que la **liste des tâches ne perd plus
aucune rangée** et que le cercle, sans image ni avatar, reste **exactement centré**.

---

## 2. La composition, mesurée dans le navigateur

Banc jetable (`.pi/tmp/mesure-vocal.html`, serveur statique local, iframe à la taille
testée) : la hauteur de rangée est **mesurée** (`gridTemplateRows`), passée au budget, la
valeur écrite, puis **re-mesurée** jusqu'à équilibre (`|après − rangée| < 0,5 px`) — une
seule passe donne un chiffre faux (65 px au lieu de 97 à 720 × 520), parce que la piste
dépend du plan qui dépend d'elle.

### 2.1 Avec un personnage

| Fenêtre | Rangée | Disque | **Médaillon** | Bloc (`+52`) | Composition | Liste | Rangées |
|---|---|---|---|---|---|---|---|
| 720 × 520 | 313 px | 151,6 px | **97 px** | 149 px | 312,6 px | 178 px | **3** |
| 768 × 576 | 369 px | 188,3 px | **116 px** | 168 px | 368,3 px | 234 px | **4** |
| 896 × 672 | 465 px | 251,3 px | **149 px** | 201 px | 464,3 px | 330 px | **6** |
| 1024 × 768 | 561 px | 314,3 px | **182 px** | 234 px | 560,3 px | 426 px | **8** |
| 1280 × 800 | 593 px | 335,3 px | **193 px** | 245 px | 592,3 px | 458 px | **8** |
| 1440 × 900 | 693 px | 336,0 px | **288 px** | 340 px | 688 px | 459 px | **8** |
| 1920 × 1080 | 873 px | 336,0 px | **288 px** | 340 px | 688 px | 459 px | **8** |

La composition ne dépasse **jamais** sa rangée (312,6 / 313 ; 368,3 / 369 ; 464,3 / 465 ;
560,3 / 561 ; 592,3 / 593 ; 688 / 693 ; 688 / 873) : c'est l'effet de l'**arrondi vers le
bas** du médaillon.

### 2.2 Positions réelles (relevées au navigateur, largeur 720)

| Cas | `cx` disque | `cx` photo | `cx` scène | Disque (haut → bas) | Photo (haut) | Nom (haut) |
|---|---|---|---|---|---|---|
| avec personnage | 360 | 360 | 360 | 86,2 → 237,8 | 249,8 | 354,8 |
| **sans personnage** | 360 | — | 360 | **160,7 → 312,3** | — | — |

Rangée de 313 px : le disque seul occupe `160,7 → 312,3`, soit **exactement le milieu**
(160,7 × 2 = 321,4 + 151,6 = 313). À 768 × 576 : avec personnage `86,3 → 274,7`,
photo `286,7`, nom `410,7` ; **sans** personnage `170,3 → 358,7` (369 px de rangée).
À 896 × 672 : `86,3 → 337,7`, photo `349,7`, nom `506,7` ; **sans** personnage
`186,8 → 438,2` (465 px de rangée).

### 2.3 Sans image ni avatar

`portraitSize` vaut **0**, l'image et le nom sont `hidden`, et la composition se réduit au
disque : `justify-content: center` le pose au centre exact. **Aucun décalage n'est écrit**
(ni `top`, ni `transform`, ni marge négative) — le mouvement du disque est **la seule
conséquence** du recentrage de l'ensemble.

### 2.4 L'avatar du visage

Inchangé, et c'est voulu : sa fenêtre reste **dans la colonne** et paie ses **180 px**.
À 768 × 576 : zone 180 px, liste **54 px / 1 rangée** (contre 4 sans lui) — comportement
d'avant le point 7, non touché. À 720 × 520 la fenêtre n'est pas dessinée : liste **178 px /
3 rangées**, comme le cas nu.

---

## 3. Ce que la liste des tâches a gagné (chiffres avant / après)

| Fenêtre | Avant (personnage) | Après (personnage) | Sans personnage |
|---|---|---|---|
| 720 × 520 | 30 px · **1** rangée (rognée) | **178 px · 3** | 178 px · 3 |
| 768 × 576 | 86 px · **1** | **234 px · 4** | 234 px · 4 |
| 896 × 672 | 132 px · **2** | **330 px · 6** | 330 px · 6 |
| 1024 × 768 | 166 px · **2** | **426 px · 8** | 426 px · 8 |
| 1280 × 800 | 132 px · **2** | **458 px · 8** | 458 px · 8 |
| 1440 × 900 | 132 px · **2** | **459 px · 8** | 459 px · 8 |
| 1920 × 1080 | 132 px · **2** | **459 px · 8** | 459 px · 8 |

**Le nombre de rangées est désormais le même avec et sans personnage**, à toutes les
tailles : la colonne ne réserve plus que ses **53 px** de haut fixe (titre + air + filets),
plus les 180 px de l'avatar quand il est là.

La **colonne de discussion** n'a jamais payé le personnage : son budget est **inchangé**
(`floor((H − 53) / 37)` lignes, `charsPerLine` sur la largeur mesurée) — mêmes lignes
avant et après, à toutes les fenêtres.

---

## 4. Ce qui a changé dans le code

| Fichier | Changement |
|---|---|
| `src/js/vocal-sides.js` | `vocalPortraitSize` prend `{ orbSize, stageHeight }` : `parHauteur = hauteurDeRangee − disque − VOCAL_PORTRAIT_FRAME_PX` (**64**), plafond `VOCAL_PORTRAIT_TARGET_PX` (**288**), plancher **96** puis **56** (`VOCAL_PORTRAIT_MIN_PX`), **arrondi vers le bas**. `planVocalSides` reçoit `stageHeight`, en déduit `portraitSize`, et **ne retranche plus le bloc** à `listHeight` (`listHeight = columnHeight − VOCAL_SIDE_FIXED_PX − imageZone.height`). `VOCAL_PORTRAIT_EDGE_PX`, `VOCAL_PORTRAIT_MIN_LIST_PX` et `VOCAL_STAGE_GAP_PX` (inutilisé) retirés ; `VOCAL_STAGE_RESERVED_PX` = **207** comme **repli** seulement. `planVocalImageZone` : le **cas 1 (personnage) ne réserve plus rien** — l'avatar garde ses 180 px. |
| `src/css/style.css` | Nouvelle règle `.vocal-center` (`grid-area: 1 / 2`, `display: flex`, `flex-direction: column`, `align-items: center`, `justify-content: center`, `align-self: stretch`, `width: var(--vocal-orb-size)`, aucun `overflow`, aucune hauteur écrite). `.vocal-orb` **n'a plus aucun placement** : `.vocal-center > .vocal-orb { flex: 0 0 auto; }` et rien de plus. `.vocal-portrait` lit `var(--vocal-portrait-size, 96px)`, garde `margin-block-start: 12px`. Aucune couleur en dur, aucun jeton nouveau. |
| `src/js/super-agent.js` | `buildVocalOverlay` : `.vocal-orb` et `.vocal-portrait` sont enveloppés dans `<div class="vocal-center">`, **disque d'abord, photo ensuite** ; `.vocal-side-tasks` commence par son titre puis `.vocal-side-body`. `vocalStageRowHeight()` (nouveau) **mesure** la première piste de `.vocal-stage` (`getComputedStyle…gridTemplateRows`), avec repli `innerHeight − VOCAL_STAGE_RESERVED_PX`. `vocalSyncSides()` lui passe `stageHeight` et devient l'**unique** écrivain de `--vocal-portrait-size`. `buildVocalPortraitName` cible `.vocal-center .vocal-portrait`. |

Rien d'autre n'a bougé : ni la règle d'effacement du bas (13/11), ni la transparence des dix
palettes, ni le bouton-œil, ni le micro, ni les trois sorties, ni la zone d'image de
l'avatar, ni les six hôtes cliquables. **Aucun réglage nouveau, aucune persistance, aucun
numéro de version.**

---

## 5. Les verrous

### 5.1 Réécrits (la prémisse « le portrait est dans la colonne » n'était plus vraie)

| Fichier | Ce qu'il tient maintenant |
|---|---|
| `src/js/vocal-portrait-detache.test.js` | **19 pass** — le médaillon **sous** le disque (même composition), `taille + 52` px de bloc, airs, jamais cliquable, reste affiché en état nu, et **la liste qui ne perd plus de rangée** |
| `src/js/vocal-taches-en-haut-portrait-en-bas.test.js` | **23 pass** — le titre « TÂCHES » ouvre la liste, le personnage est **sous** le cercle, aucun nœud de personnage dans la colonne |
| `src/js/ecran-vocal-cadres-et-cercle.test.js` | **13 pass** — les deux cadres à la même taille, et le cercle qui **ne reçoit aucun décalage écrit** |
| `src/js/ecran-vocal-zone-image.test.js` | **16 pass** — les trois cas de la zone d'image : le personnage ne réserve plus rien, l'avatar 180 px, sinon rien |
| `src/js/ecran-vocal-portrait.test.js` | **17 pass** |
| `src/js/ecran-vocal-marges-transparence-portrait.test.js` | **15 pass** — airs, verre et lavis, cible désormais **tenue** (288 px) |
| `src/js/ecran-vocal-masquage-garde-le-portrait.test.js` | **16 pass** — l'état nu n'éteint ni le portrait ni le nom |
| `src/js/ecran-vocal-la-saisie-nest-jamais-masquee.test.js` | **9 pass** |
| `src/js/vocal-sides.test.js` | **T10 réécrit** : « le PERSONNAGE ne prend plus de place à la colonne » — `portraitSize` 288, `portraitBlock` 340, `listHeight` **459 = 512 − 53** (et non plus 132), avec ou sans avatar |
| divers (`ecran-vocal-lot2`, `ecran-vocal-bouton-relance`, `vocal-halo-*`) | mises à jour d'ancrage, **toutes vertes** |

### 5.2 Ajouté

`src/js/ecran-vocal-point7-photo-sous-le-cercle.test.js` — **11 pass / 0 fail** :

- **P1** — une **seule** colonne de grille : `.vocal-center` est l'élément de grille
  (`grid-area: 1 / 2`, `flex-direction: column`, `justify-content: center`,
  `align-self: stretch`) ; `.vocal-center > .vocal-orb` n'a que `flex: 0 0 auto` ;
  `.vocal-stage` garde ses trois pistes et `align-items: center`.
- **P2** — **aucun décalage écrit** (`top`, `bottom`, `transform`, marge négative,
  `position: absolute`) dans `.vocal-center` ni dans son disque ; `margin-block-start:
  12px` du médaillon intact ; aucun style en ligne posé par `buildVocalOverlay`.
- **P3** — **sans personnage** : `<img class="vocal-portrait" alt="" hidden />`,
  `applyVocalPortrait` bascule `img.hidden`, `planVocalSides(...).portraitSize === 0`,
  `.vocal-center` sans `overflow` ni hauteur écrite.
- **P4** — la hauteur de rangée est **mesurée** (`gridTemplateRows`, première piste), avec
  un repli nommé ; `vocalSyncSides` la passe et écrit `--vocal-portrait-size` **une fois**.
- **P5** — à hauteur de rangée fixe, **1024 et 1920 de large donnent le même médaillon**
  (288) : la largeur n'entre plus dans le calcul ; à 465 px de rangée, 65 px — moins que
  288 ; `listHeight` identique avec et sans portrait.

**Le verrou qui manquait** est donc en place : si la photo repasse au-dessus du cercle
(P1/P2), si le cercle cesse d'être centré sans image (P3/P5), ou si la taille se remet à
dépendre de la largeur (P5), le test **échoue**.

---

## 6. Rejeu des mutations (les verrous mordent-ils vraiment ?)

Banc `.pi/tmp/mutations.mjs` : chaque mutation est **appliquée**, le verrou est **lancé**,
le fichier est **restauré** puis comparé à son empreinte SHA-1.

| # | Mutation | Résultat | Restauration |
|---|---|---|---|
| M1 | le disque redevient l'enfant de la grille (la photo repasse au-dessus) | **FAIL=1 — détectée** | identique |
| M2 | un décalage écrit (`translateY(-40px)`, `flex-start`) remplace le centrage | **FAIL=2 — détectée** | identique |
| M3 | le portrait n'est plus masqué quand aucune image n'existe | **FAIL=1 — détectée** | identique |
| M4 | la hauteur de rangée redevient une constante au lieu d'une mesure | **FAIL=1 — détectée** | identique |
| M5 | la colonne des tâches se remet à payer le bloc du personnage | **FAIL=3 — détectée** | identique |
| M6 | la taille du médaillon se reprend sur la **largeur** de la colonne | **FAIL=1 — détectée** | identique |

**6 mutations sur 6 détectées**, **6 restaurations à l'octet près** (SHA-1 vérifié) ;
`git diff` après le rejeu est celui d'avant le rejeu.

---

## 7. Documentation et aide intégrée

- `spec_modes_ecran_vocal.md` § 3ter : nouvelle sous-section **« Le cercle en haut, le
  personnage dessous (point 7, 2026-11-13) »** (composition, budget sur la hauteur, 64 px de
  cadre, arrondi vers le bas, tableau des sept fenêtres, positions relevées), les trois cas
  de la zone d'image réécrits (le personnage ne réserve plus rien), le budget de la colonne,
  le paragraphe du nom, l'état nu, la liste des modules et la liste des verrous.
- Bloc `<!-- HELP:vocal-colonnes-portrait -->` réécrit (portrait sous le cercle, 288 px dès
  1 440 × 900, autant de tâches avec que sans personnage, cercle exactement centré sans
  image) puis `npm run build:handbook` → `help/handbook.md` régénéré (47 blocs).
- `AGENTS.md` : la ligne de navigation du portrait décrit désormais le point 7 et renvoie
  au verrou.
- `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md` : nouvelle section
  **§ 7bis.0 (révision du 2026-11-13)** qui dit que le personnage a quitté la zone d'image.

---

## 8. État des tests

| Moment | Tests |
|---|---|
| Avant toute modification | **4943 pass / 0 fail** (15,66 s) |
| Pendant (après réécriture des 13 verrous) | 4947 / 0 |
| Après ajout du verrou P1–P5 | **4958 pass / 0 fail** |
| Après le rejeu des 6 mutations | **4958 pass / 0 fail** |

Rust non touché (aucun fichier `.rs` modifié) : `cargo test --workspace` n'est pas concerné
par ce lot.

---

## 9. Commit

**Un seul commit**, en français, sans publication, sans étiquette, sans pousser ; la
référence exacte se lit avec `git log -1 --format='%h %s'`.
