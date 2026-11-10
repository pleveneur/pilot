# Rapport — registre des comportements validés

Date : 2026-11-19 · Projet : `G:\IA_PL\pilot` · Périmètre : documentation + **un** fichier
de test de garde-fou. Aucun fichier applicatif (`src/js/*.js` hors test, `src-tauri/`,
CSS, HTML) n'a été modifié.

---

## 1. Ce qui existait avant

Aucun registre. `grep -rn "REGISTRE"` ne trouvait que des occurrences sans rapport
(« registre d'agents » dans les specs d'agents) et **une** occurrence utile : l'en-tête de
`src/js/barre-de-saisie-respire-toujours.test.js`, qui se nommait déjà
« REGISTRE DES COMPORTEMENTS VALIDÉS — ENTRÉE N° 1 ». Le commit `551c0f3` qui l'a créé
disait la même chose dans son message. **Le registre était donc annoncé et jamais écrit** :
c'est exactement le trou que la demande comble.

Le problème constaté, lui, n'est pas hypothétique : les deux derniers commits de
l'histoire (`551c0f3` barre de saisie, `b956128` arrêt d'écoute) sont des **retours en
arrière** de comportements qui avaient déjà été validés par le propriétaire. Rien dans la
suite ne nommait ces comportements : on ne pouvait pas voir qu'un correctif en défaisait
un autre.

## 2. Méthode — l'inventaire d'abord

Rien n'a été déclaré « protégé » sans avoir **lu le test** qui le porte. Le tri a été fait
en trois temps :

1. lister les fichiers de test du front (`src/js/*.test.js` : **304**), puis extraire
   programmatiquement les titres `describe` / `it` des fichiers candidats — un `grep` sur
   des titres contenant guillemets, accents et parenthèses produit des faux négatifs ;
2. pour chaque comportement de la demande, ouvrir le fichier et vérifier **ce que le test
   vérifie réellement** (corps du `it`, pas seulement son titre) ;
3. refuser tout titre qui ne serait qu'une décision **pure** là où le comportement est un
   branchement (ou l'inverse), et chercher le second test quand il existe.

Aucun test n'a été inventé pour « remplir » une ligne : les 20 entrées du registre pointent
toutes vers un `it()` **existant**, dont le titre est cité mot pour mot.

## 3. Le registre

Fichier : **`spec_registre_comportements_valides.md`** (racine, à côté des autres specs —
c'est là que le dépôt range un document de référence, et `AGENTS.md` y renvoie).

Format : un tableau, **une ligne par comportement** — `N° | comportement attendu en
français simple | fichier de test :: titre exact du test`. Le `::` sépare le fichier du
titre ; il n'est là que pour que le garde-fou puisse retrouver le test sans ambiguïté.

Les 20 entrées couvrent les six comportements demandés :

| Comportement demandé | Entrées | Tests qui les portent |
|---|---|---|
| La barre de saisie respire encore en mouvement réduit (les autres indicateurs restent figés) | 1, 2 | `barre-de-saisie-respire-toujours.test.js` (2 tests) |
| L'ordre d'arrêt d'écoute = exactement l'état de la veille de 20 s (micro non fermé, réveil par le nom possible, aucune lecture) | 3 → 7 | `arret-ecoute-vocale.test.js` (5 tests) |
| La veille de 20 s de silence (et sa suspension pendant le travail et la lecture) | 8, 9, 10, 11 | `veille-mot-de-reveil.test.js` (2), `vocal-veille-pendant-le-tour.test.js` (2) |
| Le micro du mode Vocal reste ouvert et ne se ferme pas | 12, 13, 14 | `micro-reste-ouvert-mode-vocal.test.js` (3) |
| L'exemple des mots de réveil affiché est exact | 15 | `mots-de-reveil.test.js` (1 test, qui lit `index.html` et fait tourner l'exemple) |
| Trois sorties (logo, Échap, fermeture d'onglet) et un seul bouton de masquage | 16 → 20 | `ecran-vocal-lot2.test.js` (3), `ecran-vocal-bouton-affichage.test.js` (2) |

L'entrée 1 est bien celle que le commit `551c0f3` avait numérotée : la numérotation déjà
écrite dans le code n'a pas été contredite.

## 4. Le garde-fou

Fichier : **`src/js/registre-comportements-valides.test.js`** (10 tests, Vitest, aucune
dépendance nouvelle). Il **lit le registre** : la liste des verrous n'est jamais recopiée
dans le test, sinon il ne détecterait aucune dérive.

Ce qu'il refuse :

| Refus | Comment il le voit |
|---|---|
| Une ligne sans test | la colonne doit contenir `chemin.test.js :: titre`, et le fichier doit exister |
| Un titre qui n'existe plus (test renommé, déplacé, supprimé) | recherche **du titre exact** dans le fichier cité |
| Un test sauté ou creux | la ligne doit commencer par `it("` (ni `describe`, ni `it.skip`, ni `it.todo`) **et** le corps doit porter au moins un `expect(` avant le test suivant (les commentaires ne comptent pas) |
| Un registre vidé | au moins 6 entrées, numéros uniques **et consécutifs depuis 1**, chaque ligne rédigée, aucun `TODO` / « à faire » |
| Une entrée ajoutée ou retirée en silence | un fichier de test qui se déclare `REGISTRE DES COMPORTEMENTS VALIDÉS — ENTRÉE N° n` doit figurer au registre sous **ce** numéro ; un fichier ne déclare qu'une entrée ; un numéro n'est jamais revendiqué deux fois |
| Un registre qui disparaît de la documentation | `AGENTS.md` doit citer la spec **et** le garde-fou |

Réparation d'un faux départ, dit sans détour : ma première version contenait deux
défauts, tous deux corrigés.

1. Un test **tautologique** (« le registre ne revendique aucune entrée qu'aucun fichier ne
   porte ») : il ne pouvait pas échouer. Remplacé par deux propriétés falsifiables
   (une marque par fichier, un numéro jamais pris deux fois).
2. Une ligne de découpage `texte.slice(debut, texte.indexOf("\n", index))`, refusée — à
   juste titre — par l'inventaire `source-slice.test.js` (borne calculée en ligne). Le
   contrôle porte maintenant sur le **préfixe** avant le titre (`... .toBe('it("')`), ce qui
   est plus strict et ne découpe plus rien.

### Preuves que le garde-fou mord (5 mutations, fichier restauré après chacune)

| Mutation appliquée au dépôt | Résultat |
|---|---|
| remplacer le titre de l'entrée 8 par `(b) le titre a change sans le registre` | **échec** — « le test « … » n'existe plus dans `src/js/veille-mot-de-reveil.test.js` (entrée 8) : le registre n'est plus à jour » |
| passer ce `it(` en `it.skip(` | **échec** — « n'est pas porté par un `it(...)` : `expected 'it.skip("' to be 'it("'` » |
| supprimer la ligne 13 du registre | **échec** — « le numéro 13 manque : le registre doit rester numéroté de 1 à N sans trou (… 12, 14 …) » |
| commenter toutes les assertions de ce `it(` | **échec** — « ne vérifie rien (aucune assertion) : il ne verrouille pas le comportement » |
| ajouter `// REGISTRE DES COMPORTEMENTS VALIDÉS — ENTRÉE N° 21` dans un autre fichier de test | **échec** — « `src/js/mots-de-reveil.test.js` se déclare ENTRÉE N° 21, absente du registre » |

Après restauration, le fichier repasse à **10/10** et `git diff` sur les fichiers mutés est
vide. Le garde-fou n'est donc pas un test qui passe « parce qu'il ne regarde rien ».

## 5. Ce que le registre ne prouve pas — et ce qui reste sans verrou

Les six comportements demandés ont **tous** un test : aucune ligne n'a été écrite sans
preuve. Trois limites sont réelles et sont dites ici plutôt que masquées :

1. **Unicité du bouton de masquage (entrées 19-20)** : elle est vérifiée **sur le source**
   (le `buildVocalDisplayToggle` est appelé une seule fois, et pas du tout dans l'autre
   plein écran), pas sur un DOM monté. Proposition, si le propriétaire juge le risque
   réel : monter `buildVocalOverlay` en jsdom et compter les nœuds `[data-vocal-display-toggle]`
   — petit lot séparé, le présent garde-fou n'est pas le bon endroit.
2. **Aucun test ne fait tourner 20 s de vraie horloge** sur l'écran monté : la veille est
   verrouillée par la **décision pure** (`decideVocalVeille`) et par son **branchement**
   (les deux faits qui suspendent la veille arrivent bien à la décision). Un test de 20 s
   serait lent et fragile ; la limite est acceptée telle quelle.
3. **« Aucune lecture à voix haute » pour l'ordre d'arrêt (entrée 6)** est vérifié sur le
   source (aucun appel au lecteur dans ce chemin, pas de second lecteur), pas en
   observant un `speak()` silencieux au banc.

## 6. Documentation

- `spec_registre_comportements_valides.md` : **créé** (le registre, son mode d'emploi, ce
  que le garde-fou vérifie, ce qu'il ne fait pas).
- `AGENTS.md` : une ligne de plus dans « Navigation rapide » et une dans l'arborescence,
  pour que le registre soit trouvé avant une modification qui pourrait le contredire.
  Le garde-fou vérifie cette citation : on ne peut pas retirer le registre de la
  documentation en silence.
- `plan_dev.md` : **non modifié** — il doit rester un résumé de 30 lignes ; un registre de
  comportements n'est pas un chantier.

## 7. Suites exécutées (chiffres recomptés, pas recopiés)

| Suite | Commande | Résultat |
|---|---|---|
| Front (Vitest) | `npm test` | **316 fichiers**, **5854 tests**, **0 échec** |
| Rust desktop (les mêmes que le CI) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **964 passés**, **3 ignorés**, **0 échec** |

Le garde-fou ajoute **1 fichier** et **10 tests** aux 315 fichiers / 5844 tests
précédents ; il n'a fait échouer aucun autre fichier, et aucun test existant n'a été
modifié, affaibli ou sauté.
