# RAPPORT — LOT 4 de la présentation : bande de contexte + entrée « Travail »

Document de référence : `docs/proposition-presentation-ui.md` (§3.4, §4.5, §6 lot 4, étape 9).
Aucun autre lot touché, aucun `docs/`, ni `spec_pilot.md`, ni `README.md`.

## Ce qui change

| Fichier | Changement |
|---|---|
| `index.html` | `<div id="context-bar">` en tête de `#main-area` : fil `Projet › <projet> › <onglet>` (`#context-breadcrumb`, `#context-breadcrumb-project` cliquable, 2 séparateurs `aria-hidden`, `#context-breadcrumb-name`, `#context-breadcrumb-tab`) + `#agent-activity` DÉPLACÉ dans la bande, à droite, sous forme de bouton **nommé** `#agent-activity-entry` « Travail » qui CONTIENT `#agent-activity-dot` et `#agent-activity-badge` (identifiants et attributs conservés). |
| `src/css/style.css` | `#context-bar` 26 px, filet bas, dans le flux (aucun z-index) ; fil en 11 px (`--text-secondary`, dernier segment 600/`--text-primary`) avec ellipse sur les noms (280 px / 240 px) ; `#agent-activity` `fixed` → `relative` (plus de `top` ni de z-index 10000) ; `#agent-activity-entry` 22 px avec états survol / ouvert (`aria-expanded`) / focus ; pastille 14 → **8 px**, sans bordure ni `cursor` (contenu, plus bouton) ; badge dans le flux ; media query `max-width: 999px` en **fin de feuille** (masque le nom du projet + son séparateur). |
| `src/js/context-bar.js` (nouveau) | Modèle PUR (`projectLabelFromPath`, `tabLabelFromText`, `contextBarModel`) + branchement DOM : `initContextBar()` (1er segment = clic sur `#btn-open-project`, `MutationObserver` sur `#tab-bar`, `#open-projects-bar`, `#projects-dropdown`) et `refreshContextBar()`. |
| `src/js/agent-activity.js` | Un SEUL écouteur, sur l'entrée (`entry \|\| dot`) ; Escape rend le focus à l'entrée ; `setActivityExpanded()` publie `aria-expanded` sur l'entrée ET sur la pastille. Mémoire d'onglet et respiration inchangées. |
| `src/js/main.js` | `initContextBar()` après les onglets ; `window._pilotRefreshContextBar` exposé. |
| `src/js/context-bar.test.js` (nouveau) | 23 tests : bande, fil, entrée, dot/badge conservés, non-régression du panneau. |
| `src/js/panneau-suivi-trois-onglets.test.js` | Verrou historique réécrit (relative + empilement), intention conservée. `source-slice.test.js` : inventaire 9 → 8. |

## Mesures RÉELLES (Chromium, `getBoundingClientRect`) — avant / après

Pages de mesure hors dépôt (`%TEMP%\lot4\avant.html` / `apres.html` / `etroit.html`) chargeant la feuille du commit HEAD puis la feuille actuelle.

| Élément | AVANT | APRÈS |
|---|---|---|
| bande de fenêtre | 0 → 32 px | 0 → 32 px |
| bande de contexte | absente | **32 → 58 px (26 px)** |
| entrée « Travail » | cercle 14 px, `position: fixed`, 1628 → 1642, y 43 → 57 | bouton 22 px, y 33,5 → 55,5, x 1582 → 1646 (8 px du bord) |
| barre d'onglets | 32 → 69 px | 58 → 95 px |
| **chevauchement cercle/bouton ↔ barre d'onglets** | **14 × 14 px = 196 px² (le cercle est entièrement DANS la barre)** | **0 px² (vertical 0)** |

Fenêtre étroite (viewport 900 px, iframe réelle) : bande toujours 26 px, entrée 22 px à 8 px du bord, chevauchement 0, nom du projet et son séparateur `display: none` → fil « Projet › onglet ».
Nom long (81 car.) : `#context-breadcrumb-name` `clientWidth` 280 / `scrollWidth` 405 → **ellipse** ; onglet 240 / 277 → ellipse.
Contraste mesuré (après stabilisation des transitions) — sombre 7,75 / 15,42 ; **clair 5,70 / 15,46** ; tous ≥ AA.

## Preuves de comportement (page réelle `index.html` servie par Vite, clics CDP réels)

- `#agent-activity-dot` : **1** occurrence, **dans** `#agent-activity-entry` ; `#agent-activity-badge` : **1** occurrence, dans le bouton ; libellé visible « Travail ».
- Clic réel sur `#context-breadcrumb-project` → **1** clic reçu par `#btn-open-project`.
- Clic réel sur `#agent-activity-entry` → panneau ouvert, `aria-expanded="true"` sur l'entrée **et** la pastille ; clic réel sur la pastille → panneau refermé, `aria-expanded="false"` sur les deux (aucun double basculement).
- Après `initContextBar()` : nom = dernier segment du chemin, onglet = « spec_pilot.md (aperçu) » (icône retirée), mise à jour automatique par l'observateur, `aria-expanded` du 1er segment synchronisé avec `#projects-dropdown`.

## Vérifications

- `npm test` : **PASS 2881 / FAIL 0** (23 nouveaux tests).
- `git status --short` / `git log -1 --oneline` : fournis en fin de session.

## Non vérifiable ici (sans écran)

Rendu final dans la WebView2 (polices système, zoom, glisser de fenêtre) : la page réelle chargée hors Tauri s'arrête dans `initWindowControls` (`Cannot read properties of undefined (reading 'metadata')`, préexistant à ce lot) — toutes les mesures ci-dessus viennent donc de Chromium sur les feuilles réelles.
