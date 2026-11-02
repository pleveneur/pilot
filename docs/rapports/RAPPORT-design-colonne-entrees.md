# Conception — la colonne de gauche : le haut se vide, le bas accueille

> Demande du propriétaire (2026-10-25, après essai de la version locale), ses mots :
> « Le bouton "Brouillon" et "Options" en haut à gauche doivent disparaître, ça doit
> être dans la liste en bas à gauche (première option pour "Brouillon")... On récupère
> donc l'espace d'une ligne, tout remonte d'une ligne. Et mets "Lancer l'agent" dans
> "Autres écrans". »
>
> Ce document est une **conception écrite**. Aucun fichier de code n'a été modifié.
> Toutes les valeurs de taille sont dans les unités déjà utilisées par le projet
> (`px`, jetons `--font-*`, `--fw-*`, `--radius-*`, `--surface-*`).
>
> **Décisions antérieures reprises comme contraintes fermes** (jamais rouvertes) :
> la bande haute de 32 px a disparu et ne revient pas (`index.html:19-26`) ; le coin
> haut droit garde son air autour des trois boutons de fenêtre (`index.html:274-287`,
> `src/css/style.css:93-99`) ; la colonne de gauche reste à **280 px** de base
> (`src/css/style.css:740`, `src/js/sidebar.js:1697-1709` pour le glisser existant).

---

## 1. État constaté, avec preuves

### 1.1 Où sont aujourd'hui « Brouillon » et « Options »

| Élément | Preuve |
|---|---|
| Les deux boutons sont **dans la colonne de gauche, tout en haut**, sous le bandeau du nom de projet, dans un conteneur `#global-actions` | `index.html:81-85` (`<div id="global-actions">` ; `btn-scratchpad` ; `btn-settings` ; `#remote-badge`) |
| Ordre actuel dans ce conteneur : **Brouillon**, **Options**, puis le badge « Distant » | `index.html:82`, `index.html:83`, `index.html:84` |
| Libellés affichés mot pour mot : « **Brouillon** » (infobulle « Brouillon (Ctrl+Shift+N) ») et « **Options** » (infobulle « Options ») | `index.html:82-83` |
| Icônes : `file-text` (16 px, classe `.icon`) et `settings` (16 px) | `index.html:82-83` ; `.icon { width: 16px; height: 16px }` `src/css/style.css:303` |
| Ce conteneur est la **première** chose après le bandeau de 48 px du nom de projet | `index.html:39-60` (`#project-selector`) puis `index.html:81` ; hauteur `48px` en `src/css/style.css:1039-1040` |

### 1.2 La hauteur exacte de « la ligne » à récupérer

Règle CSS du conteneur (`src/css/style.css:762-778`) :

```
#global-actions { flex-shrink: 0; margin: 8px 8px 0; padding: 0 8px 8px;
                  display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
```

et règle d'exception des boutons (`src/css/style.css:1712-1721`) :
`height: 28px`, `width: auto`, `padding: 0 6px`, libellé `12 px` / `500`.

**Hauteur verticale occupée = 8 (marge haute) + 28 (rangée de boutons) + 8 (padding bas)
= 44 px.** C'est cela, « l'espace d'une ligne » : 28 px visibles + 16 px d'air.

Conséquence mesurable : tout ce qui suit remonte de **44 px** quand ce bloc disparaît —
`#open-projects-bar` (`index.html:86`), `#tree-filter-wrapper` (`index.html:87`),
`#favorites-section` (`index.html:90`), `#file-tree` (`index.html:91`).

Note honnête : le conteneur porte aussi le badge « Distant » (`#remote-badge`,
`hidden` par défaut, `src/css/style.css:7271`). Il n'occupe aucune hauteur tant qu'il
est masqué — voir §3.4 pour ce qu'il devient.

### 1.3 « La liste en bas à gauche » : c'est le bloc `#project-footer`

Ce n'est pas « Projets en cours » (`#open-projects-bar`, qui est en **haut**, sous le
bouton « Projets »). La liste du **bas** est le bloc encadré, seul cadre accentué de
l'interface :

- Conteneur : `index.html:117` `<div id="project-footer" class="project-only hidden">`
  → **il n'existe à l'écran que lorsqu'un projet est ouvert** (voir §3.3).
- Règle : `src/css/style.css:780-803` (marges `0 8px 8px` `:782`, `gap: 6px` `:785`,
  `overflow: visible` `:790`, `max-height: 50 %` `:795`, fond accent 16 % `:798`,
  bordure `1px solid var(--accent)` `:799`).
- Panneau interne `.pj-panel` : `index.html:120`, `src/css/style.css:861-880`
  (`display:flex` colonne, `gap: 6px`, `padding: 0`).
- **Contenu actuel = SIX lignes de 32 px, dans cet ordre** (`index.html:125-157`) :

| # | Libellé affiché | Id | Icône | Classe de visibilité |
|---|---|---|---|---|
| 1 | Lancer l'agent | `btn-terminal-cmd` | `bot` (16 px) + `pj-row-main` (13 px / 600, icône accent) | `project-only hidden` |
| 2 | Assistant | `btn-superagent` | `compass` | `project-only hidden` |
| 3 | Dossier du projet | `btn-explorer` | `folder-open` | `project-only hidden` |
| 4 | Terminal | `btn-terminal` | `terminal` | `project-only hidden` |
| 5 | Commandes du projet | `btn-commands` | `square-terminal` | `project-only hidden` |
| 6 | Autres écrans ▾ | `btn-more-screens` | `more-horizontal` + `chevron-down` (14 px) | `project-only hidden` |

- **Hauteur constatée du bloc** : `2 (bordures) + 16 (padding 8×2) + 6 × 32 + 5 × 6 = 240 px`
  (le calcul est aussi écrit dans `src/css/style.css:791-795` et vérifié par
  `src/js/lot3-colonne-bas.test.js:229-246`).
- **Plafond** : `max-height: 50 %` (`src/css/style.css:795`) = **250 px** à la hauteur minimale de fenêtre
  (**500 px**, `src-tauri/tauri.conf.json:48`). Marge actuelle : 10 px seulement.
  Le commentaire du code le dit : « une 7ᵉ ligne ferait déborder »
  (`RAPPORT-barre-du-bas-quatre-acces.md`, §2).

### 1.4 Où se trouve aujourd'hui « Lancer l'agent »

- Bouton `#btn-terminal-cmd`, **première ligne du bloc du bas** (`index.html:125`),
  seul élément mis en évidence du bloc (`.pj-row-main`, `src/css/style.css:1699-1706`).
- Effet réel du clic (`src/js/main.js:865-878`) : si l'agent RPC est activé →
  ouvre l'onglet de conversation de l'agent ; sinon → terminal intégré ; sinon →
  terminal système.
- **Aucun raccourci clavier ne le double** : la palette de commandes n'a aucune entrée
  « lancer l'agent » (`COMMANDS`, `src/js/main.js:57-86`). Le bouton « ＋ » de la rangée
  d'onglets (`.tab-add-agent`, `src/js/tabs.js:232-240`) fait **autre chose** : un onglet
  agent **indépendant**, pas la conversation de l'agent du projet.

### 1.5 Ce qui est verrouillé par un test aujourd'hui (à ne pas casser par ignorance)

| Verrou | Fichier:ligne | Ce qu'il exige |
|---|---|---|
| « le haut ne contient plus que deux boutons » | `src/js/lot2-colonne-haut.test.js:202-207` | exactement **2** `<button` dans `#global-actions` |
| « le haut de la colonne garde exactement deux boutons nommés » | `src/js/retrait-ecran-aide.test.js:52-61` | idem, + présence des mots « Brouillon » et « Options » |
| pastilles de 28 px à libellé 12 px | `src/js/lot2-colonne-haut.test.js:219-224` | la règle CSS `#global-actions button { width:auto; height:28px` existe |
| « six lignes, dans l'ordre figé » | `src/js/lot3-colonne-bas.test.js:107-115`, `:200-217` | `LIGNES` = 6 identifiants, dans l'ordre |
| « la hauteur calculée du bloc est bien 240 px » | `src/js/lot3-colonne-bas.test.js:229-246` | `240`, `max-height: 50%` |
| « Lancer l'agent est la ligne mise en évidence » | `src/js/lot3-colonne-bas.test.js:247-260` | `class="project-only hidden pj-row-main"` + règles CSS |
| neuf entrées dans le menu | `src/js/lot3-colonne-bas.test.js:162-170` | `.pj-more-item` = 9, `MENU` = 9 identifiants |
| `#btn-settings` garde `<span class="ga-label">Options</span>` | `src/js/libelle-options-ecran.test.js:72-86` | la classe `.ga-label` ne doit pas changer sur ce bouton |

Ces verrous ne sont pas des obstacles : ils **décrivent l'état d'avant**. Ils doivent être
mis à jour dans la même mission que le changement (§4, lot 1, étape 1.g), sinon la suite de tests rougit.

---

## 2. Cible tranchée

### 2.1 Le haut de la colonne n'a plus aucun bouton

- Les deux `<button>` quittent `#global-actions` (`index.html:82-83`).
- `#global-actions` **reste dans le DOM** (il porte le badge « Distant », qui garde sa
  place et ses marges), mais il n'occupe **plus aucune hauteur** quand le badge est
  masqué : ses `margin` et `padding` passent à `0`, et l'air du badge est porté par le
  badge lui-même (§3.4).
- **Rien ne remonte « d'une ligne » de façon symbolique : tout remonte réellement de
  44 px.** Le nom du projet reste en haut (`#project-selector`, 48 px), puis la liste
  des fichiers commence 44 px plus haut qu'aujourd'hui. Aucune place vide n'est réservée.

**Pourquoi c'est mieux** : le propriétaire voit d'un coup d'œil plus de fichiers de son
projet, sans faire défiler ; et les deux commandes qu'il utilise le plus rarement ne
mangent plus la place la plus précieuse de l'écran.

### 2.2 La liste du bas : ordre complet et définitif (7 lignes)

Les deux entrées nouvelles sont **les deux premières lignes**, dans l'ordre où elles
étaient côte à côte en haut (Brouillon puis Options) : le geste mental ne change pas,
seule la place change.

| # | Libellé affiché (mot pour mot) | Id (inchangé) | Icône `data-lucide` | Taille icône | Classe du libellé | Visible quand aucun projet n'est ouvert |
|---|---|---|---|---|---|---|
| 1 | **Brouillon** | `btn-scratchpad` | `file-text` | `.icon` 16 px | `.ga-label` (conservée — §3.8) | **oui** |
| 2 | **Options** | `btn-settings` | `settings` | `.icon` 16 px | idem | **oui** |
| 3 | **Assistant** | `btn-superagent` | `compass` | `.icon` 16 px | `.pj-btn-label` | non |
| 4 | **Dossier du projet** | `btn-explorer` | `folder-open` | `.icon` 16 px | `.pj-btn-label` | non |
| 5 | **Terminal** | `btn-terminal` | `terminal` | `.icon` 16 px | `.pj-btn-label` | non |
| 6 | **Commandes du projet** | `btn-commands` | `square-terminal` | `.icon` 16 px | `.pj-btn-label` | non |
| 7 | **Autres écrans** ▾ | `btn-more-screens` | `more-horizontal` + `chevron-down` | `.icon` 16 px + `.icon-sm` 14 px | `.pj-btn-label` | non |

- **Infobulles conservées au caractère près** : `title="Brouillon (Ctrl+Shift+N)"` et
  `title="Options"` (`index.html:82-83`).
- **Aucun `pj-row-main`** sur ces lignes : les 7 lignes sont à **32 px de haut**,
  `12 px` / `400`, couleur `--text-secondary`, icône à gauche, libellé à gauche
  (`.pj-panel button`, `src/css/style.css:1686-1695`). Plus aucune ligne n'est mise en
  évidence : le bloc devient une liste régulière. C'est la conséquence directe de la
  sortie de « Lancer l'agent ».
- **États identiques pour les 7 lignes** (aucun nouvel état à inventer) :
  - normal : fond transparent, texte `--text-secondary`, bordure transparente ;
  - survol : fond `--surface-2`, texte `--text-primary`, bordure `--border-subtle`
    (`src/css/style.css:1668-1679`) ;
  - appui : `transform: scale(0.97)` (`:1680-1682`) ;
  - désactivé : `opacity: 0.45`, `cursor: not-allowed` (`src/css/style.css:11145-11153`) ;
  - focus clavier : `button:focus-visible` → `outline 2px var(--accent)`,
    `outline-offset: 1px` (`src/css/style.css:11155-11170`).
  Ces cinq états viennent des **jetons de thème** : ils sont donc valables en thème
  sombre **et** en thème clair sans second réglage (aucune couleur écrite en dur, ce
  que vérifie `src/js/lot3-colonne-bas.test.js:313-343`).
- **Largeur / lisibilité** (colonne 280 px) :
  `280 − 16 (marges) − 2 (bordures) = 262 px` utiles ;
  `262 − 16 (padding 8×2) − 16 (icône) − 8 (gap) = 222 px` pour le libellé.
  Le plus long reste « Commandes du projet » (~120-140 px à 12 px) : **aucune ellipse**.
  « Brouillon » et « Options » sont bien plus courts.

**Pourquoi c'est mieux** : toutes les portes vers un écran sont désormais **au même
endroit**, du haut vers le bas, dans un seul cadre ; le propriétaire n'a plus deux
familles de boutons à mémoriser (deux pastilles en haut, six lignes en bas).

### 2.3 « Lancer l'agent » entre dans « Autres écrans » — position exacte

**Position tranchée : première entrée du premier groupe, « Mon projet »**, donc la toute
première ligne du menu. Le menu s'ouvre **vers le haut** (`src/css/style.css:1762`,
`bottom: calc(100% + 4px)`) : sa première ligne est collée au déclencheur, c'est la plus
proche du pouce et de l'œil, et elle est **toujours visible sans faire défiler**, même
quand la fenêtre est à sa hauteur minimale (le menu plafonne à `60vh` = 300 px à 500 px
de haut, son contenu fait ~413 px : il défile, mais son début non).

| Menu « Autres écrans » — état cible (10 entrées, 5 groupes) | Libellé | Icône |
|---|---|---|
| **MON PROJET** | **Lancer l'agent** ← *(nouveau, id `btn-terminal-cmd` conservé)* | `bot` |
| | Prompt Builder | `puzzle` |
| **COMPRENDRE** | Tableau de bord | `gauge` |
| | Graphe du projet | `network` |
| | Historique des sessions | `history` |
| **VÉRIFIER** | Revue de code (diff Git) | `search-check` |
| **COLLABORER** | Équipe d'agents | `users` |
| | Kanban | `columns-3` |
| | Discussion inter-projets | `link` |
| **SOURCES** | GDS du projet | `database` |

- La ligne du menu reprend **exactement** le style des autres entrées du menu
  (`.pj-more-menu .pj-more-item`, `src/css/style.css:1801-1831`) : **28 px**, `padding: 0 8px`,
  `gap: 8px`, icône `.icon-sm` (14 px, `--text-secondary`), libellé `12 px`,
  `--text-primary`, survol `--surface-3`, appui `scale(0.97)`.
- Elle garde son `title="Lancer l'agent : ouvrir la conversation de l'agent"`, son
  identifiant `btn-terminal-cmd`, sa classe `project-only hidden`, et gagne
  `class="pj-more-item"` + `role="menuitem"` — ce qui la fait **refermer le menu après le
  clic** (`src/js/sidebar.js:1658-1660`, `e.target.closest(".pj-more-item")`).
- Perte à annoncer clairement : **passer de 1 clic à 2 clics** pour lancer l'agent
  (ouvrir le menu, puis la ligne), et **aucun raccourci clavier ne compense** (§1.4).
  L'accès reste direct (le menu est à un clic, sans sous-menu), rien n'est perdu, mais
  l'action la plus fréquente devient une action en deux temps. C'est la demande du
  propriétaire ; elle est appliquée telle quelle.
- **Non retenu volontairement** : créer un nouveau groupe « Agent » en tête de menu.
  Cela porterait le menu à 6 groupes et éloignerait « Prompt Builder » de sa rubrique.
  C'est la question fermée n° 2.

### 2.4 Ce que devient la zone libérée en haut : rien

Pas de bandeau, pas de séparateur, pas d'espace réservé. Le bandeau du nom de projet
(48 px) est suivi immédiatement du filtre / des projets en cours / de la liste des
fichiers. 44 px rendus à la liste des fichiers.

---

## 3. Effets de bord vérifiés

### 3.1 La bande haute de 32 px (déjà validée) ne bouge pas

Non touchée : `#app-body` commence en haut de la fenêtre, la rangée d'onglets fait
`min-height: 36px` + 1 px de filet (`src/css/style.css:1841-1849`). Le changement ne
touche **que** la colonne de gauche. Aucune ligne des règles `#tab-row`, `#tab-bar`,
`#window-controls` n'est modifiée.

### 3.2 Le coin haut droit garde son air

`#window-controls` et son padding d'air (4 px en haut, à droite et en bas,
`src/css/style.css:99` ; boutons en `index.html:274-287`) ne sont pas touchés, et aucun
élément ne vient s'ajouter à leur gauche : le badge « Distant » reste **dans la colonne de gauche**, à sa place actuelle
(§3.4). Rien ne s'approche des trois boutons.

### 3.3 Obstacle réel n° 1 — le bloc du bas n'existait que si un projet est ouvert

`#project-footer` porte `project-only hidden` (`index.html:117`), et c'est
`sidebar.js` qui le montre : `.project-only` retirés à l'ouverture d'un projet
(`src/js/sidebar.js:1467-1473`), `.hidden` remis à la fermeture (`:1597-1599`).
Si on y range « Brouillon » et « Options » **sans corriger cela**, les deux commandes
disparaissent de l'écran quand aucun projet n'est ouvert — exactement ce que le
propriétaire veut éviter (« ça doit être dans la liste »).

**Plus petite solution retenue** : le cadre devient **toujours visible**. On retire
`project-only hidden` de `#project-footer` — les **six autres** lignes portent déjà
`project-only hidden` **individuellement** (`index.html:125,128,134,136,140,157`) : avec
aucun projet ouvert, le même cadre affiche alors **2 lignes** (Brouillon, Options), avec
projet ouvert **7 lignes**. Un seul attribut change, `sidebar.js` n'est pas touché
(`_showProjectButtons` / `closeProject` continuent de piloter les lignes).

- Conséquence visuelle à annoncer : au tout premier démarrage (aucun projet), le cadre
  apparaît **en bas** de la colonne avec deux lignes. C'est cohérent avec la demande
  (une seule liste, en bas), mais cela change le premier écran. Question fermée n° 3.
- Mode Zen : inchangé — `body.zen-mode #project-footer { display: none !important }`
  (`src/css/style.css:3802-3805`) masquait déjà ce bloc ; il masquait aussi
  `#global-actions`. Rien ne change pour l'utilisateur.

### 3.4 Le badge « Distant » : où il reste, et pourquoi le haut reste à 0 px

`#remote-badge` est le troisième enfant de `#global-actions` (`index.html:84`), masqué
par défaut (`.remote-badge.hidden`, `src/css/style.css:7271`), affiché seulement quand un client
distant est connecté (`src/js/settings.js:1113-1114`).

**Décision** : le badge **ne bouge pas** (même place, même famille visuelle 28 px /
`11 px` / 600, `src/css/style.css:7235-7262`). Seul son porteur s'aplatit :

- `#global-actions` : `margin: 0; padding: 0;` (on garde `display:flex`,
  `flex-wrap: wrap`, `align-items: center`, `gap: 6px` — le verrou
  `retrait-ecran-aide.test.js:63-69` exige encore `flex-wrap: wrap` et aucune hauteur
  minimale : il reste **vert sans modification**).
- `.remote-badge` : `margin` (`src/css/style.css:7244`) passe de `0 0 0 auto` à
  **`8px 8px 8px auto`**.

Résultat mesuré :

| Situation | Hauteur du haut de colonne | Verdict |
|---|---|---|
| Aujourd'hui, badge masqué | 8 + 28 + 8 = **44 px** | — |
| Cible, badge masqué | **0 px** | 44 px rendus |
| Aujourd'hui, badge affiché | 44 px | — |
| Cible, badge affiché | 8 + 28 + 8 = **44 px** | **identique** — rien ne change pour l'utilisateur qui supervise à distance |

### 3.5 Obstacle réel n° 2 — une 7ᵉ ligne dépasse le plafond du bloc

Arithmétique du bloc, mêmes termes que le code :

```
aujourd'hui (6 lignes) : 2 + 16 + 6×32 + 5×6 = 240 px
cible       (7 lignes) : 2 + 16 + 7×32 + 6×6 = 278 px
```

Or `max-height: 50 %` = **250 px** à la fenêtre minimale de 500 px
(`src-tauri/tauri.conf.json:48`). Et `overflow: visible` est **obligatoire** (sinon le
menu « Autres écrans », qui s'ouvre vers le haut, serait rogné —
`src/css/style.css:786-790`, verrou `lot3-colonne-bas.test.js:274-282`). Donc **pas de
défilement possible** : la 7ᵉ ligne serait **dessinée hors du cadre**, par-dessus la
liste des fichiers (« Autres écrans » flottant au-dessus de l'arborescence).

**Plus petite solution** : `max-height: 50 % → 60 %` (une seule valeur).
À 500 px : 60 % = **300 px** > 278 px → marge de 22 px, aucune ligne hors cadre.
À toute hauteur supérieure, 60 % est encore plus large. C'est la seule valeur à
changer : ni le `padding`, ni le `gap`, ni la hauteur des lignes ne bougent (les réduire
ne suffirait pas : `gap: 4` donnerait 266 px > 250 px, `padding: 4` donnerait 268 px).

Cette valeur avait été fixée par une décision du propriétaire (Q3 du 2026-10-25,
40 % → 50 %). Elle n'est pas rouverte de mon propre chef : elle est **rendue
nécessaire par l'ajout d'une ligne**, et c'est la question fermée n° 1.

Autre conséquence à connaître : à la fenêtre minimale (500 px), la colonne se partage
ainsi — bandeau 48 px + bloc 278 px + 8 px de marge = 334 px, la liste des fichiers
garde ~166 px. Elle reste utilisable (elle défile), mais l'arborescence visible est
courte. Rien ne déborde : `#file-tree` est `flex: 1; overflow-y: auto`
(`src/css/style.css:1479-1483`).

### 3.6 Ce qui ne se perd pas (vérifié, preuve à l'appui)

| Accès | Avant | Après | Preuve |
|---|---|---|---|
| « Brouillon » par le bouton | 1 clic, en haut | 1 clic, 1ʳᵉ ligne du bloc | id `btn-scratchpad` inchangé ; câblage `src/js/main.js:902-904` inchangé |
| « Brouillon » au clavier | `Ctrl+Shift+N` | **identique** | `src/js/main.js:1083-1088` (gestionnaire global, ne dépend d'aucun bouton) |
| « Brouillon » par la palette | commande « Ouvrir le brouillon » | **identique** | `src/js/main.js:73`, `:357-358` |
| « Options » par le bouton | 1 clic, en haut | 1 clic, 2ᵉ ligne du bloc | id `btn-settings` inchangé ; câblage `src/js/settings.js:391`, `:2010-2012` |
| « Options » par la palette | commande « Ouvrir les Options » | **identique** | `src/js/main.js:85`, `:400-408` |
| « Options » par le badge distant | oui | **identique** | `src/js/settings.js:1113+` |
| « Lancer l'agent » | 1 clic | **2 clics** (menu → ligne) | §2.3. Aucun raccourci n'existe aujourd'hui (§1.4) : **c'est la seule perte d'accès direct, elle est assumée par la demande** |
| Les 9 autres écrans du menu | 2 clics | **identique** | ids inchangés (`lot3-colonne-bas.test.js:91-105`) |

Aucun écran ne devient inaccessible. Aucun identifiant n'est renommé. Aucun gestionnaire
de clic n'est déplacé (le câblage est fait par `getElementById`, donc indifférent à la
place dans le DOM).

### 3.7 Ordre de tabulation (accessibilité clavier)

L'ordre du DOM = l'ordre de la touche Tab. Après le changement, dans la colonne :
« Projets » → **Brouillon → Options** → (filtre, projets en cours, arborescence) →
**Assistant → Dossier du projet → Terminal → Commandes du projet → Autres écrans**.
C'est l'ordre visuel de haut en bas : rien d'incohérent. À noter : l'arborescence passe
désormais **entre** « Options » et « Assistant » (elle y était déjà entre « Options » et
« Lancer l'agent »).

### 3.8 Le libellé de classe des deux lignes déplacées

Deux possibilités, **résultat visuel identique** (le conteneur est en `flex` avec
`justify-content: flex-start`, le `text-align: left` de `.pj-btn-label` n'a aucun effet
sur une boîte de largeur automatique) :

- `.ga-label` : garde `src/js/libelle-options-ecran.test.js:72-86` **vert sans y toucher**.
- `.pj-btn-label` : uniformise le nom avec les cinq autres lignes, mais **exige de
  modifier ce test**.

**Tranché : garder `.ga-label`** — moins de verrous touchés, aucun risque visuel.

---

## 4. Lots d'application

### Pourquoi la découpe ne peut pas être plus fine (à lire avant les lots)

Trois quantités sont liées, et **aucun état intermédiaire n'est acceptable** :

| État | Lignes du bloc | Hauteur | Verdict |
|---|---|---|---|
| aujourd'hui | 6 | 240 px (plafond 250) | tenable |
| ajouter les 2 entrées **sans** retirer « Lancer l'agent » | 8 | `2+16+8×32+7×6` = **316 px** | **déborde** (même à 60 % = 300 px) : deux lignes dessinées hors cadre |
| retirer « Lancer l'agent » **sans** ajouter les 2 entrées | 5 | 218 px | les deux commandes n'existent plus à l'écran |
| déplacer les 2 entrées sans retirer `project-only hidden` du cadre | 7 | 278 px | « Brouillon » et « Options » disparaissent quand aucun projet n'est ouvert |
| **cible** | **7** | **278 px** (plafond 300) | tenable |

Il n'existe donc **qu'un seul découpage sûr** : le changement visible, ses commentaires
de code et les verrous de tests qui le décrivent forment **une seule mission** (lot 1).
Les deux lots suivants (documentation, recette) sont indépendants et livrables seuls.

---

### Lot 1 — « La colonne change de visage » (insécable, une seule mission)

Fichiers : `index.html`, `src/css/style.css`, `src/js/lot2-colonne-haut.test.js`,
`src/js/retrait-ecran-aide.test.js`, `src/js/lot3-colonne-bas.test.js`.
**Aucun JavaScript de production n'est touché** : le câblage se fait par identifiant, il
ne dépend pas de la place dans le DOM.

#### 1.a — Les deux boutons quittent le haut (`index.html`)

1. **Supprimer** les lignes 82 et 83 (les deux `<button>` de `#global-actions`).
2. Ne pas toucher à la ligne 81 (`<div id="global-actions">`) ni à la ligne 84
   (`#remote-badge`) : le badge « Distant » garde sa place. Le conteneur se vide mais
   **reste dans le DOM** (il porte le badge).

#### 1.b — Le bloc du bas devient toujours visible (`index.html:117`)

Remplacer `<div id="project-footer" class="project-only hidden">` par
`<div id="project-footer">`. Les six lignes existantes gardent **individuellement** leur
`project-only hidden` : sans projet ouvert le cadre affiche 2 lignes, avec projet 7.
`src/js/sidebar.js` n'est pas touché (`_showProjectButtons` / `closeProject` continuent de
piloter les lignes).

#### 1.c — Les deux entrées ouvrent la liste (`index.html`, après la ligne 120)

Insérer comme **premier et deuxième enfants** de `.pj-panel`, juste après
`<div class="pj-panel">`, à l'**indentation de 8 espaces** (le test de structure compte
les lignes qui commencent par 8 espaces puis `<button`), sur une seule ligne chacune,
dans cet ordre :

```html
        <button id="btn-scratchpad" title="Brouillon (Ctrl+Shift+N)"><i data-lucide="file-text" class="icon"></i><span class="ga-label">Brouillon</span></button>
        <button id="btn-settings" title="Options"><i data-lucide="settings" class="icon"></i><span class="ga-label">Options</span></button>
```

Ni `project-only`, ni `hidden`, ni `pj-row-main`. La classe du libellé reste
**`.ga-label`** (décision §3.8 : aucun test à modifier, rendu identique).

#### 1.d — « Lancer l'agent » entre dans le menu (`index.html`)

1. **Supprimer** la ligne 125 (le `<button id="btn-terminal-cmd" …>` du bloc) et son
   commentaire d'introduction (`:121-124`).
2. **Insérer** dans le groupe « Mon projet », juste après la ligne du titre
   `<div class="pj-more-group-label" id="pj-more-groupe-projet">Mon projet</div>` — donc
   **avant** « Prompt Builder » — cette ligne unique (indentation de 14 espaces, comme
   les autres entrées du menu) :

```html
              <button id="btn-terminal-cmd" class="project-only hidden pj-more-item" role="menuitem" title="Lancer l'agent : ouvrir la conversation de l'agent"><i data-lucide="bot" class="icon-sm"></i><span class="pj-btn-label">Lancer l'agent</span></button>
```

Elle conserve son identifiant, son infobulle et sa classe `project-only hidden`, et gagne
`pj-more-item` + `role="menuitem"` (le menu se referme après le clic,
`src/js/sidebar.js:1658-1660`). Le câblage `src/js/main.js:865-878` n'est pas touché.

#### 1.e — Quatre valeurs CSS, deux règles mortes retirées (`src/css/style.css`)

| Où | Avant | Après | Pourquoi |
|---|---|---|---|
| `#global-actions` (`:764`) | `margin: 8px 8px 0;` | `margin: 0;` | le haut ne porte plus de boutons |
| `#global-actions` (`:777`) | `padding: 0 8px 8px;` | `padding: 0;` | idem |
| `.remote-badge` (`:7244`) | `margin: 0 0 0 auto;` | `margin: 8px 8px 8px auto;` | l'air du badge vient de lui, plus du conteneur (44 px, comme aujourd'hui, §3.4) |
| `#project-footer` (`:795`) | `max-height: 50%;` | `max-height: 60%;` | 278 px doivent tenir dans 300 px |

Conserver dans `#global-actions` : `flex-shrink: 0`, `display: flex`, `flex-wrap: wrap`,
`align-items: center`, `gap: 6px` (le verrou `retrait-ecran-aide.test.js:63-69` l'exige,
et le badge s'en sert).

**Supprimer** deux règles devenues mortes :
- `src/css/style.css:1712-1721` — `#global-actions button { width:auto; height:28px; … }`
  et son commentaire `:1708-1711` (plus aucun bouton dans ce conteneur) ;
- `src/css/style.css:1697-1706` — `.pj-panel button.pj-row-main { … }` et
  `.pj-panel button.pj-row-main .icon { … }` avec leur commentaire (plus aucune ligne
  mise en évidence dans le bloc).

**Conserver** `.ga-label` (`:1723-1727`) : les deux lignes déplacées s'en servent.

#### 1.f — Les commentaires disent la nouvelle vérité (même mission)

`index.html:62-80` (le haut ne contient plus aucune porte, seul le badge reste) ;
le commentaire du menu dans `index.html` (NEUF → DIX entrées, `btn-terminal-cmd` en
tête) ; `index.html:118-119` (le panneau a SEPT lignes) ; `src/css/style.css:765-777`
(« il ne reste que DEUX portes nommées » `:772-773` → plus aucun bouton) ;
`src/css/style.css:786-790` et `:791-794` (SIX lignes / 240 px / 50 % → SEPT lignes /
278 px / 60 %) ; `src/js/sidebar.js:1680-1684` (six → sept lignes).

#### 1.g — Les verrous de tests (même mission, sinon `npm test` rougit)

| Fichier:ligne | Ce qu'il faut écrire |
|---|---|
| `src/js/lot2-colonne-haut.test.js:202-207` | « le haut ne contient plus **aucun** bouton » (`toHaveLength(0)`) |
| `src/js/lot2-colonne-haut.test.js:219-224` | supprimer l'attente de la règle `#global-actions button` (elle n'existe plus) ; garder la vérification que `.pj-panel button` porte `height: 32px` et `font-size: var(--font-sm)` (elle reste vraie et devient la règle des deux entrées déplacées) |
| `src/js/retrait-ecran-aide.test.js:52-61` | « le haut de la colonne ne garde **aucun** bouton » (`toHaveLength(0)`) ; retirer les deux attentes `toContain("Brouillon")` et `toContain("Options")` — ces deux noms sont désormais vérifiés dans le bloc du bas |
| `src/js/retrait-ecran-aide.test.js:63-69` | **rien** : reste vert |
| `src/js/lot3-colonne-bas.test.js:107-115` | `LIGNES` = **7** identifiants, dans cet ordre : `btn-scratchpad`, `btn-settings`, `btn-superagent`, `btn-explorer`, `btn-terminal`, `btn-commands`, `btn-more-screens` |
| `src/js/lot3-colonne-bas.test.js:117-128` | `MENU` = **10** identifiants, `btn-terminal-cmd` **en tête** |
| `src/js/lot3-colonne-bas.test.js:162-170` | `.pj-more-item` = **10** (titre du test : « les dix entrees ») |
| `src/js/lot3-colonne-bas.test.js:200-217` | « le panneau contient **SEPT** lignes, dans l'ordre fige » |
| `src/js/lot3-colonne-bas.test.js:229-246` | hauteur = **278 px** (`2 + pad×2 + 7×32 + 6×gap`), `max-height: 60%`, `278 < 300` |
| `src/js/lot3-colonne-bas.test.js:247-260` | remplacer « Lancer l'agent est la ligne mise en évidence » par : la ligne est désormais dans le menu (`.pj-more-item`), **aucune** ligne du bloc ne porte `pj-row-main`, les 7 lignes sont à `12 px` |
| `src/js/lot3-colonne-bas.test.js:218-227` | **rien** : le bloc de test va jusqu'à `</aside>`, donc `>Lancer l'agent</span>` y reste présent (dans le menu) — vérifié |
| `src/js/lot3-colonne-bas.test.js:313-343` | retirer `.pj-panel button.pj-row-main` et `.pj-panel button.pj-row-main .icon` de la liste des sélecteurs sans couleur en dur (ces règles n'existent plus) |
| `src/js/lot3-colonne-bas.test.js:1-40` | en-tête : SEPT lignes, DIX entrées, 278 px / 60 %, demande du propriétaire citée |
| `src/js/libelle-options-ecran.test.js` | **rien** : la classe `.ga-label` est conservée |

Aucun test n'est supprimé : chacun est réécrit pour décrire la cible, et le nombre total
de tests ne baisse pas.

**Résultat visible attendu**
- La colonne commence par le bandeau du nom de projet (48 px) puis la liste des fichiers,
  **44 px plus haut** qu'aujourd'hui ; aucune place vide n'est réservée.
- Le bloc du bas s'ouvre sur « Brouillon » puis « Options », suivi d'« Assistant »,
  « Dossier du projet », « Terminal », « Commandes du projet », « Autres écrans ▾ ».
- « Lancer l'agent » est la première ligne du menu « Autres écrans » (groupe « Mon
  projet »), au contact du déclencheur ; le menu se referme après le clic.
- Les 7 lignes tiennent entières dans le cadre, y compris fenêtre réduite à 500 px de
  haut ; le menu continue de s'ouvrir vers le haut sans être rogné.
- Sans projet ouvert : le cadre affiche 2 lignes (« Brouillon », « Options »).

**Vérification** : `npm test` → tous les tests passent ; puis contrôle visuel (lot 3).

---

### Lot 2 — L'aide intégrée et les spécifications

Livrable seul, indépendant (aucun fichier de code).

1. `help/overview.md`, bloc `<!-- HELP:overview -->` (autour de la ligne 27) : le
   « Panneau d'actions » décrit **sept** lignes dans l'ordre ci-dessus et **dix** entrées
   de menu, « Lancer l'agent » en tête du groupe « Mon projet » ; préciser que le haut de
   la colonne ne porte plus aucun bouton et que le bloc s'affiche même sans projet
   (deux lignes).
2. `spec_pilot.md` (§ C) : mêmes valeurs (7 lignes, 278 px, plafond 60 %, menu à
   10 entrées) ; bloc `<!-- HELP:commands -->` si le lancement de l'agent y est cité.
3. `spec_help.md:298-299` : la phrase « Le haut de la colonne de gauche ne garde que
   **deux portes** » devient **fausse** → écrire que ces deux portes sont désormais les
   deux premières lignes du bloc du bas.
4. `README.md` : vérifier si la barre latérale y est décrite ; mettre à jour si oui.
5. `npm run build:handbook` (ne **jamais** éditer `help/handbook.md` à la main).

**Vérification** : `npm run build:handbook` puis `npm test` (le verrou
`libelle-options-ecran.test.js` relit l'aide : il doit rester vert).

---

### Lot 3 — Recette visuelle (facultatif, après le lot 1)

Aucune modification de fichier. À contrôler dans `npm run tauri dev` :

| # | À vérifier | Attendu |
|---|---|---|
| 1 | Haut de la colonne | plus aucune pastille ; la liste des fichiers commence sous le bandeau du nom de projet |
| 2 | Bloc du bas | 7 lignes, aucune plus grosse que les autres, « Brouillon » en premier |
| 3 | Menu « Autres écrans » | 10 entrées, « Lancer l'agent » en première ligne, menu ouvert vers le haut, refermé au clic |
| 4 | Clic « Lancer l'agent » | ouvre la conversation de l'agent (ou le terminal), comme avant |
| 5 | Fenêtre réduite à 500 px de haut | aucune ligne hors du cadre |
| 6 | Sans projet ouvert | cadre visible en bas, 2 lignes |
| 7 | Badge « Distant » | si un client distant est connecté : badge à sa place, 44 px, rien d'autre ne bouge |
| 8 | Thème clair | mêmes contrastes, aucune couleur en dur |
| 9 | Mode Zen | le bloc et le badge restent masqués, comme avant |

---

## 5. Questions fermées au propriétaire (3 au maximum)

**Q1 — Le plafond du bloc du bas passe de 50 % à 60 % de la hauteur de fenêtre. Vous
confirmez ?**
Il le faut pour que la 7ᵉ ligne tienne dans le cadre à la fenêtre minimale (278 px contre
250 px autorisés aujourd'hui). Sans cela, « Autres écrans » serait dessiné hors du cadre,
par-dessus la liste des fichiers. Réduire l'espace entre les lignes ne suffit pas (14 px gagnés au mieux : 264 px > 250 px). *Réponse A : oui, 60 %. Réponse B : non, garder 50 % et
accepter la ligne hors cadre à petite fenêtre.*

**Q2 — « Lancer l'agent » est la première ligne du groupe « Mon projet » du menu. Vous
confirmez, ou vous le voulez dans son propre groupe « Agent » tout en haut ?**
Avec « Mon projet », le menu garde ses 5 groupes et « Lancer l'agent » est la première
ligne du menu. Autrement, le menu passe à 6 groupes, « Lancer l'agent » reste la première
ligne, mais un titre de rubrique s'intercale entre lui et « Prompt Builder ».

**Q3 — Quand aucun projet n'est ouvert, le bloc du bas reste-t-il visible avec seulement
« Brouillon » et « Options » ?**
*Réponse A (proposée et appliquée par le lot 1) : oui, le cadre reste en bas avec deux
lignes — rien ne disparaît. Réponse B : non, le bloc n'apparaît qu'avec un projet ; les
deux commandes restent alors joignables par `Ctrl+Shift+N` et par la palette de
commandes, mais plus par un bouton à l'écran.*

---

## VERDICT

**Prêt à appliquer sans interprétation**
- L'emplacement des deux entrées (1ʳᵉ = « Brouillon », 2ᵉ = « Options »), leurs
  libellés, leurs infobulles, leurs icônes et leurs identifiants : §2.2.
- Les 44 px rendus au haut de la colonne, la façon de les rendre (conteneur aplati,
  marges portées par le badge) et le fait qu'aucune place vide ne soit réservée : §2.1,
  §3.4.
- La position de « Lancer l'agent » : première ligne du groupe « Mon projet », style de
  menu commun, 2 clics assumés : §2.3.
- Les trois lots, avec valeurs exactes, fichiers et lignes : §4 (le lot 1 est insécable — la raison est démontrée en tête du §4).
- Ce qui ne se perd pas (raccourcis, palette, badge, 9 autres écrans) : §3.6.

**Reste à décider (3 questions fermées, §5)**
- Le plafond 50 % → 60 % (nécessité arithmétique, mais c'est une valeur que vous aviez
  fixée).
- Groupe « Mon projet » ou nouveau groupe « Agent » pour « Lancer l'agent ».
- Bloc visible ou non quand aucun projet n'est ouvert.

**Ce que je n'ai pas pu vérifier**
- **Le rendu réel à l'écran** : aucune fenêtre Pilot n'a été ouverte. Les largeurs et
  hauteurs sont calculées à partir des valeurs CSS, pas mesurées au pixel.
- **Les avances de police** (estimation d'absence d'ellipse sur « Commandes du projet »).
- **Le comportement exact du badge « Distant »** quand il s'affiche alors que le haut est
  aplati : le calcul donne 44 px, identique à aujourd'hui, mais je n'ai pas pu le voir
  affiché (il exige un client distant connecté).
- **`dist/index.html`** : artefact de build, encore sur l'ancien balisage ; régénéré par
  `npm run build`.
