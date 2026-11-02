# Rapport — LOT 3 de la présentation : le bas de la colonne de gauche

Référence : `docs/proposition-presentation-ui.md` §3.3 et lot 3 du §6. Base : `fe3bc90`.

## Hauteur du bloc (px)

| | Calcul | Total |
|---|---|---|
| Avant | bordure 2 + padding 12 + gap 6 + rangée d'onglets ~30 + panneau (16 + 6×32 + 5×4) | **≈ 278** (plafond 40 % = 200 à 500 px de haut, avec défilement) |
| Après | bordure 2 + padding 8+8 + 4×32 + 3×6 | **164** (36 px sous le plafond, aucun défilement) |

## Les 4 lignes (toujours visibles, ordre imposé)

| Ligne | id (inchangé) | Fonction réellement appelée |
|---|---|---|
| Assistant | `btn-superagent` | `main.js:879` → `openFile(superAgentDisplayLabel(),"superagent")` |
| Terminal | `btn-terminal` | `main.js:768` → `integrated_terminal ? openFile("Terminal","terminal") : open_terminal(false)` |
| **Lancer l'agent** (13 px/600, icône accent) | `btn-terminal-cmd` | `main.js:853` → `rpc_agent_enabled ? openFile(agent,"agent") : integrated_terminal ? openFile("Agent","terminal",true) : open_terminal(true)` |
| Autres écrans ▾ | `btn-more-screens` | `sidebar.js:1647` → ouvre `#pj-more-menu` **vers le haut** ; Échap / clic extérieur / choix referment, focus rendu au déclencheur |

## Le menu « Autres écrans » (11 entrées = les 10 du document + Kanban)

| Groupe | id | Fonction réellement appelée |
|---|---|---|
| Mon projet | `btn-explorer` | `main.js:781` → `invoke("open_explorer")` |
| Mon projet | `btn-commands` | `project-commands.js:25` → `openCommandsModal(x,y)` |
| Mon projet | `btn-prompt-builder` | `main.js:868` → `openFile("Prompt Builder","prompt-builder")` |
| Comprendre | `btn-dashboard` | `main.js:814` → `openFile("Tableau de bord","dashboard")` |
| Comprendre | `btn-code-graph` | `main.js:805` → `openFile("Graphe","code-graph")` |
| Comprendre | `btn-history` | `main.js:800` → `openFile("Historique","history")` |
| Vérifier | `btn-review` | `main.js:795` → `openFile("Review","review")` |
| Collaborer | `btn-agents` | `main.js:873` → `openFile("Agents","agents")` |
| Collaborer | `btn-superkanban` | `main.js:886` → `openFile("Kanban","superagent-kanban")` |
| Collaborer | `btn-interproject` | `interproject.js:32` → modale inter-projets |
| Sources | `btn-gds` | `main.js:828` → `openFile("GDS","gds")` |

11 et non 10 : le document compte 3 lignes + 10 entrées = 13 des 14 identifiants ; le 14e (Kanban) n'a aucun autre accès : le mettre dans le menu est la seule façon de tenir « 14 identifiants conservés ».

## Preuve du retrait de l'ancien accès (après)
`index.html` : `pj-tab` = 0, `data-panel` = 0, `role="tablist"` = 0. `sidebar.js` : `_initProjectTabs` = 0 (méthode et appel supprimés). Règles CSS `.pj-tabs`/`.pj-tab` conservées mais sans portée (documenté). Cadre accent unique du bloc conservé, aucune couleur en dur.

## Tests

`npm test` : **167 fichiers / 2921 tests passés, 0 échec**. Nouveau verrou `src/js/lot3-colonne-bas.test.js` (15 tests : sous-onglets absents, 14 identifiants présents **et** câblés, 4 lignes dans l'ordre, 164 px, menu vers le haut, Échap, jetons seuls). `npm run build` : OK.

## Reste à vérifier à l'écran (aucune fenêtre ici)

1. Thèmes sombre **et** clair à 280 px : contraste du menu, en-têtes de groupe, survols, focus.
2. Menu ouvert : il monte au-dessus du cadre sans être coupé ; Échap, clic extérieur et clic sur une ligne le referment (écran bien ouvert) ; focus rendu au déclencheur.
3. Hauteur réelle mesurée ≈ 164 px (pas de recouvrement du bas de l'arborescence) ; ordre de tabulation : 4 lignes puis entrées du menu.
