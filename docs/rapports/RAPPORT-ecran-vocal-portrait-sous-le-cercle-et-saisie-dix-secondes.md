# Écran Vocal — le portrait entièrement sous le cercle, et la saisie qui s'efface après 10 secondes

Date : 2026-11-14. Mission unique, deux points, un seul commit. Rien n'a été publié,
aucune version bumpée, aucun tag posé.

---

## 1. Ce qui était demandé

> « 1. Le portrait du personnage chevauche le cercle : le descendre pour qu'il soit
> entièrement SOUS le cercle, avec un espace net visible.
> 2. La zone de saisie doit disparaître après 10 secondes sans souris (aujourd'hui
> 2 500 ms). »

Contraintes tenues : mesure réelle avant de choisir un chiffre, mécanisme existant
conservé (le portrait reste mesuré sur la **hauteur** de sa rangée), quatre règles
d'interdiction de masquage intactes, décision de masquage toujours **pure**, aucun
nouveau réglage utilisateur, sujet `PILOT_ASSISTANT_SCHEDULE` non touché.

---

## 2. Point 1 — le portrait chevauchait la lueur du cercle

### 2.1 Mesure AVANT (aucune valeur choisie)

Banc `--headless=new` sur l'arbre réel de `buildVocalOverlay` et la feuille de style du
projet, viewport **1424 × 905** (fenêtre 1440 × 1000), disque réel **276 px**, écart
`margin-block-start: 12px` :

| Grandeur mesurée | Valeur |
|---|---|
| Disque (`getBoundingClientRect`) | `146 → 422` |
| Médaillon | `434 → 710` |
| Écart bord à bord | **12 px** |
| Couronne de la lueur (`.vocal-orb::before`, `--vocal-crown`) | **72,29 px** (88/336 × 276) |
| Bas de la lueur, état **repos** | `451,58` |
| **Recouvrement de la lueur sur le portrait, repos** | **+17,58 px** |
| Bas de la lueur, état **pleine voix** (halo ×1) | `494,29` |
| **Recouvrement, pleine voix** | **+60,29 px** |

Le diagnostic est donc arithmétique, pas esthétique : le portrait démarrait **12 px**
sous le cercle, alors que la lueur du cercle en descend **72,29 px**. Le portrait entrait
dans la lueur de 17,58 px au repos et de 60,29 px quand Pilot parle. Le `12px` était un
chiffre de mise en page, jamais confronté à la couronne.

### 2.2 La décision : l'écart vaut la couronne de la lueur, et il est calculé

- Un **seul** rapport `88 / 336` existe dans le projet, et il a désormais **deux
  lecteurs** : `VOCAL_PORTRAIT_CROWN_RATIO` (budget, `src/js/vocal-sides.js`) et le jeton
  `--vocal-crown` (feuille de style). « Il ne peut pas y avoir deux couronnes. »
- `vocalPortraitAirTopPx(disque, rangee) = max(12, min(ceil(disque × 88/336),
  rangee − disque − cadre))` : arrondi **vers le haut** (jamais un dixième de pixel sous
  la lueur), `surplus` en `Math.floor` (jamais un débordement de rangée).
- **Le personnage ne rapetisse jamais pour une lueur** : si la couronne entière ferait
  tomber le médaillon sous son plancher confortable (96 px), c'est l'**écart** qui cède,
  jamais sous 12 px. « Une lueur dégagée ne vaut pas un portrait écrasé. »
- L'écart **peint** est publié par le plan (`portraitAir`) et écrit par `vocalSyncSides`
  dans un jeton dédié `--vocal-portrait-gap`, lu par le CSS **en priorité** :
  `margin-block-start: var(--vocal-portrait-gap, var(--vocal-crown))`. Le repli vaut la
  couronne entière : sans JavaScript, le portrait ne chevauche pas non plus.
- Le cadre du médaillon n'est plus la constante 64 : `vocalPortraitFramePx(disque, rangee)`
  = écart + 8 (image/nom) + 20 (nom) + 12 (air) + 12 (air interne). `VOCAL_PORTRAIT_FRAME_PX`
  = 64 reste le repli.

### 2.3 Mesure APRÈS (même banc, même viewport, disque 276)

| Grandeur mesurée | AVANT (12 px) | APRÈS (73 px) |
|---|---|---|
| Disque | `146 → 422` | `115 → 391,5` |
| Médaillon | `434 → 710` | `464,5 → 740,5` |
| Écart bord à bord | 12 px | **73 px** |
| Bas de la lueur (repos) | 451,58 | 421,08 |
| **Dégagement du portrait (repos)** | **−17,58 px** (recouvrement) | **+43,42 px** |
| Bas de la lueur (pleine voix) | 494,29 | 463,79 |
| **Dégagement (pleine voix)** | **−60,29 px** | **+0,71 px** |
| `portraitChevaucheCercle` (banc, 3 états) | `false` (au sens boîte/boîte) | `false` |

Le portrait ne touche plus la lueur **dans aucun des trois états**, y compris à
l'amplitude maximale de la voix : il reste 0,71 px d'air au pire instant — la lueur
effleure, elle ne recouvre plus.

Le disque est remonté de 31 px (`146 → 115`) : c'est le recentrage **de la composition
entière**, qui a grandi de 61 px d'écart. Aucun décalage n'a été écrit sur le disque
(ni `top`, ni `transform`, ni marge) : il monte parce que la composition est plus haute,
exactement comme le prévoit le point 7.

Captures du banc : `final-gap12.png` (avant, la lueur mord le haut du personnage) et
`final-gap73.png` (après, jour franc entre la lueur et le personnage).

### 2.4 Les huit fenêtres du document (valeurs calculées par le module, disque réel)

| Fenêtre | Rangée | Disque | Écart | Médaillon | Bloc | Composition | Liste | Rangées |
|---|---|---|---|---|---|---|---|---|
| 720 × 520 | 313 px | 124,5 | 28 | 108 | 176 | 312,5 | 178 | 3 / 3 |
| 768 × 576 | 369 px | 154,7 | 41 | 121 | 202 | 368,7 | 234 | 4 / 4 |
| 820 × 620 | 413 px | 178,4 | 47 | 135 | 222 | 412,4 | 278 | 5 / 5 |
| 896 × 672 | 465 px | 206,5 | 55 | 151 | 246 | 464,5 | 330 | 6 / 6 |
| 1024 × 768 | 561 px | 258,2 | 68 | 182 | 290 | 560,2 | 426 | 8 / 8 |
| 1280 × 800 | 593 px | 275,5 | 73 | 192 | 305 | 592,5 | 458 | 8 / 8 |
| 1440 × 900 | 693 px | 276 | 73 | **276** | 389 | 677 | 459 | 8 / 8 |
| 1920 × 1080 | 873 px | 276 | 73 | **276** | 389 | 677 | 459 | 8 / 8 |

Deux lectures :

- **la composition tient toujours dans sa rangée** (312,5 ≤ 313 ; 677 ≤ 693) : l'écart
  payé sous le cercle ne fait jamais sortir le bloc ;
- **la liste des tâches ne perd aucune rangée** : `listHeight` est identique avec et sans
  personnage (178 = 178, 459 = 459…), puisque le portrait ne prend rien dans la colonne.
  Le prix du dégagement se paie uniquement sur la **taille** du médaillon aux fenêtres
  courtes (108 px à 720 × 520 au lieu de 124), jamais sur les rangées.

### 2.5 Le cas SANS image

`planVocalSides` rend `portraitSize = portraitBlock = portraitAir = 0` : la composition se
réduit au disque, `justify-content: center` le pose au centre de sa rangée, et le jeton
`--vocal-portrait-gap` vaut `0px` (aucune marge payée). Aucune règle de placement n'a été
modifiée par cette mission : le disque ne porte toujours **aucun** `top`, `margin-top` ni
`transform`.

**Constat annexe, mesuré et NON corrigé ici (hors périmètre)** : la rangée de la
composition est la **première** piste (`1fr`) d'une grille `grid-template-rows: 1fr auto`
dont la **deuxième** piste (`auto`) est réservée au bouton de dépannage du micro, avec un
`row-gap: 32px`. Même quand ce bouton est masqué, l'écart de rangée reste compté : la
composition est donc centrée **dans sa piste**, soit 16 px au-dessus du centre exact de la
scène. C'est **antérieur à cette mission** et **voulu** : ces 32 px évitent que le disque
saute quand le bouton apparaît. Symétrie parfaite à l'intérieur de la piste, aucun
changement apporté ici.

---

## 3. Point 2 — la zone de saisie s'efface après 10 secondes, plus après 2,5

Une seule ligne de code porte la décision : `VOCAL_CHROME_IDLE_MS = 10000` dans
`src/js/vocal-chrome.js` (était `2500`). Le module reste **pur** : aucun DOM, aucune
minuterie, aucun jeton CSS, aucune variante — ce n'est **pas** un réglage utilisateur. Le
minuteur reste **unique** (`vocalChromeTimer`, `super-agent.js`) et lit cette constante.

Ce qui ne bouge pas d'une ligne :

1. **le masquage est permis au repos** — y compris avec la dictée **armée mais encore
   silencieuse**, qui est le cas normal de cet écran ;
2. **quatre situations l'interdisent, dans cet ordre** : micro fermé, champ de saisie
   contenant du texte, pointeur en geste sur la zone du bas, question de l'assistant en
   attente ;
3. **un mouvement ou une frappe** ramènent le bas et remettent le délai à zéro ; sous
   4 px de tremblement, rien ne se réveille ; `Échap` sort du mode, il ne réveille pas ;
4. **décision en dernière ligne** de `applyVocalState`, **une seule** écriture de classe,
   écouteurs posés à l'entrée et **retirés** à la sortie.

`help/overview.md` dit maintenant, en clair, que la zone de saisie s'efface au repos après
dix secondes, qu'elle revient au moindre geste, et qu'elle ne s'efface jamais quand on y a
écrit ; `help/handbook.md` a été régénéré (`npm run build:handbook`).

---

## 4. Tests

### 4.1 Créés

| Fichier | Ce qu'il empêche |
|---|---|
| `src/js/ecran-vocal-portrait-ne-chevauche-plus-le-cercle.test.js` (8) | verrou **géométrique** : `haut(médaillon) ≥ bas(disque) + couronne`, sur neuf disques réels (336 → 100 px) ; l'écart n'est plus la constante 12 ; l'écart cède plutôt que d'écraser (plancher 12, médaillon ≥ 96) ; le plan publie `portraitAir` et le CSS le lit ; le cercle sans image ne paie rien |
| `src/js/ecran-vocal-saisie-disparait-apres-dix-secondes.test.js` (12) | délai **exactement 10 000 ms** (et pas 2 500) ; constante non réglable, module pur ; minuteur unique lisant la constante ; repos masque y compris dictée armée silencieuse ; mouvement/frappe remettent le décompte à zéro ; **les quatre règles d'interdiction, une par une** ; `Échap` excepté |

Chaque test porte en commentaire la règle qu'il protège (délai, géométrie, règle 1 à 4).

### 4.2 Mis à jour (chiffres remesurés, intentions inchangées)

`vocal-portrait-detache.test.js` (MESURES refaites sur le disque réel ; la cible de 3 ×
n'est plus atteignable, le cercle borne avant elle), `ecran-vocal-marges-transparence-portrait.test.js`,
`ecran-vocal-point7-photo-sous-le-cercle.test.js`, `vocal-taches-en-haut-portrait-en-bas.test.js`,
`ecran-vocal-zone-image.test.js`, `vocal-sides.test.js` (nouvelle clé `portraitAir`),
`vocal-barre-s-efface-au-repos.test.js`, `vocal-chrome-masque.test.js`,
`vocal-barre-effacee-pendant-la-parole.test.js`, `vocal-saisie-declenchement.test.js`.
Aucun test n'a été désactivé ni assoupli : les assertions remplacées portaient un chiffre
devenu faux, et plusieurs ont été **resserrées** (délai exact, `not.toBe(2500)`, géométrie
au lieu d'une classe CSS).

### 4.3 Suite complète

`npx vitest run` → **PASS (5017), FAIL (0)**. Aucun test Rust touché, `cargo test` non
concerné par ce lot.

---

## 5. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `src/js/vocal-sides.js` | `VOCAL_PORTRAIT_CROWN_RATIO`, `vocalPortraitAirTopPx`, `vocalPortraitFramePx`, `portraitAir` dans le plan |
| `src/js/vocal-chrome.js` | `VOCAL_CHROME_IDLE_MS` : 2 500 → 10 000 ms, une seule constante |
| `src/js/super-agent.js` | écriture de `--vocal-portrait-gap`, commentaires (10 000 ms) |
| `src/css/style.css` | `margin-block-start: var(--vocal-portrait-gap, var(--vocal-crown))`, mesures commentées |
| `spec_modes_ecran_vocal.md` | § 3ter (écart à la lueur, tableau des huit fenêtres refait) et § 4bis (10 000 ms) |
| `help/overview.md` + `help/handbook.md` | la saisie qui s'efface au repos, dite à l'utilisateur (handbook régénéré) |
| 10 fichiers de tests + 2 nouveaux | voir § 4 |

Rien d'autre n'a été touché : ni le disque, ni les colonnes, ni le micro, ni la sentinelle
`PILOT_ASSISTANT_SCHEDULE`, ni les rapports antérieurs (qui décrivent la géométrie de
leur date).
