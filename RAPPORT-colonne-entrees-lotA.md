# Rapport — Colonne d'entrées, **Lot A** : « Brouillon » et « Options » quittent le haut

> **Mission demandée** : appliquer **un seul lot** de `RAPPORT-design-colonne-entrees.md`
> (§4, « Lot A ») — le déplacement de « Brouillon » et « Options » du haut de la colonne
> vers le bloc du bas, **tel quel** (mêmes libellés, infobulles, icônes, identifiants,
> ordre Brouillon puis Options), avec la **décision Q3 / réponse A** : le bloc du bas
> **reste visible sans projet ouvert**.
> **Date** : session courante. **Version de Pilot inchangée : 0.5.0** (aucun bump).
> **Commit** : un seul commit local, en français. Aucun push, aucun tag.

---

## 1. Ce qui a changé à l'écran

| Avant | Après |
|---|---|
| Haut de colonne : 2 boutons nommés (Brouillon, Options) dans `#global-actions` | Haut de colonne : **aucun bouton** (le conteneur reste, pour le badge « Distant ») |
| Bloc du bas : **6 lignes** de 32 px | Bloc du bas : **8 lignes** de 32 px — **Brouillon · Options** puis Lancer l'agent · Assistant · Dossier du projet · Terminal · Commandes du projet · Autres écrans ▾ |
| Bloc du bas **absent** sans projet ouvert (`class="project-only hidden"`) | Bloc du bas **toujours affiché** ; sans projet ouvert il montre ses **deux premières lignes** (Brouillon, Options) — **réponse A de la Q3** |
| 44 px occupés en haut (8 + 28 + 8) même sans contenu | **44 px rendus à la liste des fichiers** ; badge « Distant » : air porté par lui-même |

Les deux lignes déplacées **ne portent ni `project-only`, ni `hidden`, ni `pj-row-main`** :
elles sont dans le même panneau, prennent la même règle de ligne que les autres
(`.pj-panel button` : 32 px, `var(--font-sm)`, icône à gauche) et gardent la classe de
libellé `.ga-label` (décision §3.8 du rapport : **aucun verrou de test touché** pour le
rendu du texte).

---

## 2. Preuves, fichier:ligne (état APRÈS)

### 2.1 `index.html`

| Ligne | Contenu |
|---|---|
| `:62-78` | commentaire du haut réécrit : plus aucune porte, raisons, badge conservé, marges à 0 |
| `:79` | `<div id="global-actions">` **conservé** dans le DOM |
| `:80` | `#remote-badge` (seul enfant restant) — inchangé |
| `:91-112` | commentaire du bloc : **HUIT lignes**, ordre figé, absence de `project-only`/`hidden` sur les deux portes, dette de plafond renvoyée à la mission séparée |
| `:123-127` | commentaire : le cadre n'est plus `project-only hidden` ; les six lignes de projet gardent la leur |
| `:128` | `<div id="project-footer">` — **`class="project-only hidden"` retirée** |
| `:132-136` | commentaire « 1 et 2. PORTES GLOBALES DEPLACEES » |
| `:137` | `<button id="btn-scratchpad" title="Brouillon (Ctrl+Shift+N)">` + icône `file-text` + `<span class="ga-label">Brouillon</span>` |
| `:138` | `<button id="btn-settings" title="Options">` + icône `settings` + `<span class="ga-label">Options</span>` |
| `:139-144` | commentaire « 3. LIGNE MISE EN EVIDENCE » : « Lancer l'agent » **n'a pas bougé** |
| `:145` | `#btn-terminal-cmd` (Lancer l'agent) — **inchangé, au caractère près** |
| `:146-170` | Assistant, Dossier du projet, Terminal, Commandes, menu « Autres écrans » — **inchangés** (seule la numérotation des commentaires passe de 2-6 à 4-8) |

Contrôles d'unicité : `id="btn-scratchpad"` → **1** occurrence (`:137`),
`id="btn-settings"` → **1** (`:138`), `id="project-footer"` → **1** (`:128`).
Aucun doublon « un en haut + un en bas ».

### 2.2 `src/css/style.css`

| Ligne | Avant → Après |
|---|---|
| `:762` `#global-actions` | `margin: 8px 8px 0` → **`margin: 0`** ; `padding: 0 8px 8px` → **`padding: 0`** (sinon 44 px resteraient vides). `flex-shrink`, `display:flex`, `flex-wrap`, `align-items`, `gap: 6px` **conservés** (le badge s'en sert, `retrait-ecran-aide.test.js` l'exige) |
| `:779` `#project-footer` | commentaire mis à jour (HUIT lignes, **316 px**, dette de plafond) ; **`max-height: 50%` NON modifié** (interdit par la demande) |
| `:865` `.pj-panel` | commentaire : ordre à HUIT lignes |
| `:1705-1713` | `.pj-panel button.pj-row-main` **conservée** (« Lancer l'agent » ne bouge pas) |
| `:1714-1721` | règle morte `#global-actions button { width:auto; height:28px; … }` **supprimée** + commentaire qui dit pourquoi ; `.ga-label` **conservée** |
| `:7259+` `.remote-badge` | `margin: 0 0 0 auto` → **`margin: 8px 8px 8px auto`** (l'air du badge vient de lui, plus du conteneur : 44 px à l'identique quand il s'affiche) |

### 2.3 Commentaires de code remis dans le vrai (aucune ligne de logique)

| Fichier:ligne | Correction |
|---|---|
| `src/js/sidebar.js:1681-1689` | « les six lignes » → les lignes du bloc, + les deux portes globales non `project-only` (donc visibles sans projet) |
| `src/js/settings.js:85-88` | « le bouton du haut de colonne » → « la ligne Options du bloc du bas » |
| `src/js/settings.js:2007-2009` | idem, sur le gestionnaire de clic |
| `src/js/settings.js:2633-2635` | idem, sur l'ouverture externe |
| `src/js/settings.js:3259` | idem, sur la sortie du mode « Assistant seul » |

**Aucun JavaScript de production ne change de comportement** : zéro ligne de logique
modifiée (seuls des commentaires). `git diff` le montre : `sidebar.js` et `settings.js`
ne portent que des commentaires.

---

## 3. Raccourcis et palette : vérifiés, identiques

| Accès | Avant | Après | Preuve |
|---|---|---|---|
| Bouton « Brouillon » | 1 clic en haut | **1 clic**, 1ʳᵉ ligne du bloc | `src/js/main.js:902-904` — `document.getElementById("btn-scratchpad").addEventListener(...)` : câblage par identifiant, indifférent à la position dans le DOM |
| Clavier **Ctrl+Shift+N** | ouvre le brouillon | **identique** | `src/js/main.js:1083-1088` — gestionnaire global `keydown`, ne dépend d'aucun bouton |
| Palette « Ouvrir le brouillon » (Ctrl+Shift+N) | oui | **identique** | `src/js/main.js:73` (entrée) et `:357-359` (`case "scratchpad"` → `tabs._openScratchpad()`) |
| Bouton « Options » | 1 clic en haut | **1 clic**, 2ᵉ ligne du bloc | `src/js/settings.js:391` (`getElementById("btn-settings")`) + `:2010-2012` (`addEventListener` → `openSettingsTab()`) |
| Palette « Ouvrir les Options » | oui | **identique** | `src/js/main.js:83` (entrée) et `:400-407` (`case "settings"` → `getElementById("btn-settings")?.click()`) |
| Badge « Distant » | ouvre les Options | **identique** | `src/js/settings.js:3190` (`remoteBadge` → `btnSettings.click()`) |

Ordre de tabulation résultant : « Projets » → **Brouillon → Options** → arborescence →
Assistant → Dossier du projet → Terminal → Commandes du projet → Autres écrans.
Aucun raccourci n'a été ajouté, retiré ni déplacé.

---

## 4. Ce qui n'a **pas** bougé (vérifié)

- **« Lancer l'agent »** : identifiant `btn-terminal-cmd`, classe `pj-row-main`, infobulle,
  effet, et **place** (toujours la première ligne *de projet* du bloc). Aucun raccourci.
- **Menu « Autres écrans »** : 9 entrées, 5 groupes nommés, ouverture **vers le haut**,
  fermeture Échap / clic extérieur / sélection — intact.
- **Les 14 identifiants** des écrans et leurs gestionnaires — intacts.
- **Largeur de la colonne (280 px), absence de repli** — intacte.
- **Bande haute 32 px, coin haut droit, groupe « Mon projet »** — non touchés.
- **Plafond du bloc (50 %)** — **non modifié** (voir §5.1).
- **Aucune ligne ajoutée à l'écran** : rien n'est réservé à la place des deux boutons
  (`#global-actions` ne fait plus 0 px de haut, il ne réserve plus rien).
- **`#file-tree`**, `#open-projects-bar`, le filtre, le watcher — non touchés.
- **Rust** : aucun fichier `.rs` modifié → suites Rust non nécessaires (aucun
  `#[tauri::command]`, aucun test Rust ne cite `#project-footer` ni `#global-actions` :
  `grep -rn "project-footer\|global-actions" src-tauri/src web/ scripts/` → **0**).
- **Lots B/C/D/E** : non commencés.

---

## 5. Écarts et points signalés (franchement)

### 5.1 Le bloc fait 316 px pour un plafond de 250 px (état intermédiaire **annoncé par le rapport**)

Avec 8 lignes : `2 + 2×8 + 8×32 + 7×6 = 316 px`. À la fenêtre minimale (500 px), le
plafond `max-height: 50 %` vaut **250 px** → **66 px de débordement**, exactement la ligne
« ajouter les 2 entrées **sans** retirer Lancer l'agent → 8 lignes → 316 px → **déborde** »
du tableau du rapport (§4). La demande interdisant de toucher le plafond (60 %) **et** de
déplacer « Lancer l'agent », cet état est **la conséquence arithmétique obligatoire** du
lot demandé. Il est :
- **écrit dans le CSS** (`src/css/style.css:785-798`, commentaire « débordement CONNU et
  assumé jusqu'à la mission du plafond ») ;
- **verrouillé par un test** (`lot3-colonne-bas.test.js:274`, calcul 316 px + assertion
  que 316 > 250) : rendre le plafond à 60 % fera **rougir** ce test, ce qui force la mise
  à jour explicite des chiffres dans la mission du plafond.
Au-dessus de 500 px de hauteur de fenêtre, 50 % ≥ 316 px dès **632 px** de haut : le
débordement ne concerne donc que les fenêtres très basses.

### 5.2 Poids typographique des deux lignes : 500 → 400

Le rapport ne fixait pas le poids (il ne parle que de la classe du libellé, §3.8). En
supprimant la règle « pastille » `#global-actions button` (28 px / 500), les deux lignes
héritent de `.pj-panel button` : **12 px / 400**, comme Assistant, Dossier du projet,
Terminal, Commandes. C'est cohérent avec « mêmes états que les autres lignes » ; aucun test
ne verrouillait le 500. À signaler comme différence visuelle de 1 cran de graisse.

### 5.3 Résidus de sélecteurs, laissés volontairement

`#global-actions button` reste cité dans **quatre** listes de sélecteurs groupés
(`:1663` base, `:1678`, `:1684`, `:11160`, `:11172`). Ils n'ont **plus aucune cible** et ne
produisent aucun effet. Ils sont **conservés** : les retirer n'apporte rien et toucherait
des règles partagées (hover/actif/focus/disabled de `.pj-panel button`, `.pj-tab`,
`.sa-events-tab`). La **règle autonome** « pastille » a bien été supprimée, comme le
demandait le rapport (§1.e).

### 5.4 Vérification visuelle

Aucune capture d'écran n'a été produite (l'application n'est pas lancée dans cette
session). La conformité est établie par : les règles CSS lues et citées, les tests de
source (82 assertions sur les quatre verrous concernés), et l'unicité des identifiants.
Le rendu attendu est celui des six autres lignes du panneau, qui n'ont pas changé.

---

## 6. Verrous et tests

### 6.1 Tests mis à jour (aucun supprimé sans remplacement)

| Fichier | Avant | Après |
|---|---|---|
| `src/js/lot2-colonne-haut.test.js` §(d) | « le haut ne contient plus **que deux** boutons » (compte = 2) ; « les deux portes sont des **pastilles de 28 px** » (cherchait `#global-actions button { width:auto; height:28px;`) | « le haut ne contient **plus aucun** bouton » (compte = 0) ; **+** « les deux portes ont bien quitté le haut (aucun de leurs identifiants n'y reste, badge conservé) » ; **+** « le conteneur du haut n'occupe plus aucune hauteur (44 px rendus) » ; « elles prennent la règle des lignes du panneau (32 px / 12 px) » + `#global-actions button` interdit |
| `src/js/retrait-ecran-aide.test.js` §(a) | « le haut garde exactement **deux** boutons nommés » + présence de « Brouillon »/« Options » **dans le haut** | « le haut ne garde **aucun** bouton » ; **+** « Brouillon et Options sont les **deux premières lignes du bloc du bas** », dans cet ordre (même pouvoir de détection, appliqué au nouvel emplacement) |
| `src/js/lot3-colonne-bas.test.js` §(c) | « **SIX** lignes », hauteur **240 px**, `toHaveLength(6)` | « **HUIT** lignes », hauteur **316 px**, `toHaveLength(8)` ; **+** « les deux portes globales sont DANS le bloc, sans `project-only`/`hidden`/`pj-row-main` » ; **+** « le cadre du bloc reste visible sans projet ouvert (réponse A de la Q3) » ; libellés « Brouillon » et « Options » vérifiés en clair |

Le verrou d'ordre (`ordre).toEqual(LIGNES)`) est passé de 6 à 8 entrées : un retour à
l'ancien état, ou une inversion Brouillon/Options, le fait rougir.

Un garde-fou d'inventaire a mordu pendant le travail (preuve qu'il sert) :
`src/js/source-slice.test.js:217` refuse tout découpage de source non protégé. Les deux
`slice()` que j'avais écrits dans `retrait-ecran-aide.test.js` ont été remplacés par
`sliceSource(html, 'id="project-footer"', "</aside>", 4000)` (`source-slice.js`), qui
**échoue** si une ancre manque au lieu de rendre un fragment vide.

### 6.2 Chiffres recomptés (avant / après), mesurés et non estimés

| Mesure | Avant | Après | Delta |
|---|---|---|---|
| `npx vitest run` — tests réussis | **3198** | **3203** | **+5** |
| `npx vitest run` — échecs | **0** | **0** | 0 |
| Fichiers `src/js/*.test.js` | **177** | **177** | 0 (aucun fichier ajouté) |
| Tests des 4 verrous concernés | 77 | **82** | +5 |

Détail du +5 : +2 dans `lot2-colonne-haut.test.js`, +2 dans `lot3-colonne-bas.test.js`,
+1 dans `retrait-ecran-aide.test.js` ; deux tests ont été **remplacés** (pas supprimés)
dans `lot2` et un dans `lot3`.

Commandes exécutées : `npx vitest run` (deux fois : avant toute modification, puis après,
plus une passe ciblée sur les quatre fichiers). Suites Rust **non lancées** : aucun
fichier Rust touché (§4).

---

## 7. Documentation et aide intégrée

| Fichier:ligne | Mise à jour |
|---|---|
| `help/overview.md:26-34` | panneau d'actions : **huit** lignes nommées, Brouillon et Options en tête, menu du bas recomposé ; **+** paragraphe « le haut de la barre latérale ne porte plus aucun bouton » et « le panneau reste affiché même sans projet ouvert » |
| `spec_pilot.md:34` | bloc du bas : **HUIT** lignes (noms, identifiants, 316 px, plafond encore à 50 % et dette signalée) ; **+** ligne « Haut de la colonne : plus aucun bouton » |
| `spec_help.md:297-301` | « le haut ne garde que deux portes » → **plus aucun bouton**, les deux portes sont les deux premières lignes du bloc du bas |
| `spec_help.md:365-367` | tableau de maintenance : `lot2-colonne-haut.test.js` (plus aucun bouton en haut) **et** `lot3-colonne-bas.test.js` (Brouillon puis Options en tête du bloc) |
| `help/handbook.md` | **régénéré** : `npm run build:handbook` → 45 blocs, topic `overview` à jour (`git diff --stat` : 12 insertions, 7 suppressions) |
| `README.md` | **aucune modification nécessaire** : il ne décrit pas la barre latérale (vérifié : `grep -n "Brouillon\|haut de la colonne\|panneau d'actions" README.md` → aucune occurrence décrivant l'emplacement) |

---

## 8. Interdits de la demande — respectés un par un

| Interdit | État |
|---|---|
| Lots B / C / D / E | non commencés |
| Plafond du bloc (60 %) | **non modifié** (`max-height: 50%` intact, dette documentée et verrouillée) |
| « Lancer l'agent » ne bouge pas | ligne `:145` inchangée, toujours 1ʳᵉ ligne de projet, `pj-row-main` conservée |
| Menu « Autres écrans » | intact (9 entrées, 5 groupes, vers le haut) |
| Groupe « Mon projet » | intact |
| Bande haute 32 px | non touchée |
| Coin haut droit | non touché |
| Largeur colonne 280 px (pas de repli) | non touchée |
| Rien d'ajouté à l'écran / pas de place vide | `#global-actions` : `margin: 0`, `padding: 0` → 0 px réservé (vérifié par test) |
| Aucun push / tag | aucun |
| Version | **0.5.0**, inchangée (aucun bump) |
| Commandes de nettoyage / reset Git | aucune (aucun `reset`, `checkout`, `clean`, `stash`) |
| Outil qui liste les sessions d'agents | **non appelé** |
| Fichiers hors objectif | non touchés (`git status` : 11 fichiers modifiés + ce rapport, tous nommés au §2/§6/§7) |
| Si Rust touché, lancer la suite Rust | sans objet : **aucun** fichier Rust modifié |

---

## 9. Fichiers modifiés (11 + ce rapport)

```
help/handbook.md                  (régénéré)
help/overview.md
index.html
spec_help.md
spec_pilot.md
src/css/style.css
src/js/lot2-colonne-haut.test.js
src/js/lot3-colonne-bas.test.js
src/js/retrait-ecran-aide.test.js
src/js/settings.js                (commentaires seulement)
src/js/sidebar.js                 (commentaires seulement)
RAPPORT-colonne-entrees-lotA.md   (ce rapport)
```

DONE: Lot A appliqué seul — « Brouillon » puis « Options » sont les deux premières lignes
du bloc du bas (bloc visible sans projet ouvert, réponse A de la Q3), le haut de la colonne
ne porte plus aucun bouton et ne réserve plus de place (44 px rendus, badge porté par
lui-même). Mêmes libellés, infobulles, icônes, identifiants et ordre ; aucun JavaScript de
production modifié (câblage par `getElementById`), raccourci **Ctrl+Shift+N** et les deux
commandes de palette vérifiés identiques (`main.js:73/357-359/1083-1088`, `:83/400-407`).
Verrous mis à jour sans suppression (2 tests remplacés, 5 ajoutés) : `npx vitest run` →
**3198 → 3203 PASS, 0 FAIL**, 177 fichiers de test inchangés. Docs et aide intégrée à jour,
`help/handbook.md` régénéré. Écarts signalés : bloc à **316 px** pour un plafond encore à
50 % (250 px à la fenêtre minimale) — conséquence arithmétique obligatoire des deux
interdits, documentée et verrouillée ; poids des deux lignes passé de 500 à 400 comme les
autres lignes du panneau. Plafond, « Lancer l'agent », menu, bande haute, coin haut droit et
colonnes 280 px intacts ; version 0.5.0 inchangée ; un seul commit local, aucun push/tag.
