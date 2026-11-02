# RAPPORT — Cadre de la liste « Projets en cours »

Demande du propriétaire (2026-11-02), petite et bornée :

> « Est-il possible d'encadrer la liste des projets en cours, avec le même cadre
> que les options en bas à gauche (en dessous de la liste des fichiers) ? »

Mission : un habillage. Aucune fonctionnalité de la liste ne change (clics,
bascule de projet, fermeture ✕, survol, défilement), aucune autre couleur, taille
ou espacement de la barre latérale n'est touché.

---

## 1. Ce qui a été identifié sur le disque (preuves)

### a) Les « options en bas à gauche, sous la liste des fichiers »

- Conteneur : `#project-footer` — `index.html:152` (`<div id="project-footer" class="pj-replie">`),
  juste après `#file-tree` ; il porte les sept lignes Brouillon · Options ·
  Assistant · Dossier du projet · Terminal · Commandes · Outils
  (`src/js/sidebar-footer-fold.js` pour le repli).
- Règle qui lui donne son cadre — **avant** la modification, `src/css/style.css`
  lignes 938‑943 (dans le bloc `#project-footer {`) :

  ```css
  /* Un seul cadre pour les SEPT lignes du bas : la bordure accent, le fond
     léger et le rayon restent ici (c'est le SEUL cadre accentué de l'interface). */
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border: 1px solid var(--accent);
  border-radius: var(--radius-lg);
  ```

  et, dans le même bloc, la marge `margin: 0 8px 8px` (inset de 8 px dans la
  colonne de 280 px).
  Valeurs des jetons : `--accent` = `#6b8cff` (thème sombre) / `#0969da`,
  `#4078f2`, `#2e7de9`, `#268bd2`… selon la palette claire ; `--radius-lg` =
  `12px` (`src/css/style.css:305`).

### b) « La liste des projets en cours »

- Conteneur : `#open-projects-bar` — `index.html:98`
  (`<div id="open-projects-bar" class="hidden"></div>`), rempli par
  `src/js/sidebar.js:1325` `_renderOpenProjectsBar()`, qui y pose le titre
  `Projets en cours` (`sidebar.js:1340`) puis une ligne `.open-project-item` par
  projet ouvert (`✕` pour fermer, clic pour basculer).
- Règle **avant** — `src/css/style.css:1629` :

  ```css
  #open-projects-bar {
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
    max-height: 40%;
    overflow-y: auto;
    padding: 4px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  ```

  donc **aucun cadre** : seulement un filet gris de 1 px en bas, pleine largeur
  (280 px), angles droits, fond transparent.

### c) Interprétation retenue (ambiguïté éventuelle)

La seule liste appelée « Projets en cours » dans l'interface est la barre
`#open-projects-bar`. Elle se trouve **sous le bouton « Projets », en haut** de la
colonne, et non sous la liste des fichiers : c'est bien elle qui a été encadrée,
et le cadre pris pour modèle est celui du bloc du bas (les options), comme demandé.

---

## 2. Ce qui a changé (avant → après)

### Facturation du cadre (point clé)

Le cadre n'a **pas** été recopié : il a été **factorisé** dans **une seule** règle
partagée, `src/css/style.css:921` :

```css
#project-footer, #open-projects-bar {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border: 1px solid var(--accent);
  border-radius: var(--radius-lg);
}
```

- Les trois déclarations ont été **retirées** du bloc `#project-footer`
  (`src/css/style.css:927`), qui ne garde que sa mise en page (marge, flex,
  `justify-content: flex-end`, `transition: height`, `max-height: 60%`,
  `padding: 8px 0`) : son rendu est **identique au pixel** à l'avant.
- `#open-projects-bar` (`src/css/style.css:1648`) ne déclare **aucun** cadre : il
  hérite de la règle partagée et garde sa mise en page (flex, `gap: 4px`,
  `padding: 4px 8px 8px`, `max-height: 40%`, `overflow-y: auto`).
- Aucune couleur en dur : uniquement `var(--accent)` et `color-mix`, donc le
  cadre suit **les deux thèmes et toutes les palettes**.

### Liste « Projets en cours » : détails

| Élément | Avant | Après |
|---|---|---|
| Bordure | `border-bottom: 1px solid var(--border-subtle)` (gris, bas seul) | `1px solid var(--accent)` sur les **quatre** côtés (règle partagée) |
| Rayon | `0` (angles droits) | `var(--radius-lg)` = **12 px** |
| Fond | transparent | accent à **16 %** (`color-mix`), identique au bloc du bas |
| Retrait dans la colonne | `0` (pleine largeur, 280 px) | `margin: 8px` → **même inset de 8 px** que le bloc du bas |
| Filet de séparation bas | `border-bottom` gris | supprimé (le cadre fait le tour ; un filet en plus aurait fait un double trait dans le rayon) |
| Largeur utile d'une ligne | 264 px | 246 px (264 − 2 bordures − 16 padding) |
| Nom trop long | débordait du cadre (pas de réduction possible) | point de suspension correct : `min-width: 0` ajouté à `.open-project-name` (`style.css:1697`) |
| Défilement | `max-height: 40%` + `overflow-y: auto` | **inchangé** |
| Liste vide | `hidden` (rien à l'écran) | **inchangé** : aucun cadre vide, le bloc disparaît comme avant |
| Clics / ✕ / survol / sélection | gérés par `sidebar.js` | **inchangé** : pas une ligne de JS touchée |

### Capture textuelle de l'écran (avant → après)

```
AVANT
+----------------------------------+  <- colonne 280 px, aucun cadre
|  PROJETS EN COURS                |
|  ✓ pilot — (GDS — liaison établie)|  <- fond gris, angles droits
|    gds-server                    ✕|
|  un-nom-de-projet-extrem...     ✕|  <- déborde si trop long
|__________________________________|  <- simple filet gris de 1 px
|  (liste des fichiers...)          |
| ...                               |
|  +----------------------------+  |  <- cadre accent (12 px de rayon)
|  | Brouillon                  |  |
|  | Options                    |  |
|  +----------------------------+  |
+----------------------------------+

APRES
+----------------------------------+
|  +----------------------------+  |  <- MEME cadre accent que le bas
|  | PROJETS EN COURS           |  |     (bordure accent 1 px, rayon 12 px,
|  | ✓ pilot — (GDS — liaison…) |  |     fond accent 16 %, inset 8 px)
|  |   gds-server             ✕ |  |
|  |   un-nom-de-projet-extr… ✕ |  |  <- point de suspension, aucun débordement
|  +----------------------------+  |
|  (liste des fichiers...)          |
| ...                               |
|  +----------------------------+  |
|  | Brouillon / Options / ...  |  |  <- inchangé, au pixel
|  +----------------------------+  |
+----------------------------------+
```

---

## 3. Fichiers touchés

| Fichier | Nature de la modification |
|---|---|
| `src/css/style.css` | **+ cadre partagé** `#project-footer, #open-projects-bar` (ligne 921) ; retrait des trois déclarations de cadre du bloc `#project-footer` (927) ; `#open-projects-bar` (1648) : suppression du `border-bottom`, ajout de `margin: 8px`, commentaires ; `min-width: 0` sur `.open-project-name` (1697) |
| `src/js/cadre-liste-projets-en-cours.test.js` | **nouveau verrou** (7 tests) : le cadre commun existe, aucun des deux blocs ne le redéclare, une seule règle de cadre accentué dans la feuille, pas de `border-bottom`, aucune couleur en dur, les deux conteneurs existent toujours |
| `src/js/lot2-colonne-haut.test.js` | outil de lecture CSS `blocs()` : une règle à **plusieurs sélecteurs** (`A, B { … }`) est désormais rattachée à chacun d'eux, comme le fait le moteur CSS — **aucune assertion modifiée** |
| `src/js/lot3-colonne-bas.test.js` | idem (même outil `blocs()`) |
| `src/js/badge-distant-bas.test.js` | idem (même outil `blocs()`, qui alimente `valeur()`) |
| `src/js/repli-menus-bas.test.js` | idem (même outil `blocs()`) |
| `spec_multiprojects.md` | 4 lignes : la liste « Projets en cours » est encadrée, cadre écrit une seule fois (règle partagée), nom du verrou |

**Non touchés** : `index.html`, `src/js/sidebar.js`, `src/js/sidebar-footer-fold.js`,
toute autre règle CSS, l'écran Vocal, le branchement MCP, l'affichage des
sentinelles (aucune de ces zones n'apparaît dans le diff).

### Pourquoi les quatre fichiers de tests existants sont modifiés

Ils lisent le CSS avec un utilitaire qui ne reconnaissait qu'une règle à **un
seul** sélecteur : après factorisation, le cadre devenu « partagé » serait
invisible pour eux et ils échoueraient **à tort**. L'utilitaire a été corrigé
(lecture des listes de sélecteurs) ; **aucune assertion n'a été changée,
assouplie ni désactivée** — les sept vérifications d'origine sur le cadre du bloc
du bas (bordure, fond, rayon, `var(--accent)`, épaisseur de bordure dans le calcul
des 50 px repliés, hauteur 278 px de la colonne) sont passées **telles quelles**.

### Décision de conception à noter

La règle « un seul cadre accentué par colonne » (principe 1 de
`RAPPORT-design-colonne-entrees.md`) est **remplacée** par la demande du
propriétaire : il y a désormais **deux blocs encadrés**, et ils partagent la
**même** définition de cadre (une seule règle), donc aucune divergence possible.
Les commentaires CSS et la spec disent désormais cela explicitement.

---

## 4. Vérifications

### Tests JavaScript (Vitest)

```
npx vitest run
  PASS (5048)  FAIL (0)
```

- Avant la mission : **5041** tests verts, **272** fichiers de tests
  (`ls src/js/*.test.js scripts/*.test.js | wc -l`).
- Après la mission : **5048** tests verts, **273** fichiers = 5041 + **7**
  nouveaux tests (le nouveau verrou). Aucun test n'a été retiré ni désactivé.
- Le nouveau verrou, lancé seul : `npx vitest run src/js/cadre-liste-projets-en-cours.test.js`
  → `PASS (7) FAIL (0)`.

### Non exécuté (et pourquoi)

- **Rust** : aucune ligne Rust touchée, `cargo test` inutile ici.
- **Vérification dans un navigateur** : la passerelle Chrome de la session n'était
  pas connectée (`the Chrome extension is not polling`), donc aucune capture
  d'écran réelle n'a pu être prise. La capture du § 2 est **textuelle et déduite
  des règles CSS** (largeurs, marges, rayons recalculés à partir de
  `#sidebar { width: 280px }`, `margin: 8px`, `border: 1px`, `padding: 4px 8px`) :
  elle n'a pas été confirmée à l'œil.

### Points de débordement examinés (statiquement)

- **Largeur** : 280 − (8 + 8) marges − (1 + 1) bordures − (8 + 8) padding = **246 px**
  utiles par ligne ; `.open-project-close` fait 18 px, `.open-project-name` prend
  le reste et se coupe proprement (`min-width: 0` + `text-overflow: ellipsis`) :
  aucun débordement horizontal, donc aucune barre de défilement horizontale
  parasite (rappel : `overflow-y: auto` rend `overflow-x` non `visible`).
- **Liste longue** : `max-height: 40 %` + `overflow-y: auto` inchangés — le
  défilement se fait **dans** le cadre, qui garde sa bordure et son rayon.
- **Liste vide** : `classList.add("hidden")` dans `_renderOpenProjectsBar` →
  `display: none`, donc **aucun cadre vide** affiché (comportement d'avant
  conservé).
- **Hauteur rendue à la liste des fichiers** : +8 px de marge haute + 8 px de
  marge basse − 1 px de filet supprimé = la liste des fichiers perd 15 px de
  hauteur, qu'elle reprend par son propre `flex: 1` + `overflow-y: auto` ; le bloc
  du bas n'est pas déplacé (sa marge est inchangée, et le cadre n'ajoute qu'un
  pixel de bordure déjà compté dans son budget de 278 px).

---

## 5. Ce qui reste à faire

1. **Contrôle à l'œil** sur une machine où Chrome est joignable (ou dans l'appli) :
   ouvrir plusieurs projets, vérifier le cadre dans le thème **clair** et le thème
   **sombre**, avec 1 projet, avec 10 projets (défilement interne) et avec 0 projet
   (bloc absent). Rien ne peut le faire à ma place dans cette session.
2. Si le rendu du fond à 16 % paraît trop présent sur une palette claire, la seule
   valeur à ajuster est celle de la règle partagée `style.css:921` — un seul
   endroit, les deux blocs suivent.
