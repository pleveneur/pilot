# CONCEPTION — Écran Vocal : les tâches en haut à droite, le portrait en bas

> **RÉVISION DU 2026-10-31 — le portrait est REVENU en haut de la colonne, au-dessus des
> tâches.** Ce document reste **exact** sur son objet propre : la colonne de droite
> (`columnHeight` / `listHeight`, budget, tableaux), la liste qui ne défile pas et les huit
> lignes au plus. Ce qui a changé, et qui **prime ici** : le portrait n'est **pas** au centre
> du cercle — il est le **premier contenu de la colonne de droite, en haut à droite de
> l'écran**, dans un bloc de **98 px** (72 px de médaillon + 6 px d'écart + 20 px de nom),
> **au-dessus** de la liste. La **ligne d'activité n'existe toujours pas** et la colonne des
> tâches **s'arrête toujours avant la couronne** du disque. Le document qui fait foi pour
> l'ensemble est `CONCEPTION-ecran-vocal-portrait-et-colonnes.md` (encadré de tête de son
> **AVENANT**) et `spec_modes_ecran_vocal.md` § 3ter.
>
> **PÉRIMÉ SUR DEUX POINTS (mission « écran Vocal », 2026-11)** : la **ligne
> d'activité n'existe plus**, et la colonne des tâches **s'arrête avant la couronne** du
> disque. Ce qui suit reste utile pour le
> budget de la colonne et ses tableaux, mais ne décrit plus le code.

> **Nature** : conception UI/UX, écrite pour être appliquée sans interprétation.
> **Aucun fichier de code n'est modifié par ce document.**
> **Précision du propriétaire, 2026-10-29** (à l'oral, après la version du même jour de
> `CONCEPTION-ecran-vocal-portrait-et-colonnes.md`) : *« quand un personnage est actif, le
> portrait occupe la partie droite et la liste des tâches se place en haut à droite, au-dessus
> du portrait ; quand aucun personnage n'est actif, la liste des tâches occupe toute la
> hauteur à droite, aucun espace réservé. »*
> **Ce document amende** la disposition de la colonne de droite de
> `CONCEPTION-ecran-vocal-portrait-et-colonnes.md` (§ 0, § 1.1, § 1.2, § 1.5, § 2, § 2.1,
> § 2.2, § 2.4, § 3.3, § 3.6, § 7, § 8.1, § 9 — les endroits sont déjà corrigés, marqués « révision du
> 2026-10-29 ») et **rien d'autre**. Les décisions déjà tranchées ne sont pas rouvertes : le
> bouton des modes reste **le logo**, le bas de l'écran **s'efface au repos**, il y a **trois
> sorties** (logo, Échap, fermeture de l'onglet), le disque ne porte **rien** dedans, il n'y a
> **aucun réglage nouveau**. Un paragraphe neuf a été ajouté à `spec_modes_ecran_vocal.md`
> (§ 3ter), lui aussi marqué **non livré**.
> **Preuves** : chaque affirmation sur l'état actuel porte un `fichier:ligne`.
> **La contrainte qui prime** (reprise telle quelle) : les colonnes restent
> `pointer-events: none`, sans nœud focusable ; **la sortie de l'écran reste cliquable**.

---

## 0. La précision du propriétaire, et ce qu'elle devient

| Ses mots | La règle écrite, vérifiable |
|---|---|
| « le portrait occupe la partie droite » | Le portrait reste **dans la colonne de droite**, au **pied** de cette colonne, **sous** la liste des tâches. Il ne sort pas de la colonne, il ne va pas dans le disque, il ne devient pas un panneau. |
| « la liste des tâches se place en haut à droite » | Le titre « TÂCHES » et **la première tâche** sont au **même endroit dans les deux cas** : 14 px sous le bord haut de la colonne. La liste est **ancrée en haut** et grandit vers le bas. |
| « au-dessus du portrait » | La liste occupe tout l'espace **au-dessus** du bloc du portrait ; le bloc du portrait est **ancré en bas** et ne remonte jamais dans la liste. |
| « la liste occupe toute la hauteur à droite » (sans personnage) | Le bloc du portrait **disparaît entièrement** : les **98 px** qu'il occupait (72 portrait + 6 écart + 20 pastille) **reviennent à la liste**. Aucune réserve, aucun cadre vide, aucun médaillon de remplacement. |
| « aucun espace réservé vide, aucune zone morte » | Sans personnage, la colonne ne contient **que** ce qui sert : le titre, les tâches, la ligne d'activité. L'air qui reste (quand il y a peu de tâches) tombe **entre la dernière tâche et la ligne d'activité**, qui reste collée au bas — il n'est **réservé à rien**, et il n'y a **aucun cadre, aucun rond, aucun emplacement** à la place du portrait. |

**Ce que cela ne change pas** : le portrait reste un médaillon de **72 px** (décision 1 : « nettement plus petit que le disque », rapport 4,7 : 1), centré dans la colonne ; la pastille du nom reste **sous** le portrait (décision 5) ; la ligne d'activité reste **une** ligne, à la même place, en bas.

---

## 1. L'état actuel — avec preuves

### 1.1 Ce que dit la proposition du 2026-10-29 (avant cette précision)

| Élément | Place aujourd'hui dans la proposition | Preuve |
|---|---|---|
| Le portrait | **1ᵉʳ** élément de la colonne de droite, en haut, suivi de la pastille | `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md:104` § 1.2 (et `:117` pour la pastille) — **après** la correction du 2026-10-29, il est le 3ᵉ élément |
| Le titre « TÂCHES » | **3ᵉ**, 14 px **sous la pastille** du nom | même fichier `:93-95` § 1.2 — **après** correction : 1ᵉʳ, à 14 px du bord haut |
| Les tâches | **4ᵉ**, donc **sous** le portrait, avec un budget `listeH = H − 170` | même fichier `:98` § 1.2 et `:460-468` § 3.3 |
| La ligne d'activité | **5ᵉ**, collée au bas de la colonne (`margin-block-start: auto`) | même fichier `:123-125` § 1.2 |
| Sans portrait | **un repli sur le logo** : `getAssistantPortrait() \|\| "/logo_pilot_vector.svg"` dans la colonne | même fichier § 7 (tableau) et `:292` § 2.2 |

**Ces cinq lignes sont exactement ce que la précision du propriétaire renverse**, et rien
d'autre.

### 1.2 Ce qui existe réellement dans le code, ce jour

| Fait | Preuve |
|---|---|
| Les colonnes de l'écran Vocal **ne sont pas encore écrites** : ni `vocal-side`, ni `vocal-portrait`, ni `vocal-tasks` n'existent dans la feuille de style ni dans `super-agent.js`. | `grep -c "vocal-side" src/css/style.css src/js/super-agent.js` → **0** et **0** |
| Le personnage actif est **déjà** lu et gardé en mémoire, sans redémarrage : relecture à l'ouverture de l'onglet et à chaque retour de focus de la fenêtre. | `src/js/super-agent.js:3213` (`await refreshAssistantPersonaAndApply()`) et `:3218` (`window.addEventListener("focus", …)`) |
| Le portrait affichable vaut **`""`** quand aucun personnage n'est actif — ce n'est pas une panne, il n'y a ni message ni exception. | `src/js/assistant-persona.js:152-155` (`getAssistantPortrait`), contrat en tête de fichier `:1-24` |
| Le **nom** ne dépend pas de l'image : personnage → nom réglé → « Assistant ». | `src/js/assistant-persona.js:123-128` (`personaDisplayName`) |
| Le nom du personnage **reste visible** sans portrait, sur le bouton de relance du cercle (« Réveiller *Nom* »). | `spec_modes_ecran_vocal.md:213` (§ 3bis) |

**Conséquence de la dernière ligne, et c'est elle qui autorise la règle** : si le portrait
manque, la colonne de droite ne peut pas perdre le nom du personnage — il est déjà écrit en
clair, en gros, sur le bouton du cercle. Rien n'est caché à l'utilisateur.

### 1.3 Ce qui doit continuer à fonctionner (à ne pas casser)

- Les **six hôtes cliquables** (`doc` § 5.1) : la colonne n'en ajoute aucun.
- **Trois sorties** : logo (bouton des modes), Échap, fermeture de l'onglet (`doc` § 5.2).
- Le **bas qui s'efface au repos** (`spec_modes_ecran_vocal.md` § 4bis) : la colonne n'y touche pas.
- Le **disque** et ses quatre états : non touchés.
- L'**ordre des groupes** de tâches : « En cours (n) » **puis** « En attente (n) », jamais l'inverse (décision 2).
- **Aucune** persistance, **aucun** réglage, **aucun** `localStorage`.

---

## 2. La colonne de droite, cas par cas

Deux cas, une seule différence : **le bloc du portrait existe, ou il n'existe pas.** Tout le
reste est identique, au pixel.

### 2.1 Cas A — un personnage est actif

De haut en bas, dans `.vocal-side-tasks` (même largeur, même hauteur que la colonne de
gauche) :

| # | Élément | Hauteur | Ancrage | Détail |
|---|---|---|---|---|
| 1 | marge haute | **14 px** | — | identique à la colonne de gauche |
| 2 | titre **« TÂCHES »** | **14 px** | **en haut** | 11 px, capitales, `letter-spacing: 0.08em` ; même ligne de base que « DISCUSSION » |
| 3 | écart | **14 px** | — | sépare le titre du contenu de la colonne |
| 4 | **la liste des tâches** | `listH` (voir § 2.5) | **en haut** | commence juste sous l'écart ; grandit **vers le bas** ; contenu aligné en haut, jamais étiré |
| 5 | *air* | ce qui reste | — | tombe **entre la dernière tâche et le bloc du portrait** — jamais entre deux tâches |
| 6 | **le portrait** | **72 × 72 px** | **en bas** | rond, `object-fit: cover`, centré horizontalement dans la colonne |
| 7 | écart | **6 px** | — | la pastille colle au portrait qu'elle nomme |
| 8 | **la pastille du nom** | **20 px** | **en bas** | une ligne, 12 px, ellipse sur fin de mot ; nom complet en `title` et `aria-label` |
| 9 | écart | **12 px** | — | |
| 10 | **la ligne d'activité** | **18 px** | **en bas** | une seule ligne, 12 px ; « *agent* exécute une opération », « Tout est au repos », etc. |
| 11 | marge basse | **12 px** | — | la ligne d'activité se lit à 12 px au-dessus du bord bas de la colonne |

**Les trois éléments du bas (portrait, pastille, ligne d'activité) ne bougent jamais**, quel
que soit le nombre de tâches : ils sont ancrés au bas de la colonne. C'est ce qui fait qu'une
mission qui démarre ou qui finit ne fait **pas** sauter le portrait.

**Hauteur réservée, en clair** : **98 px** (72 + 6 + 20), au pied de la colonne. Ni plus, ni
moins : elle ne dépend **pas** de la longueur du nom (la pastille est **une** ligne, hauteur
fixe, ellipse), **pas** de la taille du fichier image (le portrait est toujours 72 × 72), et
**pas** du nombre de tâches.

### 2.2 Cas B — aucun personnage actif

**La colonne est identique, moins les trois éléments 6, 7 et 8.** Le reste ne bouge **pas
d'un pixel** :

| # | Élément | Ce qui change par rapport au cas A |
|---|---|---|
| 1 → 3 | marge, titre « TÂCHES », écart | **rien** : même place, même pixel |
| 4 | **la liste des tâches** | sa hauteur passe de `H − 170` à **`H − 72`** : elle **gagne exactement 98 px**, et jusqu'à **2 tâches de plus** (§ 2.5) |
| 5 | *air* | tombe entre la dernière tâche et la **ligne d'activité** |
| 6 → 8 | portrait, écart, pastille | **absents**. Pas de logo de remplacement, pas de médaillon vide, pas de cadre pointillé, pas de texte « aucun personnage ». **Rien.** |
| 10 | ligne d'activité | **même place, même contenu** : à 12 px au-dessus du bord bas |
| 11 | marge basse | **rien** |

**Hauteur réservée : 0 px.** C'est la réponse littérale à « aucun espace réservé vide ».

### 2.3 Le critère « personnage actif » — un seul, vérifiable

> **Un personnage est actif si et seulement si le portrait affichable n'est pas vide :
> `getAssistantPortrait() !== ""`.**

- **Pourquoi le portrait et pas le nom** : la règle du propriétaire parle d'une **image** qui
  occupe la partie droite. Un nom sans image ne remplit rien : il n'y aurait rien à placer, et
  réserver 98 px pour un mot serait exactement la « zone morte » refusée.
- **Pourquoi ce critère ne perd aucune information** : le nom du personnage est déjà écrit sur
  le bouton du cercle (« Réveiller *Nom* », `spec_modes_ecran_vocal.md:213`).
- **Le critère est unique** : il n'y a **pas** de second drapeau « personnage activé » lu
  ailleurs, ni de réglage, ni de mémoire d'état. Une image affichable existe → cas A. Sinon →
  cas B. C'est la même valeur que celle qui alimente déjà le portrait de l'onglet 🧭
  (`src/js/tabs.js:3038`) et l'écran d'accueil de l'Assistant (`src/js/super-agent.js:2104`) ;
  **l'écran Vocal ne lit rien de plus**.
- **Ce qui donne le cas B** (tous, sans message et sans exception, comme aujourd'hui) :
  fichier absent ; fichier illisible ; image refusée par `personaPortraitSrc` (mauvais type,
  plus de 8 Mio, contenu qui n'est pas du base64) ; commande Rust en panne (le repli est
  silencieux, `src/js/assistant-persona.js:192-196`).

### 2.4 Le schéma des deux cas (pour situer, pas pour mesurer)

**Cas A — un personnage est actif**

```
┌─────────────────────────────┐  ← haut de la colonne (= haut de la boîte du disque)
│ 14 px                       │
│ TÂCHES                      │  ← même ligne que « DISCUSSION », à gauche
│ 14 px                       │
│ En cours (1)                │  ┐
│   1. Agent — Projet         │  │  la liste est ANCRÉE EN HAUT
│      depuis 3 min           │  │  et grandit vers le bas
│ En attente (2)              │  ┘
│   2. …                      │
│                             │  ← l'air tombe ici (jamais entre deux tâches)
│            ◯  72 px         │  ← le portrait, ANCRÉ EN BAS, centré
│          (nom)              │  ← la pastille, 20 px
│                             │
│ Agent exécute une opération │  ← la ligne d'activité, même place dans les deux cas
│ 12 px                       │
└─────────────────────────────┘
```

**Cas B — aucun personnage actif**

```
┌─────────────────────────────┐  ← haut de la colonne, IDENTIQUE au cas A
│ 14 px                       │
│ TÂCHES                      │  ← même place
│ 14 px                       │
│ En cours (1)                │  ┐
│   1. Agent — Projet         │  │  la liste gagne les 98 px du bloc portrait
│      depuis 3 min           │  │  (jusqu'à 2 tâches de plus)
│ En attente (2)              │  │
│   2. …                      │  │
│   3. …                      │  ┘
│                             │  ← l'air tombe ici
│ Agent exécute une opération │  ← la ligne d'activité, à la même place qu'au cas A
│ 12 px                       │
└─────────────────────────────┘
```

**Ce que les deux schémas disent d'un coup d'œil** : le haut est identique, le bas de la
colonne (la ligne d'activité) est identique ; seule la zone du milieu change de hauteur, et
seul le bloc du portrait apparaît ou disparaît.

### 2.5 Le budget de hauteur et le nombre de lignes

La décomposition est **celle du § 3.3 de la proposition**, recopiée sans un chiffre de plus :

```
cas A : listH = H − 14 − 14 − 14 − 72 − 6 − 20 − 12 − 18 = H − 170
cas B : listH = H − 14 − 14 − 14                    − 12 − 18 = H − 72
```

(`H = min(--vocal-orb-box, 100 %)`, la hauteur de la colonne, celle du § 3.2 de la proposition.
Une tâche vaut 46 px, un en-tête de groupe 20 px.)

**Un nom, pour éviter un piège de vocabulaire** : la proposition appelle `listHeight` **deux
choses différentes** — la hauteur de la **colonne** au test 10 (`min(orbSize × 1,5238, height −
289)`, qui est `H`) et la place laissée à la **liste** au § 3.3 (`vocalTaskRows(listHeight)`, qui
est `H − 170`). Ce document écrit **`listH`** pour la seconde et **`H`** pour la première ; à
l'implémentation, `planVocalSides` doit rendre **deux** valeurs distinctement nommées, et le
test T18 le fige. Rien d'autre ne change.

- **Le total fixe du cas A reste 170 px** : c'est ce qui garantit qu'**un personnage actif ne
  coûte pas un pixel de plus** à la colonne qu'aujourd'hui — seul l'**ordre** change.
- `lignes = clamp(1, floor((listH − 2 × 20) / 46), plafond)`, en-têtes de groupe retirés
  (`lignes = clamp(1, floor(listH / 46), 2)`) quand `listH < 86`, comme aujourd'hui.
- **Le plafond suit la place** :
  - **cas A : 6**, valeur déjà décidée (`doc:453` § 3.3, `VOCAL_TASKS_MAX = 6`) — le portrait est
    lui aussi une information, la colonne ne devient pas un mur de texte ;
  - **cas B : 8** — ce n'est **pas** un chiffre choisi : c'est **exactement** ce que la place
    permet à la hauteur maximale (`floor((440 − 40) / 46) = 8`). Refuser ces deux lignes
    laisserait **124 px de trou** sous une liste qui pourrait les afficher, c'est-à-dire
    précisément ce que le propriétaire refuse.
- La répartition par groupe (« 2 groupes × la moitié, l'excédent d'un groupe passant à
  l'autre ») ne change pas : 3 + 3 au cas A, 4 + 4 au cas B.

| Fenêtre | `H` | cas A : `listH` | lignes A | cas B : `listH` | lignes B |
|---|---|---|---|---|---|
| 720 × 520 | 231 | 61 | **1** (sans en-têtes) | 159 | **2** |
| 768 × 576 | 287 | 117 | **1** | 215 | **3** |
| 820 × 620 | 331 | 161 | **2** | 259 | **4** |
| 896 × 672 | 383 | 213 | **3** | 311 | **5** |
| 1024 × 768 | 479 | 309 | **5** | 407 | **7** |
| 1280 × 800 | 511 | 341 | **6** | 439 | **8** |
| 1440 × 900 et au-delà | 512 | 342 | **6** | 440 | **8** |

Chaque ligne se rejoue : `H` est la colonne `H` du tableau § 3.2 de la proposition ; les
largeurs (`track`) et le nombre de caractères par ligne (`floor(track / 7,6)` : 42 à 320 px)
**ne changent pas** — le portrait ne prend aucune largeur, il est **sous** la liste.

**Note de fidélité, à ne pas confondre avec un doute** : le panneau réel du travail affiche
**trois** groupes (« En cours », « Démarrage », « En attente », `src/js/agent-activity.js:855-856`),
la décision 2 n'en demande que **deux** pour l'écran Vocal (« en cours d'abord, puis en
attente »). Le tableau ci-dessus compte **deux** en-têtes (40 px), comme le § 3.3. Si
l'implémentation en affichait trois, on perdrait **une ligne** à chaque hauteur (donc 5 au
cas A, 7 au cas B à `H = 512`) : la règle des deux cas ne change pas, seule la dernière ligne
du compte change.

### 2.6 Liste vide : la colonne n'est jamais un trou

Dans **les deux cas**, une colonne sans mission affiche, sous le titre : **« Aucune tâche en
cours »** (11 px, gris) — le libellé du § 3.3. Et la ligne d'activité dit **« Tout est au
repos »**. La colonne la plus vide possible contient donc : « TÂCHES », une phrase, une
phrase. Aucune zone muette, aucune hauteur morte.

- **Cas B, liste vide** : on voit donc le titre, la phrase, puis l'air, puis la ligne
  d'activité. L'air est plus grand que dans le cas A, et c'est normal : il n'a **rien à
  réserver**, il est seulement de l'air.
- **Cas A, liste vide** : titre, phrase, air, puis portrait, nom, ligne d'activité.

### 2.7 Défilement : jamais

- La liste **ne défile pas** : la colonne est `pointer-events: none` (contrainte qui prime) et
  `overflow: hidden`. Une liste qui défile sans pouvoir être touchée serait un piège.
- Le nombre de lignes **suit la hauteur** (§ 2.5) ; au-delà, l'excédent est **dit** :
  « + N autre(s) » (11 px), et la liste complète reste dans le bouton **« Travail »**.
- La ligne « + N autre(s) » est **collée sous la dernière tâche** (donc en haut de la liste),
  **jamais** collée au bloc du portrait : elle ne bouge pas quand le personnage apparaît.

---

## 3. Pourquoi le portrait passe **sous** la liste, et pas **à côté** (tranché)

Le propriétaire laissait le choix (« au-dessus / à côté »). **C'est « au-dessus » (donc, pour
le portrait : *sous* la liste) qui est retenu**, pour trois raisons concrètes :

1. **La largeur de la liste ne bouge pas.** Un portrait **à côté** prendrait 72 px + 12 px
   d'écart dans une colonne de 320 px : la liste tomberait à **236 px**, soit **31 caractères**
   par ligne, sous le plancher de **33 caractères** qui justifie le seuil d'affichage des
   colonnes (`doc` § 3.1). L'utilisateur lirait des morceaux de mots pour voir un visage à
   côté. En dessous, la liste garde ses **42 caractères**.
2. **Rien ne bouge en haut quand le personnage apparaît.** La liste commence à la même
   hauteur dans les deux cas : quand le propriétaire active ou désactive son personnage, la
   ligne qu'il était en train de lire **ne se déplace pas**. À côté, la liste se serait
   rétrécie de 84 px d'un coup, en pleine lecture.
3. **Le portrait ne concurrence pas l'ordre de lecture.** En bas, il occupe la place d'une
   personne assise au bout de la table : on le voit, il ne prend pas la première ligne. En
   haut, il aurait été la **première** chose lue — avant les tâches, alors que la décision 2
   dit que la colonne parle d'abord du **travail**.

**Le portrait reste centré dans la colonne** (décision déjà prise, § 2.2 de la proposition, `align-self: center`), à 124 px d'air de chaque côté à 320 px de large : c'est le seul élément
centré de la colonne, ce qui le fait lire comme **une personne**, pas comme une ligne de
liste de plus. Il ne reçoit ni ombre, ni anneau, ni bordure d'état.

---

## 4. Passer d'un cas à l'autre : sans redémarrage, sans saut

### 4.1 Quand la décision se prend (aucun mécanisme nouveau)

| Moment | Ce qui se passe | Preuve |
|---|---|---|
| À l'ouverture de l'onglet 🧭 | le personnage est relu **avant** que l'écran Vocal puisse s'ouvrir (`await refreshAssistantPersonaAndApply()`), puis `enterVocal()` termine par `vocalSyncSides()` : la colonne est peinte **déjà** dans le bon cas | `src/js/super-agent.js:3213` ; `doc` § 3.5 |
| Fenêtre qui reprend le focus | le personnage est relu (c'est déjà le cas aujourd'hui) ; le **tic de 900 ms** (`VOCAL_SIDES_TICK_MS`) réapplique la disposition au plus tard **0,9 s** plus tard | `src/js/super-agent.js:3217-3220` ; `doc` § 3.5 |
| Redimensionnement | `resize` recalcule largeur **et** cas, en une passe | `doc` § 3.5 |

- **Aucun redémarrage** de Pilot n'est nécessaire : c'est le mécanisme **existant** de relecture
  du personnage.
- **Aucune lecture de disque nouvelle**, **aucune minuterie nouvelle**, **aucun état nouveau** :
  la disposition lit `getAssistantPersona()` **en mémoire**, comme le fait déjà le portrait de
  l'onglet.
- La fonction pure de calcul (`planVocalSides`) reçoit **un booléen de plus** —
  « un portrait affichable existe » — et rend `listHeight` en conséquence. Une seule formule,
  les deux cas.

### 4.2 Ce qui bouge, ce qui ne bouge pas

| Élément | Quand le personnage apparaît | Quand il disparaît |
|---|---|---|
| Titre « TÂCHES » | **ne bouge pas** | **ne bouge pas** |
| 1ᵉʳ ligne de tâche | **ne bouge pas** | **ne bouge pas** |
| Les lignes déjà affichées | **ne changent pas de hauteur** (46 px toujours) et **ne se déplacent pas** | idem |
| Bas de la liste | remonte de **98 px** ; au plus **2 lignes** quittent le bas et « + N autre(s) » les compte | descend de **98 px** ; au plus **2 lignes** reviennent |
| Bloc portrait + pastille | **apparaît** au pied de la colonne, déjà à sa place définitive | **disparaît** |
| Ligne d'activité | **ne bouge pas d'un pixel** | **ne bouge pas d'un pixel** |

**Ce qui fait qu'il n'y a pas de « saut brutal »** : rien ne bouge **au-dessus** de la zone qui
change, rien ne change de taille, et **deux choses seulement** changent — la hauteur du bas de
la liste (98 px) et la présence du bloc du portrait. L'œil qui lisait une tâche continue de la
lire au même endroit.

### 4.3 Aucune animation

- Pas de fondu, pas de glissement, pas de `transition` sur la hauteur : la disposition change
  **en une peinture**. C'est la règle **déjà** posée pour les colonnes (`doc` § 5.4 : « aucune
  animation propre aux colonnes ») et elle vaut pour le passage d'un cas à l'autre.
- `prefers-reduced-motion` : rien à neutraliser, puisqu'il n'y a rien à animer.

### 4.4 Cas de panne : ils donnent le cas B, sans message

| Situation | Ce que voit l'utilisateur |
|---|---|
| Personnage jamais activé | cas B : tâches sur toute la hauteur, aucune image |
| Personnage désactivé (fichiers retirés par Présences) | au plus tard 0,9 s après le retour de focus : le bloc portrait disparaît, la liste s'allonge ; **aucun message**, aucune trace |
| Image refusée (mauvais type, > 8 Mio, contenu illisible) | cas B. **Jamais** une icône d'image cassée à la place du portrait : ce serait une zone morte avec un symbole d'erreur dedans |
| Commande Rust en panne | cas B (repli silencieux existant) |

---

## 5. L'alignement avec la colonne de gauche

| Repère | Colonne de gauche (discussion) | Colonne de droite (tâches) |
|---|---|---|
| **Haut** | titre « DISCUSSION » à **14 px** du bord haut | titre « TÂCHES » à **14 px** du bord haut : **même ligne de base**, à un pixel près |
| **Largeur** | `track` (`doc` § 3.1) | **le même `track`** — le portrait ne prend pas de largeur |
| **Hauteur** | `H` | **le même `H`** (les deux colonnes s'arrêtent au bas de la boîte du disque) |
| **Bas** | le dernier échange est **collé au bas** | la ligne d'activité est à **12 px** du bas |
| **Ce qui est centré** | rien | **le portrait seul** (et sa pastille) |
| **Ce qui est ancré en haut** | le titre seul | **le titre et la liste** |

Les deux colonnes se lisent donc de la même façon : on entre par le haut (les deux titres),
on sort par le bas (le dernier échange à gauche, la ligne d'activité à droite). La colonne de
droite gagne seulement **un objet posé au pied**, entre les deux.

---

## 6. Ce que ce document a changé dans les documents (fait, et vérifiable)

Dans `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md` — **onze corrections de
disposition** (plus le bandeau, le § 8.1 et le § 9, qui ne portent qu'une note de révision),
chacune avec la phrase exacte qui devient fausse :

| Où | Aujourd'hui | Après |
|---|---|---|
| Bandeau (tout en haut du fichier) | « le portrait quitte le cercle et prend **le haut** de la colonne de droite » | « … prend **le pied** de la colonne de droite, **sous** les tâches (révision du 2026-10-29, `CONCEPTION-ecran-vocal-taches-en-haut-portrait-en-bas.md`) » — **fait** |
| § 0, décisions 1 et 2 | portrait « en haut de la colonne de droite » ; ordre « portrait → tâches → une ligne » | portrait **au pied** ; ordre « **tâches** → portrait → une ligne » — **fait** |
| § 1.1 | « la droite va du portrait vers les tâches puis vers une ligne d'activité » | « du **titre** vers les **tâches**, puis vers **le portrait** et une ligne d'activité » — **fait** |
| § 1.2 | ordre : portrait → pastille → titre → tâches → ligne d'activité | ordre : **titre → tâches → portrait → pastille → ligne d'activité** ; les 72 px, 6 px, 20 px, 14 px, 18 px, 12 px **ne changent pas**, seul l'**ordre** change — **fait** |
| § 1.5, schéma | portrait en haut de la colonne de droite | portrait **au bas** de la colonne de droite — **fait** |
| § 2 (intro) | « un médaillon rond du personnage, **en haut à droite** du disque » | « **au pied de la colonne de droite**, sous les tâches » — **fait** |
| § 2.1, balisage | `vocal-side-tasks` → `vocal-portrait` → `vocal-portrait-name` → `vocal-side-body` | `vocal-side-tasks` → **`vocal-side-body`** → **`vocal-portrait`** → **`vocal-portrait-name`** (mêmes nœuds, même nombre : **aucun nœud ajouté**, les listes ordonnées des deux tests changent d'**ordre**, pas de **longueur**) — **fait** |
| § 2.2, CSS | `.vocal-side-tasks` sans `justify-content` ; `.vocal-portrait` sans `hidden` | `.vocal-side-tasks` : `justify-content: flex-start` + `overflow: hidden` ; ligne neuve `.vocal-side-body` : `flex: 1 1 auto; min-height: 0; overflow: hidden` ; `.vocal-portrait` : `[hidden]` quand il n'y a pas de portrait — **fait** |
| § 3.3, plafond et budget | plafond 6 ; un seul budget `listeH = H − 170` | plafond **6 avec personnage / 8 sans** ; **deux** budgets `H − 170` / `H − 72` — **fait** |
| § 7 | « Le repli ? `/logo_pilot_vector.svg`, exactement comme l'écran d'accueil » et « Fichier absent ? le médaillon montre le logo » | « **aucun repli dans la colonne** : sans portrait, il n'y a **pas** d'image ; le nom reste lisible sur le bouton de relance du cercle » — **fait** |
| § 2.4, § 3.6, tests 10, 11 et 12 | `planVocalSides` rend `listHeight`, qui désigne **deux** choses selon la phrase (la colonne `H`, ou la place de la liste) | `planVocalSides({ width, height, orbSize, hasPortrait })` rend `columnHeight` (`H`) **et** `listHeight` (`H − 170` / `H − 72`) : deux noms, deux valeurs — **fait** |

Et dans `spec_modes_ecran_vocal.md` : **un paragraphe neuf**, le **§ 3ter**, marqué
« non livré » (voir § 7 ci-dessous) — **fait**.

**Ce qui n'est pas réécrit** : le § 3.3 sur l'ordre des groupes et le nombre de lignes, le § 3.4 sur la ligne d'activité (une ligne, six cas), le § 5 (les six hôtes, les trois sorties, les jetons), le § 6 (le bouton « Informations »). Un seul point est retouché, et il faut le dire : au **§ 1.2 (point 5)**, la ligne d'activité était ancrée par `margin-block-start: auto`. Comme le portrait doit lui
aussi être ancré en bas, **deux marges automatiques se partageraient l'air** et le portrait
flotterait au milieu de la colonne. Donc : **c'est la liste (`vocal-side-body`) qui absorbe
l'air** (`flex: 1 1 auto; min-height: 0`), et la marge automatique de la ligne d'activité
**disparaît**. Une seule mécanique d'ancrage, un seul endroit de l'air.

---

## 7. Ce que ce document a changé dans la spécification

Un paragraphe ajouté à `spec_modes_ecran_vocal.md` sous le titre **§ 3ter — La colonne de
droite de l'écran Vocal (tâches, personnage) — 🟡 conception écrite, non livrée** (les
colonnes ne sont pas encore écrites, `grep -c "vocal-side"` = 0) : il dit la règle des deux
cas, le critère « personnage actif », la hauteur de 98 px réservée au cas A, les 0 px du cas
B, le fait que la liste ne défile pas, et qu'aucun réglage n'est créé. Aucune autre phrase de
la spec n'est réécrite.

**L'aide intégrée (`help/overview.md`, bloc `<!-- HELP:modes-ecran -->`) n'est pas touchée** :
elle décrit ce que l'utilisateur voit **aujourd'hui**, et rien de tout cela n'est encore
livré. Le bloc sera mis à jour **avec** l'implémentation, pas avant.

---

## 8. Ce que ce document change dans les tests

| # | Nom | Ce qu'il vérifie | Il échoue si… |
|---|---|---|---|
| **T9** *(amendé)* | « le portrait est un médaillon **au pied** de la colonne de droite, pas du disque » | `.vocal-portrait` est **dans** `.vocal-side-tasks`, **après** `.vocal-side-body` dans l'ordre du document ; 72 px, `border-radius: 50%`, centré ; **aucun repli** : quand `getAssistantPortrait()` est vide, l'image est **`hidden`** et son `src` **n'est pas** le logo | le portrait est en haut, ou une image de remplacement apparaît dans la colonne |
| **T12** *(étendu)* | « les tâches : en cours d'abord, en attente ensuite » | l'ordre des groupes **ne bouge pas** ; **le nombre de lignes suit la hauteur ET le cas** : les **sept** lignes du tableau § 2.5 (plafond **6** avec portrait, **8** sans) | une ligne du tableau § 2.5 dévie, ou le plafond ne dépend pas du cas |
| **T18** *(nouveau)* | « sans personnage, la colonne ne réserve rien » | `planVocalSides({ hasPortrait: false })` → `listH = H − 72` ; `planVocalSides({ hasPortrait: true })` → `listH = H − 170` (deux valeurs **nommées distinctement** de `H`, voir le piège de vocabulaire du § 2.5) ; dans le cas B, **ni** `.vocal-portrait`, **ni** `.vocal-portrait-name` ne sont affichés (attribut `hidden`), et **aucune** hauteur n'est réservée à leur place | il reste 98 px vides, ou un médaillon de remplacement, ou `listH` ne change pas |
| **T19** *(nouveau)* | « le portrait ne bouge pas quand la liste change » | pour un **même** `H`, `listH` est **identique** que la liste porte 0, 1 ou 6 missions ; l'ordre du document reste **titre → liste → portrait → pastille → ligne d'activité**, quel que soit le nombre de tâches | la place du portrait dépend du nombre de tâches |
| **T17** *(inchangé)* | « la sortie reste cliquable » | six hôtes exactement, aucun nœud focusable dans la colonne, Échap toujours géré | un septième hôte apparaît, ou la colonne capte un clic |
| les deux listes ordonnées déjà citées au § 8.1 de la proposition (`ecran-vocal-lot2.test.js`, `vocal-halo-128-et-etat-au-dessus-saisie.test.js`) | — | **même nombre d'entrées**, **ordre** `vocal-side-body` → `vocal-portrait` → `vocal-portrait-name` | le nombre d'entrées change (ce serait un nœud ajouté, et il ne doit pas y en avoir) |

**Aucun autre test ne bouge** : le disque, le halo, le micro, le bas qui s'efface, le bouton de
relance, le bouton « Travail » ne sont pas concernés.

---

## 9. Ce que ce document ne change pas (liste ferme)

| Décision déjà tranchée | Reste intacte |
|---|---|
| Le bouton des modes **est le logo** | oui, à sa place, seule la sortie |
| Le bas de l'écran **s'efface au repos** (2,5 s) | oui, la colonne suit le mouvement existant |
| **Trois sorties** : logo, Échap, fermeture de l'onglet | oui, `T17` les tient |
| Le disque ne porte **rien** dedans (ni portrait, ni texte permanent) | oui |
| **Six hôtes cliquables** | oui, la colonne n'en ajoute aucun |
| **Aucun réglage nouveau**, aucune persistance | oui : ni `localStorage`, ni fichier, ni case à cocher |
| Le portrait **ne change pas de taille** (72 px) | oui, dans les deux cas |
| Les **titres** des deux colonnes, les **largeurs**, la **ligne d'activité** | oui |

---

## 10. VERDICT

**Prêt à appliquer, sans interprétation** :

1. **Cas A (personnage actif)** — colonne de droite de haut en bas : 14 px, « TÂCHES »,
   14 px, **la liste ancrée en haut**, l'air, **le portrait 72 px ancré en bas** (centré),
   6 px, **la pastille du nom** 20 px, 12 px, **la ligne d'activité** 18 px, 12 px.
   Hauteur réservée : **98 px**.
2. **Cas B (aucun personnage)** — mêmes éléments **moins** le portrait, l'écart et la pastille :
   la liste passe de `H − 170` à **`H − 72`** et le plafond de **6 à 8** lignes ; **0 px**
   réservé.
3. **Critère unique** : portrait affichable (`getAssistantPortrait() !== ""`). Rien d'autre
   n'est lu, aucun état n'est mémorisé.
4. **Passage d'un cas à l'autre** : mécanisme **existant** de relecture du personnage, au plus
   tard **0,9 s** après le retour de focus, **en une peinture**, **sans animation** ; le haut
   de la colonne et la ligne d'activité **ne bougent pas**.
5. **Pourquoi sous et pas à côté** : la liste garde ses **42 caractères** (à côté, 31, sous le
   plancher de 33), et la ligne qu'on lit ne se déplace pas.
6. **Le portrait ne devient jamais le logo dans la colonne** : sans image, il n'y a **pas**
   d'image. Le nom reste lisible sur le bouton du cercle.

**Reste à décider** : **rien**. La seule marge de manœuvre laissée au propriétaire est celle
qu'il n'a pas demandée : si « le portrait occupe la partie droite » voulait dire *plus grand
qu'un médaillon de 72 px*, ce serait une décision **nouvelle** (elle rouvrirait la décision 1,
« nettement plus petit que le disque »). **La valeur appliquée ici est 72 px**, telle que déjà
retenue et justifiée ; tout ce document tient si elle est conservée.

**Ce que je n'ai pas pu vérifier** :

- **Rien n'est mesuré sur un écran réel** : les colonnes ne sont pas écrites
  (`grep -c "vocal-side"` → 0). Tout ce document est un plan ; il ne peut être constaté qu'après
  implémentation, par les tests T9, T12, T17, T18 et T19.
- **Le nombre d'en-têtes de groupe** : le panneau réel en affiche **trois**
  (`src/js/agent-activity.js:855-856`), le § 3.3 de la proposition en compte **deux**. Ma table
  suit les **deux** de la décision 2 ; si l'implémentation en affiche trois, chaque hauteur perd
  **une ligne** et la règle des deux cas reste vraie.
- **`AGENTS.md` reste en retard** sur ce sujet : il annonce encore « Portrait dans le cercle +
  deux colonnes » pour ce document de conception. Il n'est pas modifié ici (ce document ne
  touche ni au code ni aux instructions du projet) ; à corriger lors de l'implémentation.
