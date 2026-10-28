# RAPPORT — halo de la parole : rendre visible la lueur de l'etat « Pilot parle »

Date : 2026-10-28 (session de correction). Projet : `G:\IA_PL\pilot`.
Base : 4 004 tests verts, dernier commit `1ea1944`.
Defaut traite : `docs/rapports/RAPPORT-diagnostic-defauts-visuels-vocal.md` §2, defaut 1.

---

## 1. Etat AVANT (mesure du diagnostic, reprise telle quelle)

`.vocal-orb::before` = enveloppe de parole, boite de 200 x 200 px (`inset: -18px`,
rayon 100 px) autour d'un disque dont l'exterieur est a **84 px** de rayon.

```css
background: radial-gradient(
  closest-side,
  color-mix(in srgb, var(--vocal-state, var(--vocal-rest)) 22%, transparent) 0%,
  transparent 100%
);
opacity: 0;            /* 1 en .vocal-state-speaking */
```

- la lumiere est **maximale au centre (r = 0)** — donc **cachee sous le disque
  opaque** ;
- la seule couronne visible (r = 84 → 100 px) ne recoit que
  `22 % x (1 - 84/100)` = **3,52 %** d'alpha brut, et l'animation
  `vocal-speak-glow` (opacite 0,45 → 0,85) abaisse ce chiffre a **2,99 %** ;
- contraste mesure : **1,044:1** (sombre) et **1,041:1** (clair) contre le fond —
  sous le seuil de perception d'un aplat voisin (~1,05:1) ;
- **en mouvement reduit**, la regle `.pilot-vocal.vocal-reduced .vocal-orb::before
  { opacity: 0 }` **eteignait** l'enveloppe : plus aucun signe de la parole.

## 2. Etat APRES (ce qui est ecrit dans `src/css/style.css`)

### 2.1 Degrade inverse — pic au bord de la boite

```css
background: radial-gradient(
  closest-side,
  color-mix(in srgb, var(--vocal-state, var(--vocal-rest)) 0%, transparent) 0%,
  color-mix(in srgb, var(--vocal-state, var(--vocal-rest)) 0%, transparent) 72%,
  color-mix(in srgb, var(--vocal-state, var(--vocal-rest)) 8%, transparent) 84%,
  color-mix(in srgb, var(--vocal-state, var(--vocal-rest)) 20%, transparent) 92%,
  color-mix(in srgb, var(--vocal-state, var(--vocal-rest)) 34%, transparent) 100%
);
```

| Arret du degrade | Rayon | Alpha de la teinte |
|---|---|---|
| **0 %** | 0 px (centre, cache) | **0 %** |
| 72 % | 72 px (sous le disque) | 0 % |
| 84 % | 84 px (**bord du disque**) | **8 %** |
| 92 % | 92 px | **20 %** |
| **100 %** | 100 px (**bord de la boite**) | **34 %** |

- **pic au bord** : le **dernier arret (100 %) est le plus opaque (34 %)**, le
  centre est **transparent** — la lumiere sort du disque au lieu d'y rester
  cachee ;
- la teinte est `var(--vocal-state, var(--vocal-rest))`, qui vaut **exactement
  `--vocal-speak`** en `vocal-state-speaking` (regle existante
  `.pilot-vocal.vocal-state-speaking { --vocal-state: var(--vocal-speak) }`) :
  c'est bien la teinte de la parole, et le test existant « aucune couleur en dur
  dans les etats : uniquement --vocal-state » reste vert (aucun jeton nouveau) ;
- `border-radius: 50%` du pseudo-element decoupe la boite a 100 px : rien ne
  depasse, aucune retombee carree dans les coins.

### 2.2 Alpha au bord >= 30 % et contraste calcule

Alpha au bord retenu : **0,34** (>= 0,30 exige). Contraste WCAG calcule par la
formule de luminance relative, composition alpha sur `--bg-app` avec la teinte
`--vocal-speak` de chaque theme :

| Theme | Fond | Teinte de parole | Alpha | Melange obtenu | Contraste |
|---|---|---|---|---|---|
| sombre | `#0f1115` | `#fbbf24` | 0,34 (pic) | `rgb(95,76,26)` | **2,281:1** |
| clair | `#f4f5f7` | `#b45309` | 0,34 (pic) | `rgb(222,190,166)` | **1,601:1** |
| sombre | `#0f1115` | `#fbbf24` | 0,272 (plancher d'animation) | `rgb(79,64,25)` | **1,872:1** |
| clair | `#f4f5f7` | `#b45309` | 0,272 (plancher d'animation) | `rgb(227,201,182)` | **1,448:1** |

A titre de comparaison, l'etat d'avant : 1,044:1 (sombre) / 1,041:1 (clair). Le
bord de la lueur passe donc de **l'invisible** a **2,28:1** en sombre et
**1,60:1** en clair — au-dessus du seuil de perception d'un aplat voisin
(~1,05:1) et dans la meme famille que le halo d'ecoute du lot B (2,13:1 en
clair au centre).

### 2.3 Plus de clignotement : le plancher d'opacite remonte

`@keyframes vocal-speak-glow` faisait varier l'opacite de **0,45 a 0,85** : meme
un bord a 34 % retombait a 0,153 d'alpha effectif. L'animation garde sa duree
(1,6 s) et son `scale` (0,94 → 1,06), mais son opacite ne descend plus sous
**0,80** :

| Instant de l'animation | Opacite | Alpha effectif au bord |
|---|---|---|
| 0 % / 100 % | 0,80 | **0,272** |
| 50 % | 1,00 | **0,340** |

La respiration reste perceptible (echelle + 20 % de variation de lueur) mais la
lueur ne s'eteint **jamais**.

## 3. Pas de doublon : l'enveloppe est le REPLI du contour

La decision pure `spectrumPlan` (`src/js/vocal-equalizer.js:555-566`) ne rend
`porteur: "enveloppe"` que si **`dessiner` est faux** : elle est deja la seule
source de verite cote code.

Ce qui **manquait** cote style : la regle qui eteint l'enveloppe quand le
peintre de contour pose sa classe (le peintre n'est pas encore branche, mais la
regle du §7.3 de la conception doit tenir des maintenant). Elle est **creee** :

```css
.pilot-vocal.vocal-spectrum-live.vocal-state-speaking .vocal-orb::before {
  opacity: 0;
  animation: none;
  transition: none;
}
```

- **quatre classes** contre trois pour la regle d'etat : elle gagne **par
  specificite**, pas par position ;
- elle est placee **apres** la regle de mouvement reduit de la parole (meme
  specificite) : en cas d'egalite, l'ordre tranche en faveur de l'extinction ;
- `animation: none` et `transition: none` : aucun doublon, meme pendant les
  0,3 s de transition d'opacite.

## 4. Mouvement reduit : fixe MAIS visible

Avant : `opacity: 0` sur `::before` → l'etat « Pilot parle » n'avait plus aucun
signe propre. Apres :

- `::before` **sort** de la regle d'extinction
  `.pilot-vocal.vocal-reduced .vocal-orb::after { opacity: 0 }` (l'arc de
  reflexion, lui, reste eteint — inchange) ;
- une regle explicite le rend **visible et fixe** :

```css
.pilot-vocal.vocal-reduced.vocal-state-speaking .vocal-orb::before {
  opacity: 1;
  animation: none;
}
```

- l'`animation: none` du bloc generique `.pilot-vocal.vocal-reduced ... ::before`
  est conservee : **aucune animation**, **aucune transition**, mais **le meme
  degrade**, donc **le meme alpha de 34 % au bord** ;
- les trois autres etats gardent `opacity: 0` (valeur de base) : la lueur
  n'apparait qu'en parole.

## 5. Ce qui n'a pas ete touche (verifie)

- aucun seuil : 600 / 200 / 0,05 / 0,03 / 0,01 / 1000, marges 1,8 et 2 ;
  `stepSpeechGate`, `setSpeaking`, `setSoundStarted`, `setThinking` intacts ;
- `--vocal-heard` / `.vocal-halo` (halo d'ECOUTE du lot B) : intacts ;
- correctif `44c7f65` (fenetre de mesure) et tests de la fiche du 02/10
  (`1ea1944`) : intacts ;
- **la barre sous le cercle reste** (200 x 3 px, `.vocal-level` /
  `.vocal-level-bar` inchangees, test de presence toujours vert) ;
- aucun nouvel element d'interface, aucun nouveau reglage, aucune image ;
- `web/`, Rust, JavaScript de l'ecran vocal : **aucune modification**.

## 6. Fichiers touches

| Fichier | Nature |
|---|---|
| `src/css/style.css` | degrade inverse, plancher d'animation, regle de repli `vocal-spectrum-live`, mouvement reduit visible |
| `src/js/vocal-halo-parole.test.js` | **nouveau** : 5 verrous (pic au bord, alpha >= 0,30, repli sans doublon, mouvement reduit visible, barre conservee) |
| `spec_modes_ecran_vocal.md` | description reelle de la lueur de parole |
| `help/overview.md` | une phrase utilisateur sur la lueur de parole (puis `npm run build:handbook`) |
| `help/handbook.md` | **regenere** par `npm run build:handbook` (jamais edite a la main) |
| `docs/rapports/RAPPORT-halo-parole.md` | ce rapport |

## 7. Resultats des tests

### 7.1 Suite complete (chiffres recomptes par moi)

```
npx vitest run --reporter=json
fichiers : total 1257, reussis 1257, echoues 0
tests    : total 4016, reussis 4016, echoues 0, ignores 0, todo 0
success  : true (code de sortie 0)
```

Base annoncee : 4 004 tests verts. Le nouveau fichier en ajoute **12** :
4 004 + 12 = **4 016**, compte confirme. Aucun test existant n'a ete modifie ni
supprime.

Rust : **aucun fichier Rust touche** (`git diff --stat` ne liste que le CSS, les
tests, la spec, l'aide et ce rapport) ; `cargo test` n'est donc pas requis par
cette modification, et n'a pas ete lance.

### 7.2 Le nouveau fichier de verrous (12 tests, tous verts)

```
PASS src/js/vocal-halo-parole.test.js (12 tests)
  VERT | le dernier arret est a 100 % et il est le plus opaque
  VERT | le centre est transparent : la lumiere n'est plus cachee sous le disque
  VERT | le degrade est centre sur `closest-side` et porte la teinte de la parole
  VERT | la valeur lue dans la feuille de style tient le seuil, sans tolerance
  VERT | la couronne visible (bord du disque a 84 %, bord de la boite a 100 %) monte bien
  VERT | la regle de repli existe et eteint l'enveloppe, sans animation ni transition
  VERT | elle est la DERNIERE de la famille : elle gagne sur l'etat et sur le mouvement reduit
  VERT | la decision pure ne designe jamais deux afficheurs pour la meme voix
  VERT | l'enveloppe n'est plus eteinte par le reglage de mouvement reduit
  VERT | en « parole », elle reste affichee et immobile
  VERT | l'alpha au bord ne baisse pas : c'est le MEME degrade
  VERT | 200 x 3 px, rayon 2 px : elle est toujours la
```

### 7.3 Preuve que 2 des tests mordent (mutation, sorties brutes)

Mutation appliquee : **ancien degrade** (22 % au centre, `transparent 100 %`, un
seul arret) **et** ancienne extinction en mouvement reduit (`::before, ::after
{ opacity: 0 }`). Sortie brute (reporter JSON, 12 tests, 7 rouges) :

```
ROUGE | le dernier arret est a 100 % et il est le plus opaque
      AssertionError: arrets du degrade illisibles: expected 1 to be greater than or equal to 3
ROUGE | le centre est transparent : la lumiere n'est plus cachee sous le disque
      AssertionError: expected { alpha: 0.22, position: +0 } to deeply equal { alpha: +0, position: +0 }
VERT  | le degrade est centre sur `closest-side` et porte la teinte de la parole
ROUGE | la valeur lue dans la feuille de style tient le seuil, sans tolerance
      AssertionError: expected 0.22 to be greater than or equal to 0.3
ROUGE | la couronne visible (bord du disque a 84 %, bord de la boite a 100 %) monte bien
      AssertionError: expected 0 to be greater than or equal to 2
VERT  | la regle de repli existe et eteint l'enveloppe, sans animation ni transition
ROUGE | elle est la DERNIERE de la famille : elle gagne sur l'etat et sur le mouvement reduit
      AssertionError: expected -1 to be greater than -1
VERT  | la decision pure ne designe jamais deux afficheurs pour la meme voix
VERT  | l'enveloppe n'est plus eteinte par le reglage de mouvement reduit
ROUGE | en « parole », elle reste affichee et immobile
      SourceSliceError: ancre de debut absente : .pilot-vocal.vocal-reduced.vocal-state-speaking .vocal-orb::before
ROUGE | l'alpha au bord ne baisse pas : c'est le MEME degrade
      SourceSliceError: ancre de debut absente : .pilot-vocal.vocal-reduced.vocal-state-speaking .vocal-orb::before
VERT  | 200 x 3 px, rayon 2 px : elle est toujours la
```

Apres restauration du CSS (copie de sauvegarde, aucune commande Git) :

```
tests: total 12, passed 12, failed 0
```

Les deux exigences de morsure sont donc demontrees chiffres en main :
**alpha au bord** (0,22 lu -> « expected 0.22 to be greater than or equal to
0.3 ») et **pic au bord** (« expected { alpha: 0.22, position: +0 } to deeply
equal { alpha: +0, position: +0 } »).

### 7.4 Garde-fous existants reverifies

- `ecran-vocal-lot2.test.js` (barre 200 x 3 px, `--vocal-state` uniquement,
  mouvement reduit sans animation) : **vert, non modifie** ;
- `ecran-vocal-lot3.test.js` / `vocal-halo-parole` voisins du halo d'ecoute :
  **verts, non modifies** ;
- correctif `44c7f65` et tests de la fiche du 02/10 (`1ea1944`) : **verts, non
  touches**.

## 8. Reste a faire

- brancher le peintre du contour spectral (`vocalSetSpectrum` + classe
  `.vocal-spectrum-live`), prevu au lot D de
  `docs/conceptions/CONCEPTION-cercle-equaliseur.md` : la regle de repli est
  deja verrouillee par test, il n'y aura qu'a poser la classe ;
- verification a l'oeil sur les deux themes (sombre et clair) et en mouvement
  reduit.
