# Rapport — les quatre accès directs passent dans la barre du bas

> Mission : appliquer **telle quelle** la proposition de barre du bas de la colonne
> de gauche, en passant de **4 lignes à 6 lignes**, dans l'ordre : *Lancer l'agent ·
> Assistant · Dossier du projet · Terminal · Commandes du projet · Autres écrans ▾*.
> Décisions du propriétaire : Q1 (« Lancer l'agent » reste 1ʳᵉ), Q2 (libellé
> « Dossier du projet », identifiants non renommés), Q3 (bloc 164 → **240 px**,
> plafond 40 % → **50 %**).
> Date : 2026-10-25.

---

## 1. Avant / après

### 1.1 Le bloc du bas (`index.html`, `#project-footer > .pj-panel`)

**Avant** — 4 lignes, 1 menu :

```
Assistant              (btn-superagent)
Terminal               (btn-terminal)
Lancer l'agent         (btn-terminal-cmd, pj-row-main)
Autres écrans ▾        (btn-more-screens)
```

et, dans le menu « Autres écrans » : **11 entrées** en 5 groupes, dont
`btn-explorer` (« Ouvrir le dossier ») et `btn-commands` (« Commandes du projet »).

**Après** — 6 lignes, 1 menu :

```
1. Lancer l'agent          (btn-terminal-cmd,  pj-row-main : 13 px / 600, icône --accent-text)
2. Assistant               (btn-superagent)
3. Dossier du projet       (btn-explorer)      ← REMONTÉ du menu, libellé « Ouvrir le dossier » → « Dossier du projet »
4. Terminal                (btn-terminal)
5. Commandes du projet     (btn-commands)      ← REMONTÉ du menu
6. Autres écrans ▾         (btn-more-screens)  ← toujours la dernière ligne, menu vers le HAUT
```

et le menu ne contient plus que **9 entrées**, groupes **non fusionnés** :
*Mon projet* — Prompt Builder (seule restante) ; *Comprendre* — Tableau de bord,
Graphe du projet, Historique des sessions ; *Vérifier* — Revue de code ;
*Collaborer* — Équipe d'agents, Discussion inter-projets ; *Sources* — GDS du projet.

Aucun identifiant renommé, aucun gestionnaire touché :
`btn-explorer` reste câblé dans `src/js/main.js` (ouverture du dossier projet dans
l'explorateur système), `btn-commands` dans `src/js/project-commands.js`.

### 1.2 Valeurs CSS touchées (`src/css/style.css`, `#project-footer`)

| Propriété | Avant | Après |
|---|---|---|
| `max-height` | `40%` | **`50%`** (Q3) |
| `padding` | `8px 0` | `8px 0` (**inchangé**) |
| `overflow` | `visible` | `visible` (inchangé) |
| `border` / `background` / `border-radius` | accent / accent 16 % / `--radius-lg` | **inchangés** (le cadre accent reste le seul de l'interface) |

`.pj-panel` est inchangé (`gap: 6px`) ; `.pj-panel button` est inchangé
(`width: 100%`, `height: 32px`, `padding: 0 8px`, `gap: 8px`, 12 px / `--text-secondary`,
survol `--surface-2` + `--text-primary`, appui `scale(0.97)`, `:disabled`
opacité .45, `:focus-visible` outline 2 px `--accent`) : **aucun jeton de couleur
nouveau, aucune géométrie nouvelle**. Les deux lignes remontées héritent donc
exactement des états des quatre autres (elles passent de `.pj-more-item`, 28 px,
couleur `--text-primary`, à `.pj-panel button`, 32 px, `--text-secondary`).

---

## 2. Valeurs recomptées (arithmétique, à partir des valeurs CSS)

**Hauteur du bloc** — mêmes termes que la formule du code, deux lignes de plus :

```
2 (bordures haut + bas)
+ 16 (padding 8 px × 2)
+ 6 × 32 (six lignes de 32 px)
+ 5 × 6 (cinq espaces de 6 px)
= 240 px
```

- Avant (4 lignes) : `2 + 16 + 4 × 32 + 3 × 6 = 164 px` → le commentaire « 164 px »
  du code était donc **exact** (c'est la formule du document de proposition
  `16 + 4 × 32 + 3 × 4 + 8` qui utilisait un `gap` de 4 px au lieu des 6 px réels).
- Après (6 lignes) : **240 px**, soit +76 px (+46 % par rapport au lot 3, −32 px
  par rapport aux ~272 px d'avant le lot 3).
- Plafond : 50 % de la hauteur minimale de fenêtre (`500 px`, `src-tauri/tauri.conf.json`)
  = **250 px** > 240 px → **marge de 10 px seulement**, aucune ligne hors cadre,
  aucun défilement. Conséquence à connaître : **une 7ᵉ ligne ferait déborder**
  (272 px > 250 px) — la barre est désormais à sa capacité maximale.

**Largeur** (colonne fixe 280 px, inchangée) :

```
280 − 16 (marges 8 px à gauche/droite du cadre) − 2 (bordures) = 262 px utiles
262 − 16 (padding 0 8px) − 16 (icône .icon) − 8 (gap)           = 222 px pour le libellé
```

Libellé le plus long : « Commandes du projet » (19 caractères) à 12 px
≈ 120-140 px selon la police → **aucune troncature** ; `.pj-btn-label` garde son
`text-overflow: ellipsis` comme filet. « Lancer l'agent » à 13 px / 600 ≈ 100 px.

*Estimations d'avance de police : le rendu exact reste à confirmer à l'écran
(aucune fenêtre n'a été ouverte pendant cette intervention).*

---

## 3. Écarts et points d'attention

1. **Aucun écart sur les trois décisions** : ordre, libellés et identifiants sont
   ceux demandés ; 240 px et 50 % sont atteints exactement par le calcul.
2. **Menu : 11 → 9 entrées** (deux sorties : `btn-explorer`, `btn-commands`).
   Les 5 groupes sont **conservés**, donc « Mon projet » ne porte plus qu'une
   entrée (Prompt Builder). Aucune fusion n'a été faite, comme demandé.
3. **Fichier de proposition non suivi par Git** : `docs/proposition-presentation-ui.md`
   n'a jamais été committé (`??` dans `git status`) alors que les commentaires du
   code le citent. Il est **modifié sur disque** par cette intervention (§ 3.3,
   § 5, § 6, § 8) mais **laissé non suivi**, comme les trois autres
   `docs/proposition-*.md` (dont `proposition-reglages-en-onglet.md`, lui aussi
   cité par `spec_pilot.md`) : la convention du dépôt est de ne pas committer ces
   documents de travail.
4. **Reste faux, volontairement non touché** : `docs/proposition-navigation.md`
   (document de *navigation*, antérieur) décrit encore la cible « 3 boutons +
   menu » et liste `Ouvrir le dossier` dans le menu (l. 87, 401-407, 565). Il garde
   sa valeur de proposition d'origine : c'est `docs/proposition-presentation-ui.md`
   § 3.3 qui porte désormais **l'état appliqué** et dit explicitement « les
   libellés de `proposition-navigation.md` § 4.3, moins les deux lignes remontées ».
5. **`dist/index.html`** garde l'ancien bloc : c'est un artefact de build, régénéré
   par `npm run build`.
6. **Non testé visuellement** : le rendu (alignement des libellés, absence
   d'ellipse, menu qui s'ouvre bien au-dessus du cadre) n'a pas été observé dans
   une fenêtre Pilot, faute de lancement de l'application.

---

## 4. Tests mis à jour (`src/js/lot3-colonne-bas.test.js`)

Aucun test supprimé ; les tests décrivant la barre ont été **mis à jour** et
**renforcés**.

| Test | Avant | Après |
|---|---|---|
| En-tête du fichier | « QUATRE lignes », ordre Assistant first | « SIX lignes », ordre figé Q1/Q2, Q3 documentée |
| `LIGNES` | 4 identifiants | **6** identifiants dans l'ordre demandé |
| Constante `MENU` | (absente) | **9** identifiants restés au menu |
| « entrees deplacees bien DANS le menu » | 11 entrées, bornes larges | 9 entrées **et** compte exact `pj-more-item` = 9 |
| (nouveau) « `btn-explorer` / `btn-commands` ne sont PLUS dans le menu » | — | absence dans le menu **et** présence dans le bloc |
| (nouveau) « libellés écrits en clair » | — | les 6 libellés + absence de « Ouvrir le dossier » |
| « panneau : QUATRE lignes » | `toHaveLength(4)` | `toHaveLength(6)` + ordre |
| « hauteur 164 px » | `2+16+4×32+3×6 = 164`, `max-height: 40%` | `2+16+6×32+5×6 = **240**`, `max-height: **50%**`, 240 < 250 |
| « Lancer l'agent en évidence » | « les trois autres à 12 px » | « les **CINQ** autres à 12 px » |
| Découpage de source | `pied.slice(0, pied.indexOf(…))` | `sliceSource(...)` (règle de l'inventaire `source-slice.test.js`) |

### Preuve que les tests mordent (exécutions réelles, puis restauration vérifiée)

**A. Retour à 4 lignes** (suppression des deux lignes remontées) :

```
PASS (13) FAIL (4)
  - btn-explorer : 0 occurrence(s)                → test « chaque entree existe une seule fois »
  - expected … to contain 'id="btn-commands"'     → test « … ne sont PLUS dans le menu »
  - expected [ …(4) ] to have a length of 6 but got 4 → test « SIX lignes »
  - expected … to contain '>Dossier du projet</span>' → test « libellés en clair »
```

**B. « Commandes du projet » renvoyé dans le menu** (ligne retirée du bloc,
bouton réinséré dans le groupe *Mon projet*) :

```
PASS (14) FAIL (3)
  - nombre d'entrees du menu : expected length 9 but got 10
  - expected … not to contain 'id="btn-commands"'
  - expected [ …(5) ] to have a length of 6 but got 5
```

Après chaque essai, `index.html` a été restauré depuis une copie hors dépôt et
**vérifié identique** (`diff -q` → aucune différence) ; aucune commande Git de
réinitialisation n'a été utilisée.

---

## 5. Comptes de tests

| Moment | Résultat |
|---|---|
| Baseline (avant toute modification) | `PASS (2969) FAIL (0)` |
| `src/js/lot3-colonne-bas.test.js` seul, après mise à jour | `PASS (17) FAIL (0)` (14 avant) |
| **Suite complète, après modification** | **`PASS (2971) FAIL (0)`** |

---

## 6. Documentation touchée

| Fichier | Ce qui a été corrigé |
|---|---|
| `docs/proposition-presentation-ui.md` | § 3.3 : diagramme « Cible » → **6 lignes** dans l'ordre appliqué + décisions Q1/Q2/Q3 + **hauteur recomptée 240 px / plafond 50 %** ; tableau (lignes visibles 14 → 6 dont 2 remontées, hauteur totale 240 px, ordre, groupes/libellés, icônes) ; Principe 2 (les 6 lignes à 12 px / 400, sauf la principale) ; § 5 ligne de suivi « 5 + menu, 6 lignes, 272 → 240 px » ; § 6 lot 3 (résultat visible, 9 entrées restantes) ; § 8 verdict |
| `spec_pilot.md` | § C : la ligne « 📂 Explorateur · 🖥️ Terminal · π Agent Pi · ▶ Commandes du projet · … » devient la description fidèle du bloc à **6 lignes** (ordre, menu 9 entrées, 240 px / 50 %) + une ligne « Autres accès » ; bloc `<!-- HELP:commands -->` : « depuis la ligne *Commandes du projet* du bas de la colonne » |
| `help/overview.md` | bloc `<!-- HELP:overview -->` : le « Panneau d'actions » décrit les 6 lignes et les 9 entrées du menu (l'ancien texte citait « Terminal, Agent Pi, Prévisualisation, Paramètres, badge Accès distant ») |
| `help/handbook.md` | **régénéré** (`npm run build:handbook` → 45 blocs, 261 573 octets) — jamais édité à la main |
| `index.html`, `src/css/style.css`, `src/js/sidebar.js` | commentaires faux corrigés : « quatre lignes » → « SIX lignes », « 164 px » → « 240 px », formule `2 + 16 + 6 × 32 + 5 × 6`, plafond 40 % → 50 % expliqué, « les trois autres » → « les CINQ autres » |

---

## 7. Commandes à taper

```bash
# Tests frontend (la barre du bas)
npx vitest run src/js/lot3-colonne-bas.test.js

# Suite complète
npm test

# Vérification visuelle
npm run tauri dev
```

---

## 8. Ce que cette intervention ne change pas

Bouton « Aide », bloc du haut de la colonne, bande des onglets, coin haut droit,
thèmes, libellé « Réglages », épinglage, colonne de 280 px, cadre accentué :
**tous intacts**. Aucun outil listant les sessions d'agents n'a été appelé.

---

VERDICT : les six lignes sont en place dans l'ordre demandé (Lancer l'agent · Assistant · Dossier du projet · Terminal · Commandes du projet · Autres écrans ▾), le bloc mesure exactement 240 px sous un plafond de 50 %, le menu garde 9 entrées en 5 groupes non fusionnés, les 14 identifiants et leurs gestionnaires sont intacts, les tests ont été mis à jour (et prouvés mordants sur les deux régressions visées) avec la suite complète verte à 2971 / 0.
