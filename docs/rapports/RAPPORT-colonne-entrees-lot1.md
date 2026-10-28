# RAPPORT — Colonne de gauche, lot 1 (insécable)

Mission : appliquer le « lot 1 » du § 4 de `RAPPORT-design-colonne-entrees.md`
(version disque, 595 lignes). Aucun push, aucun tag, aucune version modifiée
(projet toujours en **0.5.0**).

---

## 1. État de départ constaté (avant toute modification)

Une mission antérieure avait appliqué l'**ancienne** découpe (dite « lot A »,
commit `1ef4aee feat(colonne): Brouillon et Options ouvrent le bloc du bas`).
Le dépôt était donc dans l'état intermédiaire **qui déborde** :

| Point | État constaté sur le disque |
|---|---|
| Haut de la colonne | déjà vidé de ses boutons : `#global-actions` ne contient plus que `#remote-badge` (`index.html:79-81`) ; `margin: 0` / `padding: 0` déjà posés (`src/css/style.css:762-778`), badge à `margin: 8px 8px 8px auto` (`:7262`) |
| « Brouillon » / « Options » | déjà les deux premières lignes du bloc du bas (`index.html:139-140`), classe `.ga-label` conservée |
| Cadre `#project-footer` | déjà sans `project-only hidden` (`index.html:130`) : visible sans projet ouvert |
| **« Lancer l'agent »** | **encore dans le bloc du bas**, en 3ᵉ ligne, avec `pj-row-main` (`index.html:145` avant modification) |
| **Nombre de lignes du bloc** | **8** → `2 + 16 + 8×32 + 7×6 = 316 px` |
| **Plafond** | `max-height: 50 %` = **250 px** à la fenêtre minimale (500 px) → **débordement de 66 px**, deux lignes dessinées hors cadre (le commentaire CSS l'admettait explicitement) |
| Règles CSS mortes | `.pj-panel button.pj-row-main` et `.pj-panel button.pj-row-main .icon` encore présentes (`src/css/style.css:1705-1713`) |
| Menu « Autres écrans » | 9 entrées, sans « Lancer l'agent » |
| Verrous de tests | décrivaient l'état intermédiaire : 8 lignes, 316 px, 50 %, `.pj-more-item` = 9, `pj-row-main` |

C'est bien l'état « qui déborde » annoncé par la mission. Rien n'a été
supprimé : l'état final a été atteint **par ajout/retrait ciblés**.

---

## 2. Ce qui a été appliqué (état FINAL), avec preuves

### 2.a — Lancer l'agent quitte le bloc et ouvre le menu (§ 1.d du rapport)

- **Retiré** du bloc du bas : le `<button id="btn-terminal-cmd" class="project-only hidden pj-row-main" …>` et son commentaire d'introduction.
- **Inséré** en **première ligne du groupe « Mon projet »**, donc première entrée du menu, juste après le titre de rubrique et **avant** « Prompt Builder » — `index.html:179` :

```html
<button id="btn-terminal-cmd" class="project-only hidden pj-more-item" role="menuitem" title="Lancer l'agent : ouvrir la conversation de l'agent">…</button>
```

  Identifiant, infobulle et `project-only hidden` **conservés à l'identique** ;
  gain de `pj-more-item` + `role="menuitem"` (le menu se referme au clic,
  `src/js/sidebar.js:1658-1660` inchangé). Câblage `src/js/main.js:865`
  inchangé (`getElementById`, indifférent à la place dans le DOM).

#### ÉCART SIGNALÉ (non tranché par moi)

La mission relève que le rapport mentionne « Lancer l'agent » de deux façons
apparemment différentes : (a) « première entrée du groupe “Mon projet” »
(§ 2.3) et (b) « en tête du menu “Autres écrans” » (demande citée du
propriétaire, § 0). **Lecture faite sur le disque** : le § 2.3 tranche
explicitement « première entrée du premier groupe, “Mon projet” », et ajoute que
la première ligne du menu est celle collée au déclencheur (menu ouvert vers le
haut, donc toujours visible sans défiler), et que créer un groupe « Agent » en
tête est **volontairement non retenu** (§ 2.3, « Non retenu volontairement »).

Les deux formulations **désignent la même ligne** : « première entrée du groupe
“Mon projet” » = « première ligne du menu ». Ce que le disque a retenu :
`btn-terminal-cmd` est la **toute première entrée du menu**, sous le titre
« Mon projet », avant « Prompt Builder » (`index.html:179`, vérifié par le test
`lot3-colonne-bas.test.js:196-215`). Aucun nouveau groupe n'a été créé.

### 2.b — Le bloc du bas : 7 lignes, liste régulière

Ordre final du `.pj-panel` (vérifié par le test et par mesure) :

```
1 Brouillon        (btn-scratchpad, .ga-label)   index.html:139
2 Options          (btn-settings,  .ga-label)    index.html:140
3 Assistant        (btn-superagent)              index.html:143
4 Dossier du projet (btn-explorer)               index.html:149
5 Terminal         (btn-terminal)                index.html:151
6 Commandes du projet (btn-commands)             index.html:155
7 Autres écrans ▾  (btn-more-screens)            index.html:175
```

- Libellés, infobulles (`Brouillon (Ctrl+Shift+N)`, `Options`), icônes
  (`file-text`, `settings`) et identifiants **inchangés**.
- **Aucune ligne mise en évidence** : `pj-row-main` disparaît du balisage ; les
  7 lignes sont à 12 px / 400 via `.pj-panel button`
  (`src/css/style.css:1662-1677` puis `:1695-1703`).

### 2.c — Deux règles mortes supprimées, une valeur changée (§ 1.e)

| Où | Avant | Après |
|---|---|---|
| `src/css/style.css:1705-1713` | `.pj-panel button.pj-row-main` + `.icon` | **supprimées** (plus aucune ligne en évidence) |
| `src/css/style.css:796` | `max-height: 50%;` | **`max-height: 60%;`** |
| `#global-actions` | déjà `margin: 0` / `padding: 0` (fait avant) | conservé tel quel, `flex-wrap: wrap` et absence de hauteur minimale **préservés** |
| `.remote-badge` | déjà `margin: 8px 8px 8px auto` (fait avant) | conservé : badge « Distant » à **44 px** quand il s'affiche, identique à avant |
| `.ga-label` | présente | **conservée** (§ 3.8 : aucun verrou à toucher) |

### 2.d — Commentaires alignés sur la nouvelle vérité (§ 1.f)

`index.html:62-72` (haut sans porte), `:92-124` (sept lignes, dix entrées,
aucune mise en évidence, sortie de « Lancer l'agent »), `:126-129` (cinq lignes
de projet), `:166-171` (dix entrées, `btn-terminal-cmd` en tête),
`src/css/style.css:762-769`, `:785-795` (278 px / 60 %), `:863-870`
(`.pj-panel` : sept lignes), `:1705-1713`, `:7259`, `src/js/sidebar.js:1681-1687`.

### 2.e — Verrous de tests mis à jour SANS perte de pouvoir de détection (§ 1.g)

`src/js/lot3-colonne-bas.test.js` :

| Verrou | Avant | Après |
|---|---|---|
| `LIGNES` (`:127`) | 8 identifiants | **7** identifiants, `btn-terminal-cmd` retiré |
| `MENU` (`:138`) | 9 identifiants | **10**, `btn-terminal-cmd` **en tête** |
| Compte des lignes du menu (`:183-190`) | 9 | **10** (comptage tolérant `class="[^"]*\bpj-more-item\b`, la 1ʳᵉ porte en plus `project-only hidden`) |
| **Nouveau** « Lancer l'agent ouvre le menu, en PREMIÈRE ligne du groupe Mon projet » (`:196-215`) | — | vérifie `pj-more-item`, `role="menuitem"`, l'infobulle, l'antériorité sur `btn-prompt-builder` **et** l'absence de la ligne dans le bloc |
| `.pj-panel` : « SEPT lignes » (`:241-259`) | 8 | **7** |
| Hauteur (`:299-318`) | 316 px / `max-height: 50%` | **278 px**, `max-height: 60%`, `278 < 300`, et `not toContain("max-height: 50%")` |
| **Nouveau** « aucune ligne du bloc n'est mise en évidence » (`:321-333`) | « Lancer l'agent est la ligne mise en évidence » | `pj-row-main` absent du bloc **et** plus aucune règle CSS `.pj-panel button.pj-row-main {` |
| Liste des sélecteurs sans couleur en dur | incluait les 2 règles `pj-row-main` (supprimées) | retirées de la liste (sinon « règle CSS absente ») |

`src/js/lot2-colonne-haut.test.js` et `src/js/retrait-ecran-aide.test.js` :
**aucune retouche nécessaire** — ils décrivaient déjà la cible du lot 1
(`#global-actions` = 0 bouton, « Brouillon »/« Options » vérifiés dans le bloc du
bas, `flex-wrap: wrap`). Lus, ils restent verts.
`src/js/libelle-options-ecran.test.js` : **non touché** (`.ga-label` conservée).

**Aucun test supprimé** : deux tests réécrits (hauteur, mise en évidence) et
**deux tests ajoutés** ⇒ le total monte (voir § 5).

---

## 3. Mesures demandées (mesurées, pas reprises du message)

Mesure hors test (lecture du CSS et du balisage réels, fenêtre minimale
`minHeight: 500` de `src-tauri/tauri.conf.json`) :

```
lignes du bloc du bas      : 7
ordre                      : btn-scratchpad btn-settings btn-superagent btn-explorer
                             btn-terminal btn-commands btn-more-screens
hauteur d'une ligne        : 32 px | gap: 6 px | padding vertical cadre: 8 px
hauteur TOTALE du bloc     : 278 px
plafond max-height         : 60 % = 300 px a 500 px de haut
marge restante             : 22 px
entrees du menu Autres ecrans : 10
```

**Les deux chiffres demandés : 7 lignes, 278 px** pour un plafond de **300 px**
(60 % de 500 px) ⇒ marge de 22 px, **aucune ligne hors cadre**, y compris
fenêtre réduite au minimum. `overflow: visible` est conservé (obligatoire pour
le menu qui s'ouvre vers le haut) : le débordement ne serait pas rattrapé par un
défilement, d'où l'exigence arithmétique.

---

## 4. Raccourcis et palette vérifiés (aucun accès perdu)

| Accès | Statut | Preuve |
|---|---|---|
| « Brouillon » par le bouton | OK, 1 clic (2ᵉ ligne du bloc) | `index.html:139` + `src/js/main.js:902` |
| **« Brouillon » au clavier `Ctrl+Shift+N`** | **OK** | gestionnaire global `src/js/main.js:1083-1088` — ne dépend d'aucun bouton |
| **« Brouillon » par la palette** (« Ouvrir le brouillon », Ctrl+Shift+N) | **OK** | `src/js/main.js:73` (entrée) et `:357-358` (`case "scratchpad"` → `tabs._openScratchpad()`) |
| « Options » par le bouton | OK, 1 clic (2ᵉ ligne du bloc) | `index.html:140` + `src/js/settings.js:392` |
| **« Options » par la palette** (« Ouvrir les Options ») | **OK** | `src/js/main.js:83` (entrée) et `:407` (`document.getElementById("btn-settings")?.click()`) |
| « Options » par le badge distant | OK, inchangé | `src/js/settings.js:1114` |
| « Lancer l'agent » | **2 clics** (menu → ligne), perte annoncée et assumée § 2.3 | `index.html:179`, câblage `src/js/main.js:865` |
| Menu : 10 entrées, 5 groupes | OK | `index.html:176-195` |

### État AVANT → APRÈS, entrées et câblages (aucune perte)

Les **17 identifiants** sont tous présents **une seule fois** et **tous câblés**
(vérifié par script, pas à la main) :

| Identifiant | Câblage | Avant | Après |
|---|---|---|---|
| `btn-scratchpad` | `main.js:902` | bloc (1ʳᵉ ligne) | bloc (1ʳᵉ ligne) |
| `btn-settings` | `settings.js:392`, `main.js:407` | bloc (2ᵉ) | bloc (2ᵉ) |
| `btn-terminal-cmd` | `main.js:865` | **bloc (3ᵉ, en évidence)** | **menu (1ʳᵉ)** |
| `btn-superagent` | `main.js:891` | bloc | bloc |
| `btn-explorer` | `main.js:796` | bloc | bloc |
| `btn-terminal` | `main.js:783` | bloc | bloc |
| `btn-commands` | `project-commands.js:25` | bloc | bloc |
| `btn-more-screens` | `sidebar.js:1639` | bloc | bloc |
| `btn-prompt-builder` | `main.js:880` | menu | menu |
| `btn-dashboard` | `main.js:826` | menu | menu |
| `btn-code-graph` | `main.js:817` | menu | menu |
| `btn-review` | `main.js:807` | menu | menu |
| `btn-history` | `main.js:812` | menu | menu |
| `btn-gds` | `main.js:840` | menu | menu |
| `btn-agents` | `main.js:885` | menu | menu |
| `btn-superkanban` | `main.js:898` | menu | menu |
| `btn-interproject` | `interproject.js:32` | menu | menu |

Rien n'est supprimé ; un seul déplacement (`btn-terminal-cmd`). Les raccourcis
clavier et la palette de commandes sont **indépendants de la place dans le DOM**
(`getElementById` / gestionnaire clavier global).

---

## 5. Résultat exact des vérifications

| Vérification | Avant (recompté par moi) | Après (recompté par moi) |
|---|---|---|
| `npx vitest run` (suite JS complète) | `PASS (3203) FAIL (0)` | **`PASS (3204) FAIL (0)`** |
| `npm run build` (compilation front Vite) | — | `✓ built in 12.75s` (aucune erreur ; seuls avertissements préexistants de découpage de chunks) |
| Suite Rust | **non lancée** : aucun fichier Rust touché (voir `git status` : uniquement `index.html`, `src/css/style.css`, `src/js/sidebar.js`, `src/js/lot3-colonne-bas.test.js`) | idem |

Delta de tests : **+1**. Justification exacte : 2 tests réécrits à l'identique
en nombre (« 316 px » → « 278 px », « Lancer l'agent en évidence » → « aucune
ligne en évidence ») et **2 tests ajoutés** (« Lancer l'agent ouvre le menu… »,
« aucune ligne du bloc n'est mise en évidence ») — le second remplaçant un test
supprimé, il y a bien +1 net.

Aucun chiffre de la mission n'a été repris : les compteurs ci-dessus viennent de
mes propres exécutions, avant et après.

---

## 6. Ce qui n'a pas été fait (et pourquoi)

1. **Lot 2 du rapport** (documentation et aide intégrée) : **deux textes sont
   désormais FAUX sur le disque** et ce lot 1 ne les a pas touchés (le rapport
   les confie au lot 2, et la mission demandait le lot 1 exclusivement) :
   - `help/overview.md:27-32` : annonce « **huit** lignes », « **Lancer l'agent**
     (mise en évidence) » et un menu à neuf entrées — or il y en a sept, aucune
     mise en évidence, et dix entrées ;
   - `spec_help.md:298-301` : renvoie encore au « § 4 lot **A** », nom de lot
     périmé (le découpage en lots A→E n'existe plus).
   À traiter avec `spec_pilot.md`, `README.md`, puis `npm run build:handbook`.
   **C'est le point le plus urgent qui reste.**
2. **Lot 3** (recette visuelle dans `npm run tauri dev`) : non exécutée (aucune
   fenêtre Pilot ouverte, aucune mesure au pixel à l'écran). Les hauteurs du
   § 3 sont **calculées** depuis les valeurs CSS et le balisage, comme le
   rapport le faisait lui-même.
3. **`dist/index.html`** : artefact de build ignoré par Git (`.gitignore:5`),
   régénéré par `npm run build` pendant la vérification.
4. **Non touchés volontairement** : bande haute validée, coin haut droit
   (`#window-controls`), largeur de la colonne (280 px, pas de repli), mode Zen,
   comportement des menus au-delà de la ligne ajoutée, `src/js/sidebar.js` hors
   commentaire.

---

## 7. Fichiers touchés

```
index.html                            (bloc du bas, menu, commentaires)
src/css/style.css                     (max-height 60 %, 2 règles mortes, commentaires)
src/js/sidebar.js                     (commentaire seulement, zero code)
src/js/lot3-colonne-bas.test.js       (verrous : 7 lignes, 10 entrées, 278 px, 60 %)
RAPPORT-colonne-entrees-lot1.md       (ce rapport)
```

Aucun JavaScript de production modifié sur le fond (le câblage se fait par
identifiant), conformément au § 4 du rapport.
