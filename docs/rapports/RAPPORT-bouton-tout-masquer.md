# Rapport — le bouton unique de l'écran Vocal : tout masquer sauf le portrait

> **⚠️ PÉRIMÉ SUR UN POINT — correction du 2026-10-31.** Ce rapport décrit un état du
> code qui n'est plus le code livré : le portrait n'est **pas au centre du cercle**. Sur
> décision du propriétaire, la mission « écran Vocal » du 2026-10-30 est **annulée** — le
> personnage est **en haut à droite de l'écran**, dans la colonne de droite, **au-dessus**
> de la liste, et le **disque ne porte ni image ni nom**. Fait foi :
> `spec_modes_ecran_vocal.md` § 3ter et § 4ter, et l'encadré de tête de l'**AVENANT** de
> `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`. Ce qui suit reste un
> **témoignage daté** : à lire pour l'histoire des décisions, pas pour décrire le code.



Date : 2026-10-30 · Projet : `G:\IA_PL\pilot`
Demande du propriétaire : *« tout masquer d'un geste, sauf le portrait »* —
décision 9 du 2026-10-29, section 6 de
`docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`.

---

## 1. Le manque

L'écran Vocal affichait **tout, tout le temps** : disque lumineux au centre, ligne
d'état, barre de saisie, colonne de discussion à gauche, colonne des tâches et
portrait à droite. Rien ne permettait de ne garder que le visage — or c'est le
portrait qui porte la présence, le reste est du texte qu'on ne lit pas quand on
parle.

Aucun bouton ne commandait cela, et il ne pouvait pas être ajouté n'importe où :
la bande du haut (44 px) ne portait jusqu'ici aucun bouton (l'ancien bouton
« Informations » en a été retiré), et la feuille de style verrouille deux choses
que ce lot ne devait pas rouvrir — la liste ordonnée des classes de
`buildVocalOverlay` et les **six** hôtes cliquables de l'écran (issue #381).

## 2. Ce qui est construit

**Un seul bouton, discret, dont la portée est l'écran entier.**

| Élément | Valeur |
|---|---|
| Place | enfant de `.vocal-top`, centré, après le modèle |
| Taille | **28 × 24 px** fixes, icône seule de 14 px (jamais deux tailles d'un état à l'autre) |
| État « tout visible » | icône `eye`, `aria-pressed="true"` |
| État « tout masqué » | icône `eye-off`, `aria-pressed="false"`, fond plein + `--shadow-sm` |
| Infobulle ET nom accessible | « tout est visible — cliquer pour ne garder que le portrait » / « tout est masqué — cliquer pour tout réafficher » |
| Transparence | `opacity: 0` → `visibility: hidden` **retardée de 180 ms** (fondu `--transition`), espace réservé, `pointer-events: none` |
| Présence | écran Vocal **uniquement** ; jamais `hidden`, jamais `disabled` ; rien de mémorisé |

Ce qui **n'est jamais** masqué : le portrait et sa pastille (la règle la plus sûre
est l'absence de règle), le logo (une sortie), l'entrée « Travail » (un accès) et
le bouton lui-même.

## 3. Où c'est écrit

### Source neuve — `src/js/vocal-bare.js` (module pur, 104 lignes)

Il ne touche à aucun nœud : il **dit** ce que le bouton et l'overlay doivent être.
Seule source des deux libellés, de la paire d'icônes, de la durée du fondu et du
nom de la classe d'état.

- `VOCAL_BARE_CLASS` = `"vocal-bare"`, `VOCAL_DISPLAY_TOGGLE_CLASS` = `"vocal-display-toggle"`
- `VOCAL_BARE_LABEL_VISIBLE` / `VOCAL_BARE_LABEL_HIDDEN` — mot pour mot, état puis action
- `VOCAL_BARE_ICON_VISIBLE` = `"eye"` / `VOCAL_BARE_ICON_HIDDEN` = `"eye-off"`
- `VOCAL_BARE_FADE_MS` = `180`
- `normalizeVocalBare` (tout sauf `true` = tout visible), `vocalBareLabel`,
  `vocalBareIcon`, `vocalBarePressed` (l'inverse de l'état), `vocalBareClass` (`""`
  pour retirer la classe), `vocalBareNext` (la bascule)

### `src/js/super-agent.js`

| Endroit | Ajout |
|---|---|
| imports (l. 11) | `setIcon` (en plus de `refreshIcons`) et les imports de `vocal-bare.js` |
| état (l. ~3985) | `let vocalBare = false;` — **mémoire seule**, déclaré avec les quatre états du bas (même raison : lu dès l'ouverture de l'onglet) |
| `buildVocalDisplayToggle(barre)` (l. ~5217) | crée le bouton **programmatiquement** (`createElement` + `className`), pose `title`/`aria-label`/`aria-pressed`, l'icône via `setIcon`, un **seul** `addEventListener("click")`, puis `barre.appendChild` |
| `buildVocalOverlay()` (l. ~5194) | après le modèle : `buildVocalDisplayToggle(ov.querySelector(".vocal-top"))` |
| `vocalSyncBare()` (l. ~5350) | **point d'écriture unique** : classe sur l'overlay, libellés, `aria-pressed`, icône — chacun écrit **seulement s'il change** — puis rend la main à `vocalSyncChrome()` |
| `vocalSyncChrome()` (l. ~5410) | `const visible = !vocalBare && (…)` : en état nu, **le bas ne revient plus** (ni le décompte, ni un geste) |
| `enterVocal()` (l. ~6020) | `vocalBare = normalizeVocalBare(false); vocalSyncBare();` **avant** `applyVocalPortrait`/`vocalSyncSides` |
| `exitVocal()` (l. ~6180) | le booleen repart à `false` : aucune mémorisation d'une entrée à l'autre |

Aucune minuterie, aucun écouteur, aucun `setInterval` propre à cet état, aucun
`localStorage`, aucun `invoke`, aucun `fetch`.

### `src/css/style.css`

| Bloc | Contenu |
|---|---|
| `.vocal-display-toggle` | 28 × 24 px, `border-radius: 999px`, `1px solid var(--border-subtle)`, `color-mix(in srgb, var(--bg-elevated) 70%, transparent)`, `--text-secondary`, `z-index: 1` (sous le logo, 2), `margin-inline: auto`, transitions `--transition` |
| `.pilot-vocal.vocal-bare …` (disque, micro, ligne d'état, deux colonnes) | `opacity: 0`, `visibility: hidden` **retardée de 180 ms**, `pointer-events: none` |
| `.pilot-vocal.vocal-bare .vocal-input` | la même extinction, **écrite à part** : son clic est déjà coupé par `.vocal-chrome-hidden` (dont la condition contient `!vocalBare`) et le verrou #381 n'admet qu'une seule règle `pointer-events: none` sur la saisie |
| `.pilot-vocal.vocal-bare .vocal-top` | fond et filet transparents, hauteur et place conservées |
| L'exception nommée | `.vocal-bare .vocal-top .vocal-display-toggle` : `opacity: 1`, `visibility: visible`, fond plein, `--shadow-sm` |
| Mouvement réduit | `transition: none` : l'extinction est instantanée, l'espace reste réservé |

Aucune règle de `display`, de hauteur, de marge, de padding ni de position : la
place est **conservée**, donc le disque et le portrait ne sautent pas au retour.

## 4. Deux écarts assumés par rapport au texte de la conception

1. **Pas de `pointer-events: auto` sur le bouton.** La conception le prévoyait sur
   le bouton et dans l'exception. Or la propriété `pointer-events` est **héritée**
   et `.vocal-top` est l'un des six hôtes : le bouton est donc cliquable **par
   héritage**, sans une règle de plus. Déclarer `auto` en aurait fait un
   **septième hôte** aux yeux de `vocal-aucun-calque-ne-capte-les-clics.test.js`
   (issue #381), qu'il est interdit d'assouplir. Le comportement visé est identique.
2. **Le bouton est créé en JavaScript, pas dans le modèle HTML.** L'insérer dans le
   modèle aurait ajouté une classe `vocal-…` en deuxième position dans la liste
   **ordonnée** verrouillée par `ecran-vocal-lot2.test.js` et
   `vocal-halo-128-et-etat-au-dessus-saisie.test.js`. Le modèle de la barre reste
   un `div` vide ; le bouton est ajouté juste après, comme le libellé du bouton de
   relance l'est déjà.

## 5. Vérification

Nouveau fichier de test dédié : `src/js/ecran-vocal-bouton-affichage.test.js`
(**43 tests**, découpage de source obligatoirement via `sliceSource`) —
libellés mot pour mot et uniques, `aria-pressed` vrai/faux, bascule aller-retour,
icône `eye`/`eye-off` à taille fixe, présence dans l'écran Vocal seulement, jamais
`hidden`/`disabled`, `vocal-bare` ne nomme jamais le portrait, forme du fondu
(opacité, visibilité retardée, 180 ms, jamais d'instantané), cas sans personnage,
place conservée, et les verrous #381 et « une seule règle `pointer-events: none`
sur la saisie ».

| Étape | Résultat |
|---|---|
| avant (base) | `PASS (4633)` / `FAIL (0)` |
| `npx vitest run src/js/ecran-vocal-bouton-affichage.test.js` | `PASS (43)` / `FAIL (0)` |
| `npx vitest run` (suite complète) | **`PASS (4676)` / `FAIL (0)`** |
| `node --check` sur les trois fichiers touchés | OK |

Deux tests existants sont tombés en cours de route, et c'est le **code** qui a été
corrigé, jamais le test :

- `ecran-vocal-question-utilisable.test.js` (§ « le seul `pointer-events: none` qui
  touche la saisie ») : la première version du bloc écrivait aussi
  `pointer-events: none` sur `.vocal-input`. La saisie est donc écrite à part, sans
  cette propriété (voir § 3 et § 4.1).
- `vocal-halo-128-et-etat-au-dessus-saisie.test.js` (§ ordre du balisage) : un
  commentaire de documentation recopiait `class="vocal-top"` dans la tranche lue
  par le test. Le commentaire a été reformulé, le modèle n'a pas bougé.

Aucun test existant n'a été modifié, assoupli, supprimé ni désactivé.

## 6. Ce qui n'est pas fait

- **L'avatar du visage et la colonne de gauche** : hors de ce lot (lot suivant).
- **Le bloc `<!-- HELP:… -->` du handbook** : la consigne générale demande de le
  mettre à jour pour toute évolution visible, mais la consigne de ce lot interdit
  de toucher `spec_modes_ecran_vocal.md`. La phrase d'aide est donc **à écrire**,
  à l'endroit voulu par le propriétaire — la fonctionnalité, elle, est livrée.
- **Rien n'a été publié, poussé ni tagué.** Un seul commit local.
