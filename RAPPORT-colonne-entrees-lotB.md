# Rapport — Colonne d'entrées, **Lot B** : « Lancer l'agent » au menu, 7 lignes, plafond 60 %

> **Mission demandée** : appliquer **un seul lot** (le « lot B » qui suit le lot A livré en
> `1ef4aee`), tel que décrit dans `RAPPORT-design-colonne-entrees.md` § 4.
> **Version de Pilot inchangée : 0.5.0** (aucun bump). **Un seul commit local**, en
> français. Aucun push, aucun tag, aucune publication. Rien n'a été supprimé.
> **Date** : session courante.

---

## 0. Écart majeur avec la consigne — à lire d'abord

La consigne dit : « le LOT A vient d'être livré et commité (commit local 1ef4aee) ». C'est
**faux sur le disque** : `1ef4aee` est **quatre commits derrière** `HEAD`, et le lot a été
**déjà appliqué** par le commit `de9b869` — « feat(colonne): lot 1 insecable -- 7 lignes de
32 px, plafond 60 % ».

```
662b153 fix(assistant): la zone de saisie ne clignote plus ...   <- HEAD
e1b5730 fix(assistant seul): le coin haut droit ...
89d7ad9 feat(bandeau): logo a 24 px ...
7091fac fix(mcp): le nom des outils ...
de9b869 feat(colonne): lot 1 insecable -- 7 lignes de 32 px, plafond 60 %   <- LOT B deja fait
1ef4aee feat(colonne): Brouillon et Options ouvrent le bloc du bas            <- LOT A
```

J'ai donc **vérifié l'état du disque au lieu de refaire le travail** (§ 1), puis j'ai
appliqué **ce qui manquait réellement du lot B** : la documentation du lot 2 du cadrage
(qui n'avait jamais été faite), un commentaire CSS resté faux, et le renforcement du
verrou anti-débordement (§ 2). Aucune ligne de code de production n'a été refaite.

---

## 1. État constaté sur le disque (preuves, recompté par moi)

Comptage refait à la main sur `index.html` (source lue, commentaires HTML retirés) :

| Règle du lot B | État sur le disque | Preuve |
|---|---|---|
| `#global-actions` ne contient **aucun** bouton | **0** `<button>` | `index.html:80` (seul enfant : `#remote-badge`), `lot2-colonne-haut.test.js` |
| Bloc du bas : **7 lignes**, ordre figé | **7** lignes : `btn-scratchpad`, `btn-settings`, `btn-superagent`, `btn-explorer`, `btn-terminal`, `btn-commands`, `pj-more-wrap` | `index.html:140-175` |
| « Lancer l'agent » **hors du bloc**, **1ʳᵉ entrée** du menu, groupe « Mon projet » | oui : avant « Prompt Builder », `class="project-only hidden pj-more-item"` + `role="menuitem"` | `index.html:180` |
| Menu = **10 entrées**, **5 groupes** | **10** `pj-more-item`, **5** `pj-more-group-label` | `index.html:177-203` |
| Plus aucune ligne mise en évidence | aucun `pj-row-main` dans le balisage ; règles `.pj-panel button.pj-row-main` **supprimées** | `grep pj-row-main src/css/style.css` → **1** occurrence, dans un commentaire explicatif (`:1716`) |
| Plafond du bloc | **`max-height: 60%`** | `src/css/style.css:809` (`#project-footer`, `:792`) |
| `#global-actions` aplati | `margin: 0` (`:782`) ; `padding: 0` (`:789`) | `src/css/style.css:775` |
| Air du badge « Distant » porté par lui | `margin: 8px 8px 8px auto` | `src/css/style.css:7284` (`.remote-badge`, `:7272`) |
| Règle morte « pastille » 28 px supprimée | absente | `src/css/style.css:1727-1734` (commentaire qui explique sa suppression) |
| Cadre visible sans projet ouvert (Q3 / réponse A) | `<div id="project-footer">` sans `project-only` ni `hidden` | `index.html:131` |

**Conclusion** : le lot B (partie code : § 1.d, 1.e, 1.f, 1.g du cadrage) était **déjà
intégralement en place**. Le refaire aurait été une régression.

---

## 2. Ce que j'ai réellement fait (5 fichiers utiles, 1 rapport)

### 2.1 Documentation encore fausse → corrigée (c'est le lot 2 du cadrage, jamais livré)

| Fichier | Avant (faux) | Après (vrai) |
|---|---|---|
| `help/overview.md:27` | « **huit** lignes … **Lancer l'agent** (mise en évidence) … menu groupé (9 écrans) » | « **sept** lignes, toutes de la même taille … menu groupé de **dix** entrées, dont **Lancer l'agent** en toute première ligne », + la perte assumée : **deux clics**, aucun raccourci ne le double |
| `help/overview.md:38` | rien sur le plafond | les sept lignes tiennent **même à la fenêtre la plus petite** (jusqu'à **60 %** de la hauteur) |
| `spec_pilot.md:34` | « **HUIT lignes** … **Lancer l'agent** (13 px / 600) … menu 9 entrées … hauteur 316 px … **plafond encore à 50 %**, dépassement connu … missions séparées (lots B et C) » | « **SEPT lignes** de 32 px, plus aucune mise en évidence … menu **10 entrées**, **Lancer l'agent** en première ligne du groupe « Mon projet » … hauteur **278 px** … **plafond 60 %** = 300 px, marge 22 px, **aucune ligne hors cadre** » |
| `spec_help.md:298` | renvoyait au « § 4 lot A » et s'arrêtait aux deux portes | précise les **sept lignes** et le départ de « Lancer l'agent » vers le menu (10 entrées), renvoi au § 4 lot 1 |
| `help/handbook.md` | généré, donc périmé | **régénéré** par `npm run build:handbook` (jamais édité à la main) |

### 2.2 Commentaire CSS resté faux → corrigé

`src/css/style.css:824` : « les **huit** lignes du bloc sont toujours visibles » →
« les **SEPT** lignes du bloc sont toujours visibles ».

### 2.3 Verrou anti-débordement rendu auto-calculé, et éprouvé

`src/js/lot3-colonne-bas.test.js` — le test de hauteur ne fige plus rien :

- la hauteur se **recalcule** à partir des règles CSS lues (padding du cadre, hauteur de
  ligne, `gap` du panneau) **et du nombre de lignes verrouillé** (`LIGNES.length`) ;
- le plafond (60 %) est la décision arrêtée → il est vérifié **comme valeur** ;
- la **place disponible** est relue dans la vraie configuration de la fenêtre
  (`src-tauri/tauri.conf.json` → `app.windows[0].minHeight`), **plus jamais figée à 300** ;
- l'assertion finale est `hauteur <= plafond`, avec un message qui dit combien de px
  dépassent combien.

**Épreuves réelles (faites, puis restaurées à l'identique)** :

| Épreuve | Résultat exact |
|---|---|
| `max-height: 60%` remis à `50%` | **1 failed / 19 passed** : `expected 60 to be 50` (plafond du bloc) |
| `minHeight` de la fenêtre ramené de `500` à `420` | **1 failed / 19 passed** : `7 lignes = 278 px depassent les 252 px autorises (60 % de 420 px de fenetre)` |
| Fichiers restaurés | `src/css/style.css` → `max-height: 60%` (ligne 809) ; `tauri.conf.json` → `"minHeight": 500` ; `git diff` de `tauri.conf.json` **vide** |

Le verrou mord donc bien dans les deux directions (plafond baissé, fenêtre réduite).

---

## 3. Ce qui ne devait PAS bouger et n'a pas bougé

| Point ferme | État |
|---|---|
| Colonne de gauche **fixe à 280 px**, sans repli de largeur | intact (`src/css/style.css`, `sidebar.js` non touché) |
| **Bande du haut** (rangée d'onglets, hauteur validée à l'écran) | intacte (aucune règle `#tab-row` / `#tab-bar` / `#window-controls` touchée) |
| **« Lancer l'agent » première ligne du groupe du projet** | respecté **dans le menu** : 1ʳᵉ entrée du groupe « Mon projet », id `btn-terminal-cmd`, infobulle et classe inchangés |
| **Ordre et intitulés arrêtés** | inchangés : Brouillon · Options · Assistant · Dossier du projet · Terminal · Commandes du projet · Autres écrans ▾ |
| **Aucune fonctionnalité nouvelle, aucun réglage, aucun bouton ajouté** | oui : mes 5 modifications utiles sont 4 textes + 1 test, **zéro ligne de logique** |
| **Raccourcis, palette de commandes, accès existants** | intacts : `Ctrl+Shift+N`, « Ouvrir le brouillon », « Ouvrir les Options », badge distant passent par `getElementById` / gestionnaire global (aucun fichier `main.js` / `settings.js` touché) |
| **Logo, libellé du moteur, boutons du coin haut droit** | non touchés (une autre mission y travaille — commit `89d7ad9`, `e1b5730`) |
| **Aucun outil listant les sessions d'agents appelé** | oui, aucun |

---

## 4. L'état du débordement à petite fenêtre — **RÉSOLU, preuve chiffrée**

Le bloc mesurait **316 px** (8 lignes) pour un plafond de **50 %**, soit **250 px** à la
fenêtre la plus petite : il **débordait**. État **après** :

```
bloc           = 2 (bordures) + 8x2 (padding) + 7x32 (lignes) + 6x6 (gap) = 278 px
plafond 60 %   = 60 % de 500 px (minHeight reel de tauri.conf.json)    = 300 px
marge          = 300 - 278                                             =  22 px
```

- `278 < 300` → **aucune ligne hors cadre**, y compris fenêtre réduite à 500 px de haut.
- À toute hauteur supérieure, 60 % est encore plus large : la marge ne fait que croître.
- `overflow` reste **`visible`** (obligatoire : le menu « Autres écrans » s'ouvre vers le
  haut) : c'est pourquoi la marge compte — un débordement ne serait pas rattrapé par un
  défilement. Le verrou § 2.3 empêche d'y revenir.

**Réponse nette à la question posée : le lot B met fin au débordement.** Il n'y a rien à
attendre du lot suivant. Le lot suivant du cadrage (lot 3) est une **recette visuelle**,
sans modification de fichier.

---

## 5. Tests — recomptés par moi, avant et après

| Moment | Commande | Résultat exact |
|---|---|---|
| **Avant** toute modification | `npx vitest run` | **PASS (3226) FAIL (0)** |
| Pendant (verrou seul) | `npx vitest run src/js/lot3-colonne-bas.test.js` | **PASS (20) FAIL (0)** |
| Épreuves § 2.3 (2 échecs voulus) | idem, plafond et `minHeight` altérés | **FAIL (1) / PASS (19)** puis **FAIL (1) / PASS (19)** |
| **Après** (tout restauré, handbook régénéré) | `npx vitest run` | **PASS (3226) FAIL (0)** |

Le **nombre total de tests ne baisse pas** : 3226 avant, 3226 après (un test a été
**réécrit** plus strictement, aucun supprimé). Aucun test Rust n'était nécessaire : aucun
fichier `.rs` n'est touché par ce lot.

Note : `npm run build:handbook` a été lancé **après** les modifications d'aide
(`[build-handbook] ✅ help/handbook.md généré (45 blocs, 275510 octets)`).

---

## 6. Écarts et points signalés (franchement)

1. **La consigne est périmée** (§ 0) : le lot B était déjà livré par `de9b869`, quatre
   commits après `1ef4aee`. J'ai appliqué ce qui restait, sans rien refaire.
2. **`RAPPORT-design-colonne-entrees.md` § 5 dit encore « Reste à décider (3 questions
   fermées) »** alors que Q1 (60 %), Q2 (groupe « Mon projet ») et Q3 (réponse A) sont
   tranchées et appliquées. C'est un **document de conception historique** : je ne l'ai
   pas réécrit (le cadrage n'est pas la documentation utilisateur). À archiver ou à
   annoter si le propriétaire le souhaite.
3. **`docs/proposition-presentation-ui.md`** décrit encore « Lancer l'agent » en évidence
   dans le bloc du bas (proposition d'origine, § 3.3 et § 6). Même raison : document de
   proposition, non modifié.
4. **`README.md`** : vérifié, il ne détaille **pas** les lignes du panneau (il ne cite que
   « panneau bas », « panneau d'actions » de façon générique, et le repère de prise en main
   « Lancer l'agent » qui reste vrai). **Aucune modification nécessaire** — c'est le point 4
   du lot 2 du cadrage, traité par vérification.
5. **`src-tauri/src/agents.rs` porte +39 lignes non commitées** sur le disque (travail
   d'une **autre** mission : porte du verrou par projet, `command_is_prompt`). Ce n'est pas
   mon travail : il est **exclu** de mon commit, et je n'y ai pas touché.
6. **`#global-actions button`** survit dans un sélecteur groupé
   (`#global-actions button, .pj-panel button { width: 32px; height: 32px; … }`) : c'est un
   sélecteur **mort** (plus aucun bouton dans ce conteneur) mais **partagé** avec les lignes
   du panneau. Le cadrage ne demandait que la suppression de la règle « pastille » 28 px
   (faite au lot A). Je n'y touche pas : le retirer demanderait de dédoubler une règle
   partagée, hors du périmètre du lot B.
7. **Fins de ligne** : tous les fichiers texte sont en LF (`.gitattributes`) ; les tests
   normalisent leur lecture (`\r\n` → `\n`), donc pas de piège CI Windows.

---

## 7. Ce qui reste à faire

| # | Reste | Qui / quand |
|---|---|---|
| 1 | **Lot 3 — recette visuelle** (9 points du cadrage, dont « fenêtre à 500 px : aucune ligne hors cadre », « sans projet ouvert : 2 lignes », badge distant affiché, thème clair, mode Zen) | propriétaire, dans `npm run tauri dev` — **aucun fichier à modifier** |
| 2 | Annoter ou archiver `RAPPORT-design-colonne-entrees.md` § 5 (questions désormais tranchées) et `docs/proposition-presentation-ui.md` | décision du propriétaire |
| 3 | Publier la version (bump + tag) | **uniquement sur demande explicite** — non fait ici, interdit par la mission |

---

## 8. Fichiers touchés par ce lot (exhaustif)

| Fichier | Nature |
|---|---|
| `help/overview.md` | documentation utilisateur (bloc `<!-- HELP:overview -->`) |
| `help/handbook.md` | **généré** par `npm run build:handbook` (jamais édité à la main) |
| `spec_pilot.md` | spécification générale (§ C, ligne 34) |
| `spec_help.md` | spécification « réponse sur la documentation » (§ 5 UX) |
| `src/css/style.css` | **un commentaire** (huit → SEPT lignes), aucune règle modifiée |
| `src/js/lot3-colonne-bas.test.js` | verrou de hauteur/plafond renforcé (auto-calculé) |
| `RAPPORT-colonne-entrees-lotB.md` | ce rapport |

Aucun fichier de code de production n'a changé de comportement. Aucune suppression.

---

## 9. DEUXIEME PASSAGE — reprise de la mission, verification seule, aucun code refait

> Date : ce passage. Commit de depart constate : `2978922` (et non `1ef4aee`, comme
> l'annoncait la consigne). Le present fichier a ete CONSERVE : la section 9 est
> ajoutee a la suite du rapport deja commite, rien n'est supprime.

### 9.1 Ce que je constate en arrivant, sur le disque et non sur la consigne

| Annonce de la consigne | Constat fait par moi |
|---|---|
| « la tentative precedente n'a rien produit, le depot est reste au commit `1ef4aee` » | **faux** : `git log` donne `2978922` en tete, soit **six commits apres** `1ef4aee` |
| « le lot A (deux portes en tete du bloc) est applique en `1ef4aee` » | exact |
| « le bloc mesure 316 px pour un plafond de 50 % (250 px) : il deborde » | **faux sur le disque** : le bloc est deja a **7 lignes / 278 px** avec un plafond de **60 % (300 px)** |
| « `RAPPORT-colonne-entrees-lotB.md` n'existe pas » | **faux** : il existait, commite dans `2978922`, avec 205 lignes |

Deux commits ont livre ce lot entre-temps :

```
2978922 docs(colonne): lot B -- la documentation dit les 7 lignes et le plafond 60 %
de9b869 feat(colonne): lot 1 insecable -- 7 lignes de 32 px, plafond 60 %
1ef4aee feat(colonne): Brouillon et Options ouvrent le bloc du bas          <- lot A
```

**Decision prise sans rien demander** : ne rien refaire. Rejouer le lot aurait ete une
regression certaine (deuxieme deplacement des memes boutons, deuxieme passage de 50 a
60 %, tests reecrits une seconde fois). J'ai donc **verifie moi-meme, ligne a ligne**, que
chaque point du lot B du cadrage est bien sur le disque, puis j'ai documente le resultat.

### 9.2 Recomptage fait par moi (aucun nombre attendu recopie du cadrage)

| Point du lot B (cadrage § 1.a a 1.g) | Recompter sur le disque | Verdict |
|---|---|---|
| `#global-actions` ne contient plus **aucun** `<button>` | `index.html` : ce conteneur n'a qu'un enfant, `#remote-badge` | conforme |
| `#project-footer` sans `project-only hidden` (visible sans projet) | `<div id="project-footer">` nu, bordure et fond accent conserves | conforme |
| Les deux portes en **deux premieres lignes** de `.pj-panel` | `btn-scratchpad` puis `btn-settings`, indentation de 8 espaces, une seule ligne chacune, classe de libelle `.ga-label` conservee | conforme |
| « Lancer l'agent » **hors du bloc**, **1re entree** du groupe « Mon projet » | `#btn-terminal-cmd` a l'indentation de 14 espaces, juste apres le titre « Mon projet », avant « Prompt Builder » ; `class="project-only hidden pj-more-item"` + `role="menuitem"` ; identifiant et infobulle inchanges | conforme |
| Bloc = **7 lignes** dans l'ordre fige | Brouillon, Options, Assistant, Dossier du projet, Terminal, Commandes du projet, Autres ecrans (via `#pj-more-wrap`) = **7** | conforme |
| Menu = **10 entrees**, **5 groupes** | 10 `pj-more-item` (agent, prompt-builder, dashboard, code-graph, history, review, agents, superkanban, interproject, gds) ; 5 `pj-more-group-label` (Mon projet, Comprendre, Verifier, Collaborer, Sources) | conforme |
| `#global-actions` aplati | `margin: 0` et `padding: 0` dans la regle `#global-actions` | conforme |
| Air du badge porte par `.remote-badge` | `margin: 8px 8px 8px auto` | conforme |
| Plafond du bloc | `max-height: 60%` sur `#project-footer` | conforme |
| Regles mortes retirees | plus de `.pj-panel button.pj-row-main` ni `.pj-panel button.pj-row-main .icon` ; plus de regle « pastille » 28 px `#global-actions button { width:auto; height:28px }` | conforme |
| `.ga-label` conserve | regle `.ga-label` toujours presente (les deux lignes deplacees s'en servent) | conforme |
| Commentaires a jour | `index.html` (haut vide, 7 lignes, menu a 10 entrees), `src/css/style.css` (60 %, 278 px, sept lignes), `src/js/sidebar.js` (SEPT lignes) | conforme |
| Verrous de tests a jour | `lot3-colonne-bas.test.js` : `LIGNES` = 7, `MENU` = 10, `.pj-more-item` = 10, 5 groupes, aucune mise en evidence, hauteur recalculee et comparee au plafond ; `lot2-colonne-haut.test.js` et `retrait-ecran-aide.test.js` : zero bouton en haut | conforme |
| Documentation (lot 2 du cadrage) | `help/overview.md` et `spec_pilot.md` disent 7 lignes / 10 entrees / 278 px / plafond 60 % ; `spec_help.md` ne parle plus de « deux portes » seules ; `README.md` ne detaille pas ces lignes (verifie, rien a y changer) | conforme |

Aucune de ces lignes n'a eu besoin d'etre corrigee : je n'ai **touche a aucun fichier de
code** dans ce passage.

### 9.3 Etat du debordement apres le lot — question posee par la consigne

Recompte par moi, sans recopier le cadrage :

```
hauteur du bloc = 2 (bordures) + 8x2 (padding haut/bas) + 7x32 (lignes) + 6x6 (gap) = 278 px
plafond         = 60 % de la fenetre minimale (minHeight 500 px, src-tauri/tauri.conf.json) = 300 px
marge           = 22 px
```

**Le debordement ne persiste pas** : il n'y a **rien a attendre d'un lot suivant** pour ce
point. Le plafond n'a pas ete force par moi : il etait deja a 60 % (le cadrage le confie au
meme lot, et ce lot est fait). Le lot 3 du cadrage est une **recette visuelle**, sans
modification de fichier.

### 9.4 Tests et verifications, lances par moi (resultats exacts)

| Verification | Resultat exact |
|---|---|
| `npx vitest run` (etat du disque, aucun fichier modifie par moi) | **PASS (3226) FAIL (0)** |
| `npm run build:handbook` puis `git status --short help/` | handbook regenere, `git status` **vide** : la documentation generee etait deja a jour |
| `npm run build` (Vite) | **reussi** (seul avertissement preexistant : tailles de chunks > 500 kB) |
| `minHeight` relu dans `src-tauri/tauri.conf.json` | **500** px (base du calcul du plafond) |
| Tests Rust | non lances : **aucun fichier `.rs` n'est concerne** ; la seule modification Rust du disque (`src-tauri/src/agents.rs`, +39 lignes) appartient a une autre mission et est **exclue** de mon commit |

### 9.5 Incidents de mon passage, dits franchement

1. La consigne imposait d'ecrire `RAPPORT-colonne-entrees-lotB.md` **avant toute analyse**.
   Ce fichier existait deja (commite) : ma premiere ecriture l'a donc **ecrase**. Je l'ai
   **restaure a l'identique** depuis `git show HEAD:RAPPORT-colonne-entrees-lotB.md` (205
   lignes verifiees identiques) et j'ai ajoute la presente section a la suite. Rien n'est
   perdu, rien n'est supprime.
2. Le cadrage lui-meme est **perime** sur un point de forme : il nomme ses lots
   « Lot 1 / Lot 2 / Lot 3 » alors que les commits parlent de « lot A » et « lot B ». Les
   deux nommages designent la meme chose. Je n'ai pas reecrit le document de conception
   (ce n'est pas de la documentation utilisateur).
3. `docs/proposition-presentation-ui.md` decrit encore « Lancer l'agent » en evidence dans
   le bloc du bas (document de proposition, anterieur a la decision). Hors lot : non touche.

### 9.6 Fichiers touches par ce passage

| Fichier | Nature |
|---|---|
| `RAPPORT-colonne-entrees-lotB.md` | **ce rapport** : section 9 ajoutee a la suite du rapport existant (aucune ligne anterieure supprimee) |

Aucun fichier de code, de style, de test, de specification ou d'aide n'a ete modifie dans ce
passage : le lot etait deja livre, et le refaire aurait ete une regression.

### 9.7 Ce qui reste a faire apres le lot B

| # | Reste | Qui |
|---|---|---|
| 1 | **Lot 3 — recette visuelle** (9 points du cadrage : fenetre a 500 px sans ligne hors cadre, sans projet ouvert 2 lignes, badge distant, theme clair, mode Zen) | proprietaire, dans `npm run tauri dev`, aucun fichier a modifier |
| 2 | Annoter ou archiver `RAPPORT-design-colonne-entrees.md` § 5 (questions Q1/Q2/Q3 tranchees) et `docs/proposition-presentation-ui.md` | decision du proprietaire |
| 3 | Publier une version (bump + tag) | **uniquement sur demande explicite** ; interdit ici, non fait |
