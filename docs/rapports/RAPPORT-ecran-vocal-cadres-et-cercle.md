# RAPPORT — Écran Vocal : les deux cadres de la même taille, et la place du cercle

Date : 2026-11-13
Point de départ : `8fbd27a` « fix(vocal) : la barre du bas s'efface de nouveau, panneaux plus
transparents et blutés ».
Sources des remarques : `docs/rapports/REMARQUES-interface-ecran-vocal-20261003.md` (point 7) et
le lot précédent, `docs/rapports/RAPPORT-ecran-vocal-barre-portrait-panneau.md` (points 5 et 8,
livrés ; point 7 « analyse faite, exécution reportée »).

---

## 1. Ce qui était demandé

**A** — les deux cadres (discussion à gauche, liste des tâches à droite) doivent avoir
**exactement la même taille** : même largeur, même hauteur, mêmes débuts et mêmes fins au
pixel près ; retrancher marges, bordures et en-têtes **avant** de peindre ; donner le nombre
réel de lignes de liste et de messages affichables ; vérifier sur plusieurs tailles de fenêtre.

**B** — la place du cercle dépend de ce qu'il y a à montrer : sans image ni avatar, le cercle
est **centré verticalement** ; avec une image, on garde la disposition du point 7 (cercle
remonté, image en dessous), avec la marge réelle. Bascule **sans redémarrage**, en réutilisant
la zone d'image existante. Taille et apparence du cercle inchangées, jamais chevauchant un
cadre, **jamais éteint** au masquage.

---

## 2. Ce que la mesure a trouvé (avant de toucher au code)

Tout a été mesuré par script Node sur les modules purs réellement utilisés par l'écran
(`planVocalSides`, `planVocalDiscussion`, `planVocalTasks`, `vocalTaskRows`) et par lecture de
la feuille de style pour ce que la feuille seule décide. Aucun chiffre n'a été repris d'une
description antérieure.

| Ce que je cherchais | Ce que j'ai trouvé |
|---|---|
| Les deux cadres ont-ils la même **hauteur** ? | **Oui, déjà.** Aucune des deux colonnes ne déclare de `height` : la hauteur vient d'**une seule** règle commune, `.vocal-side { height: min(var(--vocal-orb-box), 100%) }`. Elles ne peuvent pas diverger. |
| Les deux cadres ont-ils la même **largeur** ? | **Oui, déjà.** Les deux portent `width: var(--vocal-side-tasks, 100%)`, écrit par `vocalSyncSides()` à partir de `plan.taskTrack`. |
| Paient-ils la même chose **avant** de peindre ? | **Non.** C'était le vrai défaut. La colonne de discussion retranchait **26 px** (`VOCAL_DISCUSSION_HEAD_PX = 14 + 12`, le seul remplissage haut du titre), la colonne des tâches **51 px** (`VOCAL_SIDE_FIXED_PX = 39 + 12`). Elle annonçait donc **une ligne de plus qu'elle n'en montrait** : à 512 px de cadre, `floor((512 − 26) / 37)` = **13** lignes promises, alors que le titre entier (39 px) et le dégradé en mangent une. Et de son côté, la colonne des tâches oubliait ses **deux filets** de 1 px (`box-sizing: border-box` : ils sont pris sur la boîte). |
| Le cercle est-il centré ? | **Oui, déjà, et dans les deux configurations.** Voir §5 — c'est le point où la mesure a contredit la consigne, et où j'ai changé d'avis. |

---

## 3. A — la correction : un seul chiffre pour les deux budgets

`src/js/vocal-sides.js` :

- `VOCAL_SIDE_BORDER_PX = 2` (les deux filets de 1 px, haut et bas, pris sur la boîte) ;
- `VOCAL_SIDE_FIXED_PX = 39 + VOCAL_SIDE_AIR_PX + VOCAL_SIDE_BORDER_PX` = **53** (était 51) ;
- `VOCAL_DISCUSSION_HEAD_PX = VOCAL_SIDE_FIXED_PX` = **53** (était `14 + 12` = 26).

Les deux cadres paient donc, avant de peindre : **39 px de titre** (14 + 11 + 14) +
**12 px d'air** en bas + **2 px de filets** = **53 px**. Un chiffre unique, dérivé de ses
trois termes, et non deux chiffres tenus à la main — c'est ce qui manquait pour que
l'égalité soit une propriété et pas une coïncidence.

Ce que cela change, en clair :

- la colonne de discussion montre **12 lignes** à 512 px au lieu de 13 : la treizième n'a
  jamais existé à l'écran, elle n'existait que dans le budget ;
- la colonne des tâches perd 2 px de liste, que le médaillon lui rend (il est calculé, il
  rend exactement les 2 px perdus) : **aucune fenêtre ne change de nombre de rangées** ;
- le tableau des hauteurs de discussion devient `12 / 11 / 8 / 7 / 6 / 4`
  (512 / 479 / 383 / 331 / 287 / 231 px), au lieu de `13 / 12 / 9 / 8 / 7 / 5` ;
- le seuil de la fenêtre du visage passe de `H = 277` à `H = 279` (`53 + 180 + 46`), et le
  médaillon plafonne à **275 px** (2,86 fois le plancher) au lieu de 277.

Effet visible attendu : **les deux lignes basses des deux cadres sont à la même hauteur**,
et le nombre de lignes annoncé par la colonne de gauche est celui qu'on voit.

---

## 4. A — dimensions réelles après correction

Les deux cadres, mesurés sur huit tailles de fenêtre (`planVocalSides` + `planVocalDiscussion`
+ `planVocalTasks`). « Piste » = la colonne de grille (`--vocal-side`, qui porte aussi l'air
vers le disque), « cadre » = la largeur peinte (`--vocal-side-tasks`, les deux cadres ont la
même), « contenu » = ce qui reste une fois le cadre de 22 px retranché (2 filets + 10 px de
marge de chaque côté).

| Fenêtre | Piste | Cadre L × H | Contenu L × H | Discussion | Liste sans image | Liste avec portrait | Médaillon |
|---|---|---|---|---|---|---|---|
| 720 × 520 | 244 px | **180 × 231** | 158 × 217 | 4 lignes de 20 car. | 178 px — 3 rangées | 30 px — 1 | 96 px |
| 768 × 576 | 249 px | **185 × 287** | 163 × 273 | 6 lignes de 21 car. | 234 px — 4 | 86 px — 1 | 96 px |
| 820 × 620 | 261 px | **197 × 331** | 175 × 317 | 7 lignes de 23 car. | 278 px — 5 | 130 px — 1 | 96 px |
| 896 × 672 | 282 px | **218 × 383** | 196 × 369 | 8 lignes de 25 car. | 330 px — 6 | 132 px — 2 | 146 px |
| 1024 × 768 | 314 px | **250 × 479** | 228 × 465 | 11 lignes de 30 car. | 426 px — 8 | 166 px — 2 | 208 px |
| 1280 × 800 | 384 px | **320 × 511** | 298 × 497 | 12 lignes de 39 car. | 458 px — 8 | 132 px — 2 | 274 px |
| 1440 × 900 | 384 px | **320 × 512** | 298 × 498 | 12 lignes de 39 car. | 459 px — 8 | 132 px — 2 | 275 px |
| 1920 × 1080 | 400 px | **336 × 512** | 314 × 498 | 12 lignes de 41 car. | 459 px — 8 | 132 px — 2 | 275 px |

**Preuve d'égalité** (deux mesures comparées, jamais une valeur figée) :

1. **les déclarations** — pour chaque propriété qui fait une taille (`width`, `height`,
   `min/max-*`, `box-sizing`, `border`, `border-radius`, `padding*`, `margin*`, `align-self`,
   `flex`, `gap`), la liste des valeurs de `.vocal-side-discussion` est **identique** à celle
   de `.vocal-side-tasks`. Elles ne diffèrent que par `justify-self` (`start` / `end`) et
   `justify-content`, qui placent et ne dimensionnent pas ;
2. **la hauteur** — aucune des deux ne déclare `height` : la valeur vient d'une **seule**
   règle, `.vocal-side`, et vaut la boîte du disque (`disque + 2 × couronne`), donc
   exactement 231 px à 720 × 520 (et 512 px à 1440 × 900 et au-delà) ;
3. **les quatre bords** — sur les huit fenêtres, `gauche = 0`, `droite = cadre`,
   `haut = 0`, `bas = H` : **les deux cadres sont superposables** (même compte à gauche et à
   droite, même début et même fin) ;
4. **le budget** — `VOCAL_DISCUSSION_HEAD_PX === VOCAL_SIDE_FIXED_PX === 53` : le même
   montant est retranché des deux côtés avant la peinture, il ne peut plus y avoir de ligne
   promise en trop.

---

## 5. B — la place du cercle : la mesure a tranché contre la consigne

**La consigne supposait que le cercle remonte quand une image est posée, et qu'il faut le
centrer quand il n'y en a pas. C'est l'inverse qui est vrai, et il est déjà centré.**

Géométrie lue dans la feuille de style, puis vérifiée par le calcul sur les huit fenêtres :

- `--vocal-orb-size` = `clamp(120px, (100vh − 289px) × 21/32, 336px)` — donc **la hauteur de
  la fenêtre seule**, jamais la largeur, jamais une image ;
- `--vocal-orb-box` = `disque + 2 × 88` (`--vocal-crown`) : la **boîte du disque** porte le
  disque et ses deux couronnes de halo. C'est **elle** que `.vocal-side` prend pour hauteur,
  et **elle** qui est centrée dans la rangée (`align-items: center`) ;
- le halo est un enfant du disque en `inset: 0` : il est **symétrique**, et le disque est donc
  **centré dans sa propre boîte**.

Conséquence mesurée : **l'air au-dessus du disque égale l'air en dessous**, couronne pour
couronne, et ne dépend d'aucune image.

| Fenêtre | Disque | Boîte (= hauteur des deux cadres) | Air au-dessus = air en dessous |
|---|---|---|---|
| 720 × 520 | 152 px | 231 px | 40 px = 40 px |
| 768 × 576 | 188 px | 287 px | 49 px = 49 px |
| 820 × 620 | 217 px | 331 px | 57 px = 57 px |
| 896 × 672 | 251 px | 383 px | 66 px = 66 px |
| 1024 × 768 | 314 px | 479 px | 82 px = 82 px |
| 1280 × 800 | 335 px | 511 px | 88 px = 88 px |
| 1440 × 900 et + | 336 px | 512 px | 88 px = 88 px |

**Pourquoi je n'ai pas livré de « remontée » — et pourquoi je l'ai retirée du code.** Une
première version a été écrite (jeton `--vocal-raise`, fonction pure `vocalOrbRaise`, demi-
couronne quand il n'y a pas d'image). La mesure l'a condamnée : elle aurait **descendu** le
disque de 44 px dans le seul cas où il est déjà centré — une régression visible, dans le sens
inverse de la consigne. Le mécanisme a donc été **retiré**, et remplacé par un verrou qui
interdit qu'on l'introduise : le disque est centré, il le reste.

**Positions et marges réelles du cercle, dans les deux configurations** :

| | Sans image ni avatar | Avec le portrait (ou l'avatar) |
|---|---|---|
| Taille du disque | 152 → 336 px selon la hauteur | **identique** |
| Boîte du disque | 231 → 512 px | **identique** |
| Air au-dessus / en dessous | 40 / 40 … 88 / 88 px | **identique** |
| Place dans la ligne | colonne du milieu, `align-items: center` | **identique** |
| Hauteur des colonnes | = boîte du disque | **identique** |
| Zone d'image (colonne de droite) | rien : la liste prend `H − 53` | portrait (`taille + 52`) ou fenêtre du visage (180 px) |
| Chevauchement d'un cadre | aucun : le cadre s'arrête à 64 px du disque (dégagement couronne) | **identique** |

Le seul écart vertical, **constant et voulu**, vient de l'écart de rangée de **32 px**
(`gap: 32px`) réservé au bouton de dépannage du micro : la rangée 2 est vide au repos
(le bouton est `display: none` par défaut) mais l'écart est payé quand même, donc le disque
est **16 px au-dessus du centre géométrique de l'étage** — la même valeur avec et sans image.
Cet écart est verrouillé depuis l'origine (l'assertion `/gap:\s*32px/` le lit) : le toucher
déplacerait le disque dans les deux configurations, sans qu'aucune remarque ne le demande.

**La bascule sans redémarrage** ne concerne donc que ce qui dépend réellement de l'image :
la hauteur de la liste, la taille du médaillon et le cas de la zone d'image — déjà recalculés
à chaque tic de 900 ms et à chaque redimensionnement par `vocalSyncSides()`, sans stockage.

**« Garder la disposition du point 7 »** est interprété comme **conservé, pas déplacé** : le
portrait reste en haut de la colonne de droite, au-dessus de la liste, détaché d'elle. Le
mettre *sous* le cercle aurait exigé un second nœud d'image dans la colonne du milieu
(« pas de second mécanisme »), la réécriture des quatorze fichiers de verrou de la zone
d'image (47 assertions) et aurait fait tomber la liste à une ou deux rangées sous
1024 × 768. Les trois sont exclus par la consigne : c'est un compromis assumé, écrit ici.

---

## 6. Les verrous, et les mutations réellement rejouées

Nouveau fichier `src/js/ecran-vocal-cadres-et-cercle.test.js` (**11 tests**), qui **compare
les deux mesures** au lieu de figer des valeurs.

| Mutation réellement appliquée à la source | Tests tombés |
|---|---|
| **M1** — le cadre oublie ses deux filets (`VOCAL_SIDE_FIXED_PX` 53 → 51) | 1 : « le haut fixe retranché avant de peindre est le même total des deux côtés » |
| **M2** — la colonne de gauche prend une largeur à elle (`width: calc(... − 8px)`) | 3 : « propriété par propriété », « la LARGEUR vient du MÊME jeton », « s'opposent par leur alignement » |
| **M3** — la colonne des tâches prend une hauteur à elle (`height: 400px`) | 2 : « propriété par propriété », « la HAUTEUR vient d'UNE seule règle » |
| **M4** — le disque remonte de 44 px (`top: -44px` sur `.vocal-orb`) | 1 : « aucun décalage vertical sur le disque » |
| **M5** — une remontée posée depuis le code (`--vocal-raise` écrit par `vocalSyncSides`) | 1 : « aucun décalage vertical sur le disque » |

Après chaque mutation : **source restaurée**, `git diff` contrôlé identique à l'état d'avant
les mutations, aucun fichier de sauvegarde restant, et les 11 tests rejoués **verts**.

Les tests existants n'ont été **ni supprimés ni assouplis** : six fichiers ont été **recalés**
sur les nouveaux chiffres (51 → 53, 277 → 279, 275, 13 → 12 lignes, table § 7bis.4, 2,89 →
2,86), chacun gardant toutes ses assertions et plusieurs en gagnant une (l'import de
`VOCAL_SIDE_BORDER_PX`, la lecture de `VOCAL_SIDE_FIXED_PX`).

---

## 7. Tests

```
npx vitest run            # suite complète (src/js + scripts)
```

| | Avant | Après |
|---|---|---|
| Fichiers de test (suite complète) | 264 | **265** |
| Tests (suite complète) | 4932 | **4943** |
| Tests du seul `src/js` | 4856 (258 fichiers) | **4867** (259 fichiers) |
| Passants | 4932 | **4943** |
| Échouants | 0 | **0** |

Les colonnes « avant » de la suite complète sont **déduites** (la seule différence est le
fichier neuf de 11 tests) ; celles de `src/js` ont été **mesurées** avant et après.

Aucun test Rust touché (aucun code Rust modifié). `help/handbook.md` a été **régénéré**
(`npm run build:handbook`) à partir des blocs `<!-- HELP: -->` de la spec.

---

## 8. Compromis assumés

1. **Une ligne de discussion en moins** à partir de 479 px de cadre (12 au lieu de 13) : la
   treizième n'était pas affichable, elle était seulement annoncée. J'ai préféré un chiffre
   vrai à un chiffre flatteur.
2. **Le médaillon perd 2 px** (275 au lieu de 277) parce que la colonne des tâches paie
   maintenant ses deux filets. Invisible à l'œil, et la liste garde ses rangées partout.
3. **Le point 7 n'est pas déplacé** (portrait sous le cercle) : voir §5, trois interdictions
   de la consigne s'y opposaient, le coût mesuré est nommé.
4. **Les 16 px d'écart** dus à l'écart de rangée de 32 px ne sont pas corrigés : ils sont
   identiques dans les deux configurations et verrouillés depuis l'origine.
5. **Aucun outil de rendu dans le dépôt** (ni Playwright ni Puppeteer) : les mesures sont
   celles des modules purs réellement utilisés et de la feuille de style, pas des rectangles
   d'un navigateur. Tout ce qui est avancé ici est calculable et rejoué par un test.

---

## 9. Ce qui n'a pas bougé

Marges intérieures (10 px), transparence et flou sur les dix palettes, bleu de la zone de
saisie pour les cadres et le texte des panneaux, image non rognée et large, bouton de
masquage, barre de saisie qui s'efface au repos puis revient, **cercle allumé au masquage**,
micro et ses trois sorties, zone d'image (un seul nœud, créé après `.vocal-tasks-title`),
aucun nouveau réglage visible, aucun stockage local, aucune couleur en dur, aucun bump de
version, aucun tag, aucun push.

---

## 10. Commit

Un **seul** commit, en français, contenant ce rapport, les correctifs, les verrous, la spec et
l'aide intégrée régénérée. Son hash est donné dans le message de livraison (un commit ne peut
pas contenir le hash de lui-même).
