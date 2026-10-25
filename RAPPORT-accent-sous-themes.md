# RAPPORT — `--accent-text` dans chaque sous-theme

## 1. Constat de depart (recompte sur le disque)

Fichier lu : `src/css/style.css` (10 957 lignes). Le jeton `--accent-text` etait
defini **2 fois** seulement : dans `.theme-dark` (ligne 337, `#7d97ff`) et dans
`.theme-light` (ligne 430, `#3b57d6`). Les sous-themes, declares en classes
`body.theme-dark.theme-*` / `body.theme-light.theme-*`, n'en definissaient aucun :
les titres de bloc des Parametres (`.settings-section-title`), les titres de
groupe de la liste de gauche (`.settings-tabs-group-title`), les rubriques du menu
« Autres ecrans » (`.pj-more-group-label`) et l'en-tete par client du Tableau de
bord (`.dash-tracking-client`) heritaient donc de la teinte generique du theme de
base, hors palette du sous-theme.

Sous-themes **recomptes un par un dans le fichier (8, et non un chiffre suppose)** :

| # | Selecteur | Ligne | Accent propre |
|---|---|---|---|
| 1 | `body.theme-dark.theme-one-dark` | 497 | `#61afef` |
| 2 | `body.theme-dark.theme-dracula` | 526 | `#bd93f9` |
| 3 | `body.theme-dark.theme-nord` | 548 | `#88c0d0` |
| 4 | `body.theme-dark.theme-tokyo-night` | 570 | `#7aa2f7` |
| 5 | `body.theme-light.theme-github` | 592 | `#0969da` |
| 6 | `body.theme-light.theme-one-light` | 614 | `#4078f2` |
| 7 | `body.theme-light.theme-solarized` | 636 | `#268bd2` |
| 8 | `body.theme-light.theme-tokyo-day` | 658 | `#2e7de9` |

Les 8 ont un accent exploitable : aucun sous-theme n'est laisse de cote.

## 2. Methode de derivation

Pour chaque sous-theme, on part de **son propre `--accent`** et on ne touche qu'a
la **clarte** (teinte et saturation conservees, comme le fait deja le theme de
base : `#6b8cff` → `#7d97ff` en sombre, `#4f6ef7` → `#3b57d6` en clair). Aucune
teinte arbitraire n'est introduite. Les sombres sont eclaircis, les clairs
assombris, jusqu'a depasser le seuil AA sur le **fond de carte reel des
Parametres**, c'est-a-dire `--bg-input` → `--surface-2` (regle
`.settings-section { background: var(--bg-input); }`).

Reference de calibrage (themes de base, non touches) : sombre `#7d97ff` = 5.94:1
sur sa carte, clair `#3b57d6` = 5.28:1 sur la sienne. Les valeurs retenues se
placent dans la meme plage, sans ecraser les libelles voisins.

## 3. Mesures obtenues (AA = 4.5:1)

| Sous-theme | accent d'origine (H/S/L) | `--accent-text` retenu | fond de carte `--surface-2` | contraste carte | `--surface-1` | `--surface-3` |
|---|---|---|---|---|---|---|
| one-dark | `#61afef` (207 / 82 % / 66 %) | `#6bb4f0` (L 68 %) | `#2c313a` | **5.85:1** | 6.90:1 | 4.72:1 |
| dracula | `#bd93f9` (265 / 89 % / 78 %) | `#c49efa` (L 80 %) | `#2f3240` | **5.83:1** | 7.23:1 | 4.92:1 |
| nord | `#88c0d0` (193 / 43 % / 67 %) | `#99c9d7` (L 72 %) | `#3b4252` | **5.60:1** | 7.79:1 | 4.80:1 |
| tokyo-night | `#7aa2f7` (221 / 89 % / 72 %) | `#7aa2f7` (accent tel quel) | `#24283b` | **5.78:1** | 7.14:1 | 4.90:1 |
| github | `#0969da` (212 / 92 % / 45 %) | `#0861c9` (L 41 %) | `#f0f3f6` | **5.29:1** | 5.89:1 | 4.84:1 |
| one-light | `#4078f2` (221 / 87 % / 60 %) | `#1053e5` (L 48 %) | `#f0f0f0` | **5.43:1** | 6.19:1 | 4.92:1 |
| solarized | `#268bd2` (205 / 69 % / 49 %) | `#1a5e8f` (L 33 %) | `#eee8d5` | **5.63:1** | 6.40:1 | 5.09:1 |
| tokyo-day | `#2e7de9` (215 / 81 % / 55 %) | `#1359b9` (L 40 %) | `#e9e9f0` | **5.50:1** | 6.65:1 | 4.60:1 |

Les 8 sous-themes depassent AA **sur leur fond de carte** (5.29:1 a 5.85:1) et
aussi sur `--surface-1` et `--surface-3`.

Etat avant, mesure (teinte heritee du theme de base, sur la carte du sous-theme) :

| Sous-theme | herite | carte | contraste avant | apres |
|---|---|---|---|---|
| one-dark | `#7d97ff` | `#2c313a` | 4.82:1 | 5.85:1 |
| dracula | `#7d97ff` | `#2f3240` | 4.69:1 | 5.83:1 |
| nord | `#7d97ff` | `#3b4252` | **3.71:1 (sous AA)** | 5.60:1 |
| tokyo-night | `#7d97ff` | `#24283b` | 5.37:1 | 5.78:1 |
| github | `#3b57d6` | `#f0f3f6` | 5.36:1 | 5.29:1 |
| one-light | `#3b57d6` | `#f0f0f0` | 5.23:1 | 5.43:1 |
| solarized | `#3b57d6` | `#eee8d5` | 4.87:1 | 5.63:1 |
| tokyo-day | `#3b57d6` | `#e9e9f0` | 4.94:1 | 5.50:1 |

Deux constats honnetes : sous les sous-themes **sombres**, la teinte heritee
n'etait pas seulement hors palette, elle tombait **sous AA sous `nord` (3.71:1)**
et restait faible sous `one-dark` (4.82:1) et `dracula` (4.69:1) ; sous les
sous-themes **clairs**, elle passait deja AA sur la carte (4.87:1 a 5.36:1) — le
manque y etait donc d'abord un manque d'**harmonie** (teinte generique au lieu de
la leur), et la valeur propre retenue ne degrade rien : github reste a 5.29:1
(au-dessus d'AA) tout en reprenant son bleu.

## 4. Points signales (non forces, non caches)

- **Fond d'onglet special ACTIF** (`.tab.tab-special.active`), dont le fond est un
  melange `color-mix(in srgb, var(--accent) 14%, var(--surface-3))` et non une
  surface pleine : le jeton y donne 3.84:1 (tokyo-night) a 4.21:1 selon le
  sous-theme, donc sous AA. C'est **exactement la situation des deux themes de
  base** (4.28:1 en sombre, 4.17:1 en clair) : ce fond teinte est un etat
  transitoire de survol/selection, et le corriger imposerait de changer la
  formule du fond des onglets — hors perimetre (aucune autre couleur ne devait
  bouger). Signalé, non force.
- **`--surface-3` en tokyo-day** (4.60:1) et **nord** (4.80:1) : juste au-dessus
  d'AA. Pour descendre plus bas il aurait fallu sortir de la teinte du
  sous-theme ; les valeurs retenues restent dans sa palette.
- Aucun sous-theme n'est depourvu d'accent : rien n'a ete invente.

## 5. Fichiers touches

- `src/css/style.css` — **seul fichier de code modifie** : ajout d'une ligne
  `--accent-text` (plus son commentaire de derivation et de mesure) dans chacun
  des 8 blocs de sous-theme. Les deux themes de base (`.theme-dark`,
  `.theme-light`) et **tous les autres jetons** sont inchanges ; aucune regle de
  mise en page, aucun balisage, aucun fichier Rust, aucune spec.
- `RAPPORT-accent-sous-themes.md` — ce rapport.

## 6. Verifications

- Baseline avant modification : `npx vitest run` → **PASS (2956) FAIL (0)**.
- Apres modification : `npx vitest run` → **PASS (2956) FAIL (0)** (aucun ecart).
- `npm run build` (vite, CSS inclus) : construction reussie, seulement les deux
  avertissements preexistants (import dynamique de `search-panel.js`, taille de
  chunk) — aucun avertissement CSS, aucune erreur.
- Contrainte de test respectee : `src/js/suivi-multi-projets-dashboard.test.js`
  lit les **deux premiers** `--accent-text` et `--surface-1` en ordre de fichier,
  qui restent ceux des themes de base (les sous-themes sont declares apres) —
  il reste vert.
- Les valeurs ajoutees sont des hex a 6 chiffres, sans `var()` ni teinte en dur
  dans les regles de style : le test « aucune teinte en dur » de
  `.dash-tracking-client` reste valide.

## 7. Reste a faire (hors perimetre de cette tache)

- Le fond des onglets speciaux actifs (point 4) : a trancher par le proprietaire
  si l'on veut porter ce compose teinte au seuil AA.
- Verification visuelle dans l'application (les 8 sous-themes, ecran Parametres)
  : a faire par le proprietaire, aucune capture automatisee ici.

VERDICT : 8 sous-themes recomptes et tous couverts, chacun avec un `--accent-text` derive de son propre accent (teinte et saturation conservees), contraste sur son fond de carte de 5.29:1 a 5.85:1 donc au-dessus du seuil AA partout ; suites de tests inchangees a 2 956 PASS / 0 FAIL ; seul ecart signale, le fond d'onglet special actif (compose teinte) qui etait deja sous AA dans les deux themes de base et n'a pas ete force.
