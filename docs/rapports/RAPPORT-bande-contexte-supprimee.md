# Rapport — bande de contexte supprimée, « Travail » dans la rangée d'onglets

Commit local unique : `feat(ui): suppression de la bande de contexte, Travail dans la barre d'onglets`.
Aucun push, aucun tag, aucune publication.

## Ordre respecté

1. Entrée « Travail » DÉPLACÉE d'abord (rangée `#tab-row`), vérifiée à l'écran.
2. Position du panneau RECALCULÉE (mesurée, pas recopiée du document) : `top: calc(100% + 1px)`.
3. Bande de contexte SUPPRIMÉE ensuite (HTML, CSS, module, test, réglages associés).

## Hauteurs mesurées (Chrome, DOM réel extrait de `index.html` + vraie feuille CSS)

| Élément | Avant | Après |
|---|---|---|
| Bande de fenêtre | 32 px | 32 px |
| Bande de contexte | 26 px | **supprimée** |
| Barre d'onglets | 37 px (36 + 1 filet) | rangée `#tab-row` : 37 px (36 + 1 filet) |
| Total au-dessus du contenu | **63 px** | **37 px** → **+26 px rendus à `#main-content`** |
| Panneau « Travail » | `top: 22 px` (dans la bande) | `top: 69 px` = 32 + 37, soit le bas exact de la rangée |
| Fenêtre 600 px de large | — | entrée entière visible (droite 594 ≤ 600), panneau sous la rangée, aucun recouvrement |
| Mode Zen (colonne gauche masquée) | — | entrée visible et cliquable (x 530 → 594) |

## Fichiers

- `index.html` : bloc `#context-bar` (fil d'Ariane) supprimé ; `#tab-row` créé (barre d'onglets + entrée « Travail » dans son conteneur séparé).
- `src/css/style.css` : règles `#context-bar` / `#context-breadcrumb*` et `@media (max-width: 999px)` supprimées ; `#tab-row` ajoutée (36 px + filet, fond et filet portés par la rangée) ; `#tab-bar` en largeur restante (`flex: 1 1 auto`, `min-width: 0`) ; panneau et fiche recalés sous la rangée.
- `src/js/main.js` : import et appels `initContextBar` / `refreshContextBar` / `window._pilotRefreshContextBar` supprimés.
- `src/js/context-bar.js` et `src/js/context-bar.test.js` : **supprimés** (aucun code mort).
- `src/js/panneau-suivi-trois-onglets.test.js` : verrou réécrit (rangée, conteneur séparé, ordre DOM, absence de tout vestige de la bande) — 2 tests mesurant ordre/hauteur.
- `src/js/taille-et-style-panneau.test.js` : décalage vertical mesuré 30 px → **69 px** (banc borné par la fenêtre).
- `spec_pilot.md` : §1 (bande de fenêtre) et §B (rangée d'onglets, bande supprimée, 26 px rendus).

## Vérifications

- `npm test` : **2917 tests, 0 échec** (dont les 56 des deux verrous réécrits).
- `npm run build` : **OK** (`built in ~13 s`).
- `npm run build:handbook` : OK — `help/handbook.md` **inchangé** (aucun bloc `<!-- HELP:* -->` ne décrivait la bande ; le fichier est généré et non versionné).
- Aucun fichier Rust touché → pas de `cargo test` nécessaire.

## Écarts document/ disque signalés (non corrigés)

1. `docs/proposition-bande-contexte-allegee.md` annonce un décalage de 68 px ; la mesure réelle est **69 px** (36 px de contenu + 1 px de filet de la rangée). Le code et le test portent 69.
2. Le test `panneau-suivi-trois-onglets.test.js` contenait déjà des commentaires « LOT 4 » renvoyant à `docs/proposition-presentation-ui.md` (document non relu ici) : remplacés par la référence à la décision de suppression.
3. Le bloc `#agent-activity` de `index.html` garde son indentation d'origine (6 espaces) alors qu'il est désormais enfant de `#tab-row` (4) : HTML valide, écart purement cosmétique.
