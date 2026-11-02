# Conception — le bouton « Distant » passe dans la barre du haut, à gauche de « Travail »

> **Nature du document** : proposition écrite. **Aucun code de l'application n'a été
> modifié, aucun commit.** Tout ce qui suit est constaté sur le disque, avec
> `fichier:ligne`. Ce que je n'ai pas pu vérifier est dit au § 11, jamais supposé.
>
> **Demande du propriétaire** : le bouton « Distant », avec son nombre de connexions
> distantes, **à gauche de « Travail »** dans la barre du haut. Bénéfice attendu :
> **gagner une ligne** dans la colonne de gauche, ce qui remonte tout le bloc du dessous
> (projets en cours, puis explorateur de fichiers).

---

## 0. Ce qui est déjà tranché (repris comme contraintes fermes, non rouvertes)

| # | Décision | Conséquence sur cette proposition |
|---|---|---|
| 1 | La hauteur de la barre du haut est **validée à l'écran** | On **n'agrandit pas** la rangée : elle reste `min-height: 36px` + 1 px de filet. Le badge doit tenir dedans. |
| 2 | La colonne de gauche est **fixe à 280 px** | Aucune proposition d'élargissement. Le gain est en **hauteur**. |
| 3 | Le **coin haut droit** garde son air (logo, libellé du moteur, « Assistant seul ») | On ne touche à **rien** de ce coin. Le badge arrive **à gauche** de « Travail », donc loin de `#window-controls`. |
| 4 | **Aucune fonctionnalité, aucun réglage, aucun bouton ajoutés** | On **déplace** un élément existant, avec le même identifiant, les mêmes libellés, la même icône, le même clic, le même titre. Zéro nœud fonctionnel nouveau. |

---

## 1. Constat sur le disque (preuves)

### 1.1 Où est « Distant » aujourd'hui

| Élément | Preuve |
|---|---|
| Le badge est `#remote-badge`, **enfant de `#global-actions`** | `index.html:80` (`<div id="global-actions">`) → `index.html:81` |
| `#global-actions` est le **2ᵉ enfant de `#sidebar`**, juste **sous** le bandeau du nom de projet et **au-dessus** de la barre « Projets en cours » | Ordre du DOM : `index.html:41` (`#project-selector`) → `:80` → `:83` (`#open-projects-bar`) → `:84` (`#tree-filter-wrapper`) → `:87` (`#favorites-section`) → `:88` (`#file-tree`) → `:131` (`#project-footer`) |
| Marque visible | `<i data-lucide="globe" class="icon-sm">` + `<span class="remote-badge-label">Distant</span>` + `<b id="remote-badge-count">0</b>` (`index.html:81`) |
| Infobulle (seule explication du clic) | `title="Client(s) distant(s) connecté(s) — cliquer pour gérer"` (`index.html:81`) |
| Hauteur occupée **quand il s'affiche** | **44 px** = `margin` 8 en haut + `height: 28px` + `margin` 8 en bas (`.remote-badge`, `src/css/style.css:7272` → `margin: 8px 8px 8px auto;`, `height: 28px`) |
| Hauteur occupée **quand il est masqué** | **0 px** : `.remote-badge.hidden { display: none; }` (`src/css/style.css:7311`) et `#global-actions` n'a **ni marge ni remplissage** (`margin: 0; padding: 0;`, `src/css/style.css:775`) |
| À côté de lui | **rien**. `#global-actions` n'a plus qu'un seul enfant : le badge. Le commentaire le dit (`index.html:71-79`) et un verrou l'exige — **0 bouton** dans ce conteneur (`src/js/lot2-colonne-haut.test.js:207-212`, `src/js/retrait-ecran-aide.test.js:58-70`) |
| Câblage (à ne pas casser) | `remoteBadge.addEventListener("click", () => btnSettings.click())` (`src/js/settings.js:3194`) — **sans `?.`** : l'élément doit exister dans le DOM |
| Commentaire d'intention à réécrire | `index.html:71-80` justifie que le conteneur « RESTE dans le DOM **parce qu'il porte le badge « Distant »** » : ce texte devient faux et doit être réécrit dans le même changement |
| Remplissage des états | `pollRemoteBadge()` toutes les 5 s (`src/js/settings.js:3196-3210`) |

### 1.2 Où est exactement « Travail », et comment la zone est construite

| Élément | Preuve |
|---|---|
| La rangée est `#tab-row`, **une seule rangée de 36 px + 1 px de filet = 37 px peints**, en haut de la zone de travail | `src/css/style.css:1854` (`min-height: 36px`, `border-bottom: 1px solid var(--border-subtle)`) ; hauteur peinte verrouillée : `src/js/compteur-taches-travail.test.js:342-343` |
| Enfants de `#tab-row`, dans l'ordre du DOM | `#tab-bar` (`index.html:228`) → `#agent-activity` (`:254`) → `#window-controls` (`:304`) |
| `#tab-bar` prend **toute la largeur restante** et **défile** | `flex: 1 1 auto; min-width: 0; overflow-x: auto` (`src/css/style.css:1868`) |
| « Travail » = le bouton `#agent-activity-entry`, dans son propre conteneur `#agent-activity` | `index.html:255` ; `src/css/style.css:1894` (conteneur, `margin: 0 6px 0 4px; align-self: stretch`) et `:1930` (bouton `height: 22px`, `padding: 0 8px`, `gap: 6px`, `font-size: var(--font-xs)` = 11 px, `600`) |
| Pastille d'état | `#agent-activity-dot`, 8 px (`src/css/style.css:1964`) |
| Compteur de travail | `#agent-activity-count`, texte seul, `min-width: 22px`, chiffres à largeur constante (`src/css/style.css:1996-2008`) |

### 1.3 La hauteur réelle de la barre du haut, et la place libre à gauche de « Travail »

- **37 px peints** (36 px de contenu + 1 px de filet) — voir 1.2.
- **Il n'existe pas de « trou » à gauche de « Travail »** : la place libre est celle que
  `#tab-bar` n'utilise pas, et `#tab-bar` est précisément le bloc **extensible**
  (`flex: 1 1 auto`, `src/css/style.css:1868`). Conséquence directe : **un élément
  inséré entre `#tab-bar` et `#agent-activity` ne « prend pas » une place vide — il
  prend sa largeur aux onglets.** C'est le seul coût de ce déplacement, et il est
  chiffré au § 5.
- Place **réservée** à droite, à ne jamais rogner : `#window-controls` = 3 × 46 px +
  4 px d'air droit = **142 px** (`src/css/style.css:93`, `:117` ; recompté par
  `src/js/barre-fenetre-assistant-seul.test.js:105-116`).

### 1.4 Le bloc libéré : une ligne entière, ou quelques pixels ? (le chiffre honnête)

Ce n'est **pas** « toujours une ligne » : c'est **44 px quand le badge s'affiche, 0 px
quand il est masqué**. Le badge n'existe à l'écran que si le **serveur d'accès distant
tourne** (`src/js/settings.js:3198-3209` : `hidden` hors service, `off` s'il tourne sans
client, état vert dès 1 client).

| Situation réelle | Hauteur du haut de la colonne aujourd'hui | Ce que l'arbre de fichiers perd |
|---|---|---|
| Accès distant **arrêté** (badge masqué) | **0 px** | 0 px |
| Accès distant **actif, 0 client** → « 🌐 Distant 0 » gris | **44 px** | **44 px de listings** |
| Accès distant **actif, N clients** → « 🌐 Distant N » vert | **44 px** | **44 px de listings** |

Ce que 44 px représentent, dans les unités du projet :

- **1,4 ligne** du bloc du bas (une ligne = 32 px, `src/css/style.css:1698-1712`) ;
- **≈ 1,6 ligne** de l'explorateur (`.tree-row` = 4 + 18 + 4 + 2 ≈ 28 px,
  `src/css/style.css:1519-1525`) ;
- **10 %** de l'arbre à la fenêtre minimale de 500 px de haut (`minHeight: 500`,
  `src-tauri/tauri.conf.json:47-48`).

**Le gain n'existe donc que pendant que l'accès distant est en service.** C'est une
information que le propriétaire doit avoir avant d'appliquer : déplacer un élément
**masqué** ne rend aucun pixel.

**Ce que le déplacement règle en plus, et qui est permanent** : aujourd'hui, l'ouverture
d'un client distant **fait sauter la liste des fichiers de 44 px vers le bas** en pleine
session de travail (le badge apparaît, la colonne `#sidebar` est en `overflow: hidden`,
`src/css/style.css:752-759`, donc le seul bloc qui absorbe est `#file-tree`
(`flex: 1`, `src/css/style.css:1505`)). Après le déplacement, **la colonne ne bouge
plus jamais**, ni à la connexion ni à la déconnexion d'un client.

### 1.5 Ce que « Distant » affiche, et si ça tient dans la barre

Trois états seulement, déjà écrits dans le code (`src/js/settings.js:3198-3209`) :

| État | Classe | Rendu | Couleur |
|---|---|---|---|
| Serveur distant **arrêté** | `hidden` | **rien du tout** | — |
| Serveur **actif, 0 client** | `off` | 🌐 **Distant 0** | `--text-secondary` sur `--surface-2`, bordure `--border-subtle` (`.remote-badge.off`, `src/css/style.css:7305`) |
| Serveur **actif, ≥ 1 client** | (aucune) | 🌐 **Distant 3** | icône + compteur en `--success`, bordure `--success` 40 % (`.remote-badge:not(.off)`, `src/css/style.css:7297`) |

Largeur, calculée composant par composant (la même arithmétique que le reste de la
feuille) :

```
remplissage 8 + 8            = 16
icône globe .icon-sm         = 14
2 espaces de gap (4 + 4)     =  8
mot « Distant » 11 px / 600  ≈ 43 à 45
compteur (« 0 » à « 12 »)    ≈ 6 à 13
bordure 1 + 1                 =  2
                               ─────
                       total ≈ 89 à 98 px
```

→ **≈ 92 px** avec un chiffre, **≈ 98 px** avec deux. Rien n'est tronqué : le badge est
en `white-space: nowrap` et en `flex: 0 0 auto` de fait (`width: auto`,
`src/css/style.css:7272-7286`), il ne peut pas rétrécir. Il consomme donc **~2,6 %**
d'une fenêtre de 1280 px de large et **~11 %** de la zone utile à 800 px (§ 5).

### 1.6 Le rapport de repli des menus du bas — je ne le contredis pas en silence

`RAPPORT-conception-repli-menus-bas.md` existe et concerne la même colonne. Points
concernés :

| Ce que dit ce rapport | Ce que ma proposition en fait |
|---|---|
| § 0 : « le badge « Distant » (#remote-badge, index.html:81) […] — **il n'est pas dans le bloc et n'est pas touché** » | **Vrai pour le bloc** (je ne touche pas `#project-footer`). **Devient faux sur « pas touché »** : le badge quitte la colonne. À réécrire dans ce rapport (§ 0 et § 6). |
| § 3.1 : « Arbre de fichiers à 500 px de haut : ≈ **402 px** replié, ≈ 174 px déplié » | Ce calcul suppose le badge **masqué** (0 px). Avec un client distant connecté, la réalité est **358 px** replié. Après mon déplacement, **402 px** devient vrai **tout le temps**. Ma proposition **rend son chiffre exact**. |
| § 6, ligne « Plier aussi `#global-actions` » : refusé parce que « il porte l'état « Distant » : le plier cacherait une information » | Après mon déplacement, `#global-actions` **ne porte plus aucun état** (conteneur vide). L'argument de refus devient caduc — **sans rien rouvrir** : le repli ne le plie toujours pas, et il n'y a plus rien à cacher. |
| § 2.1 (replié = 50 px) et § 3.1 (déplié = 278 px / 88 px) | **Inchangés** : ce sont les hauteurs internes du cadre du bas. Aucun conflit. |

**Aucune contradiction de fond** : les deux propositions se cumulent sans se gêner, et
la mienne **stabilise** l'arithmétique de l'autre.

---

## 2. État cible — ORGANISATION

### 2.1 L'emplacement retenu, mot pour mot

Le badge devient un **enfant direct de `#tab-row`**, placé **entre `#tab-bar` et
`#agent-activity`** :

```
#tab-row  (36 px, inchangé)
 ├─ #tab-bar            (onglets, défile, flex: 1 1 auto)
 ├─ #remote-badge       ← DÉPLACÉ ICI : immédiatement à GAUCHE de « Travail »
 ├─ #agent-activity     (« Travail », inchangé)
 └─ #window-controls    (3 boutons système, inchangés, place réservée)
```

Et, dans la colonne de gauche, `#global-actions` **reste dans le DOM** mais **vide**
(0 px, aucun enfant) — voir § 8, risque 4, pour la raison exacte (4 ancres de test).

Lecture à l'écran, de droite à gauche en haut de la fenêtre :
`[Réduire | Agrandir | Fermer]` … `[● Travail 2/5]` … `[🌐 Distant 3]` … `[onglets ←…]`

**Pourquoi là et pas ailleurs** : c'est le seul endroit qui soit à la fois « dans la
barre du haut » (demande), « à gauche de Travail » (demande), et **hors du coin haut
droit réservé** (contrainte 3). Le placer après « Travail » ou avant les boutons
système l'aurait mis dans l'angle en cours de correction.

### 2.2 Ce qu'on voit selon le nombre de connexions (0, 1, plusieurs)

| Connexions | Affichage exact dans la barre du haut | Place occupée |
|---|---|---|
| Serveur distant **arrêté** | **rien** (aucune trace, comme aujourd'hui) | **0 px** |
| Serveur actif, **0** client | 🌐 `Distant` `0` — gris, bordure discrète | ≈ 92 px |
| Serveur actif, **1** client | 🌐 `Distant` `1` — icône et compteur **vert `--success`** | ≈ 92 px |
| Serveur actif, **N** clients | 🌐 `Distant` `N` — vert, compteur en chiffres à largeur constante | ≈ 92 px (N < 10) / ≈ 98 px (N ≥ 10) |

Le chiffre est **le même** que celui du panneau Paramètres → 🌐 Accès distant
(`web_status.active_count`, `src/js/settings.js:3201`). Aucune nouvelle source.

### 2.3 Combien de clics (avant / après)

| Geste | Aujourd'hui | Après |
|---|---|---|
| **Savoir** combien de clients sont connectés | 0 clic (badge visible en haut de la colonne) | **0 clic** (badge visible en haut de la fenêtre) |
| **Gérer** l'accès distant | 1 clic sur le badge → Paramètres | **1 clic**, identique |
| **Voir la liste des fichiers** | il faut la faire défiler de 44 px de moins quand un client se connecte | **aucun déplacement** |

---

## 3. État cible — PRÉSENTATION (applicable sans interprétation)

### 3.1 Contrat d'application

**HTML — `index.html:81`** : la ligne du badge est **coupée** de `#global-actions` et
**replantée** telle quelle, au même niveau d'indentation, **juste avant** la ligne
d'ouverture de `#agent-activity` (`index.html:254`). **Aucun attribut ne change** :

```html
<!-- entre index.html:228 (#tab-bar, ligne vide) et index.html:254 (#agent-activity) -->
      <span id="remote-badge" class="remote-badge hidden" title="Client(s) distant(s) connecté(s) — cliquer pour gérer"><i data-lucide="globe" class="icon-sm"></i><span class="remote-badge-label">Distant</span> <b id="remote-badge-count">0</b></span>
```

`#global-actions` (`index.html:80-82`) devient une paire de balises vide, **avec son
commentaire** expliquant qu'il ne reste que pour ne pas réécrire quatre ancres de test
(§ 8, risque 4).

**CSS — bloc `.remote-badge` (`src/css/style.css:7272`)** : seules **trois**
déclarations changent, **aucune couleur, aucune taille de texte, aucun jeton** :

| Déclaration | Aujourd'hui | Cible | Pourquoi |
|---|---|---|---|
| `margin` | `8px 8px 8px auto` | **`0 2px 0 0`** | Plus d'air vertical propre (la rangée le centre), et 2 px + les 4 px de marge gauche de « Travail » = **6 px** entre les deux, l'écart des autres barres d'outils (`gap: 6px`) |
| `align-self` | *(absent)* | **`center`** | 28 px dans une rangée de 36 px → **4 px d'air en haut et en bas**, exactement au niveau des onglets (`.tab` 28 px + `padding: 4px 6px` de `#tab-bar`) |
| `height` | `28px` | **`28px` — inchangé** | Cohérent avec les onglets (28 px) et les boutons système (28 px). Ne pas descendre à 22 px : ce serait le seul élément de la rangée à changer de famille. |
| `transition` | `background .15s, color .15s, border-color .15s` | inchangé **+ `transform .1s var(--ease-spring)`** | Pour l'état d'appui (§ 3.3) |
| tout le reste | — | **inchangé** | `width: auto`, `padding: 0 8px`, `font-family: var(--font-ui)`, `font-size: var(--font-xs)` (11 px), `font-weight: var(--font-semibold)` (600), `border-radius: var(--radius-sm)`, `background: var(--surface-2)`, `border: 1px solid var(--border-subtle)`, `white-space: nowrap` |

**CSS — rangée** : `#tab-row` (`src/css/style.css:1854`) **ne change pas d'une ligne**
(pas de `height`, pas de `min-height`, pas de `gap`). Le seul ajout est un commentaire
de deux lignes expliquant le nouvel ordre.

**JS — `src/js/window-controls.js:62-64`** : ajouter **`#remote-badge`** à
`WINDOW_GESTURE_BLOCKLIST`. **Obligatoire** : `#tab-row` est une **zone de glissement de
fenêtre** (`WINDOW_DRAG_ZONE_IDS`, même fichier `:55`, et les deux écouteurs `:362-380`).
Sans cette ligne, **un clic sur le badge démarre un déplacement de fenêtre** au lieu
d'ouvrir les Paramètres, et un double-clic agrandit la fenêtre.

**CSS — mode Zen** : ajouter `.remote-badge` à la liste existante
`body.zen-mode #sidebar, body.zen-mode #global-actions, body.zen-mode #project-footer`
(`src/css/style.css:3835-3839`). **Obligatoire pour ne rien changer au comportement** :
aujourd'hui le badge disparaît en Zen parce que toute la colonne disparaît ; sorti de la
colonne, il **réapparaîtrait** en Zen. Question fermée n° 1 (§ 12).

### 3.2 Écart à combler, en un tableau

| | Aujourd'hui | Cible | Écart |
|---|---|---|---|
| Zone | colonne de gauche, 2ᵉ bloc | rangée d'onglets, 2ᵉ bloc | **déplacement** |
| Ordre horizontal | — (seul dans son conteneur) | après les onglets, **avant** « Travail » | création d'un ordre |
| Hauteur | 28 px + 16 px d'air = 44 px | 28 px, centré dans 36 px | **-16 px de marge, -44 px pour la colonne** |
| Marge haute/basse | 8 / 8 | 4 / 4 (portées par la rangée) | -8 px |
| Marge gauche | `auto` (poussé à droite) | 0 (collé à droite des onglets, 6 px de `padding` de `#tab-bar`) | -8 px |
| Marge droite | 8 px | 2 px (+ 4 px de « Travail » = 6 px) | -6 px |
| Famille visuelle | inchangée | **inchangée** | **aucun écart** |
| Couleurs | jetons de thème | **jetons de thème, mêmes jetons** | **aucun écart** |
| Libellé, icône, identifiant, infobulle, clic | — | **identiques** | **aucun écart** |

### 3.3 États du bouton (les quatre demandés)

| État | Rendu exact | Preuve / justification |
|---|---|---|
| **Normal** (≥ 1 client) | fond `--surface-2`, bordure `--border-subtle` **mais** texte + icône + compteur en `--success`, bordure mêlée à `--success` 40 % | `.remote-badge:not(.off)`, `src/css/style.css:7297` (existant) |
| **Normal** (serveur actif, 0 client) | fond `--surface-2`, tout en `--text-secondary` | `.remote-badge.off`, `src/css/style.css:7305` (existant) |
| **Survol** | fond `--surface-3`, bordure `--border-hover` — **visible dans les deux états** | `.remote-badge:hover`, `src/css/style.css:7301` (existant) — **sauf sur `.off`** : `.off` est écrit **après** et impose son fond, donc le survol n'y change rien (écart relevé, § 10) |
| **Appui** (souris enfoncée) | fond `--surface-3`, bordure `--border-active`, `transform: scale(0.97)` | **Ajouté** : c'est la convention d'appui des boutons de la colonne (`.pj-panel button:active`, `src/css/style.css:1706`). Aujourd'hui le badge n'en a aucune → un clic ne « répond » pas, alors que ses deux voisins (onglets, boutons système) répondent |
| **Désactivé** | **n'existe pas et ne doit pas exister** | Ce n'est pas une action qui peut être indisponible : c'est un état, et le clic marche dans les deux états affichés (`src/js/settings.js:3194`, hors condition). L'état « serveur arrêté » est `display: none`, pas un état grisé |
| **Masqué** | `display: none` | `.remote-badge.hidden`, `src/css/style.css:7311` (existant) |
| **Focus clavier** | **aucun** (le badge est un `<span>`, il n'est pas atteignable au `Tab`) | Existant ; voir question fermée n° 3 |

### 3.4 Contraste — thème sombre ET thème clair

**Aucune paire de couleurs nouvelle, donc aucun contraste nouveau à valider.**

- Le badge garde **son propre fond** (`--surface-2`) et **son propre texte**
  (`--success` ou `--text-secondary`) : rien ne change dans le couple
  texte/fond du badge.
- Le **fond de référence derrière** le badge ne change pas non plus : `#tab-row` peint
  `var(--bg-sidebar)` (`src/css/style.css:1860`) et `#sidebar` peint
  `var(--bg-sidebar)` (`src/css/style.css:755`) — **le même jeton**. Le badge garde donc
  exactement le même environnement coloré, dans les deux thèmes et tous les sous-thèmes.
- Les valeurs de contraste du badge existant (documentées comme suffisantes : le
  compteur de travail voisin est justifié à **7,85:1 sombre / 5,70:1 clair**,
  `src/css/style.css:1990-1996`) restent valables telles quelles.

**Un seul point de vigilance réel** : le survol passe de `--surface-2` à `--surface-3`,
comme ses voisins — paire déjà utilisée partout, y compris par `#agent-activity-entry:hover`
(`src/css/style.css:1952`). Rien à inventer.

### 3.5 Alignement dans la rangée (à appliquer tel quel)

| Élément | Hauteur | Position verticale | Alignement |
|---|---|---|---|
| Onglets `.tab` | 28 px | 4 px du haut (`#tab-bar` `padding: 4px 6px`) | référence |
| **Badge « Distant »** | **28 px** | **4 px** (centré : (36-28)/2) | **même ligne d'axe que les onglets** |
| « Travail » | 22 px | 7 px (centré) | axe de texte |
| Boutons système | 28 px | 4 px (`#window-controls` `padding: 4px`) | même ligne d'axe |

Conséquence voulue : **le badge et les onglets partagent le même axe haut**, le badge se
lit comme un « onglet d'état » posé au bout de la rangée ; « Travail » reste le seul
élément plus bas, comme aujourd'hui.

---

## 4. Le gain mesuré dans la colonne, et ce que cela change

| | Aujourd'hui | Cible | Gain |
|---|---|---|---|
| Badge masqué (accès distant arrêté) | 0 px | 0 px | **0 px** |
| Badge affiché, 0 client | **44 px** | **0 px** | **44 px** |
| Badge affiché, N clients | **44 px** | **0 px** | **44 px** |
| Saut de la liste à la connexion d'un client | **-44 px d'un coup** | **aucun** | stabilité |
| Largeur de la colonne | 280 px | 280 px | inchangée |

Traduction concrète pour le bloc du dessous :

- **≈ 1,6 ligne de fichier de plus** dans l'explorateur (28 px par ligne) **ou**
  **1,4 ligne du bloc du bas** (32 px) — donc : un dossier de plus visible avant de
  faire défiler, pendant toute la durée où l'accès distant est en service.
- **Le fichier qu'on s'apprêtait à cliquer ne se dérobe plus** quand un client se
  connecte (`#sidebar` est en `overflow: hidden`, `src/css/style.css:752-759` : le seul
  bloc qui absorbe est `#file-tree`).

**Pourquoi c'est mieux pour l'utilisateur, en une phrase** : « il voit la même
information au même endroit, et sa liste de fichiers ne saute plus sous son curseur. »

---

## 5. Fenêtre étroite — que cède-t-on en premier, et que voit-on

`minWidth: 800` px (`src-tauri/tauri.conf.json:47`). La zone de travail vaut
`largeur - 280 (colonne) - 2 (séparateur)`.

Budget de la rangée, avec les mesures du disque (Travail ≈ 100 px conteneur compris,
badge ≈ 92 px) :

| Largeur fenêtre | Zone de travail | - boutons système (142) | - « Travail » (100) | - « Distant » (92) | **Reste pour les onglets** | Aujourd'hui (sans le badge) |
|---|---|---|---|---|---|---|
| 1280 (défaut) | 998 | 856 | 756 | **664** | **664 px** | 756 px |
| 1000 | 718 | 576 | 476 | **384** | **384 px** | 476 px |
| 900 | 618 | 476 | 376 | **284** | **284 px** | 376 px |
| **800 (minimum)** | 518 | 376 | 276 | **184** | **184 px** | **276 px** |

**Ce qui cède en premier : les onglets, et rien d'autre.** Ils cèdent **proprement** —
`#tab-bar` est `flex: 1 1 auto; min-width: 0; overflow-x: auto`
(`src/css/style.css:1868-1881`) : ils **défilent horizontalement**, ils ne sont jamais
tronqués, jamais coupés, et **jamais recouverts** (rien n'est en position fixe dans la
rangée).

**Ce qui ne cède jamais** : le badge (il ne peut pas rétrécir), « Travail », les trois
boutons système (place réservée, 142 px), la hauteur de la rangée (36 px).

**Coût assumé** : à 800 px de large, on perd **≈ 92 px** d'onglets, soit environ **deux
tiers d'un onglet de longueur moyenne** — « un onglet au lieu de deux avant de faire
défiler ». C'est le prix du déplacement ; il est borné, et il disparaît en grande
fenêtre (le parcours réel est 1280 px).

**Parade (LOT 2)** — sous **900 px** de large, on **efface le mot**, pas l'état :

```css
@media (max-width: 900px) {
  .remote-badge-label { display: none; }   /* reste : 🌐 3  (≈ 45 px au lieu de 92) */
}
```

- Rend **≈ 50 px** aux onglets : à 800 px, la barre d'onglets remonte de 184 → **≈ 234 px**.
- Le **compteur reste affiché** (c'est l'information) et l'**infobulle reste entière**
  (`title` inchangé : « Client(s) distant(s) connecté(s) — cliquer pour gérer »).
- Le mot « Distant » reste dans le HTML : **aucun verrou de nommage ne casse**
  (`src/js/lot2-colonne-haut.test.js:313-321` lit le HTML, pas le rendu).
- Le seuil 900 px est **déjà utilisé** dans la feuille (`@media (max-width: 900px)`,
  `src/css/style.css:8286`) : aucun point de rupture nouveau.

Question fermée n° 2 (§ 12) : garde-t-on ce repli du mot, ou le mot reste-t-il toujours ?

---

## 6. Survol, clic, et lisibilité du compteur sans cliquer

| Geste | Comportement cible | Identique à aujourd'hui ? |
|---|---|---|
| **Survol** | fond `--surface-3`, bordure `--border-hover` | **oui** (sauf l'état `.off`, § 3.3 et § 10) |
| **Clic gauche** | ouvre **Paramètres** (le panneau 🌐 Accès distant) via `btnSettings.click()` | **oui**, mot pour mot (`src/js/settings.js:3194`) |
| **Clic droit** | rien de spécifique (aucun menu sur le badge) ; le seul menu de la rangée est celui du **bouton Agrandir** (`src/js/window-controls.js:399`) — le badge n'est pas concerné | **oui** |
| **Double-clic** | **agrandit la fenêtre** si l'on ne fait rien ; **neutralisé** par l'ajout à `WINDOW_GESTURE_BLOCKLIST` → le double-clic sur le badge ne fait rien de plus que deux clics (donc Paramètres) | **modifié volontairement** : sans la parade, le badge deviendrait une poignée de fenêtre (§ 8, risque 1) |
| **Glisser** | **ne déplace pas** la fenêtre (même parade) | idem |
| **Clavier** | **non atteignable** (c'est un `<span>`) | **oui** — question n° 3 |
| **Compteur lisible sans cliquer ?** | **OUI** : le chiffre est affiché **en permanence** à droite du mot, en `font-variant-numeric: tabular-nums` ; il ne demande ni survol ni clic, et il ne « danse » pas quand il change | **oui**, aucune régression |

---

## 7. Avant / après, en un seul tableau

| Point | Aujourd'hui | Cible | Pourquoi c'est mieux |
|---|---|---|---|
| Place du badge | 2ᵉ bloc de la colonne, sous le nom du projet | 2ᵉ bloc de la rangée du haut, **à gauche de « Travail »** | l'état distant est **dans la barre d'état de la fenêtre**, pas dans un panneau de navigation |
| Colonne de gauche pendant une session distante | **-44 px** de listings, et **saut** à la connexion | **aucun pixel perdu, aucun saut** | il ne perd plus son fichier des yeux |
| Hauteur de la barre du haut | 36 + 1 px | **36 + 1 px** | contrainte 1 tenue |
| Largeur de la colonne | 280 px | **280 px** | contrainte 2 tenue |
| Coin haut droit | en correction | **non touché** | contrainte 3 tenue |
| Éléments créés | — | **aucun** (même `<span>`, même id, même titre, même clic) | contrainte 4 tenue |
| Onglets en fenêtre de 1280 px | 756 px | 664 px | coût assumé, nul en pratique (2 onglets tiennent encore) |
| Onglets à 800 px | 276 px | 184 px (→ 234 px avec le LOT 2) | coût borné, jamais de troncature |

---

## 8. Risques, et comment la proposition les évite

| # | Risque | Preuve | Parade |
|---|---|---|---|
| 1 | **Le badge devient une poignée de fenêtre** : `#tab-row` est une zone de glissement ; un clic démarrerait un déplacement au lieu d'ouvrir les Paramètres, un double-clic agrandirait la fenêtre | `src/js/window-controls.js:55` (zone), `:62-64` (liste d'exclusion **sans** le badge), `:362-380` (écouteurs) | **LOT 1** : ajouter `#remote-badge` à `WINDOW_GESTURE_BLOCKLIST`. Le verrou de cette liste utilise `toContain` (`src/js/barre-fenetre-etats.test.js:307-311`) → **reste vert** |
| 2 | **Les onglets perdent de la place** | § 5 | Ils cèdent en défilant (mécanisme existant) ; **LOT 2** rend ≈ 50 px sous 900 px |
| 3 | **Le badge réapparaît en mode Zen** (aujourd'hui il disparaît avec la colonne) | `body.zen-mode #sidebar`, `src/css/style.css:3835-3839` | **LOT 1** : ajouter `.remote-badge` à cette liste → comportement **strictement identique** (question n° 1 si le propriétaire préfère l'inverse) |
| 4 | **`#global-actions` devient un conteneur vide** (balisage mort) | `index.html:80-82` | **On le garde** dans le LOT 1 : il fait **0 px** (`margin: 0; padding: 0`, `src/css/style.css:775`) et **6 ancres de test le lisent** (`src/js/retrait-ecran-aide.test.js:55-70`, `src/js/lot2-colonne-haut.test.js:209-214`, `:216-226`, `:229-241`, `:245-249`, `:275-278`, `:301-306` — elles cherchent toutes `<div id="global-actions">…\n    </div>` et **échouent si le conteneur disparaît**). Le supprimer obligerait à réécrire ces six ancres **le même jour** — proposé en **LOT 3** si le propriétaire veut nettoyer |
| 5 | **Le câblage casse au démarrage** | `src/js/settings.js:3194` : `remoteBadge.addEventListener(...)` **sans `?.`** → un `null` ferait tomber le bloc Paramètres | L'élément **n'est pas supprimé** : même `id`, déplacé seulement. Aucune ligne de `settings.js` ne change |
| 6 | **Un verrou de disposition casse** (ordre `rangée → onglets → Travail → boutons`) | `src/js/panneau-suivi-trois-onglets.test.js:221-240`, `src/js/barre-fenetre-etats.test.js:203-215` | L'insertion **entre** onglets et Travail laisse toutes ces assertions vraies (`barre < badge < travail < boutons`). Vérifié assertion par assertion, § 9 |
| 7 | **La hauteur de la rangée grossit** (28 px + marges) | verrou `src/js/compteur-taches-travail.test.js:342-343` (36 + 1) | `height: 28px` **<** `min-height: 36px` et `align-self: center` : la rangée ne peut pas grandir. Le badge n'a **plus** de marge verticale (elle descend de 16 à 0) |
| 8 | **Le panneau « Travail » se décale** (il s'ouvre ancré au bouton) | `#agent-activity-dropdown { right: 0 }` sur `#agent-activity`, `src/css/style.css:2044-2048` | `#agent-activity` **ne bouge pas d'un pixel dans le DOM ni dans ses marges** : le panneau s'ouvre au même endroit |
| 9 | **Un contraste passe sous le seuil** dans un sous-thème | § 3.4 | Aucune couleur changée, **et le fond de référence est le même jeton** (`--bg-sidebar` des deux côtés) |
| 10 | **Deux rapports se contredisent** (repli des menus du bas) | § 1.6 | Signalé explicitement ; aucune valeur du repli n'est touchée |
| 11 | **Le badge se comporte mal en mode « Assistant seul »** | `.superagent-immersive` est `position: fixed; inset: 0; z-index: 99990` avec fond opaque (`src/css/style.css:10817-10824`) | **Rien à faire** : l'overlay recouvre la rangée, donc le badge y est déjà invisible — **exactement comme aujourd'hui** (la colonne est recouverte de la même façon) |
| 12 | **Un client se connecte pendant une frappe** | `pollRemoteBadge` toutes les 5 s (`src/js/settings.js:3208`) | Le badge ne pousse plus rien dans la colonne : **le saut de 44 px disparaît** |

---

## 9. Ce que la livraison doit toucher (liste exacte, vérifiée)

**Application**

| Fichier | Ligne | Changement |
|---|---|---|
| `index.html` | `81` → entre `228` et `254` | déplacer la ligne `#remote-badge` (attributs inchangés) |
| `index.html` | `71-80` | réécrire le commentaire d'intention (le conteneur ne « porte » plus le badge) |
| `index.html` | `80-82` | laisser `#global-actions` **sans enfant** — **la note explicative se met AU-DESSUS du `<div>`**, jamais dedans (voir l'avertissement ci-dessous) |
| `src/css/style.css` | `7272` (`.remote-badge`) | `margin: 0 2px 0 0`, `align-self: center`, `transform` dans la `transition` |
| `src/css/style.css` | **après `7311`** (`.remote-badge.hidden`) | `.remote-badge:active { background: var(--surface-3); border-color: var(--border-active); transform: scale(0.97); }` — **après `:hover` et après `.off`**, sinon l'appui n'aurait aucun effet visible (même spécificité, l'ordre décide) |
| `src/css/style.css` | `3835-3839` | ajouter `.remote-badge` à la liste `body.zen-mode …` |
| `src/css/style.css` | nouveau bloc après `.remote-badge.hidden` (`7311`) | `@media (max-width: 900px) { .remote-badge-label { display: none; } }` (**LOT 2**) |
| `src/js/window-controls.js` | `62-64` | ajouter `#remote-badge` à `WINDOW_GESTURE_BLOCKLIST` |

**Verrous à mettre à jour (2 assertions, LOT 1)** — je les ai lues une par une :

| Fichier | Ligne | Assertion | Ce qu'elle devient |
|---|---|---|---|
| `src/js/lot2-colonne-haut.test.js` | `225` | « le badge garde sa place : `#global-actions` contient `id="remote-badge"` » | devient « le badge est **sorti** de `#global-actions` » (assertion inverse) |
| `src/js/lot2-colonne-haut.test.js` | `237-239` | `margin: 8px 8px 8px auto;` sur `.remote-badge` | devient `margin: 0 2px 0 0;` |

**Deux pièges de mise en forme, à respecter à la lettre** (sinon six verrous tombent
pour une raison qui n'a rien à voir avec le déplacement) :

1. La fermeture du conteneur doit rester **`\n    </div>`** (4 espaces) : les six ancres
   lisent `<div id="global-actions">…\n    </div>` par expression régulière.
2. **Aucun commentaire À L'INTÉRIEUR du `<div>`** : il ne doit contenir ni `<button `
   (compté par le verrou `:209-214`), ni `id="btn-help"` (`:245-249`), ni
   `id="btn-scratchpad"` / `id="btn-settings"` (`:216-226`). La note va **au-dessus**.

**Verrous vérifiés comme restant verts sans modification** (lus, pas supposés) :
`src/js/retrait-ecran-aide.test.js:55-70` (conteneur vide + 0 bouton) ·
`src/js/lot2-colonne-haut.test.js:246-249`, `:275-278`, `:313-330`, `:366` ·
`src/js/barre-fenetre-etats.test.js:118-124`, `:203-215`, `:292`, `:307-311` ·
`src/js/compteur-taches-travail.test.js:342-343` ·
`src/js/panneau-suivi-trois-onglets.test.js:192-240`. Les verrous CSS utilisent une
recherche de sélecteur **écrit exactement** `.remote-badge {` (`blocs()`,
`src/js/lot2-colonne-haut.test.js:66-72`) : la nouvelle règle `.remote-badge:active` et
la règle `.remote-badge-label` du LOT 2 **ne sont pas** capturées par cette recherche —
elles ne perturbent donc aucune des assertions de famille visuelle (`:322-331`).

**Documentation à mettre à jour (règle AGENTS.md)**

| Fichier | Ligne | Changement |
|---|---|---|
| `spec_web_remote.md` | `496-497` | « Badge distant `#remote-badge` **dans la barre d'actions** » → « **dans la rangée du haut, à gauche de « Travail »** » |
| `RAPPORT-conception-repli-menus-bas.md` | § 0 (l. 40-43), § 6 (ligne « Plier aussi `#global-actions` ») | le badge n'est plus dans la colonne (§ 1.6) |
| `RAPPORT-design-colonne-entrees.md` | § 3.4 | même correction (document historique : une note suffit) |

---

## 10. Écarts constatés mais **non corrigés** dans ce lot (pour ne pas rouvrir de décision)

1. **L'état `.off` ne réagit pas au survol et garde `cursor: default`**, alors que le clic
   ouvre les Paramètres dans **tous** les états affichés (`src/css/style.css:7301` vs
   `:7305` ; `src/js/settings.js:3194`). C'est **antérieur** à ce déplacement ; le
   déplacer à côté d'un vrai bouton le rendra seulement plus visible. Correction
   possible en 2 lignes (`cursor: pointer` + `:hover` prioritaire). **Non incluse** :
   elle change un état existant.
2. **Survol incohérent entre voisins** : le badge passe à `--surface-3`, « Travail » à
   `--surface-2` (`src/css/style.css:7301` vs `:1952`). Deux jetons pour deux voisins.
   **Non corrigé** : c'est une décision de la présentation déjà livrée.
3. **Le badge n'est pas atteignable au clavier** (c'est un `<span>` ; seul `title` porte
   l'explication). Voir question n° 3.

---

## 11. Ce que je n'ai pas pu vérifier

- **Le rendu au pixel** : aucune fenêtre Pilot n'a été ouverte. Toutes les largeurs et
  hauteurs sont **calculées** à partir des valeurs CSS citées ; la largeur du badge
  (≈ 92 px) dépend des **avances de police** réelles de « Inter »/« Segoe UI » à 11 px /
  600 — à confirmer à l'écran, ainsi que le total de la rangée à 800 px.
- **Le comportement du glisser de fenêtre** sur WebView2 et WKWebView après l'ajout à
  `WINDOW_GESTURE_BLOCKLIST` : le code est le même garde-fou que pour « Travail », mais
  je ne l'ai pas constaté à la souris.
- **L'affichage réel du badge dans ses trois états** : les états « serveur actif » et
  « client connecté » exigent un serveur distant en service, que je n'ai pas lancé.
- **Le ressenti du survol** dans les quatre sous-thèmes clairs (aucune paire nouvelle,
  donc risque faible, mais non constaté).
- **`dist/index.html`** : artefact de build, encore sur l'ancien balisage ; régénéré par
  `npm run build`.

---

## 12. Questions fermées (au plus trois — seulement si la réponse change la proposition)

**Q1 — Mode Zen (plein écran).** Aujourd'hui le badge disparaît avec la colonne
(`src/css/style.css:3835-3839`). Sorti de la colonne, il **réapparaîtrait** en plein
écran. Ma proposition le **remasque** (comportement identique). **Maintiens-tu le badge
masqué en Zen, ou veux-tu qu'il reste visible pendant que tu supervises en plein écran ?**

**Q2 — Fenêtre étroite.** Sous 900 px de largeur, la barre d'onglets perd ≈ 92 px à
cause du badge. **Efface-t-on le mot « Distant » sous 900 px (il reste 🌐 + le compteur,
et l'infobulle entière), ou garde-t-on le mot en laissant les onglets défiler davantage ?**

**Q3 — Clavier.** Le badge est un `<span>` : il n'est pas atteignable au `Tab`, seule la
souris l'atteint (comportement actuel, inchangé). À côté d'un vrai bouton (« Travail »),
l'écart se voit. **Le laisse-t-on tel quel (aucun changement, aucune fonction nouvelle),
ou le rend-on atteignable au clavier (`Tab` + `Entrée`) — ce qui modifie deux verrous de
test ?**

---

## 13. Lots livrables (chacun utilisable seul, sans état intermédiaire cassé)

### LOT 1 — Le déplacement lui-même (le mieux visible, livrable seul)

**Contenu** (7 changements, tous listés au § 9) :
déplacement de la ligne du badge dans `index.html` · `margin: 0 2px 0 0` +
`align-self: center` · état d'appui · `.remote-badge` dans la liste `body.zen-mode` ·
`#remote-badge` dans `WINDOW_GESTURE_BLOCKLIST` · `#global-actions` laissé vide ·
mise à jour des **2** assertions de `src/js/lot2-colonne-haut.test.js`.

**Gain immédiat pour l'utilisateur** : **44 px rendus à l'explorateur** pendant toute
session d'accès distant **et la fin du saut de 44 px** à la connexion d'un client. Rien
d'autre ne bouge : même libellé, même icône, même infobulle, même clic, même hauteur de
rangée, même largeur de colonne, même coin haut droit.

**Anti-régression dans le lot** : la parade de glisser (`WINDOW_GESTURE_BLOCKLIST`) et la
règle Zen sont **dans ce lot**, pas après — sans elles, le LOT 1 livrerait un badge qui
déplace la fenêtre et qui apparaît en plein écran : ce serait une régression, pas une
demi-mesure.

**Vérification** : `npx vitest run` (suite complète) — en particulier
`lot2-colonne-haut`, `barre-fenetre-etats`, `panneau-suivi-trois-onglets`,
`compteur-taches-travail`, `retrait-ecran-aide` ; puis `npm run tauri dev` pour
constater **à l'écran** : le badge à gauche de « Travail », un clic ouvre les Paramètres,
un glisser sur le badge ne déplace pas la fenêtre, la colonne ne saute pas quand un
client se connecte.

**Nouveau verrou proposé** (`src/js/badge-distant-barre-haute.test.js`, 6 cas) : le badge
est enfant de `#tab-row` · il est **après** `#tab-bar` et **avant** `#agent-activity` ·
`#tab-row` garde `min-height: 36px` · `#remote-badge` est dans
`WINDOW_GESTURE_BLOCKLIST` · `#global-actions` est vide · `.remote-badge` n'a **aucune**
marge verticale et aucune couleur en dur.

### LOT 2 — La fenêtre étroite

**Contenu** : `@media (max-width: 900px) { .remote-badge-label { display: none; } }`
placé **après `.remote-badge.hidden`**, + un cas de verrou (le mot est masqué sous
900 px, et le HTML le contient toujours).

**Gain** : sur un écran étroit ou une fenêtre en moitié d'écran, **≈ 50 px rendus aux
onglets** ; l'état distant reste lisible (🌐 + compteur) et l'infobulle reste entière.

**Désactivable sans effet sur le LOT 1** (sans elle, les onglets défilent simplement
plus tôt).

### LOT 3 — Nettoyage (optionnel, à ne faire que si le propriétaire le demande)

**Contenu** : suppression du conteneur vide `#global-actions` (`index.html:80-82`) et de
sa règle CSS (`src/css/style.css:775-789`), avec réécriture des **4 ancres** qui le
lisent (`retrait-ecran-aide.test.js:55-70` ×2, `lot2-colonne-haut.test.js:207-212`,
`:246-249`, `:275-278`) et de la règle Zen qui le nomme (`:3836`).

**Gain** : plus de balisage mort. **Aucun gain visible** — c'est de l'hygiène, pas une
amélioration pour l'utilisateur. C'est pourquoi il est **dernier** et **facultatif**.

---

## 14. VERDICT

**Prêt à appliquer tel quel (LOT 1).** L'emplacement est décidé et décrit au pixel : le
badge devient un enfant direct de `#tab-row`, **entre les onglets et « Travail »**. Rien
n'est créé : même `<span>`, même `id`, même titre, même icône, même clic, même famille
visuelle, mêmes jetons de couleur. La hauteur de la barre du haut reste **36 + 1 px**, la
colonne reste **280 px**, le coin haut droit n'est pas approché.

**Le gain réel, dit franchement : 44 px quand l'accès distant est en service, 0 px quand
il est arrêté.** 44 px = **1,4 ligne du bloc du bas** ou **≈ 1,6 ligne de l'explorateur**.
Le propriétaire attendait « une ligne » : il l'obtient **dans le cas où le badge s'affiche**,
et il obtient en plus un bénéfice permanent — **la liste des fichiers ne saute plus de
44 px quand un client se connecte**.

**Ce qui est prêt à appliquer** : § 2 (organisation), § 3 (présentation, y compris les
quatre états et les contrastes), § 4 (gain chiffré), § 5 (fenêtre étroite), § 8 (risques
et parades), § 9 (liste exacte des fichiers et des 2 assertions à mettre à jour).

**Ce qui reste à décider** : les trois questions du § 12 (mode Zen, mot effacé sous
900 px, clavier). **Aucune ne bloque le LOT 1** : il est livrable avec les réponses par
défaut que je recommande (badge masqué en Zen · mot effacé sous 900 px · clavier
inchangé).

**Ce que je n'ai pas pu vérifier** : le rendu au pixel (aucune fenêtre ouverte), la
largeur exacte du badge selon la police réelle, le glisser de fenêtre sur les deux
moteurs, et l'affichage des états « serveur actif / client connecté ». Détail au § 11.
