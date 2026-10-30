# Rapport — Cadres arrondis sur les panneaux, et le bouton de masquage sans texte

**Date** : 2026-11-02
**Point de départ** : `684e9f3` — « les panneaux translucides prennent la teinte du thème »
**Nature** : deux demandes du propriétaire, un seul lot, un seul commit.

---

## 1. Les deux demandes

**A — un cadre autour des listes.** Les panneaux translucides (la colonne des tâches,
la colonne de discussion de l'écran Vocal, et toute surface qui utilise le même
mécanisme) reçoivent un **cadre visible, en bords arrondis**, dans la **même couleur
que le texte translucide** de ces panneaux. La couleur vient **exclusivement d'une
variable de thème** ; aucune couleur en dur ; jeton d'arrondi **existant** réutilisé.
Le cadre ne doit **ni déplacer le texte, ni réduire la largeur utile** de la
discussion : la mesure de caractères par ligne doit en tenir compte. Lisible et
discret sur thème sombre **et** clair.

**B — le bouton du haut perd son texte.** Le bouton qui masque / réaffiche les listes
garde **son icône** ; **position, taille et forme inchangées** ; seule l'étiquette
visible disparaît. Cette demande **remplace explicitement** la consigne antérieure
« ne pas changer le libellé du bouton de masquage ». Le bouton garde un **intitulé
accessible** (`title` + `aria-label`) qui suit l'état réel. L'acquis `a0daf4e` n'est pas
touché : la **zone de saisie reste affichée et utilisable dans les deux états**.

**Contraintes fermes** : ne pas toucher au disque, au halo, au micro, ni aux trois
sorties ; ne pas défaire `684e9f3` (la teinte suit le thème actif, y compris après un
changement à chaud) ; aucun nouveau réglage visible, aucun stockage local
supplémentaire, aucune couleur en dur ; aucun bump de version, tag, push ni
publication ; chaque demande verrouillée par un test qui **échoue si le défaut
revient** ; aucun test existant supprimé ni assoupli.

---

## 2. Ce qui a changé, et où

### 2.1 Un seul jeton de couleur : `--glass-frame`

`src/css/style.css`, dans `.theme-dark` (à côté des jetons de verre, ~ l. 331) et dans
`.theme-light` (~ l. 467) :

```css
/* Le CADRE des panneaux translucides. Meme famille que le texte qu'il entoure :
   il derive du texte secondaire, il ne recopie aucune couleur... */
--glass-frame: color-mix(in srgb, var(--text-secondary) 80%, transparent);
```

Pourquoi cette forme, et pas une valeur écrite :

- **une seule source** : le jeton est déclaré là où vivent déjà `--glass-tint`,
  `--glass-scrim` et `--glass-scrim-soft`, c'est-à-dire **dans les deux thèmes de
  base** seulement. Aucun des **huit sous-thèmes** (`theme-one-dark`, `theme-dracula`,
  `theme-nord`, `theme-tokyo-night`, `theme-github`, `theme-one-light`,
  `theme-solarized`, `theme-tokyo-day`) ne le fige : ils ne redéfinissent que les
  variables de base, et le `color-mix` se recalcule donc à chaque changement de thème,
  **à chaud**. C'est exactement le mécanisme de `684e9f3`, prolongé — rien n'est
  défait ;
- **même famille que le texte** : 80 % de `--text-secondary`, c'est la variable qui
  peint déjà le texte des panneaux. Pas une couleur de bordure générique, pas un gris
  inventé : le cadre est un **dégradé du texte qu'il encadre** ;
- **jamais plus contrasté que le texte** : mesuré sur les dix palettes (tableau § 4),
  le cadre reste **sous** le ratio du texte secondaire dans chaque thème.

### 2.2 Le cadre sur les deux colonnes de l'écran Vocal

`src/css/style.css`, **après** les deux blocs individuels des colonnes (~ l. 12064) :

```css
.vocal-side-discussion,
.vocal-side-tasks {
  box-sizing: border-box;
  border: 1px solid var(--glass-frame);
  border-radius: var(--radius-lg);
  padding-inline: 10px; /* VOCAL_SIDE_FRAME_PX / 2 - 1 */
}
```

Trois choix, chacun contre une alternative :

| Retenu | Écarté | Pourquoi |
|---|---|---|
| `border: 1px solid` | `box-shadow: inset 0 0 0 1px` | Une ombre interne **ne prend aucune place** : il aurait fallu deviner, en JS, de combien le texte est rogné. Une bordure **réelle** se lit dans la feuille de style, donc se vérifie, et se retranche exactement |
| `box-sizing: border-box` | laisser le défaut | Sans lui, la bordure et la marge s'**ajoutent** à la largeur : la colonne grossirait de 22 px et mordrait sur le cercle |
| `padding-inline: 10px` | `padding: 10px` | La **hauteur** est un budget strict (51 px de haut fixe, 46 px par tâche) : ajouter une marge verticale ferait mentir le nombre de lignes que le module pur calcule. On ne touche qu'à l'axe horizontal |

Le bloc groupé est placé **après** `.vocal-side-discussion {` et `.vocal-side-tasks {`,
et non avant : plusieurs verrous découpent ces deux blocs **par leur sélecteur** pour
vérifier `width: var(--vocal-side-tasks, …)` et `justify-self: end`. Placé avant, le
bloc groupé faisait échouer ces découpages (`vocal-colonnes-degagees.test.js`) — la
source lue n'était plus la règle individuelle mais la règle groupée. C'est un piège
mesuré, pas une précaution théorique.

### 2.3 Le même cadre sur tous les panneaux translucides

Toute surface qui porte `background: var(--glass-tint)` est un **panneau** : elle
reçoit le même cadre, du même jeton. Deux règles étaient concernées, et elles
passaient une bordure `--border-subtle` (une couleur de séparateur, pas de cadre) :

- `.projects-dropdown` — le panneau des projets ;
- `.context-menu` — le menu contextuel.

```css
border: 1px solid var(--border-subtle);   →   border: 1px solid var(--glass-frame);
```

Les **voiles** (`--glass-scrim`, `--glass-scrim-soft`) sont des surfaces **plein
écran** : ils n'ont pas de bord, et n'en reçoivent pas. Le test l'exige explicitement
(seuls les panneaux `--glass-tint` sont tenus au cadre).

### 2.4 La mesure dit vrai : `VOCAL_SIDE_FRAME_PX`

`src/js/vocal-sides.js` :

```js
export const VOCAL_SIDE_FRAME_PX = 2 * (1 + 10);   // bordure + marge, les deux cotes = 22
```

et la fonction de mesure **retranche le cadre avant de compter** :

```js
return Math.max(1, Math.floor(Math.max(0, px - VOCAL_SIDE_FRAME_PX) / VOCAL_DISCUSSION_CHAR_PX));
```

Sans cela le texte serait coupé plus tôt qu'annoncé : la fonction promettait 42
caractères dans une largeur qui n'en tient que 39, et `vocalExcerpt()` aurait tronqué
un mot de trop en croyant tenir sur une ligne. Le `Math.max(1, …)` et le `Math.max(0, …)`
garantissent qu'une largeur nulle, absurde ou négative ne rend jamais `0` ni `NaN`.

### 2.5 Le bouton de masquage : l'icône seule

- `src/js/vocal-bare.js` — `VOCAL_BARE_TEXT_VISIBLE`, `VOCAL_BARE_TEXT_HIDDEN` et
  `vocalBareText()` sont **supprimés**. Ce qui reste est le **nom accessible** :
  `VOCAL_BARE_LABEL_VISIBLE` / `VOCAL_BARE_LABEL_HIDDEN`, `vocalBareLabel(état)`,
  `vocalBareIcon()`, `vocalBarePressed()`, `vocalBareClass()`, `vocalBareNext()`,
  `normalizeVocalBare()` — inchangés, mot pour mot.
- `src/js/super-agent.js` — `buildVocalDisplayToggle()` ne crée plus de nœud texte :
  la pastille n'a **qu'un enfant**, l'icône, dans son propre nœud
  `.vocal-display-toggle-icon` (parce que `setIcon` écrit `innerHTML` et emporterait
  le point de clic). `vocalSyncBare()` ne remet plus de texte : il remet `title` **et**
  `aria-label` (les deux ensemble, seulement s'ils ont changé), `aria-pressed`, l'icône
  et la classe d'état.
- `src/css/style.css` — la règle `.vocal-display-toggle-label` est **supprimée
  entièrement** (un emplacement libre est un endroit où le texte revient). Le bloc
  `.vocal-display-toggle` **garde** `min-width: 190px`, `height: 28px`,
  `border-radius: 999px`, `margin-inline: auto`, `justify-content: center`,
  `z-index: 1` : la taille et la forme ne bougent pas d'un pixel. Le commentaire dit
  désormais pourquoi `min-width` reste : ce n'est plus une largeur de texte, c'est **la
  taille du bouton**, et la retirer le rendrait plus petit qu'avant.

---

## 3. Comment le texte n'est pas étranglé

La chaîne complète, du CSS au calcul, tient en trois nombres qui doivent coïncider :

1. la règle CSS prend `1 px` de bordure et `10 px` de marge **de chaque côté** ;
2. `VOCAL_SIDE_FRAME_PX = 2 × (1 + 10) = 22` px — la constante JS dit la même chose
   que la feuille de style, et le test le vérifie **en lisant les deux** ;
3. `vocalCharsPerLine(px)` calcule sur `px − 22`.

Conséquence mesurée sur les largeurs réelles de la colonne :

| Largeur de colonne | Caractères annoncés | Avant le cadre (faux) |
|---|---|---|
| 320 px | **39** | 42 |
| 282 px | **34** | 37 |
| 400 px | **49** | 52 |

**Le chiffre baisse : il ne s'assouplit pas.** C'est la place réelle du texte. Les
attendus de `src/js/vocal-colonne-discussion.test.js` ont été mis à jour en
conséquence (42→39, 37→34, 52→49), avec un commentaire dédié qui dit pourquoi : le test
n'a pas été relâché, il a été **rendu vrai**. Vérifié au passage : les budgets de
**lignes** ne bougent pas (`planVocalDiscussion(512, 320).lines === 13`) — le cadre est
horizontal, la hauteur est intacte, et c'est exactement ce que la demande exigeait.

---

## 4. Le contraste, mesuré sur les dix palettes

Cadre = 80 % de `--text-secondary` composé sur `--bg-app`. Le texte secondaire est
donné à titre de comparaison : **le cadre doit rester en dessous**.

| Thème | Fond | Texte secondaire | **Cadre** | Texte |
|---|---|---|---|---|
| sombre (défaut) | `#0f1115` | `#a0a6b4` | **5,32:1** | 7,75:1 |
| one-dark | `#282c34` | `#8a919e` | **3,38:1** | 4,42:1 |
| dracula | `#282a36` | `#bfc0c9` | **5,61:1** | 7,87:1 |
| nord | `#2e3440` | `#d8dee9` | **6,55:1** | 9,25:1 |
| tokyo-night | `#1a1b26` | `#a9b1d6` | **5,65:1** | 8,10:1 |
| clair (défaut) | `#f4f5f7` | `#5a6170` | **3,69:1** | 5,70:1 |
| github | `#f6f8fa` | `#57606a` | **3,85:1** | 6,00:1 |
| one-light | `#fafafa` | `#5c5e66` | **3,93:1** | 6,19:1 |
| solarized | `#fdf6e3` | `#586e75` | **3,38:1** | 4,99:1 |
| tokyo-day | `#e1e2e7` | `#6172a9` | **2,69:1** | 3,62:1 |

Lecture : le cadre est **visible sans crier**. Il n'atteint jamais 3:1 sur un thème
clair très lumineux (tokyo-day), ce qui est **voulu** — un cadre à 3:1 sur ce fond
passerait devant le texte qu'il entoure. Le test tient deux bornes : un **plancher de
2,6:1** (en dessous, le cadre disparaît) et un **plafond implicite** (il ne dépasse
jamais le texte secondaire du même thème), plus deux seuils mesurés sur les thèmes par
défaut (≥ 5,0 en sombre, ≥ 3,5 en clair) qui échoueraient si le mélange était adouci.

---

## 5. Ce qui est verrouillé, et par quel test

### `src/js/cadre-listes-panneaux.test.js` (nouveau, 10 tests)

Lecteur **pur** de la feuille de style (aucun navigateur, aucun jsdom) : il neutralise
les commentaires, découpe les règles, résout les `var()`, compose les `color-mix` et
calcule les ratios WCAG. Trois sections :

1. **la couleur** — `--glass-frame` existe dans `.theme-dark` **et** `.theme-light`,
   dérive bien de `--text-secondary` à 80 % (les deux nombres sont lus dans la
   déclaration, pas devinés), **aucun** des huit sous-thèmes ne le fige, et le
   contraste reste dans les bornes du § 4 sur les dix palettes ;
2. **le cadre** — les deux colonnes le portent avec `--glass-frame`, `--radius-lg` et
   `box-sizing: border-box` ; `--radius-lg` est défini **une seule fois** et vaut
   `12px` ; tout panneau qui porte `background: var(--glass-tint)` porte aussi
   `border: 1px solid var(--glass-frame)` et un rayon `--radius-*` ; aucun d'eux ne
   revient à `--border-subtle` ;
3. **la mesure** — `VOCAL_SIDE_FRAME_PX === 2 × (1 + 10) === 22` et les deux nombres
   `1px` / `10px` **relus dans la feuille de style** ; `vocalCharsPerLine()` retranche
   le cadre avant de compter (vérifié à 282, 320, 400, 800 px) ; la fonction ne rend
   jamais `0` ni `NaN` (`0`, `10`, `undefined`, `NaN` → `1`) ; la règle ne contient
   **aucun** `padding-block`, `padding:`, `height:` ni `margin:` ; les budgets
   `VOCAL_TASK_PX === 46` et `VOCAL_TASK_HEADER_PX === 20` sont intacts.

### `src/js/bouton-masquage-sans-texte.test.js` (nouveau, 11 tests)

1. **le texte a disparu jusqu'au module** — plus de `VOCAL_BARE_TEXT_*`, plus de
   `vocalBareText`, plus de `vocal-display-toggle-label`, plus de `textContent` /
   `innerText` / `createTextNode` dans le bouton ; **un seul** `bouton.appendChild(…)`,
   celui de l'icône ; `vocalSyncBare()` n'écrit que `title`, `aria-label`,
   `aria-pressed`, l'icône et la classe ;
2. **la taille, la forme et la position ne bougent pas** — 190 × 28 px, rayon pastille,
   `margin-inline: auto`, `justify-content: center`, `z-index: 1`, aucune `width`
   ajoutée, et le bloc d'exception de l'état nu n'écrit ni taille ni marge ; les deux
   phrases accessibles sont **mot pour mot** (tiret cadratin, « portrait » et jamais
   « personnage »), l'icône et `aria-pressed` suivent le même état, et une valeur
   illisible retombe sur « tout visible » ;
3. **les acquis voisins tiennent** — `vocalSyncChrome` contient `vocalBare ||` (le bas
   est **retenu allumé**, c'est `a0daf4e`), le bloc d'effacement **ne nomme jamais**
   `.vocal-input` (commentaires neutralisés : c'est la règle qui compte), et le code du
   bouton ne contient ni `localStorage`, ni `sessionStorage`, ni `invoke(`, ni `fetch(`.

### `src/js/ecran-vocal-bouton-affichage.test.js` (mis à jour, 44 tests)

Les trois `it` qui parlaient du texte visible décrivent maintenant son **absence** :
la construction ne crée aucun nœud d'étiquette, le libellé accessible suit l'état sans
clignoter, la pastille garde 190 × 28 px, et la feuille de style comme le module ne
contiennent plus `.vocal-display-toggle-label`. Les 41 autres `it` (hôtes cliquables,
`aria-pressed`, fondu de 180 ms, section nue vierge du nom de la zone de saisie, etc.)
sont inchangés.

### `src/js/vocal-colonne-discussion.test.js` (mis à jour)

Les attendus de `charsPerLine` passent de 42 / 37 / 52 à **39 / 34 / 49**, avec le
commentaire qui donne le calcul (`320 → 298 → 39`). Les budgets de lignes, eux, ne
bougent pas — et c'est vérifié.

### Mutations réellement rejouées (source restaurée, `md5sum` contrôlé)

| Mutation | Verdict |
|---|---|
| Retirer `border: 1px solid var(--glass-frame)` de la règle groupée | 2 échecs |
| Écrire une couleur en dur (`#838894`) à la place du jetons | 2 échecs |
| Retirer `- VOCAL_SIDE_FRAME_PX` de `vocalCharsPerLine()` | 3 échecs (dont `vocal-colonne-discussion`) |
| Figer `--glass-frame` dans un sous-thème (`theme-nord`) | 2 échecs |
| Remplacer `var(--radius-lg)` par `10px` | 1 échec |
| Réintroduire le nœud texte dans `buildVocalDisplayToggle()` | 3 échecs |
| Changer `min-width: 190px` en `44px` | 1 échec |

Après chaque mutation, le fichier a été restauré et son empreinte `md5` comparée à
celle d'avant : les quatre fichiers touchés (`style.css`, `vocal-sides.js`,
`super-agent.js`, `vocal-bare.js`) sont **identiques** à l'état livré.

---

## 6. Arbitrages

- **Le cadre est une bordure, pas une ombre interne.** Une ombre aurait évité tout
  calcul de largeur, mais elle est **invisible à la lecture du CSS** : impossible de
  prouver par un test qu'elle vaut 1 px, impossible d'en déduire de combien le texte
  est rogné. La bordure coûte 22 px de largeur et **force** à corriger la mesure —
  c'est le prix d'une règle vérifiable.
- **`--radius-lg` (12 px) et pas un nouveau rayon.** Le projet a cinq rayons
  (`--radius-xs` 4, `-sm` 6, `-md` 8, `-lg` 12, `-xl` 16). Les panneaux flottants
  utilisent déjà `--radius-lg` ; en inventer un cinquième aurait été une valeur de plus
  à tenir cohérente pour un gain nul.
- **80 %, et pas 100 %.** À 100 % de `--text-secondary`, le cadre devient un trait de
  texte : sur tokyo-day il atteindrait le ratio du texte lui-même. À 80 %, il reste
  lisible partout et **toujours en retrait**, ce qui est le sens de « discret ».
- **Étendre le cadre à `.projects-dropdown` et `.context-menu`.** La demande dit « et
  toute surface utilisant le même mécanisme ». Ces deux panneaux portaient déjà une
  bordure, mais en `--border-subtle` — une couleur de **séparateur**, pas de cadre, qui
  ne suit pas le texte. Les laisser aurait créé deux familles de panneaux translucides
  dont une seule aurait le bon cadre. Le test interdit désormais le retour à
  `--border-subtle` sur ces surfaces.
- **Le bouton perd son texte sans perdre son nom.** L'argument du 2026-10-31 était que
  le propriétaire **ne trouvait pas** le bouton ; celui du 2026-11-02 est qu'il le
  trouve et que le texte l'encombre. Ce qui reste, et qui doit suffire : `title` +
  `aria-label` alimentés par la même fonction pure que l'état, plus `aria-pressed`.
  Aucun compromis « texte au survol » : c'était encore du texte.
- **`min-width` reste.** Elle valait la largeur du plus long libellé ; le libellé
  parti, elle pourrait sembler superflue. La retirer aurait **rétréci** la pastille,
  contre la demande explicite « taille et forme inchangées ». Le commentaire du CSS dit
  maintenant qu'elle **est** la taille du bouton.
- **Le rapport daté du 2026-10-31 n'est pas réécrit.** `RAPPORT-vocal-corrections-2.md`
  décrit ce qui a été fait ce jour-là ; il reçoit une **mise à jour datée** qui dit que
  le texte a été retiré depuis, et pourquoi. Falsifier un compte rendu aurait été pire
  que le laisser incomplet.

---

## 7. Documentation mise en accord

- `spec_modes_ecran_vocal.md` — le bouton est décrit **icône seule** (le paragraphe
  « correction du 2026-10-31 : le bouton porte son texte » devient « correction du
  2026-11-02 : le bouton perd son texte visible »), la ligne du tableau des modules
  livrés est corrigée, le budget de caractères est réécrit avec `VOCAL_SIDE_FRAME_PX`
  (39 / 34 / 49), et une section **« Le cadre des panneaux »** documente les trois
  décisions (couleur, arrondi, mesure) avec les contrastes mesurés et le verrou.
- `spec_pilot.md` § D — `--glass-frame` rejoint les jetons de verre, avec sa formule,
  ses contrastes et les deux verrous.
- `help/overview.md` — l'aide utilisateur dit que le bouton **ne porte qu'une icône** et
  que ce qu'il fait est dans son infobulle. `help/handbook.md` régénéré
  (`npm run build:handbook`, 47 blocs).
- `RAPPORT-vocal-corrections-2.md` — mise à jour datée (voir § 6).
- `docs/rapports/RAPPORT-panneaux-translucides-theme.md` — section 9 : le cadre
  prolonge la teinte, les colonnes restent **sans fond**, et `.projects-dropdown` /
  `.context-menu` passent à `--glass-frame`.

---

## 8. Ce qui n'a pas bougé

- **Le disque, le halo, le niveau, le micro** et les **trois sorties** (logo, `Échap`,
  fermeture de l'onglet) : pas une ligne.
- **La teinte des panneaux** (`684e9f3`) : mêmes jetons, même recapture
  (`glass-theme.js`, `THEME_CHANGED_EVENT`), même verrou. Le cadre est un jeton de
  **plus**, dans les mêmes blocs.
- **La hauteur des colonnes** : aucun `padding-block`, aucune hauteur posée ; les 51 px
  de haut fixe et les 46 px par tâche restent exacts, et le test le vérifie.
- **La zone de saisie** (`a0daf4e`) : `vocalSyncChrome` retient toujours le bas allumé
  quand l'état nu est posé ; elle reste affichée et utilisable dans les deux états.
- **Aucun réglage nouveau, aucun stockage** : pas une clé de plus dans les préférences,
  ni `localStorage`, ni `sessionStorage` — le test du bouton l'interdit explicitement.

---

## 9. Commandes et comptes

```
npx vitest run src/js/cadre-listes-panneaux.test.js        → 10 tests, 0 échec
npx vitest run src/js/bouton-masquage-sans-texte.test.js   → 11 tests, 0 échec
npm test                                                   → 259 fichiers, 4870 tests, 0 échec
npm run build:handbook                                     → 47 blocs, handbook régénéré
```

Sept mutations rejouées, sources restaurées et empreintes contrôlées (§ 5).
Commit unique de la mission (code, tests, rapport et documentation ensemble),
à partir de `684e9f3`.
