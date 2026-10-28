# Rapport — de l'air dans le coin haut droit (les trois boutons de fenêtre)

Lot unique : **l'air autour des trois boutons système** (`#window-controls`),
sans rien ajouter d'autre à l'écran. Option recommandée du document de
proposition, avec les deux décisions du propriétaire : **Q1 = option 1**
(air réel de 4 px en haut, à droite et en bas du groupe ; boutons à la hauteur
de la ligne des onglets) et **Q2 = (a)** (Fermer ne touche plus le bord droit).

Aucune couleur, aucune ombre, aucun dégradé, aucune bordure, aucun jeton
n'a été ajouté. Rien n'a été supprimé.

---

## 1. Valeurs recomptées sur le disque (avant modification)

| Élément | Valeur lue dans le source | Fichier |
|---|---|---|
| Hauteur de la rangée | `min-height: 36px` + `border-bottom: 1px solid var(--border-subtle)` | `src/css/style.css` (`#tab-row`) |
| Barre d'onglets | `min-height: 36px`, `padding: 4px 6px` → **ligne des onglets = 28 px** | `src/css/style.css` (`#tab-bar`) |
| Groupe des boutons | `flex: 0 0 auto`, `align-self: stretch`, `gap: 0`, `margin-right: 0`, **aucun remplissage** | `src/css/style.css` (`#window-controls`) |
| Un bouton | `width: 46px`, `height: 100%`, `padding: 0`, `border: 0` | `src/css/style.css` (`#window-controls > button`) |
| Largeur du groupe (avant) | 3 × 46 = **138 px**, collé au bord droit (Fermer sur le bord) | calculé |
| Hauteur d'un bouton (avant) | `align-self: stretch` + `height: 100%` → **36 px** (toute la rangée) | calculé |
| Anneau de focus | `outline: 2px solid var(--accent); outline-offset: -2px` | `src/css/style.css` |
| Zones de glissement | `WINDOW_DRAG_ZONE_IDS = ["project-selector", "tab-row"]`, garde-fou `WINDOW_GESTURE_BLOCKLIST` qui contient **`#window-controls`** (tout le groupe, remplissage compris) | `src/js/window-controls.js` |

**Écart avec la demande** : la demande annonçait « 28 px au lieu de 36 px » pour
la hauteur des boutons. Le disque confirme : la rangée fait 36 px et la ligne
des onglets 28 px (`36 − 4 − 4`, le `padding` vertical de `#tab-bar`). Aucun
autre écart de valeur n'a été trouvé.

---

## 2. Ce qui a été changé, exactement

### `src/css/style.css` — la seule modification de comportement

1. `#window-controls` : ajout de **`padding: 4px 4px 4px 0;`**
   (`margin-right: 0` conservé). C'est **la seule source de l'air** :
   - 4 px en haut et 4 px en bas → boîte de contenu du groupe = `36 − 8 = 28 px`,
     donc les boutons (`height: 100%`) mesurent **46 × 28 px** ;
   - 4 px à droite → **Fermer ne touche plus le bord** (Q2 a) ;
   - 0 à gauche → la place des onglets n'est pas rognée au-delà des 4 px de
     droite (l'entrée « Travail » a déjà sa marge de 6 px).
   - Largeur du groupe : `3 × 46 + 4 = 142 px` (avant : 138 px).
2. **Aucune autre règle de position** : le groupe reste le dernier enfant de
   `#tab-row`, dans le même ordre (Réduire → Agrandir → Fermer), à la même
   place (au bout à droite). `#tab-row` garde ses `36 px` + filet : la rangée
   **ne change pas de hauteur**, il n'y a **rien au-dessus d'elle** et **aucune
   marge en haut de la fenêtre** (la bande haute ne revient pas).
3. **Zones de glissement intactes** : l'air appartient au groupe, et
   `#window-controls` est dans `WINDOW_GESTURE_BLOCKLIST` — l'air **ne déplace
   pas** la fenêtre. Les deux surfaces de glissement (bandeau du nom de projet
   et vide de la rangée) sont inchangées.
4. **Zone de clic intacte** : les boutons gardent 46 × 28 px de surface utile
   (`padding: 0`, `border: 0`) — le coin reste facile à viser, rien n'est réduit.
5. **Anneau de focus** : `outline-offset: -2px` conservé, l'anneau reste inscrit
   dans la touche visible (28 px de haut), donc il n'est jamais rogné.
6. **Deux libellés devenus faux, reformulés** (aucune assertion supprimée) :
   - le commentaire de la feuille de style qui disait que les boutons
     occupaient « toute la hauteur du mobilier » → dit maintenant **la ligne des
     onglets (28 px)**, avec la raison (le remplissage du groupe) ;
   - le titre du test correspondant → **« un bouton fait 46 px de large et la
     hauteur de la LIGNE des onglets »**.
7. Commentaire du groupe réécrit : il ne dit plus « collé au bord droit, 138 px »
   mais décrit l'air, la largeur de 142 px et le fait que l'air ne déplace pas la
   fenêtre.

### `src/js/barre-fenetre-etats.test.js`

- Titre du test reformulé (voir ci-dessus) ; **`height: 100%` reste l'assertion**
  (la hauteur vient du remplissage du groupe, pas d'une valeur en dur — une
  seule source).
- **Nouveau test ajouté** (aucun test supprimé) :
  `« le groupe prend 4 px d'air en haut, à droite et en bas (coin haut droit) »`.
  Il lit le `padding` réel du groupe, en déduit `3 × largeur + air = 142 px` et
  `hauteur de rangée − 2 × air = 28 px` — **les valeurs sont recalculées depuis
  le disque**, aucune n'est recopiée en dur comme constante attendue.

### `index.html` (commentaire seulement)

Le commentaire des boutons affirmait « Fermer touche le bord droit de la
fenêtre » : faux désormais. Il décrit maintenant les 4 px d'air et les 28 px des
touches. Aucune balise, aucun identifiant, aucune classe n'a changé.

### `src/js/window-controls.js` (commentaire seulement)

`controlsHeight()` mesurait déjà `offsetHeight` du **groupe** (36 px,
remplissage compris) : le menu « Disposer » s'ouvre donc toujours sous la
rangée. Le commentaire disait « hauteur des boutons » → il dit « hauteur du
groupe ». **Aucun code exécutable modifié** (le test du menu, qui exige
`controlsHeight() + marge`, reste vert).

### Documentation

- `docs/proposition-barre-fenetre.md` §3.2 : la phrase « Fermer touche le bord
  droit de la fenêtre » est reformulée (elle renvoie à l'état réel) et un encadré
  **« État réel implémenté »** ajoute la géométrie appliquée (46 × 28 px, 4 px
  d'air en haut/à droite/en bas, Fermer à 4 px du bord, 142 px de large, rangée
  inchangée à 36 px + filet, air non déplaçant, anneau de focus inscrit, verrou
  de test). Aucun paragraphe de la proposition d'origine n'a été supprimé.
- `spec_pilot.md` (boutons de fenêtre) : une phrase ajoutée sur l'air de l'angle
  haut droit et les 46 × 28 px.
- **Aide intégrée (handbook)** : aucun bloc `<!-- HELP:* -->` ne décrit la
  géométrie de ces boutons (`grep "Réduire" / "Agrandir"` dans
  `help/handbook.md` et `help/overview.md` : 0 occurrence). **Rien à régénérer**,
  donc `npm run build:handbook` n'a pas été lancé (il aurait seulement changé la
  date de génération de `help/handbook.md`, un diff parasite).
- `README.md` : non modifié — il ne décrit aucune géométrie (ni hauteur, ni
  bord), seulement « groupe fixe en haut à droite, au bout de la rangée
  d'onglets », ce qui reste exact.

---

## 3. Écarts avec la proposition écrite, et pourquoi

| Point | Proposition / demande | Application | Raison |
|---|---|---|---|
| Porteur de l'air | « 4 px en haut, à droite et en bas **du groupe** » | remplissage du groupe (`padding`) | une seule source ; retirer l'air fait immédiatement échouer le verrou |
| Hauteur des boutons | 28 px | `height: 100%` + remplissage 4/4 → 28 px | évite une seconde valeur en dur à maintenir en double |
| Largeur du groupe | 138 px (ancienne géométrie) | **142 px** | +4 px d'air à droite ; documenté dans le CSS et dans la doc de proposition |
| Air à gauche | non demandé | 0 px | ne pas rogner la place des onglets inutilement (l'entrée « Travail » a déjà 6 px de marge) |
| Document de proposition | décrivait 46 × 32 px et Fermer sur le bord (option a, bande de 32 px) | encadré « État réel implémenté » ajouté, phrase corrigée | ne rien supprimer, mais ne plus laisser une géométrie fausse |

Aucun autre écart : la rangée n'a pas bougé, les boutons sont au même endroit,
dans le même ordre, avec la même largeur de clic.

---

## 4. Vérifications

### Tests (`npx vitest run`)

| Moment | Résultat |
|---|---|
| **Avant** toute modification | `PASS (2971) FAIL (0)` — exit 0 |
| **Après** les modifications | `PASS (2972) FAIL (0)` — exit 0 |

(+1 test : le verrou de l'air. Aucun test supprimé, aucun test ignoré.)

Fichiers ciblés relancés seuls (`barre-fenetre-etats`, `barre-fenetre-disposer`,
`panneau-suivi-trois-onglets`) : `PASS (83) FAIL (0)`.

### Preuve que le test échoue si l'air est retiré

Mutation temporaire de `padding: 4px 4px 4px 0;` → `padding: 0;`, puis
`npx vitest run src/js/barre-fenetre-etats.test.js` :

```
Test Files  1 failed (1)
     Tests  1 failed | 22 passed (23)
```

Le fichier a été restauré à l'identique (empreinte md5 vérifiée avant/après :
`99b7590a6fd5b45cdeb9618981f8dd90`). Le même test échoue aussi si un bouton
retouche le bord : `padding: 4px 0 4px 0` donne `droite = "0"` ≠ `"4px"`.

### Compilation front (`npm run build`)

`✓ 4128 modules transformed. ✓ built in 13.14s` — code de sortie 0 (les
avertissements « chunk > 500 kB » et imports dynamiques sont antérieurs à ce
lot).

### Tests Rust

Non lancés : **aucun fichier Rust touché** (changement CSS/HTML/JS/doc
seulement). `cargo test --workspace` reste donc inchangé.

---

## 5. Ce que je n'ai PAS pu vérifier

- **Le rendu à l'écran** : aucune exécution de `npm run tauri dev`, donc l'air de
  4 px, l'alignement des touches sur la ligne des onglets, l'anneau de focus et
  le survol (fond `--surface-3` qui s'arrête bien à 4 px du bord) ne sont
  vérifiés que par le calcul et par le source, pas par l'œil.
- **Fenêtre agrandie / plein écran / mode immersif / mode Zen** : non observés.
- **Glisser et double-clic dans la rangée** : la zone de glissement est
  inchangée dans le code (`#window-controls` reste exclu par
  `WINDOW_GESTURE_BLOCKLIST`) mais le geste n'a pas été rejoué à la souris.
- **Menu « Disposer »** (clic droit sur Agrandir) : la position est dérivée de
  `offsetHeight` du groupe, non réobservée à l'écran.

---

VERDICT : air réel de 4 px en haut, à droite et en bas du groupe des trois
boutons (46 × 28 px, hauteur de la ligne des onglets), Fermer à 4 px du bord
droit, rangée inchangée à 36 px + filet, aucune couleur ni zone de glissement
touchée, 2972 tests verts (2971 avant), verrou de test prouvé par mutation —
reste à confirmer visuellement à l'écran.
