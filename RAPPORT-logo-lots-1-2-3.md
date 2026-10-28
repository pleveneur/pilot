# Rapport — le logo Pilot devient le bouton des trois modes (lots L1, L2, L3)

Source appliquée : `CONCEPTION-logo-bouton-des-trois-modes.md` (annexes A et B),
questions Q1 = A, Q2 = A, Q3 = A.

## 1. Etat avant / apres

| Point | Avant | Apres |
|---|---|---|
| Noeud de commande | `#screen-mode-button`, dans `#tab-row`, entre « Travail » et les boutons systeme | `#mode-logo`, `<button>` autour de `#btn-project-logo`, dans `#project-selector` |
| Nombre de noeuds | 1 | 1 (jamais de copie, jamais cree par du code) |
| Affordance | fond, bord, mot, icone Lucide, pastille 6 px, infobulle | curseur main, fond + filet interne au survol, fond a l'appui, anneau clavier `--accent`, infobulle ; **ni mot, ni icone, ni pastille** (Q2 = A) |
| Taille | 88 x 28 px | 28 x 28 px (carre) |
| Place en « Detaille » | dans la rangee d'onglets | boite 13 -> 41 x 10 -> 38 ; le **dessin** ne bouge pas d'un pixel (13 -> 37 x 12 -> 36) |
| Place dans les deux pleins ecrans | dans la barre (58 px / 44 px) | hors du flux, dans l'overlay : boite 13 -> 41 x **8 -> 36** (dessin 13 -> 37 x 10 -> 34) |
| Barre du mode « Assistant seul » | titre -> MODE -> agents -> Travail -> ⚙ | titre -> agents -> Travail -> ⚙ (58 px et filet inchanges) |
| Barre du mode « Vocal » | 44 px portant le bouton | 44 px **vide** : elle garde sa hauteur, sa marge haute et son filet (bande de respiration) |
| Clic par erreur | 1 clic = 1 mode, un double-clic franchissait deux modes | **garde de 400 ms** : les deux clics d'un double-clic reflexe ne franchissent qu'**un** mode (Q3 = A) |
| Mode Zen (F11) | le bouton survivait au Zen | le logo disparait avec la colonne de gauche ; on change de mode au clavier (`Ctrl+Shift+A`) ou en quittant le Zen (Q1 = A, **rien de code en plus**) |
| Memoire du mode | cle `pilot_screen_mode` + migration | **inchangees** |
| Nom interne | `SCREEN_MODE_BUTTON_ID` | **meme nom de constante**, seule sa **valeur** change (`"mode-logo"`) |

## 2. Fichiers touches (7)

| Fichier | Ce qui a change |
|---|---|
| `index.html` | `<button type="button" id="mode-logo" data-screen-mode="detailed" title=… aria-label=…>` ajoute **autour** de l'image `#btn-project-logo` (id, `src` et CSS conserves) ; `#screen-mode-button` et son commentaire de propriete supprimes, remplaces par un commentaire de 4 lignes renvoyant au logo ; commentaire de la rangee d'onglets corrige (elle ne porte plus de commande de mode) |
| `src/js/screen-mode.js` | `SCREEN_MODE_BUTTON_ID = "mode-logo"` (nom inchange) ; `MODE_CLICK_GUARD_MS = 400`, `shouldIgnoreModeClick(now, dernier)` (pure), `dernierClicMode`, garde dans l'ecouteur de `initScreenMode` ; `renderScreenModeButton` ne pose plus que `data-screen-mode`, `title` et `aria-label` ; import `setIcon` retire (devenu inutile) ; commentaires mis a jour |
| `src/js/super-agent.js` | `enterImmersive` : `immersiveOverlay.appendChild(screenModeButton)` au lieu de `insertBefore(..., agentsHost)` (l'`agentsHost` devenu mort est retire) ; `enterVocal` : `vocalOverlay.appendChild(modeButton)` au lieu de `barre.appendChild(modeButton)` (le `querySelector(".vocal-top")` associe est retire) ; **restitutions inchangees** (memes noms de variables, memes parents + voisins memorises) ; commentaires mis a jour |
| `src/css/style.css` | bloc `#screen-mode-button` + ses 6 regles **remplaces** par le bloc `#mode-logo` de l'annexe A.1 ; regles `body.superagent-immersive-active #mode-logo` et `body.pilot-vocal-active #mode-logo` (annexe A.3) ; `body.superagent-immersive-active #screen-mode-button` et `body.pilot-vocal-active #screen-mode-button` supprimees. `grep "screen-mode-" src/css/style.css` = **0** |
| `src/js/trois-modes-ecran.test.js` | **une valeur d'identifiant** : ligne 189, `.toBe("mode-logo")` |
| `src/js/barre-fenetre-assistant-seul.test.js` | **une valeur d'identifiant** : ligne 252, `id="mode-logo"` (le compte reste 1) |
| `src/js/ecran-vocal-lot2.test.js` | **une valeur d'identifiant** : ligne 326, `id="mode-logo"` |

Les trois dernieres lignes sont les « adaptations minimales » autorisees par le
document (§5, LOT 1 : lignes 189, 252, 326-328). Aucun autre fichier de test
n'est reecrit : le reste est du LOT 4 (voir §4).

## 3. Ecarts avec le document (appliques tels quels, signales ici)

1. **Un test casse qui n'est PAS dans le tableau §4.3** : `src/js/ecran-vocal-nu.test.js:89`
   exige `barre.appendChild(modeButton)`. Le document ne le recense pas (oubli) :
   le LOT 4 doit l'ajouter a sa liste (`vocalOverlay.appendChild(modeButton)`).
2. **`const agentsHost`** dans `enterImmersive` devient du code mort apres le
   passage a `appendChild` : il est retire (aucun changement de comportement).
   Deux tests citent cette ancre (`trois-modes-ecran.test.js:211`,
   `barre-fenetre-assistant-seul.test.js:264`) ; ils sont de toute facon reecrits
   au LOT 4, comme le document le prevoit.
3. **Emplacement de l'annexe A.3** : le document ne dit pas ou poser les deux
   regles des pleins ecrans. Elles sont placees juste apres le bloc `#mode-logo`
   (une seule place, une seule lecture), et non dans les sections immensive/vocal.
   Contenu identique, mot pour mot.
4. **Commentaire de la rangee d'onglets** (`index.html`, autour de la ligne 261) :
   il decrivait encore « le bouton des trois modes d'ecran (#screen-mode-button) »
   dans la rangee. D5 ne parle que du noeud et de son commentaire de propriete ;
   laisser cette phrase aurait rendu le fichier faux. Corrigee, sans autre effet.
5. **Micro et premier geste (comportement inchange, mais a dire)** : dans l'ecran
   Vocal, le logo est desormais un enfant de l'overlay. Un clic dessus remonte
   donc a l'ecouteur `pointerdown` de l'overlay (`onVocalFirstGesture`) et peut
   demander le micro. **Ce n'etait pas different avant** : l'ancien bouton vivait
   dans `.vocal-top`, deja enfant de l'overlay. Aucune regression, aucune ligne
   ajoutee, mais le document affirme « le logo est un repere de 28 px dans
   l'angle, pas un element de la scene » : a confirmer par le proprietaire.
6. **Garde de 400 ms** : quand un clic est ignore, `dernierClicMode` **n'est pas**
   mis a jour (annexe B appliquee telle quelle). La garde ne se prolonge donc pas.

## 4. Tests qui cassent et qu'il faudra adapter (LOT 4)

`npm test` apres modification : **10 tests en echec dans 4 fichiers**
(198 fichiers / 3641 tests verts sur 202 / 3651). Aucun test n'a ete supprime ni
reecrit en profondeur. References exactes :

| Fichier:ligne | Ce que le test attend encore |
|---|---|
| `src/js/trois-modes-ecran.test.js:195` (test « le bouton est dans index.html, entre « Travail » et les boutons systeme ») | le noeud entre « Travail » et les boutons systeme, et present dans `#tab-row` : il est maintenant **dans `#project-selector`, avant `#btn-project-name`**, et `#tab-row` ne le contient plus |
| `src/js/trois-modes-ecran.test.js:211` (« le bouton n'est jamais cree par du code ») | `insertBefore(screenModeButton, agentsHost)` -> `immersiveOverlay.appendChild(screenModeButton)` ; `immersiveModeButtonHome` reste exige |
| `src/js/trois-modes-ecran.test.js:218` (« le bouton porte le libelle du mode courant… ») | ancre `id="screen-mode-button"` : devient `id="mode-logo"`, et **plus** de `.screen-mode-label` / `.screen-mode-dot` |
| `src/js/trois-modes-ecran.test.js:274` (« 28 px de haut, 88 px de large… ») | bloc CSS `#screen-mode-button` (88 px, `--font-sm`, `--text-secondary`) : devient 28 x 28, marges calculees, `cursor: pointer` |
| `src/js/trois-modes-ecran.test.js:283` (« dans le plein ecran, la largeur redevient AUTO ») | bloc `body.superagent-immersive-active #screen-mode-button` : remplace par `position:absolute; top:8px; left:13px` |
| `src/js/trois-modes-ecran.test.js:289` (« la pastille prend la teinte du mode courant ») | les deux regles `.screen-mode-dot` : supprimees avec la pastille (Q2 = A) |
| `src/js/barre-fenetre-assistant-seul.test.js:264` (« les deux boutons vises sont les DERNIERS de la barre ») | `insertBefore(screenModeButton, agentsHost)` : devient `immersiveOverlay.appendChild(...)`, **et** `barreJs` ne doit plus contenir `mode-logo` |
| `src/js/ecran-vocal-lot2.test.js:374` (« la pastille « Vocal » est celle du lot 1 ») | regle `#screen-mode-button[data-screen-mode="vocal"] .screen-mode-dot` : remplacee par `body.pilot-vocal-active #mode-logo { position:absolute; top:8px; left:13px }` |
| `src/js/ecran-vocal-lot2.test.js:411` (« le bouton des modes repasse en largeur AUTO dans la barre de 44 px ») | bloc `body.pilot-vocal-active #screen-mode-button` (`width:auto`) : supprime ; garder les assertions sur `.vocal-top` (44 px, `margin-top`) et ajouter « `.vocal-top` ne contient aucun bouton » |
| `src/js/ecran-vocal-nu.test.js:89` (« les seuls noeuds deplaces sont la barre de saisie et le bouton des modes ») | `barre.appendChild(modeButton)` : devient `vocalOverlay.appendChild(modeButton)` — **non recense par la conception (§4.3)** |

Tous les autres garde-fous passent sans changement : `badge-distant-bas.test.js:365`
(`#btn-project-logo` + `src` conserves), `lot2-colonne-haut.test.js:96-101`,
`barre-fenetre-etats.test.js:292` (`WINDOW_DRAG_ZONE_IDS` intact).

## 5. Glisser / double-clic de la fenetre — verifie

- `src/js/window-controls.js` n'est **pas** modifie : `WINDOW_DRAG_ZONE_IDS =
  ["project-selector", "tab-row"]` et `WINDOW_GESTURE_BLOCKLIST` sont intacts.
- Le logo est desormais un `<button>` : `closest("button")` de la liste des
  gestes **bloques** le prend, donc **le glisser et le double-clic
  d'agrandissement ne partent plus du logo** — c'est la consequence acceptee par
  le proprietaire (document §3, tableau « avant / apres »).
- Partout ailleurs, rien ne change : le **nom du projet** (`#project-identity`),
  le vide du bandeau et le **vide de la rangee d'onglets** restent des surfaces
  glissables et agrandissables (`isWindowGestureTarget` inchange, aucun test
  touche). Point de recette 8 de §4.1 a rejouer a la main.

## 6. Verifications lancees (resultat exact)

| Commande | Resultat |
|---|---|
| `npm test` **avant** modification | **202 fichiers, 3651 tests, tout vert** |
| `npm test` **apres** modification | **4 fichiers en echec, 10 tests en echec** (3641 verts) — liste exacte au §4 ; **aucun** autre fichier ne casse |
| `npm run build` (vite build) | **`✓ built in 12.47s`** (seuls les avertissements prealables de decoupage de chunks) |
| `node --check src/js/screen-mode.js` / `src/js/super-agent.js` | OK |
| `grep "screen-mode-" src/css/style.css` | **0** occurrence |
| `grep "screen-mode-button" src/js/super-agent.js src/css/style.css index.html` | **0** occurrence (hors commentaires historiques des tests) |

Rust : **aucun fichier Rust touche** ; `cargo test --workspace` n'a donc pas ete
lance ici (il releve du LOT 6, la recette de sortie).

## 7. Ce qui reste a faire

1. **LOT 4** — adapter les 10 assertions du §4 (dont `ecran-vocal-nu.test.js:89`,
   oublie par la conception), puis creer `src/js/logo-bouton-trois-modes.test.js`
   (§4.4 : un seul `id="mode-logo"` dans `#project-selector` avant
   `#btn-project-name`, plus aucune chaine `screen-mode-button` dans
   `super-agent.js` / `style.css`, `#btn-project-logo` conserve **dans** le
   bouton, 28 x 28 + `cursor`/`:hover`/`:focus-visible`, les deux regles des
   pleins ecrans a `top:8px; left:13px`, les 4 cas purs de
   `shouldIgnoreModeClick`, et « le logo est deplace, jamais cree »).
2. **LOT 5** — documentation et aide integree (`help/overview.md` bloc
   `<!-- HELP:modes-ecran -->` + `npm run build:handbook`, `spec_modes_ecran_vocal.md`
   §1.1 / §2 / §3.1 / §6, `spec_pilot.md`, `spec_super_agent.md`, `README.md`,
   arborescence d'`AGENTS.md`). **Rien de tout cela n'a ete touche ici.**
3. **LOT 6** — recette manuelle des 12 points de §4.1 sur l'application
   packager, plus `npm test` vert et `cargo test --workspace`.
4. Recette a ne pas oublier : double-clic rapide sur le logo = **un seul** mode
   franchi ; double-clic sur le **nom du projet** = la fenetre s'agrandit
   toujours ; `.vocal-top` visiblement **vide** en mode Vocal ; logo a la meme
   place apparente dans les trois modes.
