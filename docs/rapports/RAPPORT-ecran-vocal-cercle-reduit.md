# Rapport — le cercle lumineux de l'écran Vocal, réduit

Date : 2026-11-14 · Projet : `G:\IA_PL\pilot` (Tauri + JS, tests Vitest)
Demande du propriétaire : sur l'écran **Vocal**, le cercle lumineux est **un peu trop
gros** ; le **réduire modérément** (de l'ordre de 15 à 20 %), faire **descendre l'image du
personnage** en conséquence, et **ne rien toucher d'autre** (trois modes, barre du bas,
sorties, calques non capteurs de clics, mouvement réduit, micro, conversation).

---

## 1. Ce qui a été mesuré AVANT de calculer

Le disque n'a **qu'une seule** source de taille : le jeton `--vocal-orb-size` de
`src/css/style.css` (`clamp`), lu par `vocalOrbSizePx()` (`super-agent.js`) pour le repli,
et par le budget des colonnes. Relevé du disque **réellement rendu**, hauteur par hauteur :

| Fenêtre | Disque avant | Couronne | Boîte (disque + 2 couronnes) |
|---|---|---|---|
| 720 × 520 | 151,6 px | 39,7 px | 231 px |
| 768 × 576 | 188,3 px | 49,3 px | 287 px |
| 820 × 620 | 217,2 px | 56,9 px | 331 px |
| 896 × 672 | 251,3 px | 65,8 px | 383 px |
| 1024 × 768 | 314,3 px | 82,3 px | 479 px |
| 1280 × 800 | 335,3 px | 87,8 px | 511 px |
| 1440 × 900 | 336,0 px | 88 px | 512 px |
| 1920 × 1080 | 336,0 px | 88 px | 512 px |

La couronne et l'arc ne sont **pas** des pixels : ce sont des **fractions** du disque
(`88 / 336` et `12 / 88`). Ils n'ont donc pas eu à être touchés : ils suivent.

## 2. La nouvelle formule (une seule ligne, au même endroit)

```css
/* avant */  --vocal-orb-size: clamp(120px, calc((100vh - 289px) * 21 / 32), 336px);
/* après */  --vocal-orb-size: clamp(100px, calc((100vh - 289px) * 276 / 512), 276px);
```

Trois propriétés ont été cherchées, et une seule formule les donne :

- **−17,9 % à TOUTES les hauteurs** (276 / 336 = 0,821) : la réduction ne dépend pas de la
  fenêtre ;
- **même pente relative** : `276 / 512` vaut 0,8214 fois `21 / 32`, donc le disque
  **atteint son plafond à la même hauteur de fenêtre** qu'avant (**801 px**) — seule sa
  taille change, pas le moment où il cesse de grandir ;
- **mêmes réserves** : `289 px` de place hors rangée, inchangés (`VOCAL_ORB_RESERVED_PX`),
  ce qui garde la boîte du halo dans la fenêtre.

## 3. Ancien → nouveau, mesuré

Disque rendu, et médaillon du personnage (qui se mesure sur la **hauteur** de la rangée,
§ 3ter de `spec_modes_ecran_vocal.md`) :

| Fenêtre | Disque | Médaillon | Colonnes | Rangées de tâches |
|---|---|---|---|---|
| 720 × 520 | 151,6 → **124,5** | 97 → **124** | 231 (inchangé) | 3 / 3 |
| 768 × 576 | 188,3 → **154,7** | 116 → **150** | 287 (inchangé) | 4 / 4 |
| 820 × 620 | 217,2 → **178,4** | 131 → **170** | 331 (inchangé) | 5 / 5 |
| 896 × 672 | 251,3 → **206,5** | 149 → **194** | 383 (inchangé) | 6 / 6 |
| 1024 × 768 | 314,3 → **258,2** | 182 → **238** | 479 (inchangé) | 8 / 8 |
| 1280 × 800 | 335,3 → **275,5** | 193 → **253** | 511 (inchangé) | 8 / 8 |
| 1440 × 900 | 336,0 → **276,0** | 288 → **276** | 512 (inchangé) | 8 / 8 |
| 1920 × 1080 | 336,0 → **276,0** | 288 → **276** | 512 (inchangé) | 8 / 8 |

**L'image descend et GRANDIT.** Le disque plus petit libère de la hauteur sous lui : le
médaillon, qui prend tout l'air disponible, en profite (97 → 124 px à 720 × 520). Aux deux
plus grandes fenêtres il **plafonne à 276 px** au lieu de 288 : il ne peut pas être plus
large que le cercle qu'il surmonte. La cible de trois fois le plancher (`288 px`) reste la
référence du module et redeviendrait atteignable si le disque remontait.

## 4. Le piège évité : les colonnes ne devaient pas rétrécir

Les deux colonnes prenaient leur hauteur sur **la boîte du disque** (`min(--vocal-orb-box,
100%)`). En réduisant le disque à 276 px, sa boîte tombe de 512 à **421 px**, et la liste
des tâches aurait perdu **deux rangées** à 1024 × 768 (8 → 6) — une conséquence que
personne n'avait demandée.

La hauteur des colonnes a donc été **découplée** : nouveau jeton `--vocal-side-height:
512px` (constante `VOCAL_SIDE_HEIGHT_PX = 336 + 2 × 88` dans `vocal-sides.js`). Ce chiffre
n'est pas nouveau : c'est **exactement** ce que le budget rendait avant à toutes les
fenêtres (`21/32 × 512/336 = 1`, donc `min(boîte, place)` valait `min(512, place)`). La
colonne des tâches garde donc **le même nombre de rangées** qu'avant, à toutes les tailles.

## 5. Vérification dans un vrai navigateur (avec et sans image)

Pas seulement sur le papier : l'arbre **réel** de `buildVocalOverlay()` et la **vraie**
feuille de style ont été chargés dans Chrome, avec les valeurs que `vocalSyncSides()` pose
(largeurs et médaillon calculés par le module `vocal-sides.js`), une boîte par fenêtre, avec
et sans personnage.

| Vérification | Résultat |
|---|---|
| Disque rendu = formule | **oui** sur les huit fenêtres (124,5 · 154,7 · 178,4 · 206,5 · 258,2 · 275,5 · 276 · 276) |
| Disque **exactement centré** en largeur, avec **et** sans image | **oui** : `cx(disque) = cx(photo) = cx(stage) =` milieu de la fenêtre, dans les seize cas |
| Personnage **sous** le cercle, sur le même axe | **oui** : 12 px d'écart, nom dessous |
| La composition **ne déborde jamais** de la rangée | **oui** : elle s'arrête 137 px au-dessus du bas |
| La liste des tâches **ne paie rien** pour le personnage | **oui** : hauteur de colonne identique avec et sans image |
| Sans image, mise en page stable | **oui** : la composition se réduit au disque, qui est au milieu (relevé : 217,5 → 424 dans une rangée de 640 px à 896 × 672) |

## 6. Ce qui n'a PAS changé

Les trois modes d'écran et leur bouton-logo, la barre du bas qui s'efface au repos, les
trois sorties du mode, les six hôtes qui captent le clic (le calque reste traversant), le
mouvement réduit, la mesure du micro et toute la logique de conversation : **aucune ligne
touchée**. Aucun nouveau réglage, aucune nouvelle clé de configuration.

La **couronne** garde son aspect : elle vaut toujours `88/336` du disque, donc **72,3 px**
au disque de 276 px (88 px à 336). Dans les commentaires de la feuille de style, les
nombres du disque de la conception (166 px de rayon, 88 px de couronne, boîte de 512 px)
restent cités comme **référence** : les règles, elles, n'écrivent aucun de ces nombres
(`inset: 0` + `closest-side` pour le halo, `calc()` de la couronne pour l'enveloppe) et
suivent donc le disque sans rien changer.

## 7. Tests

Aucun test n'a été assoupli, désactivé ni supprimé. Les valeurs **figées** qui changeaient
réellement ont été réalignées, et **renforcées** là où c'était utile :

| Fichier | Ce qui a changé |
|---|---|
| `src/js/ecran-vocal-cadres-et-cercle.test.js` | formule du disque (× 2 occurrences), attente du jeton `clamp(100px, …, 276px)`, ajout du **repli JS** et de la **mesure de la réduction** : `(336 − 276) / 336 = 0,1786` |
| `src/js/ecran-vocal-lot2.test.js` · `ecran-vocal-nu.test.js` | le libellé « le disque fait de 100 à 276 px » et la regex du `clamp` |
| `src/js/vocal-sides.test.js` | les onze lignes du tableau § 3.2 avec les disques réels, la hauteur des colonnes en `min(512, place)`, les cas de seuil |
| `src/js/vocal-colonnes-degagees.test.js` | la place gagnée ne vient **pas** des colonnes (formule unique + `VOCAL_SIDE_HEIGHT_PX === 512`) |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` | deux constantes distinctes : le **disque d'aujourd'hui** (276) et le **disque de la conception** (336, référence des constantes du module d'enveloppe) ; la pente, le plancher et le plafond rejoués |
| `src/js/ecran-vocal-point7-photo-sous-le-cercle.test.js` | **aucun** changement de valeur : il passe `orbSize` en paramètre et `336` y est le disque de la conception. Une note datée le dit |

```
npx vitest run
PASS (4958) FAIL (0)
```

## 8. Documentation

- `spec_modes_ecran_vocal.md` : § 3 (le disque et son tableau de jetons, avec
  `--vocal-side-height`), § 3bis (rayon utile 136 px, boîte de l'enveloppe),
  § colonnes (leur hauteur ne suit plus le disque), § 3ter (tableau des **huit** fenêtres,
  ancien → nouveau), § 7.3 et tableau des deux voix (les rayons exprimés pour le disque
  d'aujourd'hui, avec les valeurs de la conception entre parenthèses).
- `src/css/style.css` : commentaire « RECTIFICATION DU 2026-11-14 » sur le jeton du disque,
  sur le jeton des colonnes, sur le halo et son plancher, sur le rayon utile du bouton, sur
  le mouvement réduit, et sur la mesure du médaillon.
- `AGENTS.md` : la ligne de navigation de l'écran Vocal (96 → 276 px, ≈ 2,9×).
