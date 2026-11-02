# Rapport — Lot 1 de la présentation (socle visuel)

## Avant / après
- Avant : un seul jeton d'accent (`--accent`) → texte blanc sur accent dans les fenêtres (3,08:1 sombre / 4,28:1 clair) ; une seule règle `:focus-visible` dans 10 000 lignes de CSS ; `--text-muted` sur du texte à 145 endroits ; `var(--text, #d4d4d4)` dans la palette, avec un `--text` jamais défini.
- Après : trois jetons d'accent, échelle 11/12/13/15, une règle d'états unique, un focus clavier global, plus aucun `--text-muted` sur du texte (sauf un verrou de test), plus aucune couleur figée dans la palette. Disposition inchangée.
- Fichier touché : `src/css/style.css` (seul fichier de code modifié).

## Ce qui a changé (avant → après)
- `.theme-dark` : ajout `--accent-text: #7d97ff`, `--accent-solid: var(--accent)` (#6b8cff), `--accent-fg: #0b0d12`. `.theme-light` : ajout `--accent-text: #3b57d6`, `--accent-solid: #3b57d6`, `--accent-fg: #ffffff`.
- `:root` : ajout `--font-zone: 15px` (échelle 11/12/13/15, pas encore consommé).
- `.pj-tab` et `.pj-panel button` : `font-size: 12px` → `var(--font-sm)` ; `.settings-tab` : `13px` → `var(--font-base)` (valeurs identiques, 0 pixel).
- `.tab.tab-special` (3 couleurs) : `var(--accent)` → `var(--accent-text)` (clair : 3,92:1 → 5,47:1).
- `.modal-actions button:first-child` : `var(--accent)` + `#fff` → `var(--accent-solid)` + `var(--accent-fg)`. Idem `.anomaly-btn-primary` (bouton primaire d'une fenêtre).
- `#global-actions button:active, .pj-panel button:active` : `0.94` → `0.97`.
- Fin de fichier : bloc « LOT 1 — règle d'états unique » (appui partagé des onglets, désactivé `.45` + `not-allowed`, `:focus-visible` global sur boutons, `[role=tab]`, liens, champs, `summary`).
- Palette et fichiers récents : 4 × `var(--text, #d4d4d4)` → `var(--text-primary)` ; 145 × `color: var(--text-muted…)` → `color: var(--text-secondary)`.

## Volontairement laissé
- `.agent-activity-item-project` garde `--text-muted` : verrou de `taille-et-style-panneau.test.js:468` et `fond-liste-agents-translucide.test.js:275`.
- `14→16 px` (icônes), `22→15 px` (nom du projet), `9→11 px` (badge), `10→11 px` (libellés de section) : changements de rendu, donc lots 2 et 3.
- Survols de `.pj-tab`, `.settings-tab`, `.sa-events-tab` laissés en `--surface-3` / `--bg-hover` (voir « contestable » 2).
- `.agent-read-btn:focus-visible` conservé (doublon du focus global, rien n'est supprimé).
- 21 autres blocs « texte blanc sur accent » (palette, fichiers récents, scratchpad, feedback, `pb-btn-*`, `pc-btn-primary`, `conflict-btn-primary`, `search-replace-all`, `help-send`, `review-launch`, `interproject-link-btn`, `codegraph-focus`, `provider-badge`, lignes `.active`) : hors lot 1.

## Contestable
1. Les 145 remplacements de `--text-muted` éclaircissent d'un coup tous les libellés secondaires : le document l'inscrit au lot 1, mais l'effet visible dépasse sa phrase « la disposition ne bouge pas d'un pixel ». Revert possible.
2. La table d'états impose `--surface-2` au survol ; tel quel, le survol d'un élément posé sur le fond de l'application deviendrait invisible en clair (#f0f1f4 sur #f4f5f7). Je ne l'ai pas réécrit.
3. `--accent-solid` suit `--accent` en sombre (sous-thèmes compris) mais est figé en clair : un sous-thème clair qui changerait `--accent` ne suivrait pas.
4. Le document annonce 5,30:1 pour `--accent-text` sombre sur `--surface-2` ; je mesure 5,94:1 (#7d97ff sur #1e2128). Écart de calcul, non bloquant.

## Vérifications
1. `npm test` : **162/162 fichiers, 2815/2815 tests, 0 échec** (19,6 s).
2. Verts : `contraste-evenements-sombre`, `taille-et-style-panneau`, `panneau-suivi-trois-onglets`, `fond-liste-agents-translucide`, `agents-editor-layout`, `gds-admin-style`, `project-queue-wiring`.
3. Bouton primaire des fenêtres (WCAG 2.1) — sombre **3,08 → 6,31** (#fff/#6b8cff → #0b0d12/#6b8cff) ; clair **4,28 → 5,97** (#fff/#4f6ef7 → #fff/#3b57d6). `npm run build` : OK (avertissements préexistants).
4. `git status --short` : `M src/css/style.css` (commité), rien d'autre modifié ; rapport et 9 fichiers non suivis préexistants, **rapport non committé**.
5. `git log -1 --oneline` : `c277f93 feat(ui): lot 1 de la présentation — socle visuel`.

## Reste à faire
- Lots 2 à 7 ; consommer `--font-zone` au lot 2 ; arbitrer les 21 boutons blancs sur accent ; décider du `--text-muted` verrouillé (exige de changer 2 tests).
