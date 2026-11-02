# Proposition — que devient la bande de contexte (26 px) ?

> Le propriétaire : *« Je ne vois pas à quoi sert la ligne "Projet" suivie du nom du
> projet en cours. […] on a l'information à gauche dans la liste des projets. »* — Il a raison.

## 1. Décision

**La bande de 26 px est supprimée entièrement** (fil « Projet › projet › onglet »
compris) **et l'entrée « Travail » déménage dans un emplacement réservé, à droite
de la rangée d'onglets** — même hauteur de rangée (36 px), **aucune hauteur
ajoutée**, **26 px rendus au contenu**.

## 2. Pourquoi (point de vue utilisateur)

- **Le nom du projet était dit deux fois** : il est déjà à gauche (`#btn-project-name`, `index.html:53`, `#open-projects-bar`, `index.html:89`).
- **Le nom de l'onglet était dit deux fois** : l'onglet actif est déjà le seul à porter un fond `--surface-3` + filet accent (`style.css:2227-2232`).
- **26 px de chrome en moins** = une ligne de code de plus visible en permanence.
- **« Travail » reste dans le même coin** (haut droite de la zone de travail), un seul clic : rien à réapprendre.

## 3. État actuel (preuves)

| Élément | Où | Preuve |
|---|---|---|
| Bande 26 px, dans le flux, au-dessus des onglets | zone de travail | `index.html:184`, `style.css:1767-1785` |
| Fil « Projet › projet › onglet » (nom du projet déjà effacé sous 999 px) | dans la bande | `index.html:185-191`, `style.css:1787-1835`, `:10968-10977` |
| Entrée Travail + panneau + fiche | dans la bande, à droite, `top: 22px` | `index.html:203-241`, `style.css:1861-1894`, `:1987`, `:2142` |
| Barre d'onglets | `min-height: 36px`, `overflow-x: auto` | `style.css:1839-1848` |
| Colonne de gauche + portes globales | **masquées en mode zen** | `style.css:3619-3621` |

Deux conséquences fermes : (1) le bouton ne peut pas aller dans la colonne de
gauche, il deviendrait inaccessible en mode zen ; (2) la barre de fenêtre est déjà
tranchée (`docs/proposition-barre-fenetre.md`).

## 4. État cible — nouvel agencement

Dans `index.html`, `#tab-bar` (ligne 243, remplie par `tabs.js`) devient le **1er
enfant** d'un conteneur neuf `#tab-row` ; `#agent-activity` (203-241) en devient le
**2e et dernier enfant** ; `#context-bar` (184-241) disparaît. Ordre final :
`#main-area` → `#tab-row` → { `#tab-bar`, `#agent-activity` } → `#main-content` (244).

| Zone | Cible | Unités |
|---|---|---|
| `#tab-row` (neuf) | `display:flex; align-items:stretch; flex:0 0 auto; min-height:36px; background:var(--bg-sidebar); border-bottom:1px solid var(--border-subtle)` | 36 px, comme aujourd'hui |
| `#tab-bar` (modifié) | perd `background` et `border-bottom` (portés par la rangée) ; gagne `flex:1 1 auto; min-width:0` ; garde `padding:4px 6px`, `gap:2px`, `min-height:36px`, `overflow-x:auto` | largeur seule |
| `#agent-activity` (modifié) | `flex:0 0 auto; align-self:stretch; display:flex; align-items:center; position:relative; margin:0 6px 0 4px` | place réservée, jamais défilée |
| `#agent-activity-entry` | **inchangé** : 22 px, pastille 8 px, badge 15 px, 11 px / 600, « Travail » | déjà juste |
| Dropdown + fiche | `top: 22px` → **`top: calc(100% + 1px)`** | 32 + 36 = 68 px du haut |

**Place libérée :** les 26 px sont **rendus à `#main-content`** ; rien n'est
réattribué à du chrome. **Le fil :** nom du projet supprimé, segment « Projet »
supprimé (il ne faisait que cliquer `#btn-open-project`, `context-bar.js:126-133`),
**nom de l'onglet supprimé aussi** (§ 2). **Perte assumée, une seule** : en Mode Zen
(colonne masquée, `style.css:3619-3621`), ce segment était le **seul** accès au menu
des projets — `F11` le rétablit en une touche. Aucune autre perte.

## 5. Ce qui doit survivre, à l'identique

`#agent-activity-entry`, `#agent-activity-dot`, `#agent-activity-badge`,
`#agent-activity-dropdown`, `#agent-activity-card`, les trois onglets du panneau,
`aria-expanded`, le clic qui bascule, `Échap`, la « respiration » (`style.css:1948`),
la mémoire d'onglet (`AGENT_PANEL_TAB_KEY`). Verrous : `panneau-suivi-trois-onglets.test.js`,
`agent-activity.test.js`, `taille-et-style-panneau.test.js`.

## 6. Suppressions propres (aucun code mort)

`src/js/context-bar.js` (154 l.), `src/js/context-bar.test.js` (296 l.),
`main.js:20-21` (import), `main.js:532-538` (`initContextBar()`,
`window._pilotRefreshContextBar`), `index.html:176-192`, `style.css:1758-1837`,
`style.css:10965-10978`.

## 7. Un seul lot, dans cet ordre (jamais l'inverse)

1. `#tab-row` + déplacement de `#agent-activity` + les 3 réglages CSS (§ 4) puis `npx vitest run src/js/panneau-suivi-trois-onglets.test.js src/js/taille-et-style-panneau.test.js`.
2. Vérifier **à l'écran** : panneau sous la rangée, respiration de la pastille, badge.
3. Supprimer la bande (HTML, CSS, module, import, tests).
4. `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `npm run build`.

## 8. Pièges repérés

- **Ne pas mettre `#agent-activity` dans `#tab-bar`** : `tabs.js:3224` calcule `this.tabBar.children[domIdx]` en supposant « onglets + `.tab-add-agent` » ; un enfant de plus fausse la restauration d'ordre. D'où `#tab-row`.
- `#tab-bar` a `flex-shrink: 0` (`style.css:1845`) : sans `flex:1 1 auto; min-width:0`, l'entrée sort de la fenêtre en fenêtre étroite.
- `taille-et-style-panneau.test.js:197` : `DECALAGE_HAUT = 30` devient **68**.
- `panneau-suivi-trois-onglets.test.js:200-222` verrouille la bande : bloc **réécrit**, pas supprimé (il doit garantir « en haut, à droite, dans le flux »).
- Commentaires à corriger, sinon ils mentent : `style.css:1761`, `:1896-1900`, `:1928-1929`, `index.html:176-183`, `main.js:533-535`.
- `docs/proposition-presentation-ui.md` §3.4 / §4.5 / lot 4 : à marquer « remplacé par ce document ».

## VERDICT

Prêt à appliquer : § 4, § 5, § 6, § 7, § 8 — un seul lot, aucun accès perdu hors Mode Zen.
Reste à décider : rien. Pas pu vérifier : le rendu pixel exact dans la WebView2.
