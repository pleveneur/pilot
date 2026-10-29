# Rapport — la suite de tests revient à zéro échec (2026-10-29)

Objectif : aucun échec avant le prochain lot d'interface de l'écran Vocal.

## 1. Décompte exact

Mesuré avec `npx vitest run --reporter=json` (rapport dans `.pi/tmp/`) :

| Moment | Suites | Tests | Échecs |
|---|---|---|---|
| Départ (HEAD `dc74a94`, arbre propre) | 1382 fichiers vus, **39 en échec** | 3941 exécutés | **1 assertion + 38 fichiers qui ne se chargeaient pas** (≈ 640 tests jamais exécutés) |
| Après réparation de la syntaxe (mesure intermédiaire) | 1382 | 4441 | **1** (`vocal-parler-declenche-une-demande`) |
| Après corrections complètes | 1384 | **4581** | **0** |

Le décompte annoncé au départ (4347 passants / 6 échecs) ne correspondait pas à
l'état réel : le vrai problème était plus grave et se voyait mal, parce que la
synthèse de la commande ne compte que les *tests* et pas les *fichiers en échec
de chargement*.

## 2. Cause principale, non prévue : `super-agent.js` ne se parsait plus

Un **backtick écrit dans un commentaire HTML à l'intérieur d'un template
literal** (`'applyVocalPortrait'. `alt` vide : ...`) coupait la chaîne en deux.
Introduit par le commit du lot 1 de la conception portrait/colonnes.

Conséquence : `node --check` refuse le fichier, donc **l'application ne démarre
plus**, et les **38 fichiers de tests qui importent `super-agent.js` tombaient
au chargement** (`Expected ';', '}' or <eof>`). Les autres continuaient de
« passer » parce qu'ils **lisent** ce fichier comme du texte (`readFileSync` +
motifs) au lieu de le charger : une grande partie de la couverture ne protégeait
donc plus rien.

Correctif : `'alt'` (une apostrophe au lieu du backtick), dans le commentaire.

**Garde-fou ajouté** — `src/js/sources-se-parsent.test.js` : les 134 modules de
`src/js` et 4 de `web/js` sont **parsés** par esbuild (270 ms), et un test nomme
le motif exact (« aucun backtick dans un commentaire HTML »). C'est le
garde-fou qui manquait : la panne était invisible pour la suite.

## 3. Les cas décrits dans la mission

### Cas 1 — helper de découpe tombant sur un commentaire CSS : **déjà réglé**
`ecran-vocal-lot2.test.js` (3 assertions) et les tests d'enveloppe de parole
passent, avant comme après mes modifications. Rien à changer : la cause
n'existait plus dans l'arbre (les échecs correspondants étaient masqués par
l'erreur de syntaxe de `super-agent.js`).

### Cas 2 — `.vocal-status` compté deux fois : **le code était fautif**
Le sélecteur était écrit deux fois (l'écriture du texte dans `applyVocalState`,
et une lecture de rectangle pour la règle 4 de `vocal-chrome.js` — la barre qui
s'efface au repos). Comportement inchangé : les deux usages passent maintenant
par **un accesseur unique**, `vocalStatusNode()`, seul endroit du fichier où le
sélecteur est écrit. **Aucune assertion supprimée** : le test vérifie en plus
(a) que l'accesseur contient bien le sélecteur, (b) que le texte de la ligne
n'est affecté qu'à un seul endroit, (c) que `reportVoiceFailure` n'écrit jamais
de texte (il passe par l'état).

### Cas 3 — « le dernier appel de `applyVocalState` » : **le test était trop rigide**
`vocalSyncChrome(state)` a été ajouté après le bouton de relance (le bas
s'efface au repos). Le test comparait la chaîne à **une** instruction. Il
compare désormais la liste **exacte et ordonnée** des instructions
présentationnelles autorisées (`vocalSyncRestartButton`, puis `vocalSyncChrome`).
Le test est **au moins aussi fort** qu'avant : une troisième instruction, ou une
inversion, le fait échouer.

## 4. Preuve par mutation (les tests modifiés échouent quand on casse ce qu'ils surveillent)

| Mutation appliquée à `super-agent.js` | Résultat |
|---|---|
| Second point d'écriture de la ligne d'état par le sélecteur brut (`.vocal-status`) | `dictee-vocale-se-rearme` **échoue** |
| Second point d'écriture via l'accesseur (`doublon.textContent = texte`) | `dictee-vocale-se-rearme` **échoue** |
| Troisième instruction après `vocalSyncConversation();` | `vocal-parler-declenche-une-demande` **échoue** |
| Backtick réintroduit dans le commentaire HTML | `sources-se-parsent` **échoue** (2 tests) |

Toutes les mutations ont été annulées (fichier restauré, `git diff` vérifié).

## 5. Ce qui n'a pas bougé

Aucune règle de l'écran Vocal n'est modifiée : la barre du bas s'efface toujours
au repos (mêmes trois nœuds lus, même ordre, même décision pure), le portrait,
la zone des tâches et le calque des clics sont intacts. Les 224 tests des neuf
fichiers de l'écran Vocal passent.

Aucun fichier Rust touché (`cargo test` non relancé : rien ne change côté
backend). Document de conception et documentation utilisateur non modifiés.

## 6. Fichiers modifiés

- `src/js/super-agent.js` — apostrophe dans le commentaire HTML ; accesseur
  `vocalStatusNode()` (sélecteur écrit une seule fois).
- `src/js/dictee-vocale-se-rearme.test.js` — assertion renforcée (3 assertions
  ajoutées, aucune retirée).
- `src/js/vocal-parler-declenche-une-demande.test.js` — liste exacte et ordonnée
  des appels présentationnels autorisés.
- `src/js/sources-se-parsent.test.js` — **nouveau** garde-fou de syntaxe.
