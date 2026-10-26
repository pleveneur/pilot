# RAPPORT — boutons du mode « Assistant seul », 2e passe

**Mission** : en mode « Assistant seul », les deux boutons du coin haut droit
(le point qui ouvre la liste des agents et la roue des options ⚙) ne sont plus
dans le coin : ils flottent au milieu-droite. Le proprietaire les veut **alignes
sur le bord droit** et **en dessous** des trois boutons systeme de la fenetre.

---

## 1. Mesure de DEPART (lue sur le disque, pas a l'oeil)

### 1.1 Les deux zones en presence

| Element | Source | Mesure |
|---|---|---|
| Rangee qui porte les boutons systeme | `#tab-row`, `src/css/style.css:1854` | `min-height: 36px` + `border-bottom: 1px` — `box-sizing: border-box` **global** (`style.css:48`) : la ligne occupe **36 px de haut**, filet compris |
| Groupe des trois boutons | `#window-controls`, `style.css:93` | `3 x 46 px` de touches + `padding: 4px 4px 4px 0` → **empreinte 142 px**, air droit **4 px**, **bord droit a 4 px du bord de la fenetre** |
| Barre du mode | `.sa-immersive-top`, `style.css:10900` | `height: 58px`, `padding: 0 calc(142px + 8px) 0 18px` → **marge droite 150 px** |
| Overlay du mode | `.superagent-immersive` | `position: fixed; inset: 0` → demarre **tout en haut**, donc sa barre partage la **premiere** ligne avec les boutons systeme |

### 1.2 Le defaut, chiffre

Les deux boutons de la barre s'arretaient a **150 px** du bord droit, alors que
les boutons systeme s'arretent a **4 px** : 146 px d'ecart. La barre, elle, a
toujours demarre a `y = 0`, c'est-a-dire **sur la meme ligne** que les trois
boutons systeme : c'est la cause structurelle commune aux deux defauts
successifs (recouvrement d'abord, flottement ensuite).

---

## 2. Solution retenue (la plus simple) et pourquoi

**Une position, une marge — aucun empilement.** La barre du mode se pose sur la
**seconde ligne** (`margin-top` = hauteur mesuree de la rangee systeme) et
reprend a DROITE l'**air exact** du groupe (`--window-controls-air`).

Pourquoi cette solution plutot qu'une autre :

- **Decaler la barre (retenu)** : une seule declaration verticale
  (`margin-top`), rien d'autre ne bouge dans le mode ; les deux boutons,
  dernieres enfants de la barre, atterrissent mecaniquement sous les boutons
  systeme **et** sur le bord droit.
- **Faire descendre seulement les deux boutons** : il aurait fallu une seconde
  position (hauteur du groupe + air) sur des enfants qui sont alignes par
  `align-items: center` — donc un reglage de plus, et le risque de recreer un
  decalage propre a ces deux boutons (le motif exact des deux defauts).
- **Deplacer l'overlay (`top`)** : l'overlay aurait laisse voir la rangee
  d'onglets au-dessus de lui, alors que le mode est immersif. Le decalage sur la
  barre garde l'ecran couvert.
- **Empiler avec un `z-index`** : c'est la cause des defauts precedents —
  ecarte.

Aucun bouton, aucun reglage, aucune fonctionnalite ajoutee. Aucun `z-index`,
aucun `position`, aucun `top` sur la barre (le test le verifie).

---

## 3. Valeurs AVANT / APRES

| Valeur | Avant | Apres |
|---|---|---|
| `.sa-immersive-top` position verticale | `y = 0` (premiere ligne, sous les boutons systeme) | `y = 36 px` (`margin-top: var(--window-controls-height)`) — **seconde ligne** |
| `.sa-immersive-top` marge droite | `calc(142px + 8px)` = **150 px** | `var(--window-controls-air)` = **4 px** (identique aux boutons systeme) |
| `.sa-immersive-top` hauteur | 58 px | **58 px (inchangee)** |
| `.sa-immersive-top` air gauche | 18 px | **18 px (inchange)** |
| Bord droit des deux boutons | 150 px du bord | **4 px du bord** = bord droit des boutons systeme |
| `--window-controls-width` | 142 px (servait a reserver) | **142 px conserve** comme mesure de reference, encore verifiee par le test (plus lue par aucune marge) |
| `--window-controls-air` | — | **4 px** (nouveau jeton, mesure recalculee) |
| `--window-controls-height` | — | **36 px** (nouveau jeton, mesure recalculee) |

Mode normal, colonne de gauche (280 px), bandeau et logo, hauteurs et themes
clairs : **non touches** (aucune regle hors du bloc du mode, hors les trois
jetons de mesure ajoutes dans `:root`).

---

## 4. Fichiers touches

| Fichier | Nature |
|---|---|
| `src/css/style.css` | 3 retouches : jetons de mesure dans `:root` ; `.sa-immersive-top` (marge haute + air droit, commentaire a jour) ; commentaire du mode (le « plus aucun decalage » est remplace par la verite actuelle) |
| `src/js/barre-fenetre-assistant-seul.test.js` | test reecrit sur le nouveau contrat (meme fichier, memes aides de lecture, aucun nombre figé) |
| `RAPPORT-boutons-assistant-seul-2.md` | ce rapport |

Aucun fichier Rust, aucun plan editable, aucune documentation, aucun autre
rapport touche ou supprime.

---

## 5. Le test, et ce qu'il garde

`src/js/barre-fenetre-assistant-seul.test.js` **recalcule tout depuis le
disque**, il ne fige aucun nombre :

- largeur d'une touche systeme (`#window-controls > button`), air droit du
  groupe (`#window-controls`), nombre de touches (`index.html`) ;
- hauteur de la rangee systeme (`#tab-row` `min-height` + filet, avec
  verification prealable du `box-sizing: border-box` global — sans lui, le
  calcul serait faux en silence) ;
- resolution des `var(--jeton)` et des `calc(...)` pour comparer les
  declarations **entre elles**.

Il rougit si :

- les deux boutons repartent sur la premiere ligne (`margin-top` absent, ou
  different de la hauteur mesuree de la rangee) ;
- la marge droite ne correspond plus a celle des boutons systeme (retour des
  150 px, ou valeur divergente) ;
- un `position` / `z-index` / `top` est ajoute sur la barre (retour a un jeu de
  couches) ;
- la hauteur de la barre (58 px) ou l'air de gauche (18 px) bougent ;
- l'ordre retour / titre / point des agents / ⚙ change.

---

## 6. Resultat des tests (compte reel)

- Test cible : `npx vitest run src/js/barre-fenetre-assistant-seul.test.js` →
  **10 tests, 10 passes, 0 echec**.
- Suite complete : `npx vitest run` → **1064 fichiers de tests, 3288 tests,
  3288 passes, 0 echec** (rapport JSON de vitest, lu apres execution).
- Compilation du front : `node node_modules/vite/bin/vite.js build` →
  **`built in 13.08s`**, aucune erreur (le CSS nouveau est valide ; seuls les
  avertissements habituels de taille de bundle apparaissent).
- Aucun fichier Rust touche : la compilation Rust n'est pas concernee par cette
  retouche de style.

---

## 7. Ce que je n'ai PAS pu verifier

1. **Le rendu a l'ecran** : je n'ai pas d'affichage de Pilot sous la main
   pendant cette mission. Les valeurs sont mesurees dans le CSS et verifiees
   par le test, mais le rendu reel (bandeau de 36 px au-dessus de la barre,
   trois boutons systeme peints dessus, alignement visuel du ⚙ sous la croix de
   Fermer) reste a confirmer par le proprietaire.
2. **Le survol et le clic** dans la bande haute de l'overlay : les boutons
   systeme restent au-dessus (`z-index: 100001`, inchange) ; la bande de 36 px
   au-dessus de la barre ne contient plus aucun bouton du panneau, donc plus
   aucun clic ne peut etre capte par erreur — verifie par le calcul, pas a la
   souris.
3. **`spec_super_agent.md` (§3173)** decrit encore l'ancienne reservation de
   150 px : la documentation etait **hors perimetre** de cette mission
   (d'autres missions y travaillent). **Reste a faire** : y decrire le
   placement sur la seconde ligne et l'air droit de 4 px.

---

## 8. Reste a faire

- Confirmer le rendu a l'ecran (point 1 ci-dessus).
- Mettre `spec_super_agent.md` en accord avec le nouveau placement (hors
  perimetre de cette mission).
- Si le proprietaire veut un peu plus d'air entre les boutons systeme et la
  barre, l'ajouter **une seule fois** dans `--window-controls-height` (le test
  suit automatiquement, il recalcule).
