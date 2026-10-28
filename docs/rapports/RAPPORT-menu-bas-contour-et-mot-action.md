# RAPPORT — Menu du bas : filet bleu et mot « Action »

> Demande du propriétaire en séance d'essai (2026-10-26), confirmée et reformulée
> par lui : **le menu déployé reste exactement comme aujourd'hui**, seul le mot
> visible sur l'entrée NON déployée change, et le menu ouvert est entouré du
> même bleu que l'entrée.

## État avant / après

| Point | Avant | Après |
|---|---|---|
| Mot affiché sur la ligne non déployée | « Autres écrans » | **« Action »** (singulier, sans « s ») |
| Filet du menu ouvert (`#pj-more-menu`) | `1px solid var(--border)` (gris du thème) | `1px solid var(--accent)` (bleu du thème) |
| Contenu, ordre, groupes, identifiants du menu | 10 entrées, 5 groupes, ouverture vers le haut | **inchangés** |
| Infobulle de l'entrée | « Autres écrans — le bloc s'ouvre au survol : … » | « Action — le bloc s'ouvre au survol : … » (elle nomme toujours les six autres lignes) |
| Libellé d'accessibilité de l'entrée | aucun `aria-label` (nom = texte « Autres écrans ») | `aria-label="Action — autres écrans du projet"` |
| Titre d'accessibilité du MENU (`aria-label="Autres écrans"`) | « Autres écrans » | **inchangé** (le menu n'est pas renommé) |

## Jeton de couleur retenu

**`--accent`** — un seul jeton, aucun jeton nouveau, aucune teinte en dur.

Pourquoi celui-là : l'entrée du bas n'emploie **aucun bleu repérable** (au survol
elle prend `--surface-2`, une surface neutre). Le bleu qui met en valeur
l'entrée de la colonne est donc l'**accent** du thème, celui qui peint déjà :

- le cadre du bloc du bas — `#project-footer { border: 1px solid var(--accent) }` ;
- l'entrée **active** de la colonne — `.tree-row.selected { background:
  color-mix(in srgb, var(--accent) 18%, transparent); box-shadow: inset 2px 0 0 var(--accent) }`.

`--accent` est défini pour **chaque palette** (thème sombre + thème clair, et
leurs cinq sous-thèmes chacun) : le filet suit donc toutes les palettes, ce
qu'une valeur écrite en dur ne ferait pas. L'épaisseur reste **1 px**, comme le
cadre du bloc : rien ne se décale à l'ouverture.

`--accent-text` a été écarté : c'est le jeton de l'accent **en texte** (titres de
rubrique du menu), pas celui d'un filet.

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `index.html` | libellé `>Action</span>` + `title` commençant par « Action » + `aria-label` de l'entrée ; commentaires du bloc mis à jour ; texte d'accueil (écran « Je découvre ») : « première ligne du menu **« Action »** » |
| `src/css/style.css` | `.pj-more-menu` : `border: 1px solid var(--accent)` (+ commentaire de décision) |
| `src/js/lot3-colonne-bas.test.js` | verrou du libellé passé à « Action » (+ refus de « Autres écrans » et de « Actions ») ; **nouveau test** « le menu ouvert est entouré du MEME filet bleu que l'entrée de la colonne » ; commentaires d'en-tête ajustés |
| `src/js/repli-menus-bas.test.js` | test (l) renommé « le libelle affiche est « Action » » (+ refus de « Autres écrans »/« Actions ») ; l'infobulle doit commencer par « Action — » ; commentaires ajustés |
| `help/overview.md` | bloc `<!-- HELP:overview -->` : « Autres écrans ▾ » → « **Action ▾** », mention du filet bleu, explication « Action = la porte des autres écrans, à ne pas confondre avec Commandes du projet » |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (jamais édité à la main) |
| `RAPPORT-menu-bas-contour-et-mot-action.md` | ce rapport |

Rien d'autre n'a été modifié : ni les identifiants (`btn-more-screens`,
`pj-more-menu`, `pj-more-wrap`, `pj-more-item`, `pj-more-group-label`), ni les
classes, ni la structure du menu, ni les autres lignes de la colonne, ni l'écran
Vocal, ni le mode « Assistant seul ».

## Vérifications

1. **Tests du menu ouvert** (`npx vitest run src/js/lot3-colonne-bas.test.js`,
   `src/js/repli-menus-bas.test.js`) : verts.
2. **Mordant du nouveau test prouvé** : en remettant temporairement
   `border: 1px solid var(--border)` dans `.pj-more-menu`, le test échoue
   (« le filet du menu ne suit plus l'accent du theme ») ; le fichier a été
   restauré à l'identique ensuite (vérifié au `git diff`).
3. **`npm test` (suite complète)** : `Test Files 200 passed (200)`,
   `Tests 3612 passed (3612)` — **0 échec**.
4. **Fins de ligne** : `git ls-files --eol` reste `w/lf` sur les fichiers
   modifiés (`attr/text eol=lf`) ; `git diff --check` ne signale rien.
5. **Aide intégrée** : `npm run build:handbook` régénéré (46 blocs) ; le
   handbook contient bien « **Action ▾** » et plus aucune mention de
   « Autres écrans » côté généralités.

## Ce qui reste à faire

- **Contrôle visuel** dans l'application lancée (`npm run tauri dev`) : ouvrir le
  bloc du bas, déployer le menu, vérifier le filet bleu sur le thème sombre
  **et** le thème clair (et un sous-thème, pour confirmer que le jeton suit).
- **Documents de spécification non touchés volontairement** (hors périmètre de la
  demande, et le menu garde son nom interne) : `spec_pilot.md` § C et
  `spec_help.md` § 5 citent encore la ligne par « **Autres écrans ▾** » ;
  `docs/proposition-presentation-ui.md` et `docs/proposition-navigation.md` sont
  des documents de conception historiques. À aligner sur le mot « Action » si le
  propriétaire le souhaite.
- `dist/index.html` (artefact de build, non versionné comme source) garde
  l'ancien libellé jusqu'au prochain `npm run build`.
