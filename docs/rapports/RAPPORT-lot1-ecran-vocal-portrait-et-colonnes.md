# RAPPORT — LOT 1 de l'écran Vocal : portrait et colonnes

Conception appliquée : `docs/conceptions/CONCEPTION-ecran-vocal-portrait-et-colonnes.md`
(lots 1 seulement ; lots 2 et 3 et l'avenant du bouton de masquage **non** appliqués).

## Fichiers touchés

| Fichier | Ce qui a changé |
|---|---|
| `src/js/vocal-sides.js` (**nouveau, pur**) | Les onze constantes du document et `planVocalSides({width,height,orbSize,hasPortrait})` → `{track, shown, columnHeight, listHeight}`. Aucun import, aucun DOM, aucune écriture. |
| `src/js/super-agent.js` | `buildVocalOverlay()` : deux `<aside class="vocal-side">` (discussion à gauche, tâches à droite), `<div class="vocal-side-body">` **avant** `<img class="vocal-portrait" alt="" hidden>` puis `<span class="vocal-portrait-name" hidden>`, entre `.vocal-mic-fix` et `.vocal-status`. Nouveaux `applyVocalPortrait()`, `vocalOrbSizePx()`, `vocalSyncSides()`. `applyAssistantPersonaUi()` appelle `applyVocalPortrait()` juste après `applyVocalRestartLabel()`. `enterVocal()` : `applyVocalPortrait()` puis `applyVocalState()` puis `vocalSyncSides()` puis l'écouteur `resize` en dernière position. `exitVocal()` : `removeEventListener` du **même** nom, dans le `try` du démontage. |
| `src/css/style.css` | Jeton dérivé `--vocal-orb-box: calc(var(--vocal-orb-size) + 2 * var(--vocal-crown))` et `--vocal-side: 0px`. `.vocal-stage` en grille (trois pistes, `grid-template-rows: 1fr auto`, `gap: 32px` **conservé**, `column-gap: 24px`, `padding: 0 16px`). `.vocal-stage > .vocal-orb` / `> .vocal-mic-fix` (`grid-area`), `.vocal-stage.vocal-sides-off` et ses deux repos de `grid-column`. Nouvelles `.vocal-side`, `.vocal-side[hidden]`, `.vocal-side-discussion`, `.vocal-side-tasks`, `.vocal-side-body`, `.vocal-portrait`, `.vocal-portrait-name`, avec les valeurs du document. |
| `src/js/vocal-sides.test.js` (**nouveau**) | T10. |
| `src/js/ecran-vocal-portrait.test.js` (**nouveau**) | T9, T16, T17. |
| `src/js/ecran-vocal-lot2.test.js` | Liste ordonnée des classes (+5 entrées) et compte de `</div>` de la scène. |
| `src/js/vocal-halo-128-et-etat-au-dessus-saisie.test.js` | Les mêmes deux relevés. |
| `src/js/vocal-halo-parole.test.js` | Compte de `</div>` de la scène. |
| `src/js/ecran-vocal-bouton-relance.test.js` | Liste ordonnée des classes (le document ne prévoyait que « ne change pas d'une ligne » ; la liste ordonnée de § 2.1 traverse aussi ce fichier). |

## Assertions ajoutées

- **T9** — 4 tests : le portrait est dans `.vocal-side-tasks`, **après** `.vocal-side-body`, jamais dans `.vocal-orb` ; le CSS pose `72px` et `border-radius: 50%` ; la source est `getAssistantPortrait()` **sans repli** (`/logo_pilot_vector.svg` n'apparaît nulle part dans la fonction) ; `src` n'est réécrit que s'il change ; le nom vient de `superAgentDisplayLabel()` sur le texte (`title` + `aria-label`), la pastille suit le portrait ; `applyAssistantPersonaUi()` appelle `applyVocalPortrait()` ; aucune lecture disque ni `invoke` ; application à l'entrée **avant** `applyVocalState()`.
- **T16** — 2 tests : ni `invoke`, ni `localStorage`/`sessionStorage`/`fetch`/`indexedDB` dans le lot ; `vocal-sides.js` n'a **aucun** `import` ; deux écritures seulement dans `vocalSyncSides` (`--vocal-side`, classe `vocal-sides-off`), écouteur retiré à la sortie.
- **T17** — 3 tests : `.vocal-side` porte `pointer-events: none` et ne contient aucun `<button>`, `<a>` ni `tabindex` ; la règle « ce qui reste cliquable » énumère **exactement six** hôtes, avec `pointer-events: auto` ; `onVocalKeydown` gère toujours Échap avant `.modal:not(.hidden)`.
- **T10** — 9 tests : les onze constantes conformes au document ; les **onze lignes** du tableau § 3.2 rejouées (fenêtre, disque, `avail`, `track`) ; le seuil de 240 dans les deux sens (640×480 → 0, 720×520 → 244 avec `H = 231` et 61 px de liste) ; la colonne écrasée à `avail` (768×576 → 249) ; pas de débordement d'`avail` sur 800→2600 px × 4 tailles de disque ; `columnHeight` indépendante de la largeur et du nombre de tâches ; fenêtre basse écorchée (640×480 → 191 px, jamais 512) ; `listHeight` = `H − 170` avec personnage / `H − 72` sans ; entrées absentes ou `NaN` → tout à zéro, `shown` faux.

Tous les découpages de source passent par `sliceSource` (aucun site non protégé ajouté, l'inventaire de `source-slice.test.js` le vérifie).

## Résultat exact des tests

```
npx vitest run        → PASS (3939) FAIL (2)
```

Les **deux** rouges sont ceux **d'avant la mission** : mesurés sur `HEAD` (fichiers `super-agent.js` et `style.css` remis à leur version committée, puis restaurés à l'identique — sommes MD5 vérifiées), ce sont exactement les mêmes, aux mêmes lignes :

1. `src/js/dictee-vocale-se-rearme.test.js:230` — « une erreur qui n'a pas de phrase n'écrit rien dans la ligne d'état » : `expected 2 to be 1` (le fichier contient déjà `.vocal-status` deux fois à `HEAD`).
2. `src/js/vocal-parler-declenche-une-demande.test.js:262` — « UN SEUL point d'application : la fin de applyVocalState » : `expected 'vocalSyncRestartButton(state); vocalS…' to be 'vocalSyncRestartButton(state);'` (causé par `vocalSyncChrome(state);`, présent à `HEAD`).

La mission annonçait six rouges préexistants ; la mesure sur l'arbre donne **deux**. Constat reporté tel quel, sans assouplir ni toucher ces deux tests. Aucune régression ajoutée.

## Écart documenté avec la conception (un seul)

Le § 2.1 annonce que le nombre de `</div>` entre `.vocal-stage` et `.vocal-status` passe de 2 à **4** (« l'objet lumineux, puis les deux `<aside>`, puis la scène »). Les deux colonnes sont des `<aside>` : elles se ferment par `</aside>` et ne peuvent pas compter dans les `</div>`. Le compte réel est **3 `</div>` + 2 `</aside>`**, soit cinq fermetures, et la scène est bien refermée **juste avant** la phrase — ce que le document veut garantir. Les trois tests concernés assertent donc 3 `</div>` **et** 2 `</aside>` (aucune colonne laissée hors de la scène).

Ajout non chiffré par le document mais nécessaire à sa propre formule : `justify-content: center` sur `.vocal-stage` (sans lui, les trois pistes se collent à gauche et le disque n'est plus au centre de l'écran, contrairement à ce que calcule § 3.1). Aucune valeur nouvelle : il n'y a pas de longueur dans cette déclaration.

## Reste à faire (hors mission)

Lots 2 (tâches, ligne d'activité, bouton d'affichage) et 3 (remplissage des colonnes), ainsi que l'avenant du bouton de masquage — **non** appliqués.
