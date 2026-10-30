# Rapport — écran Vocal : marges intérieures, transparence visible, portrait ~3 ×

**Date** : 2026-11-02
**Périmètre** : `src/css/style.css` (bloc de l'écran Vocal, 11 600 → 13 060), `src/js/vocal-sides.js`
(budget), les tests de l'écran Vocal, `spec_modes_ecran_vocal.md` § 3ter,
`docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`, `help/handbook.md`.
**Base** : `d34c789` (« le cercle reste allumé quand on masque l'affichage »).
**Commit** : `d0350cd` — « fix(vocal): marges intérieures, transparence visible, portrait ~3 x ».
*(Cette ligne nomme le commit qui porte tout le lot ; elle a été écrite dans un amendement
qui n'ajoute qu'elle — `git diff d0350cd HEAD` ne montre que ce paragraphe. Aucun commit, ni
tag, ni poussee, ni publication de plus.)*

Quatre remarques du propriétaire, un seul lot, un seul commit. Aucun réglage nouveau, aucun
stockage local nouveau, aucune publication.

---

## 1. « Aucune marge intérieure » — le contenu touche le cadre

### Ce que j'ai trouvé

La marge **existait** déjà : `padding-inline: 10px` sur les deux colonnes et
`padding-block-end: 12px` (posés au commit précédent, comptés dans le budget par
`VOCAL_SIDE_FRAME_PX = 2 × (1 + 10) = 22`). Le défaut réel était ailleurs : **la colonne
n'avait que 320 px**. Une marge de 10 px, sur une piste de 320 px, ne rend pas un texte
respirable — elle le rétrécit. Mesure : `floor((320 − 22) / 7,6)` = **39 caractères par
ligne**, et une ligne de discussion de 39 caractères se casse tous les cinq mots.

Le propriétaire autorisait explicitement les deux leviers : « ajoute une respiration à
l'intérieur des panneaux… tu peux aussi agrandir un peu les deux cadres ».

### Ce que j'ai changé

| Quoi | Avant | Après |
|---|---|---|
| Largeur nominale d'une colonne (`VOCAL_SIDE_MAX_PX`) | 320 px | **384 px** (+64 px, symétriques) |
| Caractères par ligne à la largeur nominale | 39 | **47** (+21 %) |
| Air intérieur horizontal | 10 px | 10 px (**inchangé**, déjà compté) |
| Air du bas (`padding-block-end`) | 12 px | 12 px (inchangé) |
| Air au-dessus du médaillon | 12 px | 12 px (inchangé) |

La largeur **ne peut jamais dépasser la place mesurée** : `planVocalSides` borne le `track`
par `avail` (la place réelle entre la marge extérieure, le jour et le disque). Sous 1 024 px
de fenêtre les colonnes restent écrasées (et sous 240 px de place elles s'effacent, seuil
inchangé). Le plafond de 400 px (atteint à 1 920 px de large) et le seuil de 240 px ne
bougent pas.

L'air **reste retranché du budget avant d'être peint** : `vocalCharsPerLine()` fait
`floor((track − VOCAL_SIDE_FRAME_PX) / 7,6)`, où le cadre est **lu dans la feuille de
style** par le test (`2 × (bordure + padding)`), jamais recopié. Une ligne promise n'est
donc jamais rognée par la marge.

### Verrou

- `src/js/vocal-sides.test.js` — la valeur nominale (384) et les sept lignes du tableau de
  budget ;
- `src/js/cadre-listes-panneaux.test.js` — `VOCAL_SIDE_FRAME_PX` = somme **lue** dans le CSS
  (bordure 1 px + marge 10 px) × 2, et `charsPerLine` qui la retranche ;
- `src/js/vocal-colonne-discussion.test.js` — le tableau des six hauteurs, rejoué ;
- `src/js/ecran-vocal-marges-transparence-portrait.test.js` (R1) — `padding-block-end: 12px`
  sur **chacune** des deux colonnes, et `VOCAL_SIDE_FIXED_PX = 39 + 12`.

**Mutation rejouée** : `VOCAL_SIDE_MAX_PX` remis à 320 → **4 fichiers tombent**
(`vocal-sides` 4 échecs, `ecran-vocal-marges…` 1, `vocal-portrait-detache` 4,
`ecran-vocal-zone-image` 2, `vocal-taches-en-haut…` 3). `padding-inline` remis à 0 →
`cadre-listes-panneaux` tombe (`expected +0 to be 10`). Sources restaurées, `git diff`
vérifié.

---

## 2. « La transparence ne se voit pas du tout » — DEUX causes, mesurées

### La cause, avec preuve `fichier:ligne`

**Cause 1 — il n'y avait rien à voir au travers.** Les deux colonnes n'avaient **aucun
fond** : le « panneau » n'était qu'un filet de 1 px (`border: 1px solid var(--glass-frame)`,
`style.css:12141`), et derrière lui le calque peint un fond **uni**
(`background: var(--bg-app)`, `style.css:11657`). Un panneau transparent devant un fond uni
est invisible : il n'y a rien à voir au travers.

**Cause 2 — et c'est celle qui a survécu au premier correctif.** Le fond ajouté ensuite
était un lavis de **`--surface-floating`** (`style.css:11763`, avant ce lot), c'est-à-dire la
**même famille de couleur que la teinte du panneau** : `--glass-tint` dérive lui aussi de
`--surface-floating` (`style.css:~350`, 94 %). Le verre était donc **éclairé par sa propre
couleur** ; les deux se compensaient, et le panneau se lisait **exactement comme le fond**.

Mesure sur les dix palettes, avec le calcul du compositeur (lavis → teinte → verre), avant
ce lot :

| Palette | Lumière qui traverse (panneau éclairé − panneau à nu) | Écart panneau / arrière-plan éclairé | Texte sur le panneau |
|---|---|---|---|
| dark | 2,3 | 6,7 | 14,06 |
| light | 1,5 | 4,4 | 16,46 |
| one-dark | **0,8** | 2,4 | 6,25 |
| dracula | 1,3 | 4,0 | 12,33 |
| nord | 2,4 | 7,1 | 9,29 |
| tokyo-night | 2,8 | 8,3 | 9,48 |
| github | 1,2 | 3,6 | 14,40 |
| one-light | **0,7** | 2,0 | 11,20 |
| solarized | **0,0** | **0,0** | 4,13 |
| tokyo-day | 4,0 | 11,9 | 5,45 |

En `solarized`, `--surface-floating` **est** `--bg-app` : le panneau était littéralement
invisible (0 niveau). C'est la preuve chiffrée de « la transparence ne se voit pas ».

### La règle qui en sort

**Le verre doit être éclairé par une couleur opposée au fond**, et la seule que le thème
garantit opposée au fond **dans les deux modes** est son **texte** (`--text-primary`). Une
teinte de verre éclairée par sa propre famille ne peut pas se voir : c'est une identité, pas
un réglage.

### Ce que j'ai changé

| Pièce | Avant | Après |
|---|---|---|
| `--vocal-wash` (la lumière derrière) | `color-mix(in srgb, var(--surface-floating) 32%, transparent)` | **`color-mix(in srgb, var(--text-primary) 12%, transparent)`** |
| `--vocal-glass` (la surface) | `--glass-tint` à **62 %** | `--glass-tint` à **55 %** |
| `backdrop-filter` | `blur(8px)` | **`blur(12px)`** (8 px ne dissolvait pas la structure d'un lavis large) |
| Filet lumineux du verre | — | **`box-shadow: inset 0 1px 0 color-mix(in srgb, var(--text-primary) 10%, transparent)`** (0 px : aucune place prise, donc rien de plus à retrancher) |

La teinte reste **entièrement** issue du thème : `--glass-tint` = 94 % de
`--surface-floating` (plage 92–95 %, héritée par les dix palettes), aucune couleur en dur,
aucun `rgba()`, aucun `#hex`. `background-color` et non `background` : le raccourci
effacerait l'image de fond du calque (et donc les lavis).

### Résultat mesuré sur les dix palettes

| Palette | Lumière qui traverse | Écart panneau / arrière-plan éclairé | Texte sur son fond | Texte sur le panneau | Titres (secondaire) |
|---|---|---|---|---|---|
| dark | 12,6 | 6,6 | 15,42 | **12,57** | 6,31 |
| light | 12,6 | 19,2 | 15,46 | **14,49** | 5,34 |
| one-dark | 8,1 | 6,1 | 6,57 | 5,66 | 3,81 |
| dracula | 12,1 | 9,3 | 13,36 | 10,58 | 6,23 |
| nord | 11,0 | 5,1 | 10,84 | 8,20 | 7,00 |
| tokyo-night | 12,0 | 5,1 | 10,59 | 8,56 | 6,55 |
| github | 12,2 | 17,7 | 13,76 | 12,80 | 5,58 |
| one-light | 11,2 | 14,6 | 10,86 | 10,08 | 5,75 |
| **solarized** | 8,8 | 9,4 | **4,13** | **3,87** | 4,67 |
| tokyo-day | 9,9 | 26,1 | 4,52 | 4,84 | 3,87 |

**La lisibilité gagne sur la transparence, et c'est dit.** `solarized` reste à **3,87:1**
parce que sa **propre palette** ne donne que **4,13:1** sur son propre fond : aucune
transparence ne peut rendre un texte plus lisible que la palette qui le porte. Je n'ai pas
compensé en assombrissant la teinte (ce qui aurait tué la remarque n° 2) et je ne l'ai pas
corrigée en silence (ce qui aurait voulu dire écrire une couleur en dur dans une palette du
thème). C'est une **limite préexistante de la palette**, déclarée ici.

### Changement de thème à chaud

Les deux jetons sont des **variables CSS** : elles se recalculent au changement de thème,
sans redémarrage. Une surface qui floute garde sinon l'instantané de l'arrière-plan, d'où le
rafraîchissement existant (`body.glass-refresh`, `glass-theme.js`, qui inclut les deux
colonnes) — conservé, et verrouillé.

### Verrou

- **`src/js/ecran-vocal-transparence-visible.test.js`** (nouveau, 10 tests) — il ne cherche
  pas des mots : il **résout les jetons des dix palettes** et **compose les couches** comme
  le compositeur, puis mesure (1) la lumière qui traverse (≥ **6** niveaux entre le panneau
  éclairé et le même panneau à nu), (2) le bord du panneau (≥ **4** niveaux), (3) le
  contraste WCAG sur les dix palettes (≥ 4,5:1 partout où la palette y arrive déjà,
  `solarized` tenue à part et **documentée**), (4) que le mélange est bien un mélange (chaque
  canal entre le fond et la surface), (5) que la source du lavis n'est pas la famille de la
  teinte, (6) que le thème est réellement lu (dix panneaux différents) ;
- `src/js/ecran-vocal-marges-transparence-portrait.test.js` (R2) — `background-color:
  var(--vocal-glass)`, jeton en `color-mix`, `blur(12px)`, lavis issu de `--text-primary` ;
- `src/js/panneaux-translucides-theme.test.js` — `blur(12px)` et aucune couleur en dur.

**Mutation rejouée** : jetons remis à `--surface-floating 32 %` / `62 %` →
`ecran-vocal-transparence-visible` tombe sur la source du lavis, sur « la lumière ne
traverse pas » (**2,27 niveau** contre 6 exigés), sur « aucun bord » (one-dark 2,38 contre
4), sur « opaque » (solarized, écart 0), et sur le contraste de `tokyo-day` (4,49 < 4,5) et
de `solarized` (3,54 < 3,8). Sources restaurées, `git diff` vérifié.

---

## 3. « En état nu, le cadre du panneau de droite doit disparaître »

### Ce que j'ai trouvé

Traité au commit précédent (`d34c789`) : `.pilot-vocal.vocal-bare .vocal-side-tasks` éteint
le fond, le filet et le flou. **Mais** mon filet lumineux (`box-shadow: inset …`) est posé
sur la même règle de surface : sans une ligne de plus, il serait **resté** et aurait
redessiné le panneau en état nu.

### Ce que j'ai changé

`box-shadow: none` ajouté au bloc `.pilot-vocal.vocal-bare .vocal-side-tasks` — et à lui
seul.

### Vérification explicite des survivants

| Ce qui doit survivre | État |
|---|---|
| le **portrait** (`.vocal-portrait`) | non nommé par l'état nu → affiché |
| le **prénom** (`.vocal-portrait-name`) | non nommé → affiché |
| le **bouton de masquage** (`.vocal-display-toggle`) | rallumé **explicitement** dans la barre du haut (même taille, même place, même forme, libellé d'accessibilité inchangé) |
| la **zone de saisie** (`.vocal-input`) | non nommée → affichée et utilisable (verrou existant `ecran-vocal-la-saisie-nest-jamais-masquee.test.js`) |

Seuls `opacity`/`visibility` de la colonne de gauche, du titre et du corps de la liste
tombent ; la colonne des tâches, elle, garde **sa place et sa hauteur** (aucun `display`,
aucune marge, aucune translation) : le portrait ne bouge pas d'un pixel à l'aller comme au
retour.

### Contre-vérification demandée (autre remarque, traitée séparément)

**« Le cercle reste visible quand l'affichage est masqué »** : ce lot **ne touche pas** au
disque et ne l'ajoute à aucune liste d'extinction. `ecran-vocal-le-cercle-reste-visible.test.js`
reste **vert (12 tests)**. Le fond de scène ne peut pas l'éteindre non plus : le rayon des
lavis (`--vocal-wash-w`) s'arrête avant la boîte du disque, et **aucune couleur n'a été
posée sur le calque** (seul `background-image` a changé de source, jamais d'opacité).

### Verrou

`src/js/ecran-vocal-marges-transparence-portrait.test.js` (R4) — la règle de l'état nu :
`background-color: transparent`, `border-color: transparent`, `backdrop-filter: none`,
**`box-shadow: none`**, et l'interdiction d'y nommer `.vocal-portrait`,
`.vocal-portrait-name`, `.vocal-display-toggle`, `.vocal-input`. Plus
`ecran-vocal-masquage-garde-le-portrait.test.js` (16 tests) et
`ecran-vocal-le-cercle-reste-visible.test.js` (12 tests), inchangés.

**Mutation rejouée** : `box-shadow: none` retiré du bloc nu → R4 tombe (`to match
/box-shadow:\s*none/`). Restauré.

---

## 4. « Le portrait ~3 × plus grand, au-dessus du cadre, avec une marge »

### Ce que j'ai trouvé

Le médaillon était mesuré mais **plafonné à 214 px (2,2 ×)** dans une grande fenêtre,
parce que la règle 2 lui réservait **trois rangées et l'en-tête** à la liste
(`VOCAL_PORTRAIT_MIN_LIST_PX` = 40 + 3 × 46 = **178 px**). Avec 178 px, le maximum
mathématique était **231 px (2,4 ×)** : la remarque n'était pas tenue, et ce n'était pas un
problème de mesure mais de **priorité budgétaire**.

### L'arbitrage, assumé

La place réservée à la liste passe de **trois rangées** à **deux en-têtes + deux rangées** =
**132 px**. Conséquences **mesurées**, pas supposées :

| Réservation | Médaillon max | Écart à la cible | Liste |
|---|---|---|---|
| 178 px (3 rangées + en-tête) | 231 px (2,4 ×) | −57 px | 3 rangées, 2 en-têtes |
| **132 px (2 rangées + 2 en-têtes)** | **277 px (2,89 ×)** | −11 px | **1 tâche par groupe, 2 en-têtes**, le reste **dit** (« + N autre(s) ») |

Le choix est celui du propriétaire : il a demandé un portrait trois fois plus grand, pas une
liste de trois lignes. Ce qui dépasse n'est **jamais caché** : la ligne « + N autre(s) » le
dit. C'est un **arbitrage**, il est déclaré ici.

### Le chiffre réel, sans arrondi complaisant

La cible de 288 px **n'est jamais atteinte** : elle demanderait une colonne de tâches de
330 px, donc une fenêtre de plus de 2 000 px de large — et, à trois rangées comme à deux, il
ne resterait alors que deux rangées de liste. **Le chiffre retenu est 276-277 px, soit
2,88-2,89 ×**, atteint dès 1 280 px de large. Aucun débordement, aucun rognage de visage.

| Fenêtre | Colonne | Colonne des tâches | Médaillon | Bloc | Liste | Rangées |
|---|---|---|---|---|---|---|
| 720 × 520 | 244 | 180 | 96 | 148 | 32 | 1 (rognée) |
| 768 × 576 | 260 | 196 | 96 | 148 | 57 | 1 |
| 820 × 620 | 272 | 208 | 96 | 148 | 100 | 1 |
| 896 × 672 | 282 | 218 | 148 | 200 | 132 | 2 |
| 1024 × 768 | 314 | 250 | 208 | 260 | 168 | 2 |
| 1280 × 800 | 384 | 320 | **276** | 328 | 132 | 2 |
| 1440 × 900 | 384 | 320 | **277** | 329 | 132 | 2 |
| 1920 × 1080 | 400 | 336 | **277** | 329 | 132 | 2 |

Sous 1 280 px, c'est la **largeur** qui manque (deux colonnes + le disque) : le chiffre
baisse honnêtement (2,17 × à 1 024, 1,54 × à 896), et il ne déborde **jamais** du cadre.

### Marges (ni le cadre, ni le bord de l'écran, ni le nom)

- **12 px d'air au-dessus** du médaillon (`VOCAL_PORTRAIT_AIR_TOP_PX`, comptés dans le bloc) ;
- **10 px de marge de chaque côté** à l'intérieur du cadre (mesure : 320 − 22 − 277 = 21 px,
  soit 10,5 par côté à 1 440 × 900 ; 11 par côté à 1 280 × 800) ;
- **8 px** entre l'image et le nom, **12 px** sous le nom ;
- `object-fit: cover` sur un carré de côté `taille` : **aucun visage rogné**, aucun
  débordement possible (la boîte est carrée, l'image la remplit).

### Verrou

`src/js/vocal-portrait-detache.test.js` (R6, nouveau) — pour les six fenêtres : la marge
latérale ≥ 10 px (jamais de contact avec le cadre), `object-fit: cover`, l'écart au nom, le
bloc = `taille + 52` ; la cible de **2,8 ×** tenue dès 1 280 px et **jamais dépassée** ; le
chiffre réel **277** ; et **la liste à deux rangées + deux en-têtes sous le médaillon**
(`listHeight` = 2 × 20 + 2 × 46 = 132).

**Mutation rejouée** : `VOCAL_PORTRAIT_MIN_LIST_PX` remis aux trois rangées (178) →
médaillon 231 px → **2,40 ×** → R6 tombe (plus les valeurs attendues des autres tests).
Restauré.

---

## 5. Où j'ai tranché (jugements assumés)

1. **384 px et non 320 + un `padding` plus épais.** La respiration manquait par **manque de
   place**, pas par manque de marge : ajouter 2 px de `padding` aurait rendu 2 caractères de
   moins par ligne. J'ai donc pris la respiration en largeur (+64 px) et **gardé** la marge
   de 10 px déjà comptée.
2. **Deux rangées réservées au lieu de trois.** Voir § 4 : c'est le prix du portrait, il est
   dit et affiché (« + N autre(s) »).
3. **Lavis issu de `--text-primary`.** C'est la seule couleur garantie opposée au fond dans
   les deux modes. Une couleur choisie « à l'œil » aurait été une couleur en dur.
4. **`blur` de 12 px au lieu de 8.** Le flou n'avait rien à flouter tant que le lavis venait
   de la même famille ; il a maintenant une structure à dissoudre, et 8 px ne suffit pas.
5. **`solarized` laissée à 3,87:1.** Sa palette plafonne à 4,13:1 : je préfère une limite
   déclarée à une correction en dur qui casserait les dix palettes.
6. **Le filet lumineux en `box-shadow`, pas en `border`.** Une bordure aurait pris de la
   place et donc des caractères par ligne ; `inset 0 1px 0` ne prend rien.

---

## 6. Tests

| Commande | Avant | Après |
|---|---|---|
| `npx vitest run` (suite complète) | **4 896 / 0** | **4 911 / 0** |
| `src/js/ecran-vocal-transparence-visible.test.js` | — (nouveau) | **10 / 0** |
| `src/js/ecran-vocal-marges-transparence-portrait.test.js` | 13 / 0 | **14 / 0** |
| `src/js/vocal-portrait-detache.test.js` | 14 / 0 | **18 / 0** |
| `src/js/vocal-sides.test.js` | 11 / 0 | 11 / 0 |
| `src/js/vocal-colonne-discussion.test.js` | 34 / 0 | 34 / 0 |
| `src/js/ecran-vocal-zone-image.test.js` | 16 / 0 | 16 / 0 |
| `src/js/panneaux-translucides-theme.test.js` | 19 / 0 | 19 / 0 |
| `src/js/cadre-listes-panneaux.test.js` | 10 / 0 | 10 / 0 |
| `src/js/ecran-vocal-le-cercle-reste-visible.test.js` | 12 / 0 | **12 / 0** (inchangé) |
| `src/js/ecran-vocal-lot2.test.js` | 49 / 0 | 49 / 0 |
| `src/js/ecran-vocal-bouton-affichage.test.js` | 44 / 0 | 44 / 0 |

**Aucun test supprimé, aucun test relâché.** Seules des **valeurs attendues** ont été mises à
jour, et chacune est justifiée : 320 → 384 (largeur nominale), 214 → 277 et 195 → 132
(médaillon et liste), 266 → 329 (bloc), 231 → 277 (borne de hauteur), `blur(8px)` →
`blur(12px)`, `62%` → `55%`, `var(--surface-floating)` → `var(--text-primary)`. Là où une
ancienne assertion exprimait une **égalité** qui n'est plus la borne active (médaillon = place
en largeur à 1 440 × 900), elle est devenue une **borne explicite** *plus* la valeur attendue
— le sens du verrou (jamais plus large que le cadre) est conservé, et une assertion de plus
est ajoutée.

---

## 7. Documentation

- `spec_modes_ecran_vocal.md` § 3ter : le budget (47 caractères à 384 px), le paragraphe de
  l'élargissement, la transparence **en deux passes** (avec la cause mesurée), le tableau des
  **huit** fenêtres et le chiffre réel **277 px** ;
- `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md` : décisions 6 et 10,
  `charsPerLine` (avec le cadre retranché), et le bloc « ce qui a changé » ;
- `help/handbook.md` régénéré (`npm run build:handbook`) : « près de trois fois sa taille de
  départ dès 1 280 px de large (2,9 ×) ».
