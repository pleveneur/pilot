# Écran Vocal — le portrait et les deux colonnes : conception définitive

> **✅ DÉCISIONS TRANCHÉES — AUCUNE QUESTION OUVERTE** (propriétaire, à l'oral, 2026-10-29).
> **RÉVISION DU 2026-10-29 (précision du propriétaire, après l'oral) : la liste des tâches
> passe EN HAUT de la colonne de droite et le portrait descend à son PIED.** Quand un
> personnage est actif : titre → tâches → portrait → pastille → ligne d'activité. Quand aucun
> personnage n'est actif : **aucun espace réservé**, la liste prend toute la hauteur.
> Le détail applicable, les deux cas, le budget et les tests sont dans
> **`docs/conceptions/CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md`** — ce
> document-ci est corrigé aux endroits concernés (§ 0, § 1.1, § 1.2, § 1.5, § 2, § 2.1, § 2.2,
> § 3.3, § 7, § 8.1, § 9), et **aucune décision n'est rouverte**.
> **COMPLÉMENT DU 2026-10-29 — LA ZONE D'IMAGE A TROIS CAS, DANS CET ORDRE** (décision du
> propriétaire) : **le personnage** → **l'avatar du visage (PLface)** → **la liste seule**. La
> zone est la **place au pied de la colonne** ; elle ne dessine **rien** pour l'avatar ; et
> l'avatar ne s'y pose que si sa **taille** est connue — aujourd'hui elle ne l'est **pas**
> (aucune route de taille dans PLface, § 7bis.5). Détail applicable : **§ 7bis** ci-dessous,
> qui n'amende **aucune** ligne des § 0 à § 7.
> **Correction du 2026-10-31** : le portrait est **en haut de la colonne de droite**, au-dessus
> des tâches, et le **disque ne porte rien** (ni image, ni nom). La mission « écran Vocal » du
> 2026-10-30, qui l'avait mis **au centre du cercle**, est **annulée** — voir l'encadré de tête
> de l'**AVENANT**. Il n'y a donc **pas de portrait au centre du disque** nulle part dans ce
> document ; lisez « pied de la colonne » partout où le texte parle du portrait comme d'un
> élément **bas** : la seule disposition valide est **titre → portrait + nom → zone d'image →
> liste**.
> Révision du 2026-10-29 (après l'oral) : le portrait **quitte le cercle** et prend le
> haut de la colonne de droite *(→ désormais le **pied** de cette colonne, voir la révision
> ci-dessus)* ; la discussion à gauche passe du hors-périmètre au
> **lot 3** ; le bouton d'affichage est chiffré ; les chiffres sont justifiés un par un ;
> le budget d'états est rejoué.
>
> Ce document ne contient **aucune** des marques `[à trancher]`, *(proposition)*, `TODO`,
> ni aucun « reste à voir ». Un chiffre qu'on ne justifie pas ici n'a pas à être choisi
> par qui code : il est **déjà** choisi, et le lot qui le porte dit dans quel fichier il vit.

---

## AVENANT (mission « écran Vocal », 2026-11) — il PRIME sur les sections qu'il cite

> **⚠️ POINT 3 ET POINT 4 DE CET AVENANT : ANNULÉS LE 2026-10-31 (décision du propriétaire).**
> Le portrait **ne vit plus dans le cercle** : il est **revenu en haut de la colonne de
> droite**, **au-dessus** de la liste des tâches, et son **nom** est écrit **sous lui**
> (`.vocal-portrait-name`). Le disque ne porte **rien** — ni image, ni nom. La zone d'image
> reprend donc **trois cas, dans cet ordre** : le **personnage** (bloc de **98 px** = 72 px de
> médaillon + 6 px d'écart + 20 px de nom) → l'**avatar du visage** (180 px) → **rien**. Le
> budget de la colonne est donc `H − 51`, `H − 51 − 98` ou `H − 51 − 180`. Conséquence
> rétablie : dans l'**état nu**, le **portrait et son nom restent** visibles, seuls (décision 9
> du 2026-10-29, de nouveau applicable). Le bouton d'affichage, lui, **porte désormais son
> texte** en clair (« Ne garder que le portrait » / « Tout réafficher ») : le propriétaire ne
> le trouvait pas. Les points **1 et 2** de l'avenant (plus de ligne d'activité, la colonne qui
> ne passe jamais sous le cercle) **restent valables**. Voir
> `spec_modes_ecran_vocal.md` § 3ter et § 4ter.

Quatre décisions du propriétaire, prises à l'oral après usage de l'écran. Elles **ne
rouvrent aucune des neuf décisions** ci-dessous : elles en retirent deux objets (le
portrait de la colonne, la ligne d'activité) et déplacent un troisième (le nom). Les
trois sorties, le halo, le micro, le disque, l'effacement du bas et l'état nu restent
**intacts**.

1. **Plus aucune ligne d'activité.** Le texte du bas de la colonne de droite (« *X*
   réfléchit », « *X* exécute une opération », « *N* missions en attente ») **disparaît**.
   La place n'est pas réoccupée : la liste prend les 21 px qu'il occupait. La fonction pure
   qui le calculait (`vocalNowLine`) et son nœud (`.vocal-now`) sont retirés **ensemble**,
   et le test qui les décrivait part avec eux. *Amende § 3.3 et § 3.4 (entier).*

2. **La colonne des tâches ne passe jamais sous le cercle.** Sa largeur n'est plus celle de
   la piste de la grille : `vocalSyncSides()` écrit `--vocal-side-tasks`, qui vaut
   `--vocal-side` **moins la couronne** du disque (`VOCAL_CROWN_PX` 88 − 24 px, soit 64 px).
   C'est une **largeur**, pas une marge : un titre trop long est coupé **par sa boîte**
   (une ligne, points de suspension), il ne peut ni déborder ni pousser la boîte. La colonne
   reste alignée vers le disque (`justify-self: end`). *Amende § 2.2 et § 3.1.*

3. **Le portrait est au CENTRE DU DISQUE**, plus dans la colonne. *(**ANNULÉ le 2026-10-31** :
   voir l'encadré de tête de cet avenant — le portrait est revenu en **haut de la colonne de
   droite**, au-dessus de la liste, et le disque ne porte rien.)* Il occupe **au plus la
   moitié de l'intérieur du cercle** (`--vocal-orb-size / 2`, soit 168 px pour 336), il est
   centré (`position: absolute; left/top: 50%; translate(-50%, -50%)`), et il est le
   **premier enfant** de `.vocal-orb` — donc sous le halo et sous le bouton de relance, qui
   se peignent par-dessus. Le disque ne bouge pas d'un pixel : le portrait ne prend aucune
   place dans la grille. *Amende la décision 1, § 1.2, § 2.1 et § 2.4.*

4. **Un seul nom, et il est DANS le cercle, juste sous l'image.** *(**ANNULÉ le 2026-10-31** :
   le nom est **sous le portrait**, dans la colonne, classe `.vocal-portrait-name`.)*
   `.vocal-orb-name` passe de
   `top: calc(100% + 6px)` (sous le bouton-cercle) à `top: calc(75% + 6px)` — le bas exact du
   portrait, qui est centré et vaut la moitié du disque. Une seule ligne, jamais deux noms :
   `max-width: 66%` (222 px pour 336, la corde du cercle à cette hauteur en vaut 284) et
   `text-overflow: ellipsis`. Le nom est le nom du personnage, à défaut celui de l'assistant,
   par la **seule** règle `superAgentDisplayLabel()`. **Rien d'autre sous l'image.** La
   pastille sous le bouton-cercle n'existe plus. *Amende la décision 5, § 2.3 et § 2.5.*

### Ce que ces quatre points changent dans les tableaux

- **La zone d'image a TROIS cas** (§ 7bis) — le personnage d'abord, puis la **fenêtre du
  visage** quand elle tourne et que sa taille est connue (180 px), puis **rien**. Le
  personnage occupe le haut de la colonne, dans son bloc de 98 px.
- **La hauteur fixe de la colonne tombe de 170 px à 51 px** : 14 (marge) + 11 (titre) + 14
  (marge) + 12 (air du bas). La liste dispose donc de **`H − 51` px**, de **`H − 51 − 98`**
  avec le personnage, ou de `H − 51 − 180` avec
  la fenêtre du visage, ce qui va de **3 à 8** lignes, et **8 au plus** (`VOCAL_TASKS_MAX`,
  `floor((440 − 2 × 20) / 46)`).
- **`H = 277`** est le seuil de la fenêtre du visage : `51 + 180 + 46` — en dessous, elle ne
  laisserait pas une seule tâche, donc elle n'est pas dessinée et la liste garde exactement
  la hauteur du cas « rien ».

### L'état nu (§ 6.7) — la décision du 2026-10-29 est RÉTABLIE

Le 2026-10-29, l'état nu éteignait tout **sauf le portrait**, qui vivait dans la colonne.
L'avenant du 2026-11, en déplaçant le portrait **dans** le disque, avait fait tomber cette
exception. **Cet avenant est annulé le 2026-10-31** : le portrait est revenu dans la colonne,
il n'est plus peint par le nœud du disque, et le bloc d'effacement **ne le nomme pas** — donc
il **reste allumé**, avec son nom. `§ 6.7` se relit donc « tout se masque **sauf le portrait et
son nom** », et le bouton d'affichage reste le seul moyen de tout réafficher.

---

## La contrainte qui prime sur tout ce document

**La sortie de l'écran Vocal reste toujours cliquable.** Le 29/10, une projection a posé
des colonnes de part et d'autre du disque : elles couvraient toute la hauteur de l'écran,
ne laissaient passer aucun clic, et il a fallu passer par le clavier pour quitter un écran
qui n'avait plus de porte. Cette conception **ne peut pas** reproduire cet incident :

- les deux colonnes sont des zones **`pointer-events: none`**, sans aucun nœud focusable ;
- le **test T17** (créé au lot 1, § 2.5) **échoue** si un seul des trois chemins de sortie
  (le bouton des modes — le logo —, la touche Échap, la fermeture de l'onglet) cesse d'être
  joignable ; il est la raison d'être du document, pas un test de plus.

Un lot qui ne peut pas passer T17 ne se livre pas.

---

## 0. Les neuf décisions du 2026-10-29

| # | Décision | Où elle se traduit |
|---|---|---|
| 1 | Le portrait **n'est pas dans le cercle**. Le disque garde son objet lumineux ; le personnage devient un **médaillon au pied de la colonne de droite** *(révision : il était en haut)*, nettement plus petit que le disque. | § 1.2, § 2 |
| 2 | La **colonne de droite**, de haut en bas : les tâches du projet (**en cours d'abord, puis en attente**) → **le portrait** → **une ligne** disant ce que fait l'agent à cet instant. **Rien d'autre.** *(révision : les tâches passent au-dessus du portrait ; les deux blocs gardent leur contenu et leurs chiffres)* | § 1.2, § 3.2, § 3.3 |
| 3 | La **colonne de gauche** : la discussion — les questions de l'utilisateur y figurent **aussi**, en plus petit et en gris. | § 1.3, § 4 |
| 4 | **Halo / voix : on garde 60 %.** La question du contraste portrait ↔ halo tombe : plus de portrait dans le halo. | § 1.4 (et le tableau « ce que ces lots ne font pas » ci-dessous) |
| 5 | Le **nom** garde sa petite pastille, mais elle est **rattachée au portrait** (elle vit sous lui, plus dans le bouton de relance). | § 2.3 |
| 6 | **Largeur des colonnes : 384 px** (320 px dans la première conception ; élargies de 64 px le 2026-11-02, cf. `spec_modes_ecran_vocal.md` § 3ter), avec **élargissement au-delà de 1600 px** de fenêtre. | § 3.1, § 3.2 (table) |
| 7 | **Seuil d'affichage : dès `avail ≥ 240`.** Rien n'est caché sur un petit portable. | § 3.2 |
| 8 | **Trois lots**, livrables seuls et dans cet ordre : **lot 1** portrait ; **lot 2** tâches + ligne d'activité (+ le bouton d'affichage, qui n'a de sens qu'une fois les colonnes remplies, § 6) ; **lot 3** discussion **et** levée de l'interdit — la doctrine de l'écran nu est isolée dans son lot, avec ses mises à jour de spec et d'aide. | § 2, § 3, § 4, § 6 |
| 9 | **Tout ce que l'écran affiche se masque d'un seul geste, sauf le portrait.** Un petit bouton discret (une icône d'œil, dans la barre du haut) retire **ensemble** le disque, la couronne, la ligne d'état, la saisie, les colonnes et le fond de la barre ; **le personnage reste**, et le même bouton remet tout. **Rien n'est mémorisé** : on entre toujours avec tout visible. *(décision du 2026-10-29, postérieure aux huit premières — elle ne rouvre aucune d'elles : les trois sorties, le logo-bouton et l'effacement du bas sont intacts.)* | § 6 (entier) |

> **Décision 9 — les quatre points laissés en attente sont tranchés le 2026-10-29** (réponses
> du propriétaire, reprises ici sans les rouvrir). **(1)** Le bouton d'affichage **n'existe
> que dans l'écran Vocal** → § 6.4. **(2)** Sans personnage actif, il ne reste **que le
> bouton**, et le disque ne reste pas pour le remplir → § 6.5. **(3)** L'infobulle dit
> « **le portrait** », jamais « le personnage » → § 6.4. **(4)** Le fondu du masquage reste à
> **180 ms**, jamais l'instantané → § 6.7. Les passages concernés vont donc du § 6.4 au § 6.7 ;
> le § 6.6 (la mémoire) n'est pas touché, et aucune autre ligne de la décision 9 ne change.

### Ce que ces lots ne font pas (et pourquoi)

| Ce qui est hors périmètre | La raison |
|---|---|
| Un portrait **dans** le cercle, un portrait derrière le disque, un portrait à la place du logo des modes | Décision 1 : le disque est l'objet lumineux, il ne porte rien. |
| Un **troisième** bloc dans une colonne (compteur, projet, date, version, badges, boutons de tâche) | Décision 2 : « tâches → portrait → une ligne → rien d'autre » *(ordre corrigé le 2026-10-29)*. Le reste est déjà dans le bouton « Travail ». |
| Rendre une **tâche cliquable** dans la colonne | Elle est un **aperçu** ; la surface cliquable est le bouton « Travail », qui porte déjà la liste complète et ses actions. Un second chemin d'action contredirait la règle des six hôtes. |
| Un **curseur** de largeur, un **glissement** des colonnes, un **pli** | Aucun réglage nouveau (contrainte du § 5). |
| **Persister** l'état des colonnes ou l'état nu (fichier, `localStorage`, config) | Un écran nu n'a pas d'état à retrouver : on entre, tout s'affiche selon la place, on sort, rien ne reste (décision 9, § 6.6). |
| Un **second** bouton de masquage (les colonnes d'un côté, le bas de l'autre) | Décision 9 : **un seul** geste, un seul état. Deux interrupteurs voisins seraient un réglage déguisé (§ 6.3). |
| Masquer le **portrait**, le **logo** ou le bouton « **Travail** » | Le portrait est ce qui reste quand tout disparaît ; le logo et « Travail » sont des portes, et une porte qu'on ne voit plus n'est plus une porte (§ 6.3). |
| Une **animation d'entrée** des colonnes | `prefers-reduced-motion` s'applique à tout l'écran, et une apparition en fondu des colonnes n'apporterait aucune information. |
| Peindre les colonnes **hors du mode Vocal** (dans une bande latérale de l'onglet) | Décision du propriétaire : l'écran Vocal est le seul endroit qui les montre ; ailleurs, la conversation et le volet ont la place. |

---

## 1. La disposition définitive

### 1.1 En une phrase

Le disque reste **seul au centre** ; deux colonnes prennent place **symétriquement** de
part et d'autre, sur toute la hauteur du disque et **pas au-delà** ; la droite va du **titre**
vers les **tâches**, puis vers **le portrait** et une ligne d'activité *(révision : c'était
portrait → tâches → ligne)* ; la gauche porte la discussion qui
remonte du bas ; **en dessous du disque, la ligne d'état et la barre de saisie traversent
l'écran de part en part, libres de toute colonne.**

### 1.2 En mots et en chiffres — la colonne de droite

La colonne de droite a **la hauteur exacte de la boîte du disque** — `--vocal-orb-box`,
c'est-à-dire `--vocal-orb-size` plus ses deux couronnes (`--vocal-crown`, 88 px quand le
disque est à son maximum) : 512 px au maximum, 480 px dans le seul cas où la grille a une
seconde rangée (le bouton « Autoriser le micro » s'affiche), et **jamais plus que la place
que la scène lui laisse** (191 px sur une fenêtre de 480 px de haut, où la boîte vaudrait
301 px) — et **la même largeur que la colonne de gauche**. Son contenu, de haut en bas,
**sans rien d'autre** :

> **Ordre du document (révision du 2026-10-29, précision du propriétaire)** : **le titre**,
> **les tâches**, **le portrait**, **la pastille**, **la ligne d'activité**. Les cinq blocs et
> tous leurs chiffres sont **inchangés** ; seul leur **ordre** change. Détail applicable et
> cas « aucun personnage » : `CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md`.

1. **Le titre de la colonne** — « TÂCHES », 11 px, capitales, `letter-spacing: 0.08em`,
   à **14 px** du bord haut de la colonne. *Pourquoi 14 px :* c'est le `--space-3`+2 —
   exactement la marge du haut de la colonne de gauche, donc les deux titres sont **sur la
   même ligne**. *Ce que la révision change :* le titre passe **en premier** (il était
   sous la pastille) ; la colonne parle d'abord du **travail**.
2. **Les tâches** — groupe **« En cours (n) »** en premier, puis groupe **« En attente (n) »**,
   dans **cet** ordre et jamais l'inverse (décision 2). Chaque tâche : **une** ligne de
   titre (13 px, une seule ligne, points de suspension) + **une** ligne de contexte
   (11 px : qui + depuis quand). Jamais trois lignes. *Ce que la révision change :* elles
   sont **ancrées en haut** — elles commencent 14 px sous le titre et grandissent vers le
   bas, donc **à la même place que le personnage soit actif ou non**.
3. **Le portrait** — un médaillon rond de **72 px** de diamètre, centré dans la colonne,
   `object-fit: cover`, **au pied de la colonne** (sous les tâches, au-dessus de la pastille).
   C'est le **même** portrait que celui de l'écran d'accueil de l'Assistant
   (`getAssistantPortrait()`), mais **sans repli** : sans portrait affichable, la colonne
   n'affiche **aucune image** (le logo reste au bouton des modes, sa place est prise —
   révision ; voir `CONCEPTION-…-taches-en-haut-portrait-en-bas.md` § 2.3 et § 6) ;
   aucune lecture nouvelle, aucun fichier nouveau (§ 7).
   *Pourquoi 72 px :* le disque mesure 336 px, donc le rapport est de **4,7 : 1** et le
   « nettement plus petit » de la décision 1 est tenu. Dans la colonne de 320 px il laisse
   **124 px d'air de chaque côté** : il ne fait pas « un bloc ». Ce chiffre tient aussi sur
   les colonnes étroites : 105 px d'air à 282 px de large (fenêtre de 896 px). 64 px aurait
   donné un médaillon de la taille d'une icône ; 96 px commençait à concurrencer le disque
   (3,5 : 1).
4. **La pastille du nom** — la bande arrondie qui était jusqu'ici dans le bouton de
   relance, **sous** le portrait, à **6 px** de son bord bas. 12 px, une ligne, coupée sur
   une fin de mot si besoin (`vocalRestartText`), nom complet en `title` et en
   `aria-label`. *Pourquoi 6 px :* la pastille colle au portrait qu'elle nomme (c'est le
   lien que la décision 5 demande) sans le toucher ; l'écart d'un cran de la grille
   d'espacement (`--space-1` = 4 px) eût été trop serré pour un bord d'image sombre.
5. **La ligne d'activité** — **une** ligne, 12 px (18 px de hauteur de ligne, le chiffre qui
   sert au budget du § 3.3), une seule, toujours à la même place :
   collée au bas de la colonne, à **12 px** au-dessus du bord
   bas. Elle dit ce que fait l'agent **à cet instant** (§ 3.3). *Pourquoi une place fixe :*
   une ligne qui apparaît et disparaît ferait sauter la liste des tâches au-dessus d'elle ;
   *pourquoi en bas :* c'est un état, il se lit après le travail, comme la ligne d'état de
   l'écran se lit sous le disque.
   *Ce que la révision change, et c'est le seul geste technique du document :* l'ancrage ne se
   fait plus par `margin-block-start: auto` **sur cette ligne**. Le portrait devant lui aussi
   être ancré en bas, **deux marges automatiques se partageraient l'air** et le portrait
   flotterait au milieu de la colonne. C'est donc **la liste** (`.vocal-side-body`,
   `flex: 1 1 auto; min-height: 0; overflow: hidden`) qui absorbe la hauteur libre ; le
   portrait, la pastille et la ligne d'activité la suivent, collés au bas. **Une seule**
   mécanique d'ancrage, et **le même** résultat visible : la ligne d'activité ne bouge pas
   d'un pixel quand la liste change, ni quand le personnage apparaît ou disparaît.

### 1.3 En mots et en chiffres — la colonne de gauche

Même hauteur, même largeur que la droite, **symétrique** autour du disque :

1. **Le titre** — « DISCUSSION », 11 px, capitales, en haut (14 px du bord haut), mêmes
   réglages que « TÂCHES » : les deux titres sont à la même hauteur, à un pixel près.
2. **La discussion** — collée au **bas** de la colonne : le dernier échange est le plus
   proche du bord bas, comme dans une conversation qu'on lit en arrivant. La colonne est en
   `justify-content: space-between` — le titre reste en haut, le corps tombe au bas — de
   sorte qu'un aperçu court ne flotte pas au milieu. L'aperçu remonte donc vers le haut, et
   le **dégradé de disparition** est en **haut** (vers le titre), jamais en bas.
3. **Les questions de l'utilisateur y figurent** (décision 3) : 13 px, en gris, **deux**
   lignes au maximum. Les réponses : 15 px, `--text-primary`, **huit** lignes au maximum.
   Les deux mesures sont justifiées au § 4.2.

### 1.4 Ce qui ne bouge pas d'un pixel

- **Le disque** garde sa taille, son centre, sa bordure d'état, son enveloppe de parole
  (`--vocal-halo`) et son rythme : **le halo garde ses 60 %** (décision 4). Aucune des
  règles du disque n'est touchée par ce document — c'est vérifié par deux tests existants
  qui n'ont pas à changer (`vocal-halo-parole.test.js`, `vocal-enveloppe-aigu.test.js`).
- **La ligne d'état** et **la barre de saisie** restent **sous** le disque, pleine largeur,
  et **hors** des colonnes : les colonnes s'arrêtent au bas de la boîte du disque.
- **Les quatre états** (repos / écoute / réflexion / parole) et leurs jetons `--vocal-*`
  ne changent pas.
- **Le bouton des modes (le logo)** ne change ni de place ni de rôle : il reste la sortie.
- **Les six hôtes cliquables** de l'issue #381 restent **exactement six** (§ 5.1).

**La question « contraste portrait ↔ halo » est close, et elle n'est pas reportée.** Elle
n'existe que si le visage se trouve **dans** le disque : il faudrait alors garantir la
lisibilité d'un portrait posé sur une lumière qui monte et descend avec la voix, donc
négocier le halo à la baisse à chaque état. Le portrait étant dans la colonne, il repose sur
le **voile des colonnes** — une fois, à 50 %, calculé au § 5.3 — et il ne dépend plus du tout
de l'état du halo. Les 60 % sont donc conservés **sans contrepartie** : plus aucun chiffre de
l'écran n'a besoin d'être arbitré entre le visage et la lumière.

### 1.5 Le schéma (pour situer, pas pour mesurer)

```
┌───────────────────────────────────────────────────────────────┐
│  [logo]                                          [ œil ] 44 px │  ← .vocal-top
├───────────────┬─────────────────────────┬─────────────────────┤
│  DISCUSSION   │                         │  TÂCHES             │
│               │    ┌───────────────┐    │   En cours (n)      │
│  (remonte du  │    │  .vocal-halo  │    │   1. …              │
│   bas)        │    │  ┌─────────┐  │    │   2. …              │
│  question 13  │    │  │ disque  │  │    │   En attente (n)    │
│  réponse  15  │    │  │   336   │  │    │   3. …              │
│               │    │  └─────────┘  │    │                     │
│               │    │ 88 px couronne│    │     ◯  portrait 72  │
│               │    └───────────────┘    │       (nom)         │
│               │  [Autoriser le micro]   │  « … à cet instant »│
├───────────────┴─────────────────────────┴─────────────────────┤
│                     ligne d'état (1 ligne)                     │
│                     barre de saisie (déplacée)                 │
└───────────────────────────────────────────────────────────────┘
   ↑ 320 / 400 px       ↑ disque 336       ↑ 320 / 400 px
   ←———— min(--vocal-orb-box, 100 %) de haut, pour les deux ————→
```

La rangée « Autoriser le micro » n'existe que si ce bouton s'affiche (micro refusé) : elle
est **dans** la scène, sous le disque, et les deux colonnes lui laissent la place (480 px
au lieu de 512) — elle ne peut donc pas pousser la ligne d'état.

Les colonnes ont **la hauteur de la boîte du disque** (la ligne `min(…)` sous le schéma) et
**pas une de plus** : c'est cette borne qui garantit que ni la ligne d'état ni la barre de
saisie ne peuvent être recouvertes, et donc que la sortie et la parole restent joignables
(T17).
La hauteur vaut `min(var(--vocal-orb-box), 100 %)` : plafonnée à la boîte du disque (512 px),
mais réduite à la place disponible dans la seule situation où la grille a une seconde rangée
(le bouton « Autoriser le micro » affiché, 480 px) — jamais 512 px écrasés sur la ligne
d'état.

Deux conséquences géométriques, qui ne sont pas des détails :

- La place disponible se mesure **sur le disque**, pas sur la boîte : la couronne
  (`.vocal-halo`) est **hors flux** (`position: absolute`), elle n'élargit rien. À 336 px de
  disque, les colonnes commencent à 24 px de son bord : la lumière de la couronne passe donc
  **de 64 px sous la colonne** (88 − 24). C'est exactement pour cela que le voile des
  colonnes est à 50 % et non à 100 % (§ 5.3), et pour cela que la couleur du texte des
  colonnes est calculée derrière cette lumière (même §).
- La colonne étant **dans le flux** alors que la couronne ne l'est pas, la hauteur de 512 px
  est la seule qui aligne le haut de la colonne sur le haut de la couronne sans jamais
  dépasser : 512 + 289 = 801 px, la hauteur exacte à laquelle la formule du disque atteint
  son plafond. Aucune colonne ne peut donc pousser la ligne d'état vers le bas.

---

## 2. LOT 1 — le portrait et son nom

**Ce que l'utilisateur voit à la fin du lot 1** : en mode Vocal, un médaillon rond du
personnage, **au pied de la colonne de droite** *(révision du 2026-10-29 : il était en haut
à droite du disque)*, avec son nom en dessous. Rien à gauche, aucune
tâche. **Aucun bouton** : le lot 1 ne montre que la structure et l'identité.

### 2.1 Le balisage (un seul point d'accroche)

`buildVocalOverlay()` (`src/js/super-agent.js`) — **seul** endroit qui pose le balisage de
l'écran. Ordre **final** des classes, à recopier tel quel dans les deux tests qui le lisent :

```
vocal-top
vocal-stage
vocal-orb
vocal-halo
vocal-restart
vocal-mic-fix
vocal-side-discussion     ← ajouté au lot 1 (vide)
vocal-side-tasks          ← ajouté au lot 1 (vide)
vocal-side-body           ← ajouté au lot 1 (conteneur dynamique, vide) — RÉVISION 2026-10-29 : placé AVANT le portrait
vocal-portrait            ← ajouté au lot 1 (dans .vocal-side-tasks) — RÉVISION : après la liste
vocal-portrait-name       ← ajouté au lot 1 (dans .vocal-side-tasks) — RÉVISION : après la liste
vocal-status
vocal-input
```
**Le bouton d'affichage n'est PAS dans cette liste** (révision du 2026-10-29, § 6.4) :
`buildVocalOverlay()` pose le modèle ci-dessus, puis **ajoute** le bouton comme enfant de
`.vocal-top`. Il n'apparaît donc dans aucune classe du modèle, et la chaîne
`'<div class="vocal-top"></div>'` que lit `ecran-vocal-lot2.test.js` reste **intacte**.
Raison : le test dit « la barre de 44 px ne porte rien », et c'est vrai — c'est **une
fonction** qui y pose un contrôle, de la même façon que le libellé du bouton de relance
est posé après coup. Le modèle dit la structure ; la fonction dit l'état.

Deux points de vigilance, et **un chiffre qui change** :

- le nombre de `</div>` entre `.vocal-stage` et `.vocal-status` passe de **2 à 4** (l'objet
  lumineux, puis les **deux** `<aside>`, puis la scène). Ce chiffre est asserté par **deux**
  tests existants (`ecran-vocal-lot2.test.js` ~l. 262, `vocal-halo-128-et-etat-au-dessus-saisie.test.js`
  ~l. 327), et les deux fichiers sont **déjà** dans la liste de ceux qui changent (§ 8.1) :
  c'est donc une ligne de plus à y changer, pas une surprise. On **ne triche pas** en
  laissant les colonnes hors de la scène : le test dit « la scène est refermée avant la
  phrase », et c'est toujours vrai — elle l'est simplement quatre `</div>` plus loin.
- les deux colonnes sont les **enfants de la scène** (c'est la grille qui les place) et
  précèdent `.vocal-status` dans le document : elles ne peuvent pas se trouver au-dessus de
  la ligne d'état.
- `gap: 32px` **reste** dans `.vocal-stage` (l'assertion `/gap:\s*32px/` le lit) ; c'est
  lui qui fait, en `row-gap`, l'écart entre le disque et le bouton de dépannage du micro —
  exactement l'écart d'aujourd'hui ; `column-gap: 24px` posé **après** l'annule
  horizontalement et pose le jour des colonnes. Aucun test n'a à changer pour cela.

Les deux `<aside>` sont créés **au lot 1**, même vides : la grille existe ainsi dès le
premier lot et la liste ordonnée des tests ne bouge plus qu'une fois (lot 1 : cinq entrées ;
lot 2 : **aucune entrée de plus** — le bouton d'affichage est ajouté hors du modèle, § 6.10).
Les remplir est le travail des lots 2 et 3.

### 2.2 Le CSS (lot 1)

| Sélecteur | Ce qu'il pose | Ce qu'il ne pose **jamais** |
|---|---|---|
| `.vocal-stage` | `display: grid` ; `grid-template-columns: var(--vocal-side) var(--vocal-orb-size) var(--vocal-side)` ; `grid-template-rows: 1fr auto` ; `column-gap: 24px` ; `align-items: center` ; `justify-items: center` ; `padding: 0 16px` ; `gap: 32px` conservé (voir § 2.1) | `position: fixed`, `inset: 0`, `overflow: auto` |
| `.vocal-stage > .vocal-orb` | `grid-area: 1 / 2` | — |
| `.vocal-stage > .vocal-mic-fix` | `grid-area: 2 / 2` — rangée 2, **même colonne que le disque** : il garde sa place d'aujourd'hui, sous le disque | une colonne 1 ou 3 |
| `.vocal-stage.vocal-sides-off` | `grid-template-columns: var(--vocal-orb-size)` **et** `.vocal-sides-off > .vocal-orb, .vocal-sides-off > .vocal-mic-fix { grid-column: 1 }` | — |
| `.vocal-side` | `grid-row: 1` ; `height: min(var(--vocal-orb-box), 100%)` ; `justify-self: stretch` ; `overflow: hidden` ; `pointer-events: none` ; `user-select: none` | un fond, une bordure, un `z-index` |
| `.vocal-side-discussion` | `grid-column: 1` ; `display: flex; flex-direction: column; justify-content: space-between` | du texte (il vient du lot 3) |
| `.vocal-side-tasks` | `grid-column: 3` ; `display: flex; flex-direction: column` ; `justify-content: flex-start` ; `overflow: hidden` (révision du 2026-10-29 : le **haut** de la colonne ne bouge pas — titre et première tâche à la même place dans les deux cas) | du texte |
| `.vocal-side-body` *(liste)* | `flex: 1 1 auto; min-height: 0; overflow: hidden` — c'est **elle** qui absorbe la hauteur libre (révision : elle remplace le `margin-block-start: auto` de la ligne d'activité ; deux marges automatiques se partageraient l'air et le portrait flotterait au milieu) | un `flex: 1` sur le portrait ou la pastille |
| `.vocal-portrait` | `width: 72px; height: 72px; border-radius: 50%; object-fit: cover; align-self: center; pointer-events: none; flex: 0 0 auto` ; `[hidden]` quand `getAssistantPortrait()` est `""` (révision : **aucun repli sur le logo** dans la colonne) | `box-shadow`, un anneau, une bordure d'état |
| `.vocal-portrait-name` | `align-self: center; margin-block-start: 6px; font-size: var(--font-sm); background: color-mix(in srgb, var(--bg-app) 88%, transparent); border-radius: 999px; padding: 2px 10px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis` | `pointer-events: auto`, `title` (le nom complet vit sur le **texte**, pas sur une zone cliquable) |
| `[hidden]` sur ces nœuds | — (le navigateur le fait déjà) | une règle `[hidden] { display: none !important }` sous `.vocal-side` : on masque la **colonne**, jamais ses enfants |

**Pourquoi le placement est explicite** — trois pièges, tous vérifiés sur le code réel :

1. **L'ordre du DOM ne donne pas l'ordre visuel.** `.vocal-stage` contient aujourd'hui
   `.vocal-orb` puis `.vocal-mic-fix`. En grille, l'auto-placement mettrait le disque dans la
   **piste 1** (celle de la colonne gauche, largeur 0 quand les colonnes sont masquées) : le
   disque disparaîtrait. D'où `grid-area` / `grid-column` sur les cinq enfants concernés,
   qui ne dépendent plus de l'ordre d'écriture du balisage.
2. **Le bouton du micro ne doit pas changer de camp.** Sans `grid-area: 2 / 2`, il tomberait
   en rangée 2, colonne 1 — sous la colonne de gauche. Il reste sous le disque, et le
   `gap: 32px` de rangée fait exactement l'écart actuel.
3. **La rangée 2 n'existe que si ce bouton est visible.** Quand il est `hidden` il sort de la
   grille, `1fr` prend toute la hauteur et `min(--vocal-orb-box, 100 %)` donne 512 px ; quand
   il est affiché, la rangée 1 tombe à 480 px. Aucune règle ne dépend d'un état lu en
   JavaScript.

**Pourquoi `padding: 0 16px`** — le jour vertical venait du `padding: 16px` du `flex` actuel.
Avec des colonnes de la hauteur exacte de la boîte du disque, ces 16 px de haut et de bas
auraient coûté 32 px de trop : à `100vh = 801px`, la hauteur où le disque atteint son
plafond, les colonnes auraient été coupées en bas. Le centrage (`align-items: center`) donne
déjà l'air vertical ; les 16 px horizontaux restent (marge de l'écran).

La taille du disque ne dépend **pas** du CSS du lot : `--vocal-orb-size` et `--vocal-crown`
sont **déjà** posés dans le bloc de jetons de l'écran ; le lot 1 les **lit**. Il ajoute **un
seul** jeton dérivé, au même endroit et à côté d'eux — jamais une valeur en dur :

```css
--vocal-orb-box: calc(var(--vocal-orb-size) + 2 * var(--vocal-crown));
```

Un jeton dérivé n'est pas un réglage : il n'apparaît dans aucune interface, il ne peut pas
diverger du disque, et il évite que trois règles recopient `+ 2 × couronne` (trois occasions
de se tromper).

### 2.3 Le nom (décision 5)

Le nom affiché passe par `superAgentDisplayLabel()` — **déjà** la règle unique
(personnage → nom réglé → « Assistant »). Le lot 1 ajoute **un** écrivain,
`applyVocalPortrait()` :

- écrit `img.src` **seulement s'il change** (comparer avant d'écrire : réaffecter le même
  `src` relance le chargement) ;
- écrit `nameEl.textContent = superAgentDisplayLabel()` et pose `title` + `aria-label` sur
  le **texte** (le nom entier) ;
- cache (`hidden`) l'image **et** la pastille quand `getAssistantPortrait()` est vide — **aucun
  repli sur le logo dans la colonne** (révision : sans personnage, il n'y a pas d'image, et la
  liste prend toute la hauteur) ;
- **n'appelle jamais `invoke`** : la lecture est faite par `refreshAssistantPersona`
  (existante) et l'état vit en mémoire.

`applyAssistantPersonaUi()` (existante) appelle `applyVocalPortrait()` à côté de
`applyVocalRestartLabel()` — c'est le même point d'application, donc le portrait suit un
changement de personnage sans aucun mécanisme nouveau.

**Le bouton de relance garde son texte actuel, centré**, sans `justify-content: flex-end`
ni `padding-bottom`: la pastille a quitté le bouton, rien d'autre n'y change. **Conséquence
sur les tests : `ecran-vocal-bouton-relance.test.js` ne change pas d'une ligne.**

### 2.4 Fichiers, symboles, tests du lot 1

| Fichier | Ce qui change |
|---|---|
| `src/js/vocal-sides.js` (**nouveau, pur**) | `VOCAL_SIDE_MIN_PX = 240`, `VOCAL_SIDE_MAX_PX = 320`, `VOCAL_SIDE_WIDE_MAX_PX = 400`, `VOCAL_SIDE_WIDE_AT_PX = 1600`, `VOCAL_SIDE_GAP_PX = 24`, `VOCAL_SIDE_PAD_PX = 16`, `VOCAL_PORTRAIT_PX = 72`, `VOCAL_TASK_PX = 46`, `VOCAL_TASK_HEADER_PX = 20`, `VOCAL_SIDE_FIXED_PX = 170`, `VOCAL_ORB_BOX_RATIO = 1 + 2 × 88 / 336` (la même règle que le jeton CSS, une seule fois côté JS) ; `planVocalSides({ width, height, orbSize, hasPortrait })` → `{ track, shown, columnHeight, listHeight }` — `columnHeight` est la hauteur de la colonne (`H`, l'ancien `listHeight` du test 10), `listHeight` la place laissée à la liste (`H − 170` avec un personnage, `H − 72` sans — révision du 2026-10-29, voir `CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md` § 2.5). Aucun DOM, aucun `import` Tauri. |
| `src/js/super-agent.js` | `buildVocalOverlay()` (+ les deux `<aside>`, + `<img class="vocal-portrait" alt="">`, + `<span class="vocal-portrait-name">`, + `<div class="vocal-side-body">`) ; `applyVocalPortrait()` (nouveau) ; `applyAssistantPersonaUi()` (+1 appel) ; `vocalSyncSides()` (nouveau : seul point d'écriture de `--vocal-side` et de la classe `vocal-sides-off`, via `planVocalSides`, appelé à l'entrée **et** sur `resize`) ; `enterVocal()` (+ `vocalSyncSides()` en **dernière** ligne, + `addEventListener("resize", vocalSyncSides)`) ; `exitVocal()` (+ `removeEventListener` du **même** nom de fonction, dans le `try` du démontage) |
| `src/css/style.css` | `.vocal-stage` (grille, `grid-template-rows`, `column-gap`), `.vocal-stage.vocal-sides-off` + ses deux repos de `grid-column`, `.vocal-stage > .vocal-orb` et `.vocal-stage > .vocal-mic-fix` (`grid-area`), `.vocal-side`, `.vocal-side-discussion`, `.vocal-side-tasks`, `.vocal-side-body`, `.vocal-portrait`, `.vocal-portrait-name` |
| `src/js/ecran-vocal-lot2.test.js` | liste ordonnée : **+5** entrées (§ 2.1) ; compte de `</div>` de la scène : **2 → 4** |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` | les mêmes deux changements, aux mêmes endroits |
| `src/js/vocal-sides.test.js` (**nouveau**) | T10 |
| `src/js/ecran-vocal-portrait.test.js` (**nouveau**) | T9, T16, T17 |

### 2.5 Tests créés au lot 1 (numérotation du premier jet, conservée)

| # | Nom | Ce qu'il vérifie | Il échoue si… |
|---|---|---|---|
| **9** | « le portrait est un médaillon **au pied** de la colonne de droite, pas du disque » | `.vocal-portrait` existe, il est **dans** `.vocal-side-tasks`, **après** `vocal-side-body`, il n'est **pas** dans `.vocal-orb` ; le CSS pose `72px` et `border-radius: 50%` ; la source est `getAssistantPortrait()` **sans repli** (`src` n'est jamais `/logo_pilot_vector.svg`) ; le nom est écrit par `superAgentDisplayLabel()` ; la pastille suit le portrait | le portrait revient dans le cercle, remonte en haut, se replie sur le logo, ou un second mécanisme de nom apparaît |
| **10** | « la largeur des colonnes » | `planVocalSides` : 384 px jusqu'à 1600, 400 px à 1920 et au-delà, 0 en dessous de 240 d'`avail`, jamais plus grand qu'`avail`, 24 px de jour, 16 px de marge ; `columnHeight = min(orbSize × 1,5238, height − 289)` et `shown` conformes aux colonnes « `H` » et « Colonnes » du tableau § 3.2 — **les onze lignes** | une des lignes du tableau § 3.2 dévie d'un pixel, ou une colonne de 512 px est posée sur une fenêtre de 480 px de haut |
| **16** | « aucune écriture, aucune trace » | le lot n'écrit ni fichier, ni `localStorage`, ni config : `vocal-sides.js` ne contient ni `invoke`, ni `localStorage`, ni `fetch` ; `super-agent.js` n'écrit l'état des colonnes nulle part | un état persiste après la sortie |
| **17** | « la sortie de l'écran reste cliquable » | `.vocal-side` porte `pointer-events: none` et ne contient **aucun** nœud focusable (`button`, `a`, `[tabindex]`) ; `.vocal-top`, `.vocal-stage`, `.vocal-status`, `.vocal-input`, `#mode-logo`, `#agent-activity` portent `pointer-events: auto` et sont **exactement six** ; `onVocalKeydown` gère toujours Échap | un seul des trois chemins de sortie cesse d'être joignable |

---

## 3. LOT 2 — les tâches, la ligne d'activité et le bouton

**Ce que l'utilisateur voit à la fin du lot 2** : les tâches du projet **en haut à droite**
(en cours d'abord, en attente ensuite) — **que le personnage soit actif ou non** —, le
portrait sous elles quand il existe, puis une ligne qui dit ce que fait l'agent à cet
instant ; et, sous le logo, le bouton translucide qui affiche ou retire les colonnes.

### 3.1 Le calcul de la largeur (une seule formule, pure)

```
avail   = floor((W − orb − 2 × 24 − 2 × 16) / 2)
nominal = W ≤ 1600 ? 320 : min(400, 320 + round((W − 1600) / 4))
track   = avail < 240 ? 0 : min(nominal, avail)
H       = min(orb + 2 × couronne, 100vh − 289)      // hauteur des colonnes
```
- `orb` = `--vocal-orb-size` : **le disque**, jamais la boîte du halo (la couronne est hors
  flux, elle ne prend pas de place — elle passe sous les colonnes, § 1.5) ;
- 24 px de jour de chaque côté du disque, 16 px de marge de chaque côté de l'écran ;
- **Le seuil est 240, et il vaut 240 dans les deux sens.** Les deux colonnes doivent
  pouvoir contenir ce qu'elles ont à dire : `72 (portrait) + 6 + 20 (nom) + 14 + 14 (titre)
  + 14 + 20 (en-tête de groupe) + 46 (une tâche) + 12 + 18 (ligne d'activité) = 236 px`,
  arrondis à **240**. En largeur, 240 px donnent 33 caractères à 13 px, soit une ligne de
  texte lisible et pas un mot par ligne. C'est le même nombre des deux côtés, donc le
  seuil de la décision 7 (`avail ≥ 240`) n'a pas besoin d'un second seuil pour être
  cohé­rent : quand les colonnes apparaissent, elles tiennent déjà une tâche (§ 3.2, ligne
  720 × 520 : `H = 231`, il reste 61 px de liste).
- **`track = 0` ⇒ colonnes absentes** (`hidden` sur les deux `<aside>`) **et la grille
  repasse à une seule piste** (`.vocal-sides-off`, § 2.2) : sans ça, les deux asides sortis
  de la grille laisseraient le disque dans la première piste, de largeur 0 — aucun `gap`
  fantôme non plus, une grille à une piste n'a pas de `column-gap`.
- Au-dessus de 1600 px, chaque colonne gagne **0,25 px** par pixel de fenêtre : la moitié
  de la largeur ajoutée va aux deux colonnes, l'autre moitié aux jours et aux marges, de
  sorte que **le disque reste exactement au centre** (une répartition 50/50 l'aurait
  décentré visuellement).
- Plafond 400 px : 52 caractères à 15 px. Au-delà, l'aperçu cesse d'être un aperçu et
  devient une colonne de lecture qui dispute le regard au disque ; 400 px est atteint à
  1920 px de fenêtre, la largeur la plus courante des grands écrans, ce qui fait du
  plafond une valeur **atteinte**, pas théorique.

### 3.2 Le tableau des largeurs (rejoué, chaque ligne est un cas de test)

| Fenêtre | disque | boîte | `H` | `avail` | `track` | Colonnes | Tâches | Lignes de discussion |
|---|---|---|---|---|---|---|---|---|
| 640 × 480 | 125,3 | 301,3 | 191 | 217 | **0** | absentes | — | — |
| 720 × 520 | 151,6 | 327,6 | 231 | **244** | 244 | présentes | 1 | 5 |
| 768 × 576 | 188,3 | 364,3 | 287 | 249 | 249 | présentes | 1 | 7 |
| 820 × 620 | 217,2 | 393,2 | 331 | 261 | 261 | présentes | 2 | 8 |
| 896 × 672 | 251,3 | 427,3 | 383 | 282 | 282 | présentes | 3 | 9 |
| 1024 × 768 | 314,3 | 490,3 | 479 | 314 | 314 | présentes | 5 | 12 |
| 1280 × 800 | 335,3 | 511,3 | 511 | 432 | 320 | présentes | 6 | 13 |
| 1440 × 900 | 336 | 512 | 512 | 512 | 320 | présentes | 6 | 13 |
| 1600 × 900 | 336 | 512 | 512 | 592 | 320 | présentes | 6 | 13 |
| 1920 × 1080 | 336 | 512 | 512 | 752 | **400** | présentes | 6 | 13 |
| 2560 × 1440 | 336 | 512 | 512 | 1072 | 400 (plafond) | présentes | 6 | 13 |

La colonne `H` est **la hauteur réellement disponible**, et ce n'est pas la boîte :
`min(boîte, 100vh − 289)` — à 640 × 480 la boîte vaudrait 301 px alors que la scène n'en
offre que 191 (les couronnes du halo débordent verticalement, elles sont décoratives et
hors flux). C'est `H` qui décide du nombre de tâches et de lignes, jamais `track` : à 320 px
on lit 42 caractères par ligne, à 400 px on en lit 52 — **on gagne des caractères, pas des
lignes**.

`--vocal-orb-size = clamp(120px, (100vh − 289px) × 21 / 32, 336px)` : 289 px = 36 (bande
des onglets) + 44 (barre) + 80 (ligne d'état) + 60 (saisie) + 69 (respirations), et 21/32
est le rapport qui fait tenir le disque et ses couronnes dans la hauteur restante. Ces deux
nombres **existent déjà** : le lot les lit, il ne les recalcule pas.

### 3.3 Les tâches (décision 2) — une seule source

La colonne ne recalcule **rien** : `collectSuperMissions()` est **extraite** de
`publishSuperMissionsCount()` (`src/js/super-agent.js`), qui devient son premier
consommateur (le compteur du bouton « Travail »), `vocalSyncSides()` le second. Le calcul
reste **un seul** : `buildRunningMissions(activity.list, queued)` puis `splitMissions()`,
donc les groupes « En cours (n) » / « En attente (n) » et l'ordre de la file sont
**identiques** au volet et au bouton — le bouton ne peut pas contredire la colonne.

- **Ordre** : `splitMissions().running` puis `.waiting` — l'ordre d'origine (celui de la
  file) est conservé à l'intérieur de chaque groupe. On n'inverse jamais les deux groupes.
- **Une tâche** : `missionWho(m)` (11 px) + `m.mission` (13 px, une ligne, ellipse).
  Réutilisation de l'existant ; aucun nouveau libellé.
- **Plafond** : `VOCAL_TASKS_MAX = 6` **quand un personnage est actif** (le portrait est lui
  aussi une information : la colonne ne devient pas un mur de texte) ; **8 quand aucun
  personnage n'est actif** — ce n'est pas un chiffre choisi : c'est exactement ce que la place
  permet à hauteur maximale (`floor((440 − 40) / 46) = 8`). Sans ce relèvement, **124 px**
  resteraient vides sous une liste qui pourrait les remplir (révision du 2026-10-29).
  Répartition **par groupe** (2 groupes × la moitié,
  l'excédent d'un groupe passant à l'autre) : 3 + 3 au cas A, 4 + 4 au cas B ; l'excédent est dit
  par une ligne « + N autre(s) » (11 px, même gris que les métadonnées).
- **Budget**, avec `H = min(--vocal-orb-box, 100 %)` (la hauteur du § 3.2). Le total fixe est
  le **même** dans les deux cas, seul son **ordre** change (révision : titre, tâches, portrait,
  pastille, ligne d'activité) :
  - **cas A (personnage actif)** :
    `listeH = H − 14 (marge) − 14 (titre) − 14 (marge) − 72 (portrait) − 6 (gap) − 20 (pastille) − 12 (gap) − 18 (ligne d'activité)`,
    soit `listeH = H − 170` ;
  - **cas B (aucun personnage)** : mêmes termes, **moins** le portrait, son écart et la
    pastille : soit **`listeH = H − 72`**. La liste gagne **exactement les 98 px** du bloc
    portrait, et **rien n'est réservé** à sa place.
  - une tâche vaut 18 (titre) + 16 (contexte) + 4 (écart interne)
  + 8 (écart entre tâches) = **46 px**, un en-tête de groupe 20 px.
  - `lignes = clamp(1, floor((listeH − 2 × 20) / 46), plafond)` tant que `listeH ≥ 2 × 20 + 46`
  - **en dessous, les en-têtes de groupe disparaissent** (`listeH < 86`) et
    `lignes = clamp(1, floor(listeH / 46), 2)`. C'est le seul repli, et il ne touche **pas
    l'ordre** — la seule chose que la décision 2 impose (en cours d'abord, puis en attente).
    Le contexte de chaque tâche dit déjà qui et depuis quand.
  - `H = 512` : **cas A** `listeH = 342`, `floor(302 / 46) = 6` → **3 + 3** ; **cas B**
    `listeH = 440`, `floor(400 / 46) = 8` (le plafond) → **4 + 4**.
  - `H = 479` (fenêtre de 768 px de haut) : **A** `listeH = 309`, `floor(269 / 46) = 5` → **3 + 2** ;
    **B** `listeH = 407`, `floor(367 / 46) = 7` → **4 + 3**.
  - `H = 480` (bouton du micro affiché, fenêtre haute) : **A** `floor(270 / 46) = 5` → **3 + 2** ;
    **B** `floor(368 / 46) = 8` (le plafond) → **4 + 4**.
  - `H = 231` (le plus petit `H` où les colonnes s'affichent, 720 × 520) : **A** `listeH = 61`,
    en-têtes retirés, `floor(61 / 46) = 1` → **1** ; **B** `listeH = 159`, en-têtes retirés,
    `floor(159 / 46) = 3` mais plafond sans en-tête de **2** → **2**. Jamais zéro : une colonne qui n'affiche
    aucune tâche alors que des missions tournent serait un mensonge silencieux.
  - Le nombre de **caractères** par ligne suit la largeur : `floor((track − 22) / 7,6)` → **47** car.
    à 384 px (largeur nominale depuis le 2026-11-02), **52** à 400 px, **34** à 282 px, **29** à 249 px.
- **Liste vide** : la colonne garde son titre en haut et, **s'il y a un personnage**, le portrait
  **au pied** ; **entre les deux**, à la place de la liste, une
  ligne « Aucune tâche en cours » (11 px, gris). La colonne n'est donc jamais vide — ce qui
  compte pour le seuil des 240 px, **pas** pour le bouton d'affichage : depuis la révision du
  2026-10-29, celui-ci est toujours proposé, parce que sa portée dépasse les colonnes (§ 6.4).

### 3.4 La ligne d'activité (décision 2) — une ligne, jamais deux

`vocalNowLine(missions)` (pure, dans `vocal-sides.js`), priorité **stricte** :

| Cas | La ligne |
|---|---|
| 1 mission en cours, un **outil** tourne | « *agent* exécute une opération » |
| 1 mission en cours, pas d'outil | « *agent* réfléchit » |
| n > 1 en cours | « n agents travaillent — *agent* exécute une opération » |
| 0 en cours, ≥ 1 en démarrage | « Démarrage de n mission(s) » |
| 0 en cours, ≥ 1 en attente | « n mission(s) en attente » |
| rien | « Tout est au repos » |

- La distinction « outil en cours » / « pas d'outil » **existe déjà** (`toolInProgress`,
  distinct de `busy` : un outil long et silencieux garde `busy` faux). Pour que la colonne
  y ait accès, `buildRunningMissions` reçoit un champ **additif** `toolInProgress: true`
  — posé **seulement** s'il vaut vrai, exactement comme le champ `since` existant. Forme
  historique préservée : **aucune assertion de `agent-activity.test.js` ne change** (les
  `toEqual` de forme portent sur des agents dont `toolInProgress` est faux).
- La ligne **ne nomme jamais un outil** : le nom de l'outil n'est pas dans la supervision,
  et l'inventer (le lire dans le DOM de l'onglet) serait un second mécanisme. Elle dit le
  **fait**, pas le détail.
- Elle ne dit **jamais** « rien » par une ligne absente : une ligne qui vient et s'en va
  ferait sauter la liste. « Tout est au repos » est une information, pas un vide.
- Elle ne **double** pas la ligne d'état de l'écran : celle du bas dit ce que fait **Pilot**
  (l'écran, la voix), celle-ci dit ce que font les **agents du projet**. Deux sujets, deux
  lignes, deux places.

### 3.5 Le point d'écriture (un seul)

`vocalSyncSides()` est **le seul** endroit qui écrit : la largeur (`--vocal-side`), la
visibilité des deux colonnes (`hidden`), et le contenu des colonnes. Appelé par :

1. la **dernière** ligne de `enterVocal()` ;
2. `setInterval(vocalSyncSides, VOCAL_SIDES_TICK_MS = 900 ms)` — assez frais pour qu'une
   tâche qui démarre apparaisse, assez lent pour ne pas relire la supervision dix fois par
   seconde (la sonde d'activité existante tourne déjà à son propre rythme : ce tick ne fait
   que **recopier** un store déjà à jour) ;
3. l'écouteur `resize` de la fenêtre (une seule écriture, pas de `requestAnimationFrame`).

`exitVocal()` **annule la minuterie et retire l'écouteur** — même patron que tout ce qui
sort de l'écran ; sans ça, la colonne continuerait d'écrire dans un overlay démonté.

### 3.6 Fichiers, symboles, tests du lot 2

| Fichier | Ce qui change |
|---|---|
| `src/js/vocal-sides.js` | `vocalTaskRows(listHeight)`, `vocalTasksView`, `vocalNowLine`, `VOCAL_TASKS_MAX`, `VOCAL_TASK_PX = 46`, `VOCAL_TASK_HEADER_PX = 20`, `VOCAL_SIDES_TICK_MS`, `VOCAL_TASK_GROUP_*` (réutilise les libellés de `agent-activity.js`). **Plus** de `vocalSideToggleVisible` ni de `vocalSideToggleTitle` : le bouton ne dépend plus de la largeur et son libellé est une icône (révision du 2026-10-29, § 6.4) |
| `src/js/agent-activity.js` | `buildRunningMissions` : champ **additif** `toolInProgress` (seulement si vrai) ; export de `missionWho` si absent |
| `src/js/super-agent.js` | `collectSuperMissions()` (extrait de `publishSuperMissionsCount`) ; `vocalSyncSides()` étendu (tâches + ligne d'activité) ; `buildVocalDisplayToggle()` + `vocalSyncBare()` (le bouton d'affichage, § 6.4/§ 6.7 — **hors** de `vocalSyncSides`, qui ne le commande pas) ; `buildVocalOverlay()` (+ l'ajout du bouton **dans** `.vocal-top`, après le modèle) ; `enterVocal()` (+ minuterie, + écouteur, + remise à « tout visible ») ; `vocalSyncChrome()` (+ le terme `!vocalBare &&`) ; `exitVocal()` (+ nettoyage) |
| `src/css/style.css` | `.vocal-display-toggle` (tableau des états du § 6.4) et le bloc `.pilot-vocal.vocal-bare …` (§ 6.7), `.vocal-tasks-title`, `.vocal-task*`, `.vocal-side-more`, `.vocal-side-empty`, `.vocal-now`, et les deux jetons `--vocal-veil`, `--vocal-ink-soft` (§ 5.3) |
| `src/js/ecran-vocal-lot2.test.js` | **aucune** ligne pour le bouton : il n'est pas dans le modèle (§ 2.1) |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` | idem : aucune ligne pour le bouton |
| `src/js/vocal-sides.test.js` | T11, T12 (les fonctions pures : **`planVocalSides` → `columnHeight` et `listHeight`** — deux valeurs distinctement nommées, la seconde dépendant de `hasPortrait` —, `vocalTaskRows`, ordre des groupes, plafond 6 / 8) |
| `src/js/vocal-colonnes-taches.test.js` (**nouveau**) | T13, T15 (le rendu dans le DOM : une ligne d'activité, une seule source de missions) |
| `src/js/ecran-vocal-bouton-affichage.test.js` (**nouveau**) | T14, réécrit par la révision du 2026-10-29 (§ 6.9) |
| `spec_modes_ecran_vocal.md` | § 3ter et **§ 4ter** (l'état nu : tout masquer sauf le portrait, un seul bouton-œil, aucune mémorisation), marqués **non livrés** à la révision du 2026-10-29 — et une phrase de renvoi en § 3 et en § 8 |
| `help/overview.md` (bloc `<!-- HELP:modes-ecran -->`) | deux lignes : « les tâches en haut à droite, le portrait en dessous », « le petit œil en haut de l'écran masque tout sauf le visage, un clic le remet » ; puis `npm run build:handbook`. **Aussi** : `spec_modes_ecran_vocal.md` § 3ter et § 4ter, marqués non livrés (révision du 2026-10-29) |

| # | Nom | Ce qu'il vérifie | Il échoue si… |
|---|---|---|---|
| **11** | « les colonnes ont la hauteur du disque et pas une de plus » | `.vocal-side { height: min(var(--vocal-orb-box), 100%); overflow: hidden }` ; `.vocal-orb` est en `grid-area: 1 / 2` et `.vocal-mic-fix` en `grid-area: 2 / 2` (ni l'un ni l'autre dans une colonne) ; aucune des deux colonnes ne contient `position: absolute; inset: 0` ; `columnHeight = min(orbSize × 1,5238, height − 289)` reproduit la colonne `H` du tableau § 3.2 | une colonne recouvre la ligne d'état ou la saisie, le bouton du micro change de camp, ou `columnHeight` contredit `H` |
| **12** | « les tâches : en cours d'abord, en attente ensuite » | `vocalTasksView` rend le groupe « En cours (n) » avant « En attente (n) », l'ordre de la file est conservé, **le nombre de lignes suit `vocalTaskRows(listHeight)`** (**6 au plus avec un personnage, 8 sans**, 1 au moins, en-têtes retirés sous `listHeight < 86`), « + N autre(s) » au-delà | l'ordre s'inverse, une tâche est inventée, une tâche est perdue sans le dire, le plafond du cas A est dépassé, ou le nombre de lignes ne suit pas la hauteur |
| **13** | « la ligne d'activité » | les six cas du tableau § 3.4, **une** seule ligne, jamais vide, jamais le nom d'un outil, jamais la même phrase que `vocalStatusText` | la ligne est vide, multiple, ou duplique la ligne d'état |
| **14** | « le bouton d'affichage » | enfant de `.vocal-top`, `aria-pressed` vrai/faux, infobulle « état puis action », icône `eye` / `eye-off` à taille fixe, **jamais** `disabled` ni `hidden` (même sans colonnes), **remis à vrai à chaque entrée**, et le bloc `.vocal-bare` ne nomme **jamais** le portrait (§ 6.4, § 6.9) | le bouton ment sur l'état, disparaît, ou masque le personnage |
| **15** | « une seule source pour les tâches » | `collectSuperMissions` est appelée par `publishSuperMissionsCount` **et** par `vocalSyncSides` ; `vocalSyncSides` n'appelle **pas** `buildRunningMissions` directement | deux calculs de missions divergent (le bouton et la colonne se contredisent) |

---

## 4. LOT 3 — la discussion, et l'interdit levé

**Ce que l'utilisateur voit à la fin du lot 3** : à gauche du disque, les derniers échanges
de la conversation — ses propres questions en petit et en gris, les réponses en plus gros —
qui remontent du bas. **La spec et l'aide changent dans ce lot, et dans ce lot seulement.**

### 4.1 Ce que l'interdit disait, et ce qu'il devient

| Aujourd'hui (`spec_modes_ecran_vocal.md` § 3, `help/overview.md`) | Après le lot 3 |
|---|---|
| « Rien de la conversation n'y est affiché (aucun message, pas même en petit). » | « La conversation n'est **jamais déplacée** dans l'écran : elle reste dans l'onglet. L'écran en montre un **aperçu** dans la colonne de gauche, et **seulement** là : aucun nœud de conversation n'est copié, l'aperçu est du texte recopié à la lecture. » |
| Le test `ecran-vocal-nu.test.js` interdit le retour de la conversation | **inchangé et toujours vert** : il vérifie que `enterVocal()` ne contient ni `innerHTML`, ni `textContent`, ni `messagesEl`. L'aperçu est écrit par `vocalSyncSides()`, une autre fonction. |
| `body.pilot-vocal-active .agent-chat-messages { visibility: hidden }` | **inchangé** : la conversation reste cachée (`visibility`, jamais `display:none`, pour ne pas perdre le défilement). L'aperçu est un **reflet** d'un nœud invisible, pas le nœud. |

La doctrine est donc **isolée dans le lot 3** : le lot 1 et le lot 2 ne touchent ni la spec
ni l'aide sur ce point, et peuvent être livrés sans qu'aucune phrase de documentation ne
devienne fausse.

### 4.2 Les deux mesures de texte (décision 3)

| | Question de l'utilisateur | Réponse de l'Assistant |
|---|---|---|
| Taille | **13 px** (`--font-base` — décision 3 : « en plus petit ») | **15 px** (`--font-zone`) |
| Couleur | **gris** : `--vocal-ink-soft` (§ 5.3) | `--text-primary` |
| Lignes | **2** | **8** |
| Alignement | à gauche, `padding-inline-start: 12px` | à gauche, `padding-inline-start: 0` |
| Ordre | chronologique, du plus ancien (haut) au plus récent (bas) | idem |

- **2 lignes pour la question** : une question tient en une phrase ; au-delà de deux lignes
  ce n'est plus une question mais un brief, et la colonne est un aperçu — le texte complet
  est à un clic, dans la conversation.
- **8 lignes pour la réponse** : 8 × 23 = 184 px, soit **36 % de la hauteur maximale de
  colonne** (512 px). Le budget réel est `lignes = floor((H − 14) / 37)` (28 px de titre et
  de marge en haut, 23 px de ligne, 14 px d'écart entre messages) : **13** à `H = 512`
  (et à 511), **12** à 479, **9** à 383, **8** à 331, **7** à 287, **5** à 231 — ce sont les
  hauteurs du tableau § 3.2, et le calcul s'y rejoue. Un échange (question 2 lignes +
  réponse 8 lignes) vaut 10 lignes : une colonne haute en montre **un**, une colonne de
  331 px et plus en montre **deux**. C'est voulu : la colonne est le rappel de ce qui vient
  d'être dit, pas un journal. `VOCAL_DISCUSSION_MAX_MESSAGES = 6` borne la **lecture** du
  DOM (3 échanges), pas l'affichage, et `vocalExcerpt()` coupe ce qui dépasse le budget.
- La coupe se fait **sur une frontière de mot** (`vocalExcerpt`) et **jamais dans un mot**
  (même règle que `cutTextAtBoundary` de `speech-text.js`, qui est le précédent du projet).
- L'excédent est dit : `.vocal-side-more` → « … et N échange(s) plus haut » (11 px). Une
  coupe muette serait un mensonge.
- `charsPerLine = floor((track − 22) / 7,6)` : 47 caractères à 384 px (largeur nominale
depuis le 2026-11-02), 34 à 282 px, 52 à 400 px.
  C'est ce chiffre qui **fixe** le nombre de lignes coupées, pas une constante cachée.
- **Une seule famille de messages** est lue : `.agent-message-user` / `.agent-message-assistant`
  de l'onglet (les classes existantes, `agent-pi.js`) ; les messages système, les blocs
  d'outils, les réflexions (`agent-thinking*`, `agent-tool-inline`) **ne sont pas** repris —
  un aperçu, pas un journal technique.

### 4.3 Fichiers, symboles, tests du lot 3

| Fichier | Ce qui change |
|---|---|
| `src/js/vocal-sides.js` | `vocalDiscussionView`, `vocalExcerpt`, `vocalSideClipped`, `VOCAL_DISCUSSION_MAX_MESSAGES = 6`, `VOCAL_DISCUSSION_LINE_H = 23`, `VOCAL_DISCUSSION_GAP = 14` |
| `src/js/super-agent.js` | `collectVocalDiscussion()` (lecture **seule** du DOM de l'onglet, aucun nœud déplacé) ; `vocalSyncSides()` : écrit la colonne gauche |
| `src/css/style.css` | `.vocal-side-discussion` (masque dégradé en haut), `.vocal-msg`, `.vocal-msg-user`, `.vocal-msg-assistant`, `.vocal-side-more` |
| `src/js/vocal-colonne-discussion.test.js` (**nouveau**) | T1 à T8 |
| `src/js/ecran-vocal-nu.test.js` | **aucune** modification — il doit rester vert tel quel |
| `spec_modes_ecran_vocal.md` | § 3 (« écran nu ») et § 4bis : la phrase du tableau § 4.1, rien de plus |
| `help/overview.md` | bloc `<!-- HELP:modes-ecran -->` : « les derniers échanges s'affichent à gauche, en aperçu » ; puis `npm run build:handbook` |

| # | Nom | Ce qu'il vérifie |
|---|---|---|
| **1** | « les questions de l'utilisateur sont dans la colonne » | une question de l'onglet apparaît dans la colonne, en 13 px, gris, deux lignes au plus |
| **2** | « les réponses sont dans la colonne » | 15 px, `--text-primary`, huit lignes au plus |
| **3** | « l'ordre est chronologique et le plus récent est en bas » | deux messages de suite, puis un troisième : l'ordre est conservé |
| **4** | « la coupe tombe sur un mot » | jamais de mot tranché, ellipse ou phrase dite avant la coupe |
| **5** | « rien n'est déplacé » | `collectVocalDiscussion` ne fait que lire (`querySelectorAll`, `textContent`) : aucun `appendChild`, `innerHTML`, `remove` |
| **6** | « le dégradé est en haut » | `.vocal-side-discussion` porte son masque côté haut (le contenu remonte du bas) |
| **7** | « six messages au plus, et l'excédent est dit » | `VOCAL_DISCUSSION_MAX_MESSAGES = 6` ; « … et N échange(s) plus haut » |
| **8** | « une seule source » | `vocalSyncSides` ne lit pas `messagesEl` directement : il appelle `collectVocalDiscussion()` |

---

## 5. Contraintes non négociables (les trois lots les respectent)

### 5.1 Les six hôtes cliquables — la liste ne bouge pas

`.vocal-top`, `.vocal-stage`, `.vocal-status`, `.vocal-input`, `#mode-logo`, `#agent-activity`
(issue #381). **Six, et six seulement.** Les colonnes n'en ajoutent aucun : elles sont
`pointer-events: none`, sans nœud focusable. Le bouton d'affichage (l'œil, § 6.4) n'est
**pas** un septième hôte — il est **dans** `.vocal-top`, qui est déjà cliquable ; il n'a
besoin que de `pointer-events: auto` **sur lui-même**. Il en va de même du bouton
« Informations » du premier jet, qu'il remplace : même hôte, même permission. Les tâches ne
sont **pas** cliquables : la surface cliquable du travail reste le bouton « Travail ».

### 5.2 Les sorties

Trois, et les trois restent intactes : le **logo** (bouton des modes), **Échap**
(`onVocalKeydown`), la **fermeture de l'onglet**. Aucun des trois n'est déplacé par ce
document ; `onVocalKeydown` n'est **pas** modifié. T17 le prouve.

### 5.3 Les jetons — deux ajouts, aucun réglage

| Jeton | Valeur | Pourquoi |
|---|---|---|
| `--vocal-side` | posé par `vocalSyncSides()` (JavaScript), lu par le CSS | une seule source de la largeur |
| `--vocal-veil` | `color-mix(in srgb, var(--bg-app) 50%, transparent)` | le voile des colonnes : 50 % du fond de l'application, donc la moitié de la lumière du halo traverse. **50 % et pas 30 %** : à 30 % le texte passe sous 4,5:1 ; **50 % et pas 70 %** : à 70 % on ne voit plus la lumière derrière le texte et la colonne devient un panneau. |
| `--vocal-ink-soft` | `color-mix(in srgb, var(--text-primary) 85%, var(--bg-app))` | **le gris** des colonnes (questions, titres, métadonnées). Aucune couleur en dur : il suit les **dix** palettes. **85 % et pas 80 %** : à 80 % la marge n'est que de 0,02 au-dessus de 4,5:1 dans One Dark — le bruit d'arrondi ; à 85 % elle est de 0,42 et le gris reste franchement distinct du texte plein. Mesuré : 4,92:1 au pire (One Dark, derrière la lumière de la couronne), 7,32:1 en Pilot sombre, 7,97:1 en Pilot clair. |

Deux palettes (Solarized Light 4,13:1, Tokyo Night Day 4,52:1) n'atteignent pas AA **pour
leur propre texte principal**, partout dans l'application, depuis bien avant ce travail :
la colonne hérite de leur limite et n'ajoute aucun défaut qui lui soit propre.

**Aucun réglage nouveau** : ni `localStorage`, ni fichier, ni entrée de config, ni case à
cocher, ni curseur. L'état des colonnes (affichées ou non) vit **en mémoire** et repart à
« affichées » à chaque entrée.

### 5.4 Mouvement et lisibilité

- `prefers-reduced-motion` s'applique : **aucune** animation propre aux colonnes. Elles
  apparaissent, elles disparaissent, elles ne glissent pas.
- Les deux colonnes **ne réagissent pas** au survol : pas de `:hover` qui changerait leur
  fond (elles ne sont pas cliquables, un retour visuel promettrait une action).
- `user-select: none` sur les colonnes : on ne sélectionne pas un aperçu.

### 5.5 Aucun écran redessiné, aucun nœud de conversation déplacé

Le balisage des colonnes est **ajouté** à `buildVocalOverlay()` ; le disque, la ligne
d'état, la saisie, le bouton de relance et le bouton du micro ne changent pas. La
conversation de l'onglet n'est **jamais** déplacée : `collectVocalDiscussion()` la **lit**.

---

## 6. L'affichage : tout masquer d'un geste, tout remettre du même geste

### 6.1 Ce que cette section remplace, et au nom de quoi

Le premier jet de ce document prévoyait un bouton « **Informations** » qui affichait ou
retirait **les deux colonnes**, et qui **disparaissait** (`hidden`) quand la fenêtre était
trop étroite pour les tenir. Le 2026-10-29, le propriétaire a élargi l'exigence :
**tout ce que l'écran Vocal affiche, sauf le portrait lui-même, doit pouvoir être masqué
puis remis** par un petit bouton discret.

Cette section remplace ce premier jet. **Trois** choses changent :

| | Premier jet | Ce document |
|---|---|---|
| **Portée** | les deux colonnes | **tout, sauf le personnage** (§ 6.3) |
| **Libellé** | le mot « Informations » + icône `info` | **icône seule** (`eye` / `eye-off`) ; le sens est dans l'infobulle (§ 6.4) |
| **Quand le bouton existe** | `hidden` dès que `track = 0` | **toujours présent dans l'écran Vocal, et là seulement** : ce qu'il commande existe même quand les colonnes ne tiennent pas (§ 6.4) |

Tout le reste du premier jet est **conservé** : sa place (enfant de `.vocal-top`), sa taille,
son fond translucide, `aria-pressed`, l'infobulle qui dit l'état puis l'action, l'absence
d'`aria-controls`, l'absence de réglage et de persistance, `z-index: 1`, les quatre formes
interdites.

Deux choses ne changent **pas** et ne doivent pas changer : **le personnage n'est jamais
masqué** (§ 6.3), et **les trois sorties restent les trois sorties** (§ 6.8).

### 6.2 L'inventaire : ce que l'écran affiche, et ce qui se masque

Nœud par nœud — la colonne « se masque » est la **décision**, pas une constatation.

| # | Ce qu'on voit | Où (source) | Se masque ? |
|---|---|---|---|
| 1 | La barre de 44 px du haut, son filet et son fond | `style.css` `.vocal-top` | **son fond et son filet seulement** — sa place et le bouton restent |
| 2 | Le bouton d'affichage (nouveau) | `.vocal-top` (enfant) | **jamais** |
| 3 | Le logo — le bouton des trois modes | `body.pilot-vocal-active #mode-logo` | **jamais** (c'est une sortie) |
| 4 | Le bouton « Travail » | `body.pilot-vocal-active #agent-activity` | **jamais** (c'est un accès) |
| 5 | Le disque | `.vocal-orb` | **oui** |
| 6 | L'enveloppe de parole et l'arc de réflexion | `.vocal-orb::before`, `.vocal-orb::after` | **oui**, avec le disque |
| 7 | La couronne lumineuse | `.vocal-halo` (dans le disque) | **oui**, avec le disque |
| 8 | Le bouton « Réveiller *Nom* » | `.vocal-restart` (dans le disque) | **oui**, avec le disque |
| 9 | La ligne d'état | `.vocal-status` | **oui** (elle s'efface déjà seule au repos — `spec_modes_ecran_vocal.md` § 4bis) |
| 10 | La barre de saisie (champ, micro, envoi) | `.vocal-input` | **oui** |
| 11 | Le bouton « Autoriser le micro » | `.vocal-mic-fix` | **oui** |
| 12 | La colonne de discussion (titre + aperçu) — à venir | `.vocal-side-discussion` | **oui** |
| 13 | La colonne des tâches (titre, lignes, ligne d'activité) — à venir | `.vocal-side-tasks` | **oui** |
| 14 | **Le portrait et la pastille de son nom** — à venir | `.vocal-portrait`, `.vocal-portrait-name` | **NON — la seule exception** |
| 15 | Les trois boutons système de la fenêtre | hors de l'overlay, `z-index: 100001` | jamais |
| 16 | Le fond de l'écran | `.pilot-vocal` `background: var(--bg-app)` | reste — c'est le fond, il n'y a rien à masquer là |

Deux chiffres à retenir. Les lignes 5 à 11, ce sont **sept nœuds** qui disparaissent ensemble.
Les lignes 12 et 13 n'existent pas encore, mais le CSS qui les nomme est **déjà** écrit
(§ 6.7) pour que le lot qui les livre n'ait pas à y revenir.

### 6.3 Ce qui se masque ensemble, ce qui ne se masque jamais

**Tout se masque ensemble. Un seul geste, un seul état.** Il n'y a **pas** de masquage
séparé — ni des colonnes seules, ni du bas seul — pour quatre raisons, dans l'ordre :

1. **Une seule question à poser à l'utilisateur.** « Je veux voir Pilot, ou seulement son
   visage. » Deux boutons voisins obligeraient à essayer l'un, puis l'autre, puis les deux :
   c'est un réglage déguisé, et ce document n'en ajoute aucun (§ 5.3).
2. **Le bas a déjà son effacement.** La ligne d'état et la saisie s'effacent seules au bout
   de 2,5 s (`spec_modes_ecran_vocal.md` § 4bis, `vocal-chrome.js`). Un second effacement, manuel, des mêmes nœuds
   donnerait deux mécanismes pour un seul effet — et deux façons de ne pas comprendre
   pourquoi le champ a disparu.
3. **Les colonnes n'ont pas de bouton propre.** Leur disparition suit la place disponible et
   le fait qu'elles aient quelque chose à dire. Elles n'ont jamais eu d'interrupteur séparé
   dans le premier jet, et elles n'en ont pas davantage ici.
4. **Masquer une seule colonne décentrerait le disque.** Le jour des colonnes
   (`column-gap: 24px`) est réservé par la grille : une piste vide se voit, la scène se
   décale de la moitié de sa largeur. Les lignes 5 à 11 et 12 à 13 disparaissent donc du
   **même** geste, sinon le disque saute.

Une seule exception, et ce n'est pas un masquage séparé : **le personnage ne se masque
jamais** (ligne 14). C'est la demande du propriétaire, et elle a un sens : quand tout
disparaît, il reste **quelqu'un**. Le portrait n'est pas une information sur le travail, il
est la présence de l'assistant ; le retirer ne laisserait qu'un écran vide avec un bouton.

Et deux choses ne se masquent pas non plus, pour une raison différente : **les sorties**
(le logo, ligne 3) et **l'accès au travail** (le bouton « Travail », ligne 4). Une porte
qu'on ne peut plus voir n'est pas une porte : masquer le logo supprimerait un des trois
moyens de sortir du mode, et masquer « Travail » cacherait ce que l'onglet Assistant sert à
montrer.

**Cas particulier, et il est voulu** : s'il n'y a **aucun personnage** (aucun fichier
portrait), l'état « tout masqué » ne laisse que le bouton. Ce n'est pas un écran cassé,
c'est l'état le plus nu possible — et le bouton y devient la seule chose à voir, donc la
plus facile à trouver.

### 6.4 Le bouton : place, taille, apparence, état, infobulle

**Dans quels écrans.** Ce bouton n'existe **que** dans l'écran Vocal. Les modes « Détaillé » et
« Assistant seul » n'ont pas de disque à sauver : y masquer tout ne laisserait qu'un écran
vide, et leur équivalent est déjà le logo-bouton des trois modes — un second bouton y serait
une commande de plus pour un geste qui a déjà sa porte.

**Place.** Enfant de `.vocal-top`, jamais de l'overlay : il suit la barre, il ne peut pas
dériver si la barre bouge, et il **n'ajoute aucun hôte** (§ 5.1 — `.vocal-top` est déjà
cliquable, le bouton n'a besoin que de `pointer-events: auto` sur lui-même).

- `.vocal-top` reçoit `position: relative` ; aucun enfant absolu n'y est posé aujourd'hui,
  donc rien ne bouge.
- `position: absolute; top: 10px; left: 50%; transform: translateX(-50%)` → la bande
  **46 → 70 px** de l'écran (36 px de bande de fenêtre + 10 px), donc **dans** `.vocal-top`
  (36 → 80) et 10 px au-dessus de son bord bas.
- **Il ne peut pas recouvrir les deux autres commandes de la bande.** Le logo occupe
  13 → 41 px en horizontal et 8 → 36 px en vertical ; le bouton « Travail » occupe la même
  bande verticale (7 → 29 px) contre le bord droit, à 6 px des boutons système, larges de
  142 px. Le nouveau bouton est **centré** et ne monte pas au-dessus de 46 px. À la largeur
  minimale de la fenêtre (800 px), son bord gauche est à **386 px**, le bord gauche du
  bouton « Travail » à **548 px** : **162 px d'air**, et 345 px jusqu'au logo. Aucun
  recouvrement n'est possible à aucune largeur prévue.
- `z-index: 1` (le logo est à `2`) : si les deux se touchaient un jour, **la sortie gagne**.
- Les **quatre formes interdites** pour ce bouton : `position: fixed`, `inset: 0`,
  `z-index ≥ 2`, être focusable sans fonction (il a une fonction : il est donc focusable, et
  c'est voulu — il se commande au clavier).

**Taille.** 28 × 24 px, icône **seule** de 14 px (`icon-sm`), centrée. 24 px est la plus
petite cible qui reste confortable (WCAG 2.2 §2.5.8 demande 24 × 24) ; 28 px de large donnent
7 px d'air de chaque côté de l'icône. La hauteur de 24 px laisse 10 px au-dessus et 10 px
au-dessous dans la barre de 44 px : le bouton **flotte** dans la bande, il ne la remplit pas.
**La taille ne change jamais** d'un état à l'autre : l'icône est remplacée dans un bouton de
taille fixe, donc **le point de clic ne bouge pas** sous le doigt.

**Apparence.** Icône seule, `--text-secondary`, fond
`color-mix(in srgb, var(--bg-elevated) 70%, transparent)`, bordure
`1px solid var(--border-subtle)`, rayon 999 px. Il **ne prend jamais** de couleur d'état
`--vocal-*` : ce n'est pas un état de la voix. À l'état « tout masqué », il devient la seule
chose de la bande : son fond passe à 100 % de `--bg-elevated` et une ombre `--shadow-sm`
apparaît — **trouvable sans crier**, sans jamais devenir un bouton criard.

**Pourquoi une icône seule, sans le mot « Informations ».** Le mot décrivait les colonnes ;
le bouton ne commande plus les colonnes. Le remplacer par « Affichage » serait un mot de plus
dans une barre qui n'en porte aucun, pour une action qui n'a besoin que d'un symbole et d'une
infobulle. L'icône de Lucide **déjà disponible** dans le projet fait le travail : `eye` quand
tout est visible, `eye-off` quand tout est masqué — la même paire que dans tous les logiciels,
aucune légende à apprendre. Elle est posée par `setIcon()` (`src/js/icons.js`), à 14 px, avec
le mécanisme existant : **aucune dépendance nouvelle, aucune icône à dessiner**.

**Les deux libellés, mot pour mot.** L'infobulle (`title`) et l'`aria-label` portent la même
phrase, l'**état d'abord**, l'**action ensuite** :

| État | `title` **et** `aria-label` |
|---|---|
| tout visible | « tout est visible — cliquer pour ne garder que le portrait » |
| tout masqué | « tout est masqué — cliquer pour tout réafficher » |

Le mot est **« le portrait »**, jamais « le personnage » : c'est plus court dans une
infobulle, et « personnage » désigne l'entité du carnet — deux mots pour deux choses, aucune
confusion à lever à la lecture.

### 6.5 Ce qui reste toujours visible quand tout est masqué

Trois choses, dans cet ordre d'importance :

1. **Le personnage** (portrait + pastille de son nom), s'il existe. Il ne bouge pas d'un
   pixel : à l'état masqué, sa place est conservée (§ 6.7). C'est le point fixe de l'écran.
2. **Le bouton d'affichage**, seul moyen de tout réafficher. Il garde `pointer-events: auto`
   et reste focusable : on le trouve à la souris comme au clavier (`Tab`, puis `Entrée`).
3. **Les trois sorties et l'accès au travail** : le logo, la croix de l'onglet, le bouton
   « Travail ». À vrai dire ce ne sont pas des éléments de l'écran nu — ce sont des
   commandes posées **au-dessus** de lui, que l'état nu ne touche pas.

Ce qui reste à l'écran, en plus : **le fond** (la couleur de l'application) et, dans la bande
du haut, **rien d'autre que le bouton** — la barre perd son fond et son filet, elle n'est plus
une barre, seulement l'endroit où le bouton se pose.

Et si le personnage manque : **le bouton, et c'est tout** (§ 6.3, cas particulier). C'est
l'état voulu, et le disque ne reste **pas** pour tenir compagnie au bouton : un disque sans
personnage est déjà muet, le laisser contredirait « tout masquer » et créerait un état nu à
deux vitesses — avec un visage, et sans.

### 6.6 La mémorisation : aucune, et c'est un choix

**L'écran revient toujours « tout visible ». Rien n'est mémorisé.** Ni `localStorage`, ni
fichier, ni entrée de configuration, ni case à cocher. Le booléen vit **en mémoire** et il est
remis à « tout visible » dans `enterVocal()`, à côté de la remise à `true` des colonnes.

Trois raisons, et la première suffit :

1. **L'écran Vocal est un mode, pas une préférence.** On y entre pour parler à Pilot. Entrer
   dans un écran **vide**, sans disque et sans champ, pour découvrir qu'un geste d'hier l'a
   laissé ainsi, c'est le défaut classique du mode qu'on ne comprend plus.
2. **La valeur la plus utile est « tout visible ».** L'état masqué est un geste de confort —
   « laisse-moi juste voir le visage » —, pas une façon de travailler. Un geste de confort se
   refait ; il ne se retient pas.
3. **Un réglage de plus serait un réglage de trop.** Ce document n'en ajoute aucun (§ 5.3) ;
   mémoriser l'état serait exactement cela, sous un autre nom.

**Ce qui ne se réinitialise pas en cours de route** : l'état masqué tient tant qu'on reste dans
l'écran — il survit au changement de projet, au redimensionnement de la fenêtre, à l'arrivée
d'une réponse, au début et à la fin d'une lecture, et à l'effacement automatique du bas.
**Une seule chose le fait tomber** : sortir du mode. À la rentrée suivante, tout est visible.

**Et Échap ?** Échap **sort** du mode (§ 6.8, troisième sortie). Il ne « réaffiche » pas : un
utilisateur qui veut réafficher a le bouton, sous la main.

### 6.7 Le patron de masquage : une classe, rien d'autre

Une **seule** classe d'état sur l'overlay : **`vocal-bare`**. Elle n'a **aucun rapport** avec
`vocal-chrome-hidden` (`spec_modes_ecran_vocal.md` § 4bis), qui garde son rôle, ses trois nœuds et son CSS : les deux
classes peuvent être posées en même temps, elles ne se contredisent pas.

| Ce que fait `vocal-bare` | Comment | Pourquoi pas autrement |
|---|---|---|
| retire les nœuds de la vue | `opacity: 0` puis `visibility: hidden` (retardée de 180 ms) | `display: none` **interdit** : il retirerait la place réservée, la scène se réorganiserait et **le personnage sauterait**. C'est la règle déjà écrite pour le bas, appliquée ici pour la même raison. |
| rend les clics inoffensifs | `pointer-events: none` sur chaque nœud masqué | un nœud invisible qui reçoit encore un clic est un piège (le bouton « Réveiller » relancerait l'écoute sans qu'on voie ce qu'on touche). `visibility: hidden` le retire aussi du parcours clavier. |
| ne déplace rien | aucune règle de `margin`, `padding`, `height`, `position` | le disque et le portrait restent **exactement** où ils étaient ; le retour ne les fait pas sauter |
| garde le bouton utilisable | `.vocal-bare .vocal-top .vocal-display-toggle { opacity: 1; visibility: visible; pointer-events: auto }` | exception **nommée**, à côté de la règle qui masque — jamais une exception implicite |
| garde le portrait visible | `.vocal-portrait` et `.vocal-portrait-name` **ne sont pas nommés** par le bloc | la règle la plus sûre est l'absence de règle : on ne peut pas masquer par erreur ce qu'on n'a pas écrit |
| efface l'aspect de la barre | `background: transparent; border-color: transparent` sur `.vocal-top` | la bande de 44 px reste (elle porte le bouton) mais ne se voit plus comme une barre |

**Un seul écrivain** : `vocalSyncBare()` (`super-agent.js`), appelée par le **clic** et par
`enterVocal()` (remise à « tout visible »). Elle pose ou retire `vocal-bare`, remplace l'icône
et l'infobulle, pose `aria-pressed`, puis appelle `vocalSyncChrome()` — parce que l'effacement
du bas dépend désormais du mode nu. **Aucun `setInterval`, aucun écouteur, aucun minuteur**
propre : un clic, un appel, une écriture.

**Mouvement** : le même que le bas — `opacity` et `visibility 0s linear 180ms`, et **aucune
translation** (le disque ne doit pas glisser, il doit s'éteindre). En mouvement réduit
(`prefers-reduced-motion` ou `_pilotModalAnimations`), `transition: none` : l'extinction est
instantanée.

**Ces 180 ms ne deviennent jamais un instantané.** Un écran qui s'éteint d'un coup se lit
comme un bug, pas comme un geste : le fondu dit qu'une chose vient de se ranger du regard, il
ne dit pas que l'affichage a sauté.

**Le bas qui s'efface et le mode nu ne se battent pas.** `vocalSyncChrome()` calcule :

```js
const visible = !vocalBare && (vocalChromeTimer !== 0 || vocalChromeVisible(faits));
```

Un seul terme ajouté, **à un seul endroit**. Conséquence : à l'état nu, le minuteur de 2,5 s
ne peut plus rallumer le bas (sinon bouger la souris ferait revenir la saisie dans un écran
qu'on vient de vider). `src/js/vocal-chrome.js` **ne change pas d'une ligne** — ses quatre
règles, ses trois constantes et sa correspondance unique restent intactes, et ses quatre
tests ne bougent pas d'une assertion. **Et `applyVocalState` ne bouge pas non plus** : c'est
`vocalSyncChrome` qui lit le mode nu, pas l'appelant.

**Pourquoi c'est permis à un geste et pas à l'automatique.** Le § 4bis de
`spec_modes_ecran_vocal.md` dit « le cercle ne disparaît jamais ». C'est vrai de l'effacement **automatique** : la machine ne retire pas ce
qu'on regarde sans qu'on l'ait demandé. Un geste **explicite** (« ne garde que le visage »)
est autre chose : l'utilisateur demande, l'écran obéit, et le bouton pour revenir est à
l'endroit exact où il vient de cliquer. La phrase du § 4bis de la spec garde donc son domaine, et ce
document ne la rouvre pas.

### 6.8 Les règles fermes, une par une

| Règle ferme | Ce que l'état nu en fait |
|---|---|
| **Le bouton des modes est le logo** | Intact, à sa place (`top: 8px; left: 13px`), **jamais masqué, jamais déplacé**, et toujours au-dessus de l'overlay. Le nouveau bouton ne l'approche pas : 345 px d'air au pire cas (§ 6.4). Aucun `#screen-mode-button` n'est réintroduit. |
| **La barre du bas s'efface au repos** | Conservée telle quelle. Le mode nu **s'ajoute** par-dessus (`!vocalBare`, § 6.7) : à l'état nu, le bas ne revient plus, même au geste. La classe et ses trois nœuds sont inchangés ; aucun test de `vocal-chrome-masque.test.js` ne bouge. |
| **Trois sorties** (logo, Échap, fermeture de l'onglet) | Les trois restent, aucune n'est masquée ni déplacée. `onVocalKeydown` n'est **pas** modifié : Échap sort du mode, même à l'état nu. La croix de l'onglet reste atteignable parce que `.pilot-vocal` garde `pointer-events: none` (§ 6.9). |
| **Aucun clic avalé par un calque** | C'est le point le plus dangereux, et il a sa section (§ 6.9). En un mot : rien ne redevient cliquable sauf les six hôtes et le bouton, et aucun nœud masqué ne prend la place d'un autre. |

### 6.9 Aucun clic avalé : la vérification, en trois points

L'issue #381 a déjà coûté une correction parce que l'overlay avalait le clic de la croix
d'onglet. Trois points, mesurables :

1. **`.pilot-vocal` reste `pointer-events: none`.** L'état nu ne lui rend **jamais** de
   pointeur : il ne devient pas une surface cliquable. Rien n'est ajouté à la liste des six
   hôtes (§ 5.1) : le bouton est **dans** `.vocal-top`, qui en est déjà un.
2. **Un nœud masqué ne reçoit rien.** `visibility: hidden` + `pointer-events: none` : le clic
   traverse la scène vide et tombe sur le fond de l'overlay, qui ne fait rien — ou sur la
   croix d'onglet, dans la bande des 36 px du haut, que l'état nu ne touche pas.
3. **Le bouton, lui, reçoit.** Il est le seul nœud de la scène à garder `pointer-events: auto`
   et `visibility: visible`. Sans cette ligne, l'écran nu serait un cul-de-sac ; avec elle, la
   sortie est à un clic.

**Le test qui tient cela** : à l'état nu, `document.elementFromPoint()` au centre de la croix
rend la croix, et au centre du bouton rend le bouton. Deux appels, deux identités, aucune
supposition.

### 6.10 Ce qui change dans les tests

**Aucune ligne des tests existants ne change pour ce bouton.** C'est un résultat, pas une
chance, et il tient à une décision de balisage :

- `ecran-vocal-lot2.test.js` exige que le modèle contienne **exactement**
  `'<div class="vocal-top"></div>'` — « la barre de 44 px ne porte rien ». Cette chaîne reste
  intacte : le bouton est **ajouté après** le modèle, par `buildVocalDisplayToggle()`, de la
  même façon que le libellé du bouton de relance est posé après coup
  (`applyVocalRestartLabel`). Le modèle dit la structure, la fonction dit l'état.
- La **liste ordonnée des classes** de `buildVocalOverlay` (`ecran-vocal-lot2.test.js`,
  `vocal-halo-128-et-etat-au-dessus-saisie.test.js`, `bouton-travail-ecran-vocal.test.js`)
  **ne gagne donc aucune entrée** : le balisage du bouton n'est pas dans le modèle. Le
  « +1 entrée » que prévoyait le premier jet (§ 3.6, T14) **disparaît** de la liste des
  changements.
- `vocal-chrome-masque.test.js` et `ecran-vocal-nu.test.js` découpent le bloc **de
  `vocal-chrome-hidden`** et vérifient qu'il ne nomme ni le disque ni la barre : le bloc
  `vocal-bare` est **séparé**, et ces tests restent verts sans retouche.

Un test **nouveau** couvre le bouton : `src/js/ecran-vocal-bouton-affichage.test.js` (il
remplace le `ecran-vocal-bouton-informations.test.js` du premier jet, qui n'a jamais été
écrit). Il vérifie, dans cet ordre :

1. le bouton est un enfant de `.vocal-top`, et le modèle garde `<div class="vocal-top"></div>` ;
2. `aria-pressed` vaut `true` quand tout est visible, `false` quand tout est masqué ;
3. l'infobulle et `aria-label` disent **l'état puis l'action**, et changent avec l'état ;
4. l'icône passe de `eye` à `eye-off` (et retour) et **la taille du bouton ne change pas** ;
5. le bouton n'est **jamais** `hidden` ni `disabled` — y compris quand `track = 0` ;
6. le bloc `vocal-bare` **ne nomme pas** `.vocal-portrait` ni `.vocal-portrait-name` ;
7. le bloc `vocal-bare` nomme bien le disque, le bouton du micro, la ligne d'état, la saisie
   et les deux colonnes ;
8. le bloc `vocal-bare` ne contient **ni** `display: none`, **ni** de règle `height`,
   `margin`, `padding` ou `position` ;
9. `vocalSyncChrome` contient le terme `!vocalBare &&` ;
10. `enterVocal()` remet le booléen à « tout visible » **avant** `vocalSyncSides()` ;
11. le code du bouton ne contient **ni** `localStorage`, **ni** `invoke`, **ni** `fetch`.

### 6.11 À l'œil

1. Entrer dans le mode Vocal : tout est là, l'icône est un œil ouvert.
2. Cliquer le bouton : la scène s'éteint en 180 ms, **le portrait ne bouge pas d'un pixel**,
   l'icône devient un œil barré, l'infobulle dit « tout est masqué ».
3. Attendre 5 s et bouger la souris : **rien ne revient** (le minuteur du bas ne rallume plus
   rien).
4. Cliquer le bouton : tout revient à sa place, sans saut, l'icône redevient un œil ouvert.
5. Masquer, puis `Tab` : le focus trouve le bouton (et le logo), jamais un nœud invisible.
6. Masquer, puis cliquer la croix de l'onglet : l'onglet se ferme (aucun clic avalé).
7. Masquer, puis `Échap` : on sort du mode. Rentrer : **tout est visible**.
8. Réduire la fenêtre à 800 × 500, masquer : le bouton reste atteignable et le portrait reste
   à sa place.

---

## 7. La source du portrait (réutilisée, **sans repli dans la colonne**)

| Question | Réponse — et il n'y en a pas d'autre |
|---|---|
| D'où vient l'image ? | `getAssistantPortrait()` (`src/js/assistant-persona.js`), qui lit le personnage **déjà** chargé en mémoire par `refreshAssistantPersona()` (commande Rust `read_assistant_persona`, fichiers `<données Pilot>/.pilot/portrait/nom.txt` et `portrait.png`). |
| Qui lit le disque ? | **Personne de nouveau** : `vocal-sides.js` est pur, `applyVocalPortrait()` ne fait que **lire l'état en mémoire**. |
| Le repli ? | **Aucun dans la colonne** (révision du 2026-10-29) : `src` **ne reçoit jamais** `/logo_pilot_vector.svg`. Sans portrait affichable, l'image et la pastille sont **`hidden`** et **aucune hauteur n'est réservée** (98 px rendus à la liste). Le repli sur le logo reste vrai là où il était décidé : l'écran d'accueil de l'Assistant (`mark.src = getAssistantPortrait() \|\| "/logo_pilot_vector.svg"`). Aucun portrait « générique » n'est fabriqué. |
| Fichier absent ? | Aucun message, aucune exception : **aucune image dans la colonne** (cas B), et le nom du personnage reste lisible sur le bouton de relance du cercle (« Réveiller *Nom* », `spec_modes_ecran_vocal.md` § 3bis). Une icône d'image cassée serait une zone morte avec un symbole d'erreur dedans : jamais. |
| Le nom ? | `superAgentDisplayLabel()` — personnage → nom réglé → « Assistant ». Un seul mécanisme (§ 2.3). |
| Pilot écrit-il dans `.pilot/portrait/` ? | **Jamais.** Pilot lit ; le dossier est déposé par le projet Présences. Aucun `write`, aucun `create_dir`, aucun nettoyage. |
| Et si le portrait change pendant que l'écran est ouvert ? | `applyAssistantPersonaUi()` (déjà appelée au retour de focus de la fenêtre) réapplique le portrait ; `applyVocalPortrait()` ne réécrit `src` que s'il a changé. |

---

## 7bis. La zone d'image : trois cas, dans cet ordre (complément du 2026-10-29)

> **Décision du propriétaire, mot pour mot** : « **si un personnage est activé, son image
> occupe la zone** ; **sinon, si l'avatar du visage (PLface) est activé, c'est l'avatar qui
> s'affiche dans la zone d'image prévue** ; **sinon, la liste des tâches occupe toute la
> hauteur**, comme déjà tranché. »
>
> Ce complément ne rouvre **aucune** décision prise : le bouton des modes **est le logo**, le
> bas s'efface au repos, il y a **trois** sorties (le logo, Échap, la fermeture de l'onglet),
> **aucun** calque ne capte les clics (les **six** hôtes de T17), le personnage reste au
> **pied** de la colonne, le médaillon reste **rond de 72 px**, et il n'ajoute **ni réglage**,
> **ni persistance**, **ni minuterie**, **ni nœud de balisage**.

### 7bis.1 Où est la zone, et ce que veut dire « en haut à droite »

> **Correction du 2026-10-31 (décision du propriétaire) — « en haut à droite » se lit
> littéralement.** Ce paragraphe disait que l'image restait **au pied** de la colonne et
> n'exprimait « en haut à droite » qu'en hauteurs. **C'est faux aujourd'hui** : le
> propriétaire veut voir le personnage **en haut à droite de l'écran**, la liste des tâches
> **en dessous**, et le **disque totalement vide** (la mission « écran Vocal » du 2026-10-30,
> qui mettait l'image **au centre du cercle**, est **annulée**). Le portrait est donc le
> **premier contenu** de `.vocal-side-tasks`, dans le flux (`align-self: center`), suivi de son
> nom puis de la liste — plus aucune position absolue, plus aucun `offsetBottom`.

Le propriétaire nomme la zone d'image « **en haut à droite** ». « À droite » est la **colonne
du travail** (`.vocal-side-tasks`) ; « en haut » est **le haut de cette colonne**, au-dessus
de la liste. Les trois phrases du propriétaire ne se contredisent plus : la **colonne de
droite** commence à la ligne du disque, et la seconde moitié de sa phrase — « la liste des
tâches occupe toute la hauteur » — décrit le **cas 3**, quand aucune image n'est disponible.

### 7bis.2 Les trois cas, et le **fait** qui décide de chacun

| Cas | Le fait qui décide — jamais un réglage | Ce qui remplit la zone |
|---|---|---|
| **1** — un personnage | un portrait **affichable** est en mémoire : `getAssistantPortrait() !== ""` (`src/js/assistant-persona.js`, rempli par `refreshAssistantPersona()` → `read_assistant_persona`). **Critère inchangé** (§ 7). | le **médaillon rond de 72 px** et la pastille du nom (20 px). Rien de neuf. |
| **2** — l'avatar | **pas** de portrait affichable **et** l'avatar **répond** : `invoke("plface_status")` (`src-tauri/src/lib.rs:2363`) — exactement la sonde que l'écran Paramètres → Avatar interroge déjà (`src/js/settings.js:2295`) — **et** sa taille est connue (§ 7bis.5). | la **fenêtre de l'avatar**, posée dans la zone. **Pilot ne dessine rien** (§ 7bis.3). |
| **3** — rien | ni l'un, ni l'autre. | **rien** : la liste prend toute la hauteur, aucun espace réservé (décision déjà prise). |

> **« Activé » ne veut pas dire « une case cochée ».** Pilot n'a **pas** de réglage « avatar
> activé » : il a `plface_autostart_enabled` (« lancer au démarrage ») et il **sonde** si
> l'avatar tourne (`plface_status`, affiché tel quel par `plfaceStateMessage`). Le mot du
> propriétaire se traduit donc par le **fait observable** — « il répond » — et **non** par une
> case à ajouter. Ce complément **n'ajoute aucune case** : la règle du projet est qu'on
> n'invente pas de réglage.

**Un seul ordre, un seul haut.** Les trois cas partagent le même ancrage :

- **l'ordre est fixé une fois pour toutes** : titre « TÂCHES » → **le portrait et son nom** →
  **la zone d'image** → **la liste**. Le portrait est **dans le flux**, en premier ; la zone
  d'image est inerte, sans forme, et ne prend de place que dans le cas 2 ; la liste absorbe
  l'air qui reste ;
- **le médaillon est centré** dans la colonne (`align-self: center`, 72 px) ; il n'y a plus
  d'`offsetX` à calculer, puisqu'aucune position absolue n'est posée ;
- seule la **hauteur réservée** change : **98 px** pour le bloc du personnage (72 + 6 + 20),
  **0 px** (cas 3), **180 px** (cas 2).

**Le contrat, en une ligne** — un seul endroit décide, pour qu'il n'y ait jamais deux
vérités à synchroniser :

```
planVocalSides({ width, height, orbSize, hasPortrait, hasAvatar })
  → { track, shown, columnHeight, listHeight, imageZone }
imageZone = { kind: "portrait" | "avatar" | "none", width, height, offsetX, offsetBottom }
```

C'est le **seul** ajout à la signature du lot 1 (§ 2.4) ; les quatre premières valeurs gardent
leur sens et leurs chiffres. `imageZone` est en pixels **CSS** et **relatifs à la colonne** :
la conversion en coordonnées d'écran est faite au § 7bis.5, à un seul endroit.

### 7bis.3 La forme : un rond pour une image, **aucune forme** pour l'avatar

| Cas | Forme | Pourquoi |
|---|---|---|
| 1 | **cercle de 72 px** (`border-radius: 50%`) | inchangé : c'est le médaillon de la révision du 2026-10-29 |
| 2 | **aucune** : ni cadre, ni fond, ni ombre, ni rond, ni anneau. La zone ne dessine **rien**. | 1. **une fenêtre d'un autre processus ne se découpe pas** : le CSS de Pilot ne peut pas arrondir la fenêtre de PLface ; un cadre rond autour d'une fenêtre carrée montrerait le carré. 2. **c'est ce que dit l'écran nu** : pas de boîte autour de l'assistant. Une **image** (un portrait) se présente dans un médaillon ; un **être vivant** se tient debout, sans cadre. La fenêtre de PLface est déjà **sans cadre, transparente, sans ombre** (`app/src-tauri/tauri.conf.json` : `decorations: false`, `transparent: true`, `shadow: false`, `alwaysOnTop: true`) : posée là, elle ne montre **que** l'avatar. |

**C'est cette absence de dessin qui règle le repli (§ 7bis.7)** : une place réservée qui ne
dessine rien ne peut **pas** ressembler à un trou. Un cadre, lui, en ferait un dès que
l'avatar manque ; c'est précisément ce que la révision du 2026-10-29 a supprimé pour le
portrait (aucun repli sur le logo), et la même règle vaut ici.

### 7bis.4 Le budget de hauteur, et les sept fenêtres

> **RÉVISION DU 2026-11-02 — LES CHIFFRES DE CE § 7bis.4 SONT PÉRIMÉS, LA SPÉCIFICATION FAIT FOI.**
> Trois remarques du propriétaire ont changé le budget, et **aucun** des nombres ci-dessous
> (72 px de médaillon, blocs de 98 / 170 / 252 / 356 px, colonne de 51 px sans air) n'est plus
> celui du code. Ce qui a changé :
>
> - **le médaillon est mesuré, plus figé** : `vocalPortraitSize` le choisit entre un plancher de
>   **96 px** et une cible de **288 px** (trois fois le plancher), en respectant la place dans le
>   cadre et **deux en-têtes + deux rangées** garantis à la liste (132 px). Le bloc du personnage
>   vaut **`taille + 52`** (148 px au plancher, **329 px** dans une grande fenêtre, médaillon
>   **277 px** = 2,89 × le plancher ; 288 n'est jamais atteint, voir la spec) ;
> - **le contenu ne touche plus le cadre** : **12 px d'air** en bas des deux colonnes
>   (`padding-block-end`) et **12 px** au-dessus du médaillon (`margin-block-start`), tous deux
>   **comptés** dans le budget — l'en-tête de la colonne de gauche passe de 14 à **26 px** ;
> - **le fond du panneau de droite s'éteint en état nu**, avec son cadre et son flou.
>
> Les nombres applicables, la table des sept fenêtres et leurs verrous vivent désormais dans
> **`spec_modes_ecran_vocal.md`** § 3ter (« La taille du médaillon » et « La transparence qu'on
> voit »). Le présent document garde la **conception** — l'ordre des cas, l'arbitrage, la forme —
> et l'histoire des décisions ; il ne fait plus référence pour un chiffre.


La décomposition est **celle de la révision** (§ 2.5 de
`CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md`), recopiée sans un chiffre de plus :

```
cas 1 + 2 : listH = H − 14 − 14 − 14 − 180 − 6 − 72 − 6 − 20 − 12 − 18 = H − 356
cas 1 seul: listH = H − 14 − 14 − 14        − 72 − 6 − 20 − 12 − 18 = H − 170
cas 2 seul: listH = H − 14 − 14 − 14 − 180                    − 12 − 18 = H − 252
cas 3     : listH = H − 14 − 14 − 14                          − 12 − 18 = H −   72
```

**180 px pour l'avatar, et pas autre chose** : c'est **exactement** le plancher de la fenêtre
de PLface (`minWidth: 160`, `minHeight: 180`, `app/src-tauri/tauri.conf.json`) ; 160 × 180 est
donc la **plus petite** place que l'avatar puisse occuper, c'est-à-dire le **coût minimal**
pour la liste. Aucun chiffre n'est choisi ici : il est **mesuré** sur l'autre projet — et il
n'est **pas** modifiable par Pilot (§ 7bis.5).

**Le plafond suit la place**, comme pour les deux cas déjà écrits (§ 2.5) :

- **cas 2 : 4** — ce n'est pas un chiffre choisi : c'est **exactement** ce que la place permet
  à la hauteur maximale (`floor((260 − 40) / 46) = 4`) ;
- **cas 1 + 2 : 2** — même règle (`floor((156 − 40) / 46) = 2`) ;
- cas 1 : **6** et cas 3 : **8** — inchangés.

**La zone n'existe que si la liste garde au moins une ligne** : `listH ≥ 46`, le même seuil
que « une colonne n'est jamais un trou » (§ 2.6 de l'amendement). Pour le cas 2, cela veut
dire **`H ≥ 298`**, c'est-à-dire à partir de **820 × 620** ; en dessous, c'est le cas 3 :
aucune place réservée, l'avatar reste où il est et **n'est pas déplacé**.

| Fenêtre | `H` | cas 1 : `listH` | lig. | **cas 2 : `listH`** | **lig.** | cas 3 : `listH` | lig. | cas 1+2 : `listH` | lig. |
|---|---|---|---|---|---|---|---|---|---|
| 720 × 520 | 231 | 61 | 1 | **−21** | **0** | 159 | 2 | — | 0 |
| 768 × 576 | 287 | 117 | 1 | **35** | **0** | 215 | 3 | — | 0 |
| 820 × 620 | 331 | 161 | 2 | **79** | **1** | 259 | 4 | — | 0 |
| 896 × 672 | 383 | 213 | 3 | **131** | **1** | 311 | 5 | — | 0 |
| 1024 × 768 | 479 | 309 | 5 | **227** | **4** | 407 | 7 | 123 | **1** |
| 1280 × 800 | 511 | 341 | 6 | **259** | **4** | 439 | 8 | 155 | **2** |
| 1440 × 900 et au-delà | 512 | 342 | 6 | **260** | **4** | 440 | 8 | 156 | **2** |

*(« — » : la zone n'existe pas ; « 0 » : elle n'est pas dessinée, la liste garde la hauteur du
cas 3.)*

Lecture honnête du tableau : **aux deux plus petites fenêtres, un avatar ne s'affiche pas** —
il coûterait plus que la place disponible. À 820 × 620 et 896 × 672 il laisse **une** ligne de
tâche ; à partir de 1024 × 768, **quatre**. C'est le prix assumé de la priorité donnée par le
propriétaire (« si l'avatar est activé, c'est lui qui s'affiche »), et il n'y a **rien à
régler** : c'est la place qui décide, pas une préférence.

### 7bis.5 « Peut-on demander à l'avatar de s'ouvrir à une position et une taille voulues ? »

Question posée telle quelle, réponse mesurée dans le code de l'avatar (`G:\IA_PL\PLface`),
jamais dans une intention :

| Question | Réponse | Preuve |
|---|---|---|
| **Poser** l'avatar à une position voulue | **Oui, aujourd'hui.** `GET /set_position?x=&y=` | `app/src-tauri/src/api.rs:153-160` (`handle_set_position` → `window.set_position(PhysicalPosition::new(x, y))`), route `:203`, `struct PositionParams { x: i32, y: i32 }` `:64-67`. Côté Pilot, **déjà branché** : `src/js/face-gateway.js:46` et l'outil `set_position` de `src-tauri/extensions/pilot-face.ts:78-93`. |
| **Imposer une taille** | **Non, aujourd'hui.** | Le routeur n'expose **aucune** route de taille : les 14 routes sont `/`, `/status`, `/emotion`, huit raccourcis d'humeur, `/move`, `/set_position`, `/close` (`api.rs:191-204`). La taille se règle **dans la page de PLface** (`app/src/main.js:92` `setSize`, `:513` `setSize(PhysicalSize)`) ou à la souris ; son plancher est `minWidth: 160` / `minHeight: 180`. |
| **Lire** sa position ou sa taille | **Non.** | `/status` renvoie une phrase **fixe** (`api.rs:106-115` : « PLface 3D API running. Endpoints: … ») ; aucune route de lecture. Pilot ne peut donc **ni vérifier** où est l'avatar, **ni** lui rendre sa place d'avant. |
| Ce qu'il faudrait — **une** chose | que `/set_position` accepte `w` et `h` **facultatifs** et les **renvoie** dans sa réponse | le corps de la route est déjà l'appel Tauri que PLface emploie lui-même (`window.set_size`, `app/src/main.js:513`) : rien d'autre n'est nécessaire |
| Pourquoi Pilot ne force pas la taille lui-même | redimensionner la fenêtre d'un **autre** processus demande une API **par plateforme** (Windows `SetWindowPos` ; macOS sans équivalent sans autorisation Accessibilité ; Linux selon le gestionnaire de fenêtres) : **les trois plateformes ne seraient pas couvertes** | règle du projet : tout doit fonctionner sur les trois systèmes |
| Ce que l'utilisateur voit de la fenêtre | **rien** : `decorations: false`, `transparent: true`, `shadow: false`, `alwaysOnTop: true` | `app/src-tauri/tauri.conf.json` |

**La règle de conversion, en deux lignes** — et c'est la seule chose à écrire :

```
x_écran = round(x_fenêtre + x_css × facteur)
y_écran = round(y_fenêtre + y_css × facteur)
```

`x_fenêtre` / `y_fenêtre` = la position de la fenêtre de Pilot en **pixels physiques**
(`getCurrentWindow().outerPosition()`, la même API que `src/js/window-controls.js` emploie déjà
pour `onResized`) ; `facteur` = son `scaleFactor()` ; `x_css` / `y_css` = le coin **haut-gauche**
de `imageZone`, en pixels CSS. On **arrondit** — PLface n'accepte que des entiers (`i32`).

**Quand on la calcule** — trois moments, jamais un flux : (1) à l'**entrée** de l'écran Vocal,
si le cas est 2 ; (2) à la **fin** d'un déplacement ou d'un redimensionnement de Pilot — un
appel par geste, pas pendant ; (3) quand le **cas change** sans que la place change (le
personnage prend la zone, ou la rend).

**Limite connue, écrite et assumée** : si l'utilisateur a posé l'avatar sur un **autre écran**
avec un autre facteur d'échelle, la place calculée est fausse, et Pilot ne peut pas le savoir
(aucune route de lecture). Le prochain déplacement de Pilot le replace. Aucun message, aucune
exception : l'avatar est un **décor utile**, pas une fonction dont dépend la conversation.

### 7bis.6 Les deux possibilités, et celle qui est recommandée

| | **A. L'avatar vient se poser dans la zone** | **B. Afficher l'avatar dans la zone, sans le déplacer** |
|---|---|---|
| Ce que ça veut dire | Pilot demande à PLface de **se poser** là (`/set_position`) : c'est le **vrai** avatar, avec ses expressions et ses mouvements | Pilot **dessine lui-même** une image de l'avatar dans la zone |
| Ce qui existe déjà | la route **et** le branchement Pilot (`face-gateway.js`) | **rien** : Pilot n'a **aucun** moteur 3D |
| Ce qu'il faudrait faire | **une** ligne dans PLface (`w`, `h` facultatifs **et** renvoyés) | embarquer un moteur 3D (`three.js` + `@pixiv/three-vrm`, aujourd'hui chez PLface) **et** le modèle `.vrm` **dans** Pilot |
| Le résultat | **un** avatar, le vrai | **deux** avatars à l'écran, dont un qui parle sans bouger |
| Verdict | **recommandé**, sous **une** condition : la taille est connue | **refusé** |

**Pourquoi B est refusé, en une phrase** : Pilot n'a que deux images — le portrait
(`portrait.png`, cas 1) et son logo ; « afficher l'avatar dans la zone » **sans** embarquer un
second moteur 3D voudrait dire montrer une **photo** d'un personnage qui est déjà vivant deux
cents pixels plus loin ; et l'embarquer, c'est faire entrer dans Pilot un moteur et un modèle
qui ne lui appartiennent pas, pour **copier** ce que l'autre projet fait déjà.

**Et il y a une réponse plus simple que les deux, qu'il faut dire** : le besoin « une image
dans la zone **sans** toucher à PLface » **a déjà son chemin** — c'est le **cas 1**. Une
**image** se pose (un `portrait.png` déposé par Présences, cas 1) ; un **être vivant** ne peut
que **venir s'asseoir** (cas 2).

**Ce que l'utilisateur a à faire, cas par cas** — c'est le critère qui tranche :

| | Ce que l'utilisateur fait | Ce qu'il risque |
|---|---|---|
| **A**, avec la taille | **rien** | que l'avatar reste là où Pilot l'a posé après la sortie du mode (Pilot **ne peut pas** le remettre : sa place d'avant n'est pas lisible) — il le replace à la main s'il y tient, et PLface **retient** ce nouveau choix (`plface.windowPosition`, `app/src/main.js:148`) |
| **A**, sans la taille | il devrait **réduire et glisser** son avatar à la main, à chaque session | un avatar encore à 640 × 720 posé sur la zone : il remonterait jusqu'au bandeau du haut et pourrait recouvrir **le logo**, c'est-à-dire **une sortie** — la contrainte qui prime sur tout ce document —, et Pilot **ne pourrait pas le constater** (aucune lecture). **Refusé.** |
| **B** | rien | un second avatar, faux — **refusé** |

**Recommandation, en une ligne** : **A**, et **seulement** quand la condition « la taille est
connue » est remplie ; **tant qu'elle ne l'est pas, le cas 2 ne s'affiche pas** (c'est le cas 3,
et l'avatar n'est **pas** déplacé). C'est le choix qui ne peut pas se retourner contre
l'utilisateur : il ne voit jamais un avatar mal posé, et il ne voit jamais un trou.

### 7bis.0 RÉVISION DU 2026-11-13 (point 7) — le personnage a QUITTÉ la zone

> **Décision du propriétaire, mot pour mot** : « le cercle en haut, à sa taille actuelle,
> la photo **dessous**, sur le **même axe vertical**, non rognée, avec de vraies marges —
> environ **trois fois** plus grande ». Le personnage n'est donc **plus dans la colonne** :
> il est **sous le disque**, dans la composition du milieu (`.vocal-center`), et son nom
> reste juste sous lui.
>
> Conséquences, toutes mesurées (voir `docs/rapports/RAPPORT-ecran-vocal-point7-cercle-photo.md`) :
>
> - **Le cas 1 ne réserve plus rien dans la colonne.** Avec un personnage, la liste des
>   tâches garde **toute** la hauteur (`H − 53`), exactement comme au cas 3 : elle ne perd
>   plus 148 à 340 px, donc plus **jusqu'à six rangées**.
> - **La taille du médaillon se prend sur la HAUTEUR de la rangée**, plus sur la largeur de
>   la colonne : `vocalPortraitSize({ orbSize, stageHeight })` = `hauteurDeRangee −
>   tailleDuDisque − 64`, plafonnée à **288 px** (trois fois le plancher de 96), plancher
>   **96 px** puis **56 px**, arrondi **vers le bas**. La cible de 3 × est **atteinte** dès
>   1 440 × 900 (288 px) ; elle ne dépend plus de la largeur.
> - **Le disque n'a plus aucun placement propre** : il est le premier enfant de
>   `.vocal-center` (`flex: 0 0 auto`), et c'est le **centrage de l'ensemble** qui le fait
>   monter ou descendre. Aucun décalage écrit. Sans image ni avatar, la composition se
>   réduit au disque, qui est alors **exactement centré**.
> - **Rien d'autre ne change** : trois pistes, l'avatar toujours dans la colonne avec ses
>   180 px, trois sorties, six hôtes cliquables, aucun réglage, aucune persistance.
>
> Verrous : `src/js/ecran-vocal-point7-photo-sous-le-cercle.test.js` (P1 à P5),
> `src/js/vocal-portrait-detache.test.js`, `src/js/vocal-sides.test.js` (T10),
> `src/js/ecran-vocal-cadres-et-cercle.test.js`.

### 7bis.7 Le repli : jamais un trou, jamais un message

| Situation | Ce que l'utilisateur voit | Ce que Pilot fait |
|---|---|---|
| Aucun portrait, avatar **injoignable** (pas lancé, arrêté, planté) | la liste, pleine hauteur | rien (cas 3) ; **aucune** tentative de lancement, **aucun** message |
| Avatar joignable, **taille non confirmée** | idem | rien (cas 3) ; **aucun** déplacement |
| Place insuffisante (`listH < 46`, donc `H < 298`) | idem | rien (cas 3) ; **aucun** déplacement |
| L'appel `/set_position` **échoue** (délai, refus) | idem | rien : **la place n'est pas réservée si l'avatar ne vient pas** ; l'avatar reste où il est |
| L'avatar est **fermé** pendant la session | la zone reste **vide** jusqu'au prochain relevé (entrée, retour de focus, redimensionnement) — c'est de l'**air**, pas un trou : rien n'y est dessiné | rien |
| Un **personnage** arrive avec un portrait refusé (mauvais type, plus de 8 Mio) | le cas 2 s'il y a un avatar, sinon le cas 3 | le critère du cas 1 ne change pas (§ 7) |

**La phrase qui compte** : *la zone ne dessine jamais rien pour l'avatar — ni cadre, ni ombre,
ni rond, ni fond, ni icône, ni texte. Une zone vide est donc indiscernable d'un air normal :
il n'y a pas de trou possible, par construction.* Aucun repli n'est « fabriqué » : on ne met
**jamais** le logo dans la zone (même règle que pour le portrait), on n'affiche **jamais** une
image cassée, et on n'écrit **jamais** un message d'erreur dans la ligne d'état pour un décor.

### 7bis.8 Changer de cas sans redémarrer

Aucun redémarrage, aucun rechargement, **aucun intervalle nouveau** : les **trois** moments
qui existent déjà (l'entrée de l'écran, `VOCAL_SIDES_TICK_MS` = 900 ms, `resize`) relisent le
cas, et `planVocalSides` rend la nouvelle place. La même fonction décide **et** la réserve
**et** le rectangle : il n'y a donc jamais deux vérités à synchroniser.

| De → vers | Ce qui change à l'écran | Ce que Pilot fait de l'avatar |
|---|---|---|
| 3 → 1 | 98 px réservés, médaillon et pastille au pied | rien |
| 1 → 3 | 98 px rendus à la liste | rien |
| 3 → 2 | 180 px réservés, **rien de dessiné**, l'avatar se pose | **un** appel de position (et de taille, si elle existe) |
| 2 → 3 | 180 px rendus, l'avatar **reste où il est** | **rien** — Pilot ne peut pas savoir où le remettre (§ 7bis.5) ; il flotte au pied droit de la fenêtre de Pilot, l'utilisateur le replace s'il veut |
| 1 → 1+2, ou 1+2 → 1 | rien de visible pour le personnage | l'avatar **monte** de 98 + 6 px quand le personnage prend la zone, et **redescend** quand il la rend : il ne se pose **jamais sur** l'image du personnage, il se pose **au-dessus** d'elle |
| 3 → 1+2 | 278 px réservés | **un** appel, directement à la place « au-dessus » |

**Pourquoi l'avatar monte au lieu de rester** : l'ordre du propriétaire est que le
**personnage occupe la zone** quand il est là ; un avatar déjà posé dessus la lui volerait. On
ne peut pas le renvoyer « chez lui » (sa place n'est pas lisible), et la seule autre place que
Pilot **connaisse** est **juste au-dessus** de la zone, dans la colonne. Il n'y cache rien de
cliquable — la colonne ne capte aucun clic (T17) — et il recouvre au plus **une ou deux**
lignes de liste (§ 7bis.4), le temps que les deux soient actifs. C'est le seul ordre possible
sans mentir sur ce que Pilot sait faire.

### 7bis.9 Ce qui reste à trancher — trois points, et rien d'autre

1. **La place de l'image : au pied (ce document) ou au-dessus de la liste ?** Je garde le
   **pied** de la colonne, comme tranché le 2026-10-29, malgré les mots « en haut à droite »
   (§ 7bis.1). Si vous vouliez la **remonter**, dites-le : la règle est exprimée en hauteurs,
   donc **aucun chiffre ne change**, seule la position du bloc dans la colonne.
2. **La taille de l'avatar** : faut-il demander à PLface d'accepter `w` et `h` dans
   `/set_position`, et de les renvoyer ? **Sans cela, l'avatar ne se pose pas** : il reste une
   fenêtre flottante et le cas 2 ne s'affiche **jamais** (le cas 3 prend sa place). C'est la
   seule dépendance extérieure de ce complément.
3. **Le nom sous l'avatar** : dans le cas 2, je n'écris **rien** sous l'image — l'avatar n'a pas
   de nom ; celui de l'Assistant reste sur le bouton du cercle, et la pastille du cas 1 est
   celle du **personnage**. Si vous voulez le nom réglé sous l'avatar, c'est **une** ligne de
   plus (20 px) et **une** phrase à changer : la zone passerait à 200 px.

### 7bis.10 Ce que ce complément change — et ce qu'il ne change pas

| | |
|---|---|
| **Tests existants** | **aucun ne change.** Les colonnes ne sont pas implémentées (`src/js/vocal-sides.js` et `src/js/vocal-sides.test.js` n'existent pas encore) : ce complément **planifie**, il n'amende aucune assertion. Les quatre lignes du § 8.1 restent les seules. |
| **Tests à créer** (avec le lot des colonnes) | **T20** « trois cas, dans cet ordre » : `planVocalSides` rend la bonne réserve et la bonne `listH` pour les **quatre** colonnes du tableau § 7bis.4, sur les **sept** fenêtres ; le cas 2 n'apparaît pas sous `H = 298`. **T21** « l'avatar n'est jamais un nœud » : la zone du cas 2 ne porte **aucun** élément, aucun `img`, aucun `src`, aucun logo ; `planVocalSides` rend `imageZone` et rien d'autre. **T22** « la pose » : la conversion pixels CSS → physiques **arrondit**, n'appelle `/set_position` **que** si une taille est confirmée, et **une seule fois** par geste. |
| **`spec_modes_ecran_vocal.md`** | le § 3ter passe de **deux** cas à **trois**, avec les hauteurs de ce document. Le marqueur **🟡 non livré** reste : rien de tout cela n'est dans le code. |
| **Aide intégrée (`help/`)** | **non touchée** : rien n'est livré, donc rien à annoncer (même règle que la révision du 2026-10-29). Aucun bloc `<!-- HELP:* -->` n'est ajouté ici. |
| **Réglages / persistance** | **aucun** : pas de case, pas de `localStorage`, pas de ligne de config. La place de l'avatar est **décidée à chaque affichage**. |
| **Nœuds de balisage** | **aucun** : la zone est une **place mesurée**, pas un élément. Les **six** hôtes cliquables de T17 restent **six** (l'avatar est la fenêtre d'un autre processus, pas un nœud de Pilot). |
| **Minuteries** | **aucune nouvelle** : `VOCAL_SIDES_TICK_MS` (900 ms) suffit. |

---

## 8. Vérification

### 8.1 Ce qui change dans les tests **existants** (deux fichiers, et c'est tout)

| Fichier | Assertion | Avant | Après |
|---|---|---|---|
| `src/js/ecran-vocal-lot2.test.js` (~l. 247) | liste ordonnée des classes de `buildVocalOverlay` | **8** entrées | **13** au lot 1, **13** au lot 2 — le bouton d'affichage n'y entre pas (§ 2.1, § 6.10) |
| `src/js/ecran-vocal-lot2.test.js` (~l. 262) | nombre de `</div>` entre `.vocal-stage` et `.vocal-status` | `2` | **`4`** au lot 1 (§ 2.1) |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` (~l. 305) | même liste ordonnée | **8** entrées | **13**, mêmes ajouts, au lot 1 seulement |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` (~l. 327) | même compte de `</div>` | `2` | **`4`** au lot 1 |

Soit **quatre** lignes, dans **deux** fichiers. Rien d'autre dans la suite existante ne bouge.

**Révision du 2026-10-29 (tâches en haut, portrait en bas)** — l'**ordre** de la liste ordonnée
change (`vocal-side-body` **avant** `vocal-portrait` et `vocal-portrait-name`), le **nombre**
d'entrées **ne change pas** : ce sont les mêmes quatre lignes, avec deux entrées interverties.
Deux tests **nouveaux** s'ajoutent (T18 « sans personnage, rien n'est réservé », T19 « le
portrait ne bouge pas quand la liste change ») et deux sont **amendés** (T9 : médaillon au
pied, sans repli ; T12 : nombre de lignes selon la hauteur **et** le cas, plafond 6 / 8).
Le détail et le tableau de hauteurs sont dans
`CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md` § 2.5 et § 8.

**Complément du 2026-10-29 (la zone d'image à trois cas, § 7bis)** : **aucune** ligne de test
n'est ajoutée ici, parce que les colonnes ne sont pas encore implémentées — ce complément
**planifie** les tests T20, T21 et T22 (§ 7bis.10) pour le lot qui les portera. Les quatre
lignes ci-dessus restent les seules, et aucune phrase de la spec n'est retirée : celle du
§ 3ter est **étendue** de deux cas à trois.

Ce qui **ne change pas** — vérifié, et c'est un gain par rapport au premier jet de ce
document :

| Fichier | Pourquoi il ne change pas |
|---|---|
| `src/js/ecran-vocal-bouton-relance.test.js` | la pastille a quitté le bouton : son texte, son `title`, son `aria-label` restent ceux d'aujourd'hui |
| `src/js/ecran-vocal-nu.test.js` | `enterVocal()` reste **structure seule** (aucun `innerHTML`, aucun `textContent`, aucun `messagesEl` dans son corps) : l'aperçu est écrit par `vocalSyncSides()`, une autre fonction. ⚠️ à savoir : la **colonne est remplie** à l'entrée (par cet appel), alors que la phrase du test dit « aucun contenu n'est écrit dans l'écran à l'entrée ». Cette phrase vise la **conversation**, et c'est toujours vrai ; elle n'a pas à être réécrite, mais quiconque la lit doit savoir que les colonnes, elles, sont un contenu — assumé, puisqu'il n'a pas la place ailleurs. |
| `src/js/agent-activity.test.js` | le champ `toolInProgress` n'est posé **que s'il vaut vrai** ; les `toEqual` de forme portent sur des agents où il est faux |
| `src/js/vocal-halo-parole.test.js`, `vocal-enveloppe-aigu.test.js`, `ecran-vocal-lot3.test.js`, `ecran-vocal-lot4a.test.js`, `vocal-chrome-masque.test.js`, `vocal-mic*.test.js` | le disque, le halo, le micro, le bas qui s'efface : **non touchés** |

### 8.2 État de la suite au moment de la rédaction — à lire avant de commencer

**Mesure du 2026-10-29, après l'écriture de ce complément** : `npx vitest run` → **4 414
tests passent, 2 échouent** (sur 4 416). Les quatre échecs de découpe signalés ci-dessous
(`ecran-vocal-lot2`, `vocal-halo-parole`) ont été réparés depuis ; il ne reste que les **deux**
qui viennent de l'arbre de travail, **sans rapport avec ce document** :
`dictee-vocale-se-rearme.test.js:230` (`.vocal-status` apparaît deux fois dans
`super-agent.js`) et `vocal-parler-declenche-une-demande.test.js:262` (un appel a été ajouté
après `vocalSyncRestartButton(state);` dans `applyVocalState`). Aucune modification de
documentation ne peut les provoquer : ils lisent **du code**, pas des `.md`.

`npx vitest run` **échouait** (exit 1, **6 échecs** sur 4 353) **avant** toute
modification de ce document et **sans rapport avec lui** (mesuré dans l'arbre de travail au
moment de la rédaction) :

| Test | Assertion qui casse | Ce que ça dit |
|---|---|---|
| `ecran-vocal-lot2.test.js:194`, `:203`, `:263` | `color: var(--text-primary)` / `font-size: var(--font-zone)` / `gap: 32px` introuvables | le helper de découpe tombe sur le **commentaire** posé au-dessus du bloc `pointer-events` de l'issue #381 |
| `vocal-halo-parole.test.js:224` | même `gap: 32px` introuvable | même cause, même helper |
| `dictee-vocale-se-rearme.test.js:230` | `.vocal-status` apparaît **2** fois dans `super-agent.js` au lieu de 1 | un second `vocal-status` a été introduit dans l'arbre de travail — **pas** par ce document |
| `vocal-parler-declenche-une-demande.test.js` | le **dernier** appel de `applyVocalState` n'est plus `vocalSyncRestartButton(state)` | un appel a été ajouté après lui dans l'arbre de travail — **pas** par ce document |

Les deux premières lignes sont la seule gêne réelle : ce sont les fichiers que le § 8.1
demande de modifier, et **le lot 1 commence par les remettre au vert** en réparant la
découpe (ancrer sur la règle `.vocal-stage {`, pas sur du texte libre). Sans ça, impossible
de dire si une régression vient du lot ou du helper. C'est le seul travail hors périmètre
autorisé dans ces trois lots, et il ne touche pas au code applicatif — les tests, et eux
seuls.

Les deux dernières lignes ne concernent **aucun lot** : elles viennent de modifications
déjà présentes dans l'arbre de travail et doivent être traitées (ou assumées) **avant** de
commencer, faute de quoi le lot 2 ne pourra pas prouver qu'il n'a rien cassé. En
particulier : ce document ne pose **jamais** d'appel dans `applyVocalState` — `vocalSyncSides()`
est appelé par `enterVocal()`, par son intervalle et par `resize` (§ 3.5), jamais par la
peinture d'état, précisément pour que « le dernier appel d'`applyVocalState` » reste vrai.

### 8.3 Ce qu'il faut regarder à l'œil (dans cet ordre)

1. **La sortie** — entrer en mode Vocal, puis **cliquer le logo** : l'écran se referme. Puis
   Échap. Puis fermer l'onglet. **Trois fois.** C'est le premier geste, avant l'esthétique.
2. **Le portrait** — il est **rond**, il ne touche pas le disque, il est **nettement** plus
   petit, il ne clignote pas à l'entrée, et son nom se lit dessous sans effort.
3. **Le disque** — l'objet lumineux est **intact** : pas de portrait dedans, pas de cadre, le
   halo garde son ampleur.
4. **Les tâches** — une mission lancée apparaît « en cours » en premier **en moins d'une
   seconde** ; un projet sans travail montre « Aucune tâche en cours » et « Tout est au
   repos », **jamais** une colonne vide.
5. **La ligne d'activité** — elle change quand l'agent passe de « réfléchit » à « exécute une
   opération », et elle ne bouge **pas** de place.
6. **La discussion** — la question est **visiblement** plus petite et plus grise que la
   réponse ; le dégradé est bien **en haut** ; le dernier échange est bien **en bas**.
7. **Les largeurs** — redimensionner la fenêtre lentement de 640 px à 1920 px : les colonnes
   apparaissent une fois, sans saut, et le disque **reste au centre**.
8. **Le bouton** — il ne chevauche ni le logo ni le bouton « Travail » ; il dit son état, puis
   son action ; il est **toujours là**, même quand la fenêtre est trop étroite pour les
   colonnes ; un clic éteint **tout sauf le portrait**, un second rallume tout ; on entre
   toujours avec tout visible.
9. **Rien d'avalé** — masquer, puis cliquer la croix de l'onglet : elle réagit. Masquer, puis
   Échap : on sort. Masquer, puis cliquer le logo : on sort.
10. **Les palettes** — refaire les points 2, 4 et 6 en Pilot clair, One Dark et Nord : le gris
    des questions doit rester lisible sur les trois.

### 8.4 Commandes

```bash
# 1. Remettre au vert ce qui est rouge AVANT de coder (§ 8.2)
#    1a. les deux fichiers que le lot 1 modifie de toute façon (helper de découpe)
npx vitest run src/js/ecran-vocal-lot2.test.js src/js/vocal-halo-parole.test.js
#    1b. les deux échecs qui ne viennent d'aucun lot (à corriger ou à assumer, § 8.2)
npx vitest run src/js/dictee-vocale-se-rearme.test.js \
  src/js/vocal-parler-declenche-une-demande.test.js

# 2. À la fin de CHAQUE lot
npx vitest run src/js/vocal-sides.test.js \
  src/js/ecran-vocal-portrait.test.js \
  src/js/vocal-colonnes-taches.test.js \
  src/js/ecran-vocal-bouton-affichage.test.js \
  src/js/vocal-colonne-discussion.test.js

# 3. Anti-régression de l'écran (les six hôtes, la sortie, l'écran nu)
npx vitest run src/js/ecran-vocal-nu.test.js src/js/ecran-vocal-lot2.test.js \
  src/js/ecran-vocal-lot3.test.js src/js/ecran-vocal-lot4a.test.js \
  src/js/ecran-vocal-bouton-relance.test.js src/js/vocal-chrome-masque.test.js \
  src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js src/js/vocal-halo-parole.test.js

# 4. La suite entière, avant de dire qu'un lot est fini
npx vitest run

# 5. Aide intégrée (lot 2 et lot 3, après toute modification d'un bloc <!-- HELP:* -->)
npm run build:handbook
```

---

## 9. VERDICT

**Il ne reste aucune question ouverte.**

> **Révision du 2026-10-29 (précision du propriétaire)** : la liste des tâches passe **en haut**
de la colonne de droite et le portrait **à son pied** ; sans personnage actif, **aucun espace
n'est réservé** et la liste prend toute la hauteur. Elle ne rouvre **aucune** des huit
décisions : le total fixe de la colonne reste **170 px** quand un personnage est actif, donc
`listeH` ne change pas d'un pixel ; seule la **place** du bloc portrait change, et le repli sur
le logo **disparaît de la colonne** (il reste vrai sur l'écran d'accueil). Détail applicable :
`CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md`, qui ne laisse lui non plus aucune
question ouverte.

- Les **neuf décisions** du 2026-10-29 sont écrites, chiffrées, justifiées, et chacune dit
  dans quel lot elle se traduit.
- La **neuvième** — « tout se masque d'un geste, sauf le portrait, et rien n'est mémorisé » —
  n'ajoute **aucune ligne de test existante** à modifier : le bouton est posé **après** le
  modèle, donc `'<div class="vocal-top"></div>'` reste vrai et les trois listes ordonnées de
  `buildVocalOverlay` gardent leur nombre d'entrées (§ 6.10). C'est le point qui rend cette
  décision livrable sans toucher à l'existant : elle s'ajoute, elle ne réécrit pas.
- Ce qui a été **retiré** du premier jet l'est explicitement : le portrait **dans** le
  cercle, la pastille **dans** le bouton de relance, la question du **contraste portrait ↔
  halo**, et la discussion laissée hors périmètre (« un jour, peut-être ») — elle a
  maintenant un lot, des mesures et des tests.
- Les **trois lots** peuvent être livrés **seuls et dans cet ordre** : le lot 1 ne dépend de
  rien, le lot 2 dépend du lot 1 (la grille et le médaillon), le lot 3 dépend du lot 2
  (le point d'écriture unique `vocalSyncSides`). **Aucun lot n'ajoute d'échec** : le § 8.1 dit
  exactement quelles assertions bougent, et les deux seuls fichiers concernés sont nommés
  avec leur numéro de ligne.
- **Un seul point demande du travail avant le lot 1**, et il n'est pas une question de
  conception mais un état de fait : la suite de tests est **déjà rouge** (**6 échecs**, § 8.2),
  pour des raisons étrangères à ce document (deux viennent d'un helper de lecture des tests,
  deux de modifications déjà présentes dans l'arbre de travail). Le lot 1 commence par les
  deux premières ; les deux autres se traitent avant de commencer, § 8.2 dit comment.
- La contrainte qui prime — **la sortie reste cliquable** — n'est pas une intention : elle a
  un test (T17), créé au lot 1, qui échoue si elle est perdue.

> **Complément du 2026-10-29 (la zone d'image)** : elle a désormais **trois** cas, dans
> l'ordre décidé par le propriétaire — **le personnage**, puis **l'avatar du visage**, puis
> **la liste seule**. Les deux premiers coûtent **98 px** et **180 px** de la colonne, le
> troisième **rien**, et toute la règle est exprimée en **hauteurs** : la place du bloc et les
> neuf décisions restent intactes. Le cas 2 **ne dessine rien** — donc aucun repli à fabriquer
> et aucun trou possible. Il reste **un** point extérieur, nommé : **PLface ne sait pas
> imposer une taille** (§ 7bis.5) ; tant que c'est vrai, l'avatar ne se pose pas et le
> troisième cas s'applique. Deux confirmations de vocabulaire seulement sont demandées au
> propriétaire (§ 7bis.9) et n'attendent qu'un mot.
