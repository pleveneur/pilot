# Conception — repli/déploiement au survol du bloc de menus du bas (colonne de gauche)

> **Document de conception. Lecture seule sur le code** : aucun fichier de code n'a
> été modifié, aucun commit n'a été fait pour l'écrire. Toutes les affirmations sur
> l'existant portent leur preuve `fichier:ligne`, **relues sur le disque le
> 27/10/2026** (la zone a bougé récemment : décision 375, commit `9db5ea7`).
> Périmètre : **uniquement** `#project-footer`. Largeur de colonne, bandeau du haut,
> logo, rangée d'onglets, ligne d'information du bas : **hors périmètre, rien n'y
> change**.

---

## 0. Pour décider

1. **Repos replié à 50 px** (une ligne), **déploiement au survol**, la ligne du bas ne
   bouge jamais : **228 px** rendus à la liste des fichiers (278 → 50 px).
2. **100 ms** avant d'ouvrir (`--transition-fast`), **300 ms** de sursis avant de
   fermer (`--transition-smooth`), **180 ms** d'animation (`--transition`) : trois
   jetons existants (`style.css:308-312`), aucune durée inventée.
3. Replié : `⋯ Autres écrans` avec un projet, `⚙ Options` sans projet — déjà l'état du
   HTML (`btn-more-screens` est `project-only hidden`, `index.html:180`).
4. **Clavier et toucher** : déploiement au premier `Tab` (sans animation) et au
   premier appui ; trois points restent ouverts en § 7.
5. Trois pièges prouvés : `overflow: visible` est verrouillé (`style.css:847`,
   `lot3-colonne-bas.test.js:373`), `.pj-panel` se comprime sans `flex: 0 0 auto`, et
   un conteneur `overflow: hidden` **défile tout seul** au focus clavier.
6. **Pas de teinte de survol du cadre** : elle fait tomber le libellé à **4,15:1** en
   thème clair, sous le seuil AA (§ 5.6, mesuré, pas estimé).

---

## 1. État des lieux prouvé

### 1.1 Ce que contient le bloc, dans l'ordre

`#project-footer` → `div.pj-panel` → **7 boutons**, puis la ligne du bas de la
colonne.

| # | id | libellé affiché | condition | preuve |
|---|---|---|---|---|
| 1 | `btn-scratchpad` | Brouillon | toujours | `index.html:144` |
| 2 | `btn-settings` | Options | toujours | `index.html:145` |
| 3 | `btn-superagent` | Assistant | `project-only hidden` | `index.html:148` |
| 4 | `btn-explorer` | Dossier du projet | `project-only hidden` | `index.html:150` |
| 5 | `btn-terminal` | Terminal | `project-only hidden` | `index.html:153` |
| 6 | `btn-commands` | Commandes du projet | `project-only hidden` | `index.html:156` |
| 7 | `btn-more-screens` | Autres écrans | `project-only hidden` | `index.html:180` |

Ordre figé et vérifié : `lot3-colonne-bas.test.js:127-136` (`LIGNES`) et le test
« le panneau ne contient que SEPT lignes » (`:241-258`). Le menu `#pj-more-menu`
(`index.html:181`) contient **10 entrées en 5 groupes** et s'ouvre **vers le haut**
(`style.css:1826`, `bottom: calc(100% + 4px)`).

**Conséquence capitale, souvent oubliée** : `btn-more-screens` est `project-only
hidden`. **Sans projet ouvert, le bloc ne fait que DEUX lignes** (Brouillon, Options)
et la dernière est **`Options`**. Avec projet, il en fait sept et la dernière est
**`Autres écrans`**.

### 1.2 Mesures

- Colonne : `width: 280px; min-width: 280px; flex-direction: column; overflow: hidden`
  (`style.css:760-768`). ⚠️ **La largeur est réglable de 280 à 600 px** et mémorisée
  (`sidebar.js:1694-1727`, config `sidebar_width`) : « 280 px » est le défaut et le
  plancher, pas une garantie. Le repli ne joue que sur la **hauteur** — c'est
  compatible, et il restera compatible quelle que soit la largeur choisie.
- Cadre : `border: 1px solid var(--accent)`, fond `accent 16 %`, `border-radius:
  var(--radius-lg)`, `max-height: 60%`, `flex-shrink: 0`, `overflow: visible`,
  `padding: 8px 0`, `gap: 6px` (`style.css:838-873`).
- Lignes : `height: 32px`, `height` conservé par le verrou
  (`style.css:1737-1750`, `lot3-colonne-bas.test.js:345-351`). Libellé `--font-sm`
  = 12 px.
- Panneau : `display: flex; flex-direction: column; gap: 6px; padding: 0`
  (`style.css:922-940`) — **aucun `flex`, donc compressible** (voir § 5.2).
- Hauteur dépliée : `2 + 8×2 + 7×32 + 6×6 = 278 px` ; plafond `60 %` de
  `minHeight: 500` = 300 px → 22 px de marge (`tauri.conf.json`,
  `lot3-colonne-bas.test.js:299-334`).
- **Sous** le bloc, et non dedans : `#sidebar-engine-row` (28 px + 8 px de marge,
  `style.css:803+`, décision 375). Le bloc n'est donc **plus le dernier enfant de la
  colonne** : il est collé à cette ligne d'information, qui ne bouge jamais.
- Liste des fichiers : `#file-tree { flex: 1; overflow-y: auto }`
  (`style.css:1558-1562`) — c'est elle qui encaisse le gain de hauteur.

### 1.3 Mécanique de survol existante : néant

- **Aucun** `mouseenter` / `mouseleave` / `pointerenter` sur `#project-footer` ni sur
  `.pj-panel` : les seules occurrences du dépôt sont `recent-files.js:156` et
  `toast.js:66-67` (pause d'un toast au survol — précédent de style, pas de mécanisme
  réutilisable).
- **Aucune** règle `prefers-reduced-motion` dans `style.css` : la convention du projet
  est en JS, `modal-anim.js:43-44` — le mouvement n'est coupé que si le système
  demande une réduction **et** que `window._pilotModalAnimations === false`
  (réglage « Animer l'ouverture des modales »).
- Le menu se ferme par `Échap`, clic extérieur (phase de capture) et choix d'une
  entrée : `sidebar.js:1658-1687`. **La fonction `fermer()` est locale à
  `_initProjectFooterMenu`** — non exposée (voir § 5.4).
- Mode zen : `body.zen-mode #project-footer { display: none !important }`
  (`style.css:3888-3891`) — en zen le bloc est absent, le repli n'a aucun effet.
- Focus clavier : règle unique `button:focus-visible { outline: 2px solid
  var(--accent); outline-offset: 1px }` (`style.css:11322-11331`).
- `#global-actions` est **vide** (décision 375) : plus rien à faire en haut.

---

## 2. Comportement exact

### 2.1 Deux états, et rien d'autre

| | **Replié (repos)** | **Déplié** |
|---|---|---|
| Hauteur du cadre | **50 px** (2 bordures + 16 padding + 1 ligne de 32) | **278 px** avec projet · **88 px** sans projet |
| Lignes visibles | **la dernière seule** : `Autres écrans` (projet ouvert) · `Options` (aucun projet) | **toutes** |
| Lignes présentes dans le DOM | **les mêmes 7** — rien n'est `display: none` | les mêmes 7 |
| Rognage | `overflow: clip` sur le cadre | `overflow: visible` (obligatoire pour le menu) |
| Menu `Autres écrans` | toujours fermé (jamais rogné) | ouvrable normalement |
| Fond, bordure, rayon | **identiques** — seul le cadre se réduit | identiques |

Le bloc est donc **la même chose, vue par une fente de 32 px**. Aucun nœud n'est
créé, aucun n'est détruit, aucun libellé ne change, **aucun bouton n'est ajouté**,
**aucun réglage n'est ajouté**.

### 2.2 Ce qui déclenche l'ouverture (trois portes, toutes exigées)

1. **Survol** : `pointerenter` sur `#project-footer` → déploiement après **100 ms**.
2. **Clavier** : `focusin` dans le cadre → déploiement **immédiat, sans animation**
   (l'anneau de focus doit être peint tout de suite, sinon il est rogné).
3. **Toucher** : `pointerdown` de type `touch` sur le cadre replié → déploiement.

### 2.3 Ce qui provoque le repli — et le sursis

Le bloc ne se replie **que si les trois conditions sont réunies** : la souris n'est
plus dessus, **et** le focus n'est plus dedans, **et** le menu `Autres écrans` est
fermé. La sortie de l'une de ces trois conditions **annule** le sursis en cours.

| Situation | Délai avant repli | Pourquoi |
|---|---|---|
| `pointerleave` du cadre, rien d'autre | **300 ms** puis 180 ms d'animation | sursis |
| `focusout` vers l'extérieur du cadre | **300 ms** | idem |
| `Échap` pressé, menu fermé, focus dans le bloc | **immédiat** | geste explicite : on ne fait pas attendre |
| un projet est fermé / ouvert (nombre de lignes change) | **aucun repli** — on remesure | la hauteur dépliée change, pas l'état |
| mode zen activé | bloc masqué | `style.css:3888` |

**Pourquoi 300 ms** (et pas 150, ni 500) :
- c'est un **jeton existant**, `--transition-smooth: 0.3s var(--ease-spring)`
  (`style.css:311`) : aucune durée nouvelle n'entre dans le projet ;
- un aller-retour involontaire de souris (sortie puis retour sur 90-150 px à
  600 px/s) dure **150-250 ms** : 300 ms l'absorbe entièrement ;
- **300 + 180 = 480 ms** < 500 ms, seuil au-delà duquel une attente est ressentie :
  même dans le pire cas (sursis complet + animation complète), le bloc est au repos
  en moins d'une demi-seconde ;
- 500 ms aurait laissé le bloc ouvert sur l'arborescence alors que l'utilisateur l'a
  manifestement quitté.

**Pourquoi 100 ms à l'ouverture** :
- jeton existant `--transition-fast: 0.1s var(--ease-spring)` (`style.css:309`) ;
- un simple **passage** de souris à travers la bande (50 px à 800 px/s ≈ 62 ms) est
  filtré : on n'ouvre pas sur une traversée ;
- 100 + 180 = **280 ms** pour voir les sept lignes : perçu comme immédiat ;
- un délai plus long (≥ 200 ms) donnerait la sensation d'un bloc qui « accroche ».

**Pourquoi 180 ms d'animation** : `--transition` = `0.18s var(--ease-spring)`
(`style.css:312`) — la courbe « ressort » déjà utilisée partout pour les ouvertures.
Aucune durée, aucune courbe inventée.

### 2.4 Ce qui se déplace à l'écran — le point décisif

L'ancre de positionnement est **le bas**. Conséquence mesurable : **la ligne du bas
ne bouge pas d'un pixel**, ni au déploiement, ni au repli, ni pendant l'animation. Les
six autres lignes **ne bougent pas non plus** : elles sont découvertes ou recouvertes
par la fente qui s'ouvre ou se ferme **vers le haut**. Ce qui bouge réellement, c'est
la **liste des fichiers au-dessus**, qui gagne ou perd 228 px.

Trois bénéfices concrets, à ne pas perdre de vue :
- **la cible sous le curseur est toujours la bonne** : entrer dans le bloc, c'est
  entrer sur `Autres écrans` ; celle-ci ne se dérobe jamais ;
- un clic sur `Autres écrans` fonctionne **même si le déploiement n'a pas encore eu
  lieu** (le bouton est déjà là, immobile) ;
- l'utilisateur qui sort par le haut (vers l'arborescence) ne voit **rien glisser sous
  son curseur** : seul le bas de l'arbre se redessine.

### 2.5 Valeurs techniques exactes (pour le lot 1)

```
#project-footer            + justify-content: flex-end          (colle le contenu en bas)
                           + transition: height var(--transition)
                           (conserve tout le reste, dont overflow: visible et max-height: 60%)
.pj-panel                  + flex: 0 0 auto                     (jamais comprimé)
#project-footer.pj-replie  { height: 50px; overflow: clip; }
```

`height` est animable des deux côtés **à condition d'être explicite** : le JS mesure
la hauteur dépliée (`panneau.offsetHeight` + paddings + bordures lus par
`getComputedStyle`) et pose la valeur en pixels ; au terme du déploiement il **retire
la valeur** (`height: ""`), ce qui rend le bloc auto-ajustable si le nombre de lignes
change (ouverture/fermeture de projet). Aucun nombre figé dans le JS : les durées sont
les deux constantes nommées, vérifiées par un test contre `style.css`.

**Repli de secours documenté** : si un moteur n'honorait pas `justify-content:
flex-end` en situation de débordement (`safe` vs `unsafe`), le repli montrerait la
**première** ligne au lieu de la dernière. Le plan B — à n'activer que si le lot 1
échoue à l'écran — est de laisser le panneau en `flex-start` et de le décaler de
`translateY(-(H − 32)px)` ; la ligne du bas reste alors strictement immobile. Ce
plan B n'est **pas** retenu par défaut (il coûte du JS et une transformation).

---

## 3. La ligne qui reste visible, et ce que son texte dit

### 3.1 Le choix

**Replié, la ligne visible est la dernière ligne du bloc, telle quelle :**
`⋯ Autres écrans` **avec un projet ouvert**, `⚙ Options` **sans projet ouvert**.

Ce n'est pas une préférence esthétique, c'est la seule ligne possible :
- c'est **déjà** la seule que le HTML laisse visible sans projet (`btn-more-screens`
  est `project-only hidden`, `index.html:180`) ;
- c'est **la ligne qui décide du menu** : la garder visible garantit que le menu
  s'ouvre toujours au-dessus d'une ligne qui existe, à la bonne place ;
- c'est **la ligne la moins destructrice à voir seule** : elle n'exécute aucune
  action irréversible, elle ouvre un menu qui se referme ;
- elle ne bouge jamais (§ 2.4), donc le bloc peut se refermer sous le curseur sans
  jamais retirer la cible.

### 3.2 Ce que son texte dit — et ce qu'il ne dit pas

**Il dit assez, et voici pourquoi, sans rien ajouter à l'écran :**

1. **`Autres écrans` dit littéralement « il y a autre chose ici »** — et c'est la
   ligne que l'utilisateur connaît déjà : elle est là depuis le lot 3, avec son
   chevron (`index.html:180`, `style.css:1810-1820`). Le cadre accentué (le seul de
   l'interface) et le chevron disent « ceci est une porte ».
2. **Rien n'est perdu** : replié, le bloc s'ouvre au **survol** (100 ms), au **premier
   `Tab`** et au **premier appui tactile**. Une fonction n'est donc jamais
   *introuvable* : elle est au plus à un geste, dans la bande qu'on voit.
3. **Deux portes gardent un second chemin, et c'est vérifié** : `Brouillon` a
   `Ctrl+Shift+N` (`index.html:144`, `title="Brouillon (Ctrl+Shift+N)"`) ; `Options`
   reste atteignable par le **badge « Distant »**, dont le clic appelle
   `btnSettings.click()` (`settings.js`, verrou `badge-distant-bas.test.js:340-343`).
4. **L'infobulle de la ligne devient le seul ajout, et ce n'est ni un bouton ni un
   réglage** : l'attribut `title` de `btn-more-screens` passe de `Autres écrans` à un
   texte qui **nomme les six lignes** (« Autres écrans — le bloc s'ouvre au survol :
   Brouillon, Options, Assistant, Dossier du projet, Terminal, Commandes du projet »).
   Aucun verrou de test ne porte sur ce `title` (vérifié : `lot3-colonne-bas.test.js`
   n'impose que `aria-haspopup`, `aria-expanded`, `aria-controls`, `:356-366`).

**Ce qu'il ne dit pas, et qu'il faut assumer** : « Autres écrans » ne nomme pas
`Options`. Un utilisateur qui ne survole **jamais** la bande du bas et n'utilise
**jamais** le clavier ne découvrira pas `Options` par ce texte. C'est la seule
faiblesse du dispositif, et elle est traitée par la question fermée **Q2** (§ 7) :
la résorber exigerait de changer le libellé, donc de rouvrir un verrou du
propriétaire.

---

## 4. Clavier et toucher — explicitement

### 4.1 Clavier

| Geste | Effet | Raison |
|---|---|---|
| `Tab` arrivant dans le bloc | **déploie immédiatement, sans animation**, et force `scrollTop = 0` | l'anneau de focus (`outline-offset: 1px`, `style.css:11331`) doit être vu ; un cadre rogné qui défile tout seul est le piège n° 1 (§ 5.3) |
| `Tab` / `Shift+Tab` à l'intérieur | circule dans les 7 lignes, dépliées | ordre du DOM inchangé |
| `Tab` sortant du cadre | repli après **300 ms** | sursis, pas de fermeture brutale |
| `Échap` menu ouvert | ferme le menu **et rend le focus au déclencheur** — comportement existant, inchangé (`sidebar.js:1684-1688`) | ne pas doubler `Échap` : le menu a la priorité |
| `Échap` menu fermé, focus dans le bloc | replie **immédiatement** et rend le focus à la ligne visible | geste explicite |
| `Entrée` / `Espace` sur une ligne | action de la ligne, comme aujourd'hui | inchangé |

Les six premières lignes **restent focalisables** quand le bloc est replié : c'est
voulu. Le `focusin` déploie avant que l'utilisateur ne voie quelque chose d'incohérent.
Aucun `tabindex="-1"` n'est ajouté (cela retirerait des fonctions du parcours clavier).

### 4.2 Toucher

| Geste | Effet |
|---|---|
| 1er appui sur le bloc replié | **déploie et ne fait rien d'autre** (l'appui est consommé) |
| 2e appui sur une ligne | action normale |
| appui sur `Autres écrans` déplié | ouvre le menu (au-dessus, rien n'est rogné : le repli n'a pas lieu tant que le menu est ouvert) |
| appui hors du bloc déplié | replie (immédiat, sans sursis : il n'y a pas de « sortie de survol » à absorber) |
| appui sur `Options` replié sans projet | déploie d'abord (1er appui), agit au 2e — `Brouillon` apparaît entre-temps |

Deux précautions tactiles, obligatoires :
- **l'état de survol ne doit pas coller** après un appui : les états `:hover` du bloc
  passent sous `@media (hover: hover) and (pointer: fine)`, sinon un `:hover` « collé »
  laisse une ligne teintée sur tablette ;
- la détection se fait sur **`pointerdown` avec `pointerType === "touch"`**, pas sur
  `touchstart` : un seul chemin, celui du reste de l'application.

### 4.3 Mouvement réduit

Convention du projet respectée à l'identique : `prefers-reduced-motion: reduce`
**et** `window._pilotModalAnimations === false` (`modal-anim.js:43-44`) ⇒ classe
`no-motion` sur le cadre ⇒ `transition: none`, bascule **instantanée**.
**Les délais (100 ms / 300 ms) ne sont pas supprimés** : ce sont des délais de
*décision*, pas du mouvement ; les retirer ferait clignoter le bloc au moindre
passage de souris, ce qui est précisément ce que l'accessibilité cherche à éviter.

---

## 5. Pièges constatés dans le code (et comment ils sont traités)

### 5.1 `overflow: visible` est verrouillé — on ne peut pas simplement rogner

`#project-footer { overflow: visible }` (`style.css:847`) est **exigé** par
`lot3-colonne-bas.test.js:373` : le menu s'ouvre vers le haut et serait rogné.
→ Le rognage ne peut donc exister que dans une **règle d'état séparée**
(`#project-footer.pj-replie { overflow: clip }`), jamais dans le bloc de base. Le
helper du verrou ne lit que le sélecteur exact `#project-footer {`
(`lot3-colonne-bas.test.js:88-99`) : la règle d'état ne le trompe pas.

### 5.2 `.pj-panel` se comprime si on ne le protège pas

`.pj-panel` n'a **aucun `flex`** (`style.css:922-940`) ⇒ `flex: 0 1 auto` ⇒ dès que
le cadre descend à 50 px, le panneau est écrasé : les boutons gardent 32 px
(`flex: 0 0 auto`, `style.css:1750`) mais **sortent du panneau**, et la mesure de la
hauteur dépliée devient fausse. → `flex: 0 0 auto` sur `.pj-panel` est
**indispensable**, pas cosmétique.

### 5.3 Un conteneur `overflow: hidden` **défile tout seul** au focus

Un `overflow: hidden` **est** un conteneur de défilement : quand une ligne rognée
reçoit le focus, le moteur ajuste `scrollTop` pour la rendre visible — la ligne
d'ancrage disparaît alors et le bloc paraît vide. → **`overflow: clip`** (qui n'est
pas un conteneur de défilement) et, en repli de sécurité, `scrollTop = 0` forcé au
`focusin`. Support : WebView2 (Chromium ≥ 90) et WKWebView ≥ 16 : OK ; le repli JS
couvre le reste.

### 5.4 `fermer()` est enfermée dans `_initProjectFooterMenu`

`sidebar.js:1646-1688` : `fermer` est une constante **locale**. Or le repli doit
fermer le menu avant de rogner. → on expose **une seule** référence
(`this._fermerMenuAutresEcrans = fermer;`) **sans toucher aux cinq chaînes que le
verrou exige** (`lot3-colonne-bas.test.js:395-401`, dont l'ancre fragile
`"true\n    );"`) : l'ajout se fait **après** l'écouteur `keydown`, jamais dedans.

### 5.5 `height` anime le reflow, pas la composition

Animer `height` redessine l'arborescence à chaque image (elle est `flex: 1`,
`style.css:1558`). Sur 7 lignes c'est acceptable, mais : **pas de `will-change`**
(il créerait une couche plein cadre pour un gain nul), et **annulation propre si la
fenêtre est redimensionnée pendant l'animation** (la hauteur en pixels posée devient
fausse ; on termine l'état logique et on remesure).

### 5.6 La teinte de survol du cadre casse le contraste en thème clair

Mesure WCAG refaite (méthode officielle, jetons `style.css:331-380` et `:434-470`) :

| Fond du cadre | Thème sombre, `--text-secondary` | Thème clair, `--text-secondary` |
|---|---|---|
| repos, `accent 16 %` | **6,25:1** ✔ | **4,71:1** ✔ (juste au-dessus de 4,5) |
| survol, `accent 26 %` | 5,23:1 ✔ | **4,15:1 ✘** |

→ **Aucune teinte de survol du cadre n'est ajoutée.** Retour visuel = le mouvement
seul, qui commence à 100 ms. Cela évite aussi d'inventer un état que la règle d'états
du lot 1 ne prévoit pas (survol d'une ligne = `--surface-2` + `--text-primary`,
`style.css:1753-1758`).

### 5.7 Replier sans projet : le gain est faible, et c'est assumé

Sans projet, le bloc fait **88 px** (2 lignes) : replié il en fait **50** → **38 px
gagnés** seulement, et la ligne visible passe de `Options` à… `Options`.
→ Le repli s'applique quand même (une seule règle, pas deux comportements à
expliquer), et la décision acquise (« `Options` au repos sans projet ») est
respectée telle quelle.

### 5.8 Le changement de ligne d'ancrage à l'ouverture d'un projet

Replié, ouvrir un projet fait passer la ligne visible de `Options` à
`Autres écrans` **instantanément** (c'est `_showProjectButtons`,
`sidebar.js:1467`/`:1597`, inchangé). C'est le **seul** cas où le contenu du bloc
change sous l'utilisateur. Il est bénin (le curseur est alors sur le bouton
« Projets », en haut) et **ne justifie aucun code** : à constater au lot 1, pas à
traiter.

### 5.9 Deux détails de l'existant qu'on ne touche pas (mais qu'il faut savoir)

- Le chevron de `Autres écrans` est un `chevron-down` qui pivote à 180° quand le menu
  est **ouvert** (`style.css:1810-1820`) alors que le menu s'ouvre **vers le haut** :
  il porte donc déjà deux sens sur un seul symbole. **On ne lui ajoute pas un
  troisième état** (replié/déplié) : aucun chevron ne signale le repli.
- En mode zen, `#project-footer` est masqué (`style.css:3888-3891`) : le repli n'a
  aucun effet et ne doit rien laisser tourner (minuteurs annulés au masquage).

---

## 6. Lots de livraison, dans l'ordre imposé

Chaque lot est **livrable seul**, **ne retire aucune fonction** et **arrive avec son
verrou** (test rouge avant, vert après) **et sa ligne de documentation**. Aucun lot
n'attend le suivant pour être sûr.

### LOT 1 — le repli et le déploiement au survol (le cœur, 1 test + 1 module)

- **Verrou** : `src/js/repli-menus-bas.test.js` — recalcule depuis le disque :
  hauteur repliée = `2 + 2×padding + 32` lue dans `style.css` ; `justify-content:
  flex-end` présent dans `#project-footer {` ; `overflow: visible` **toujours** dans
  ce même bloc ; `overflow: clip` dans la règle `.pj-replie` ; `.pj-panel` porte
  `flex: 0 0 auto` ; `transition: height var(--transition)` ; constantes
  `OUVERTURE_MS = 100` et `GRACE_MS = 300` **égales** à `--transition-fast` et
  `--transition-smooth` relues dans `style.css`.
- **Code** : `style.css` (3 déclarations dans `#project-footer`, 1 dans `.pj-panel`,
  1 règle d'état), `index.html` (`class="pj-replie"` sur `#project-footer`, pour peindre
  l'état au premier rendu sans clignotement), **nouveau module pur**
  `src/js/sidebar-footer-fold.js` (constantes, `hauteurDeplieePx`, `doitResterDeplie`,
  attache des écouteurs) branché depuis `Sidebar.init()` à côté de
  `_initProjectFooterMenu()` (`sidebar.js:244`).
- **Ne retire aucune fonction** : `Autres écrans` reste la ligne visible et cliquable ;
  le survol déploie.
- **Doc** : `docs/proposition-presentation-ui.md` § 3.3 (état réel du bloc) +
  `spec_pilot.md` § C.

### LOT 2 — le clavier

- **Verrou** : le même fichier de test — `focusin` déploie **sans** animation ;
  `Échap` ne double jamais le menu ; `focusout` arme le sursis de 300 ms ;
  `scrollTop = 0` forcé ; aucune ligne ne reçoit `tabindex="-1"`.
- **Code** : `sidebar-footer-fold.js` uniquement (aucune ligne de `sidebar.js`
  déplacée, aucune des cinq chaînes du verrou du menu touchée — § 5.4).
- **Doc** : `help/overview.md` bloc `<!-- HELP:overview -->` (« le bloc s'ouvre au
  clavier ») puis `npm run build:handbook`.

### LOT 3 — le toucher

- **Verrou** : 1er appui tactile = déploiement seul (aucun `click` ne part) ; 2e appui
  = action ; `:hover` du bloc sous `@media (hover: hover) and (pointer: fine)` ;
  appui hors du bloc déplié = repli immédiat.
- **Code** : `sidebar-footer-fold.js` + une media query dans `style.css`.
- **Doc** : `help/overview.md` (même bloc), régénération du handbook.

### LOT 4 — le mouvement réduit

- **Verrou** : `no-motion` posée si **et seulement si** `prefers-reduced-motion:
  reduce` **et** `window._pilotModalAnimations === false` ; les deux délais restent
  actifs dans ce mode.
- **Code** : `sidebar-footer-fold.js` + `#project-footer.no-motion { transition: none }`.
- **Doc** : `docs/proposition-presentation-ui.md` § 2 (règle d'états, un état de
  mouvement de plus) et `spec_pilot.md` § C.

### LOT 5 — la documentation et la clôture

- **Verrou** : le test du lot 1 vérifie que `spec_pilot.md` et `help/overview.md`
  décrivent l'état replié (présence des mots « replié » et « survol » dans les deux).
- **Code** : aucun.
- **Doc** : `spec_pilot.md` § C (hauteur 50 px, ligne visible, délais),
  `help/overview.md`, `help/handbook.md` régénéré, ce rapport passé en « livré ».

---

## 7. Questions fermées (3 au maximum)

### Q1 — Au toucher, le premier appui déploie-t-il **sans rien faire** (recommandé) ou déploie-t-il **et agit** ?

- **Recommandation : déploie sans rien faire** (2 appuis pour agir).
- **Raison** : sur un écran tactile, l'appui sur un bloc replié ne peut atterrir que
  sur la ligne d'ancrage ; ouvrir d'autorité un menu entier sur un geste de
  découverte est une action que l'utilisateur n'a pas demandée. C'est aussi cohérent
  avec le clavier, où le premier `Tab` déploie sans activer. Coût : un appui de plus
  pour ouvrir « Autres écrans » au doigt.

### Q2 — Replié, la ligne garde-t-elle le libellé **`Autres écrans`** (recommandé) ou reçoit-elle un texte qui nomme le contenu (ex. `Menus du projet`) ?

- **Recommandation : garder `Autres écrans`**, et n'ajouter qu'une **infobulle
  enrichie** (attribut `title`, ni bouton ni réglage).
- **Raison** : changer le libellé rouvre un verrou du propriétaire
  (`lot3-colonne-bas.test.js:286-295`, « les libellés sont écrits en clair ») pour un
  gain incertain, alors que le contenu est **à un geste** (survol 100 ms, `Tab`,
  appui). Si le propriétaire préfère le texte explicite, c'est **la seule** ligne de
  ce document qui doive être modifiée — et le lot 1 doit alors réécrire ce verrou.

### Q3 — En **mouvement réduit**, garde-t-on les délais de 100 / 300 ms (recommandé) ou le bloc devient-il instantané dans les deux sens ?

- **Recommandation : garder les délais**, supprimer seulement l'animation de hauteur.
- **Raison** : les délais ne sont pas du mouvement, ce sont des **absorbeurs de
  gestes** ; les supprimer ferait clignoter le bloc au moindre passage de souris — un
  scintillement, qui est exactement ce que `prefers-reduced-motion` demande d'éviter.
  Seule la transition de 180 ms est retirée (bascule franche, sans interpolation).

---

## 8. Ce que cette conception ne fait pas (garde-fous respectés)

- **Aucune fonctionnalité, aucun réglage, aucun bouton ajouté** : le bloc contient
  toujours exactement les 7 mêmes boutons, avec les mêmes identifiants, les mêmes
  libellés, les mêmes infobulles (une seule infobulle enrichie en texte, Q2).
- **La colonne reste à 280 px** (défaut et plancher) : le repli ne touche que la
  hauteur. Rien n'est raccourci, rien n'est élargi.
- **Le bandeau du haut, le logo, la rangée d'onglets et la ligne d'information du
  bas ne changent pas d'un pixel.** La ligne d'information du bas ne bouge jamais,
  puisque le bloc se replie vers le haut.
- **Aucune information utile n'est cachée sans porte** : la ligne visible nomme la
  porte (`Autres écrans`), deux fonctions gardent un second chemin (`Ctrl+Shift+N`,
  badge « Distant »), et le déploiement est au premier geste de chaque modalité
  (survol, `Tab`, appui).
- **Aucune décision du propriétaire n'est rouverte** : la ligne d'ancrage, la hauteur
  de 278 px, la septième ligne, l'absence de mise en évidence et le menu vers le haut
  sont repris tels quels. Les trois points encore ouverts sont posés en § 7, avec leur
  recommandation.
