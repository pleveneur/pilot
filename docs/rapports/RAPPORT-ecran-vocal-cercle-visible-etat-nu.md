# Rapport — le cercle reste visible dans l'état nu de l'écran Vocal

Date : 2026-11-02
Base : `5749322` (`feat(vocal): cadre arrondi des panneaux et bouton de masquage sans texte`)
Périmètre : `src/css/style.css`, `spec_modes_ecran_vocal.md`, `help/handbook.md`,
7 fichiers de tests existants réalignés, 1 verrou ajouté.

---

## 1. La demande

Quand on désactive l'affichage de l'écran Vocal (mode « nu », classe `vocal-bare`),
**le cercle ne doit pas disparaître**. L'état attendu une fois masqué, sans exception :

1. le cercle reste visible, **identique à l'état normal** (taille, place, bord,
   enveloppe, arc, respiration) ;
2. le portrait et son prénom restent visibles (acquis `a0daf4e`) ;
3. le bouton de masquage reste visible et utilisable, forme/taille/place inchangées ;
4. la zone de saisie reste affichée et utilisable (acquis `a0daf4e`) ;
5. les cadres des panneaux disparaissent, **y compris le cadre de droite** ;
6. le fond de scène de l'état masqué n'éteint **ni n'assombrit** le cercle.

Contraintes fermes respectées : forme, taille, position et apparence du cercle
inchangées ; micro, trois sorties et fonctionnement du bouton intacts ; aucun
nouveau réglage ; aucun stockage local ; aucune couleur en dur ; aucun bump de
version, aucun tag, aucun push.

## 2. La cause exacte, avec la preuve

**Le cercle s'éteignait par sa propre règle.** Avant correction, dans
`src/css/style.css` — fichier tel que livré au commit `5749322`, **ligne 12828** :

```
.pilot-vocal.vocal-bare .vocal-orb,          ← ligne 12828
.pilot-vocal.vocal-bare .vocal-mic-fix,
.pilot-vocal.vocal-bare .vocal-status,
.pilot-vocal.vocal-bare .vocal-side-discussion,
.pilot-vocal.vocal-bare .vocal-side-tasks > .vocal-tasks-title,
.pilot-vocal.vocal-bare .vocal-side-tasks > .vocal-side-body {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity var(--transition), visibility 0s linear 180ms;
}
```

Le disque était le **premier sélecteur de la liste d'effacement**, et le commentaire
juste au-dessus (lignes 12821-12827 du même fichier) l'assumait :

> « ce bouton masque les panneaux latéraux et la MISE EN SCÈNE autour du visage
> (colonnes, **disque et halo**, ceinture du haut) »
> « SANS PERSONNAGE, il ne reste que le bouton : **le disque s'éteint comme le
> reste** »

Ce n'était donc ni un ancêtre qui l'emportait, ni un calque superposé par accident :
`opacity: 0` **et** `visibility: hidden` étaient écrits sur `.vocal-orb` lui-même.
Le halo (`.vocal-halo`) et l'enveloppe (`.vocal-orb::before`) tombaient avec lui, et
le bouton « Réveiller <Nom> », qui occupe sa surface intérieure, devenait invisible
avec son hôte.

## 3. L'approche retenue — en amont, pas une exception en aval

**Retenue : corriger le périmètre.** La ligne `.pilot-vocal.vocal-bare .vocal-orb,`
est **supprimée** ; le bloc commence désormais par `.pilot-vocal.vocal-bare .vocal-mic-fix,`
(`style.css`, ligne 12963). Le nom du disque ne figure plus nulle part dans une règle
de l'état nu.

**Écartée : l'exception finale.** Elle aurait consisté à ajouter
`.pilot-vocal.vocal-bare .vocal-orb { opacity: 1; visibility: visible; }`. Trois
raisons de ne pas le faire :

- il aurait fallu **gagner deux fois** : sur la spécificité (même sélecteur ⇒ il faut
  au moins un nœud de plus, donc un sélecteur inventé pour l'occasion) **et** sur la
  transition `visibility 0s linear 180ms`, qui retarde la disparition ;
- la feuille aurait porté **deux intentions contraires** sur le même nœud, à quelques
  lignes d'écart — la prochaine lecture aurait eu à deviner laquelle gagne ;
- le comportement du cercle aurait dépendu d'un **rattrapage** au lieu de son état
  normal : toute future règle d'état nu, tout changement de transition aurait pu le
  reprendre.

En retirant le nom, **le disque garde exactement ce qu'il a dans l'état normal** :
`width/height: var(--vocal-orb-size)`, `border: 2px solid var(--vocal-state)`,
`background: radial-gradient(...)`, `border-radius: 50%`, le `pointer-events` hérité
de `.vocal-stage` (l'un des six hôtes cliquables, issue #381), l'enveloppe de parole
et l'arc. **Zéro ligne de style ajoutée pour le cercle.**

## 4. Ce que l'état nu éteint — exactement cinq sélecteurs

```
.vocal-mic-fix                                  (bouton de dépannage du micro)
.vocal-status                                   (l'unique ligne d'état)
.vocal-side-discussion                          (colonne de gauche)
.vocal-side-tasks > .vocal-tasks-title          (titre de la colonne de droite)
.vocal-side-tasks > .vocal-side-body            (contenu de la colonne de droite)
```

Plus la règle séparée qui éteint le **cadre** de la colonne de droite
(`background-color`, `border-color`, `backdrop-filter`), sans toucher `opacity`,
`visibility` ni une dimension : la colonne garde sa place et sa hauteur.

**Ne sont nommés par aucune règle de l'état nu** : `.vocal-orb`, `.vocal-halo`,
`.vocal-stage`, `.vocal-portrait`, `.vocal-portrait-name`, `.vocal-input` — et
l'overlay lui-même (`.pilot-vocal.vocal-bare` seul, ou l'un de ses `::before` /
`::after`) n'est jamais nommé non plus. Seule exception nominale :
`.pilot-vocal.vocal-bare .vocal-top .vocal-display-toggle`, qui **rallume** le bouton
(le masquage ne peut pas cacher son propre rappel), sans aucune dimension, position
ni apparence — c'est pourquoi il ne bouge pas.

## 5. Le fond de scène ne peut ni l'éteindre ni l'assombrir

Le fond de l'état nu n'est pas un nœud : ce sont deux lavis radiaux posés en
`background-image` sur `.pilot-vocal` (`--vocal-wash`), avec le fond d'application en
`background`. Un `background` de parent est **peint derrière ses enfants** : le disque
passe par-dessus, sa teinte ne peut pas en être changée.

Le rayon des lavis est borné par `--vocal-wash-w` :

```
--vocal-wash-w: calc(50vw - var(--vocal-orb-box) / 2 - 24px);   (style.css, l. 11764)
```

Il **retranche la demi-boîte du disque et son jour (24 px)** : le lavis s'arrête avant
le cercle. Et aucun voile n'est posé devant lui : aucune règle de l'état nu ne vise
`.pilot-vocal.vocal-bare` seul, ni ses pseudo-éléments (`position: absolute; inset: 0`
passerait *devant* tous les enfants et ternirait le disque), ni un `filter`, ni une
`opacity`, ni un `display` sur l'overlay.

## 6. Ce qui est verrouillé, et par quel test

### 6.1 Verrou dédié — `src/js/ecran-vocal-le-cercle-reste-visible.test.js` (12 tests)

Le fichier lit la **source** (commentaires neutralisés par `neutraliserSource`, lecture
normalisée en LF — quality-gate § 3.4), en extrait les règles par un parseur minimal,
et isole celles qui portent la classe `vocal-bare` comme **mot de classe**.

| # | Ce qu'il interdit |
|---|---|
| 1 | la liste d'effacement vaut **exactement** les cinq sélecteurs du § 4 — et ne contient ni `.vocal-orb`, ni `.vocal-portrait`, ni `.vocal-input` |
| 2 | **aucune** règle de l'état nu ne nomme `.vocal-orb`, `.vocal-halo` ou `.vocal-stage` (l'hôte du clic) |
| 3 | aucun jeton du disque n'est redéfini par l'état nu (`--vocal-orb-size`, `--vocal-state`, `--vocal-crown`) |
| 4 | la règle de base `.vocal-orb` est intacte : `var(--vocal-orb-size)` en largeur **et** hauteur, `border: 2px solid var(--vocal-state…)`, `border-radius: 50%`, `radial-gradient(` |
| 5 | le fond vit sur le calque **parent** (`background: var(--bg-app)`, `background-image`, `--vocal-wash-w`, `var(--vocal-wash)`) |
| 6 | `--vocal-wash-w` retranche `var(--vocal-orb-box)` et son jour : le lavis s'arrête avant la boîte du disque |
| 7 | aucun voile/filtre/opacité sur l'overlay nu ni ses pseudo-éléments |
| 8 | le cercle, le halo, le portrait, son nom et la zone de saisie ne sont **jamais nommés** par l'état nu |
| 9 | le bouton de masquage est nommé **une seule fois**, pour être rallumé (`opacity: 1`, `visibility: visible`) et **sans** dimension, position, apparence |
| 10-12 | **le verrou n'est pas complaisant** : la mutation est **rejouée à chaque exécution** (voir § 6.2) |

### 6.2 La mutation a été réellement rejouée (pas seulement décrite)

Procédure exécutée, dans cet ordre :

1. **Défaut réintroduit dans la vraie source** : `.pilot-vocal.vocal-bare .vocal-orb,`
   réinséré en tête du bloc d'effacement de `src/css/style.css` ;
2. suite lancée sur le verrou **et** sur les deux voisins qui mesurent ce que le masque
   n'atteint jamais ;
3. résultat : **5 échecs**, tous parlants —
   `la liste d'effacement est exactement celle-la…` (`[ …(6) ] ≠ [ …(5) ]`),
   `aucune regle de l'etat nu ne nomme le disque…` (`ces selecteurs de l'etat nu
   eteignent le cercle (ou l'un de ses ancetres)`),
   `le cercle, le portrait, son nom et la zone de saisie ne sont jamais nommes`
   (`.vocal-orb ne doit pas etre nomme par l'etat nu`),
   `la regle du defaut, reintroduite, est immediatement vue`,
   `un ancetre eteint est vu : .vocal-stage emporterait le disque` — cette dernière
   échoue parce que la mutation du test s'ajoutait à la vraie : la mesure est
   sensible ;
4. **source restaurée** (`cp` de la sauvegarde) ;
5. `git diff` contrôlé : une seule occurrence de `vocal-bare .vocal-orb` subsiste, dans
   un **commentaire** qui cite le défaut (aucune règle) ;
6. suite relancée : **PASS (37) FAIL (0)** sur les trois fichiers.

Les trois derniers tests du verrou rejouent la mutation **à chaque exécution**, sans
toucher au disque : ils injectent le sélecteur fautif, puis un `::before` opaque, puis
un `.vocal-stage` à `opacity: 0.4`, dans une **copie** de la source. Si l'ancrage du
bloc changeait, le test `la mutation n'a pas pris : l'ancre du bloc d'effacement a
change` échoue au lieu de passer silencieusement.

### 6.3 Les tests existants : réalignés, aucun supprimé, aucun assoupli

Six fichiers découpaient le CSS **à partir de** `.pilot-vocal.vocal-bare .vocal-orb,`,
qui n'existe plus. L'ancre devient `.pilot-vocal.vocal-bare .vocal-mic-fix,` — ancre de
fin `.pilot-vocal.vocal-bare .vocal-top {` inchangée. Les assertions ont été
**renforcées**, jamais relâchées :

| Fichier | Changement | État |
|---|---|---|
| `ecran-vocal-bouton-affichage.test.js` | en-tête point 7 réécrit ; `blocEffacement`/`sectionNue` réancrés ; test 7 renommé « le bloc nomme le micro, la ligne d'etat et les deux colonnes » **+** `not.toContain(".vocal-orb")` ; nouveau test « le disque reste, meme SANS PERSONNAGE : il n'est jamais nomme » | PASS (44) |
| `bouton-masquage-sans-texte.test.js` | `blocEffacement` réancré ; test renommé « le bloc d'effacement ne nomme ni la zone de saisie ni le disque » **+** `not.toContain(".vocal-orb")` | PASS (11) |
| `ecran-vocal-masquage-garde-le-portrait.test.js` | `blocEffacement` réancré ; `attendus` ne contient plus `.vocal-orb` ; **contrôle négatif ajouté** pour le disque (`eteintPar(…)` rend `[]`) ; le test « le verificateur reproduit le defaut » prend `.vocal-side-discussion` comme témoin | PASS (16) |
| `vocal-portrait-detache.test.js` | ancre + `neutraliserSource` (le commentaire cite désormais la règle fautive) | PASS (14) |
| `ecran-vocal-marges-transparence-portrait.test.js` | ancre `sliceSource` réalignée | PASS (13) |
| `ecran-vocal-la-saisie-nest-jamais-masquee.test.js` | test « le verificateur n'est pas complaisant » réécrit : le défaut du 2026-10-31 est reproduit avec `.vocal-side-discussion` (même héritage d'`opacity`, toujours éteint) au lieu du disque, qui ne peut plus servir de témoin | PASS (9) |

Aucun test supprimé ; aucun `expect` retiré ; les trois témoins de non-complaisance
gardent leur mécanisme (un nœud réellement éteint par un ancêtre éteint).

## 7. Documentation mise en accord

- `spec_modes_ecran_vocal.md` § 4ter : le disque quitte « ce qui se masque » et entre
  dans « ce qui reste, toujours » ; la cause, l'approche retenue (et le rejet de
  l'exception en aval), le fond de scène et le verrou sont écrits ; les passages
  « le disque s'éteint comme le reste » et « le portrait et le disque restent à leur
  place » sont corrigés ; la liste des verrous passe de trois à quatre fichiers.
- `spec_modes_ecran_vocal.md` § 3 / § 4ter : l'état nu résumé en tête inclut le cercle.
- `help/handbook.md` régénéré (`npm run build:handbook`) : le bloc
  `vocal-colonnes-portrait` dit maintenant que **le cercle reste allumé, identique à
  lui-même**, et pourquoi (c'est lui qui dit encore si Pilot écoute, réfléchit ou
  répond).

## 8. Contrôle final

- Suite complète `npx vitest run` : **PASS (4896) FAIL (0)** — 4884 tests avant
  modification (mesure de référence sur le même arbre), + 12 tests pour le verrou
  dédié ; **aucun échec**, aucun test rendu `skip`.
- Aucune couleur en dur ajoutée, aucun jeton nouveau, aucun réglage, aucune
  persistance, aucun bump de version.
- Le commit unique inclut les modifications du lot précédent restées non commitées
  (portrait détaché, colonnes, panneaux translucides, thème, aide intégrée).
