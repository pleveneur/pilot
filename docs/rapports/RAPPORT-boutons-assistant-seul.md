# Rapport — boutons de l'angle haut droit en mode « Assistant seul »

**Mission** : symptôme signalé par le propriétaire. En mode « Assistant seul »,
les **deux boutons du coin supérieur droit** — le point qui ouvre la liste des
agents et le ⚙ des options — étaient placés trop haut : les trois boutons
système de la fenêtre (réduire, agrandir, fermer) les chevauchaient, donc ils
étaient partiellement recouverts et difficiles à cliquer. En mode normal, le
même coin ne posait pas de problème.

---

## 1. État AVANT — la cause, avec sa preuve

### 1.1 Les deux modes ne partagent PAS la même zone

**Mode normal** — les trois boutons système sont un conteneur **dans le flux**,
dernier enfant de la rangée d'onglets :

- `index.html:304` — `<div id="window-controls">`, dernier enfant de
  `#tab-row` (`index.html:227`), avec les trois `<button>` ;
- `src/css/style.css:93` — `#window-controls { padding: 4px 4px 4px 0;
  flex: 0 0 auto; align-self: stretch; }` ;
- `src/css/style.css:117` — `#window-controls > button { width: 46px; }` ;
- `src/css/style.css:1854` — `#tab-row { min-height: 36px; }`.

Conséquence : en mode normal, la place du groupe est **réservée dans le flux**
(aucun onglet ne passe dessous), et les boutons de droite de l'onglet 🧭 vivent
**sous** cette rangée, dans leur propre barre d'outils. Aucun recouvrement
possible — le propriétaire a raison de dire que ce mode est correct.

**Mode « Assistant seul »** — l'overlay recouvre la fenêtre **mais les trois
boutons système sont peints par-dessus lui** :

- `src/js/super-agent.js:3415` — la barre du mode :
  `<div class="sa-immersive-top">` … bouton retour, titre « Pilot »,
  `[data-imm="agents"]` (le **point**), `[data-imm="settings"]` (le **⚙**) ;
- `src/css/style.css:10817` — `.superagent-immersive { position: fixed;
  inset: 0; z-index: 99990; }` : l'overlay démarre **tout en haut** (la bande
  de fenêtre de 32 px a été supprimée, cf. le commentaire `:10831` et suivants) ;
- `src/css/style.css:108` — `#window-controls { z-index: 100001; }` : les trois
  boutons **restent au-dessus** de l'overlay (c'est voulu : sans cela, Pilot ne
  serait plus fermable en mode immersif) ;
- `src/css/style.css:10849` (avant correction) — `.sa-immersive-top { height:
  58px; padding: 0 18px; }` : la barre posait ses deux boutons **à 18 px du bord
  droit, sans rien réserver**.

### 1.2 Le recouvrement, chiffré (mesures prises dans le CSS, pas à l'œil)

| Élément | Bande horizontale | Bande verticale |
|---|---|---|
| `#window-controls` (3 × 46 px + 4 px d'air droit) | de `W-142` à `W-4` | de `y=4` à `y=32` (36 px de rangée − 4 px d'air haut/bas) |
| ⚙ `[data-imm="settings"]` (`agent-btn` : icône 16 px + 10 px de marge + 1 px de bord) | de `W-56` à `W-18` | de `y≈14` à `y≈44` |
| point des agents `.sa-immersive-dot` (10 px, `padding: 0 4px`, `gap: 12px` avant le ⚙) | de `W-82` à `W-72` | centré, `y≈24` à `y≈34` |

Les deux boutons de la barre tombent **entièrement** dans la bande horizontale
du groupe système, et sur la **partie haute** de leur hauteur (18 px sur 30 px
pour le ⚙) : ils sont donc recouverts par le haut, exactement comme décrit.

### 1.3 Réponse à la question posée

Ce n'est **ni** une bande plus haute dans ce mode, **ni** une marge différente,
**ni** une zone de titre de fenêtre qui n'existerait que dans un des deux modes :
c'est une **place non réservée**. L'overlay démarre à `inset: 0` (même origine
verticale que la fenêtre) et les boutons système flottent au-dessus de lui ;
la barre du mode écrivait ses propres marges **sans tenir compte du groupe**.

---

## 2. Correction appliquée (et pourquoi elle est minimale)

**Fichier touché : `src/css/style.css` uniquement** (plus le test et la spec).

1. `:root` (`:279`) — la largeur du groupe est **nommée une seule fois** :
   `--window-controls-width: 142px`, avec le calcul écrit en clair
   (3 × 46 px + 4 px d'air) et la raison (deux blocs la lisent).
2. `.sa-immersive-top` (`:10864`) — réservation **à droite** :
   `padding: 0 calc(var(--window-controls-width) + var(--space-2)) 0 18px;`
   soit 142 px + 8 px d'air = **150 px**. Le ⚙ et le point des agents sont
   désormais **entièrement à gauche** des trois boutons système, avec 8 px d'air.

Pourquoi c'est la plus petite correction juste :

- **une seule cause traitée** : le manque de place réservée, pas la position
  verticale (la barre garde sa hauteur, les boutons restent centrés) ;
- **aucune valeur du mode normal n'est touchée** : `#window-controls`,
  `#tab-row`, `#window-controls > button` sont inchangés ;
- **aucun `z-index` modifié** (le garde-fou « la fenêtre reste fermable en mode
  immersif » est intact) ;
- **pas de `position: absolute/fixed` ajoutée** : la place est réservée dans le
  flux de la barre, comme en mode normal ;
- la largeur n'est pas recopiée en dur dans la règle : elle **cite le jeton**.

---

## 3. Ce qui ne devait pas bouger… et n'a pas bougé

| Ce qui est protégé | Vérification |
|---|---|
| Hauteur de la bande validée à l'écran | `.sa-immersive-top { height: 58px }` inchangé ; `#tab-row { min-height: 36px }` inchangé ; aucun `top:` sur `.superagent-immersive` (test dédié) |
| Colonne de gauche | aucun fichier ni règle de la colonne touchée |
| Place des boutons (haut à droite) | ordre de la barre inchangé : retour, titre, point des agents, ⚙ ; `.sa-immersive-agents { margin-left: auto }` inchangé |
| Mode normal | aucune règle du mode normal modifiée (`#window-controls`, `#tab-row`, onglet 🧭) |
| Logo, libellé du moteur, thème clair | aucun fichier concerné ; la correction n'introduit **aucune couleur** (elle ne fait que réserver de l'espace) |
| Garde-fou `z-index: 100001` | intact ; le commentaire qui l'explique est conservé |

**Écart signalé** (mission en cours sur le même coin — agrandissement du logo,
libellé du moteur, commit `89d7ad9`) : cette mission ne touche **pas** au logo
du hero ni au libellé du moteur. Aucun conflit constaté sur le disque : la
dernière mission a modifié le **bandeau du nom de projet** (colonne de gauche),
pas `.sa-immersive-top`. Il n'y a donc rien à arbitrer, et aucune de ses
décisions n'a été défaite.

---

## 4. Cas d'affichage examinés

| Cas | Résultat |
|---|---|
| Fenêtre **agrandie** (1280 px, état par défaut) | réservation constante à droite → les deux boutons restent à gauche du groupe système : **OK** |
| Fenêtre **maximisée** | la barre prend toute la largeur, le groupe reste au bout droit : la relation « 150 px réservés » ne dépend pas de la largeur : **OK** |
| Fenêtre **réduite au minimum** (`minWidth: 800`, `tauri.conf.json`) | contenu minimal de la barre ≈ 18 + 30 (retour) + 12 + ~40 (« Pilot ») + 12 + ~18 (point) + 12 + 38 (⚙) + 150 = **≈ 330 px** < 800 px : rien n'est comprimé ni tronqué : **OK** |
| **Zoom système / échelle DPI** | toutes les valeurs sont en **px CSS du même document** (boutons 46 px et réservation 142 px + 8 px) : elles changent d'échelle **ensemble**, le rapport est conservé : **OK par construction** |
| Liste des agents **dépliée** | le panneau `.sa-immersive-agents-drop` est ancré `right: 0` sur son conteneur et s'étend vers la **gauche** : il reste lui aussi à gauche du groupe système : **OK** |
| Thème **clair / sous-thèmes** | aucune couleur introduite : **OK** |

**Ce que je n'ai pas pu vérifier** : l'aspect **à l'écran** (je n'ai pas d'écran
dans cette session, et Pilot n'est pas lancé). Les chiffres ci-dessus sont
**lus dans le CSS** (`style.css:93`, `:108`, `:117`, `:1854`, `:10817`,
`:10849`) et non mesurés dans un navigateur. À confirmer visuellement en
ouvrant l'onglet 🧭 puis **Ctrl+Shift+A**, dans les cinq cas du tableau.

---

## 5. Tests

Nouveau fichier : **`src/js/barre-fenetre-assistant-seul.test.js`** (5 tests,
aucun navigateur requis). Il **n'est pas un gel de valeurs** : il **recalcule**
la largeur attendue depuis le disque.

| Test | Ce qu'il garantit |
|---|---|
| « le jeton vaut exactement l'empreinte mesurée » | `--window-controls-width` == (nombre de `<button>` de `#window-controls` dans `index.html`) × (largeur lue dans `#window-controls > button`) + (air droit lu dans `padding` du groupe) → une touche qui change de largeur, un air qui change ou un 4ᵉ bouton qui apparaît **fait échouer** le test |
| « la barre réserve cette largeur plus de l'air » | le 2ᵉ côté du `padding` de `.sa-immersive-top` cite `var(--window-controls-width)` (pas une valeur recopiée) et la place réservée **dépasse** l'empreinte (l'air demandé) |
| « la place est réservée à droite seulement » | l'air de gauche de la barre reste > 0 et plus petit que la réservation : la barre n'est pas recentrée |
| « la barre démarre toujours tout en haut » | `.superagent-immersive` garde `inset: 0` et **aucun `top:`** : aucun décalage vertical n'a été ajouté (la hauteur validée ne bouge pas) |
| « les deux boutons visés sont les derniers de la barre » | ordre retour → titre → point des agents → ⚙ : la réservation profite bien aux deux boutons signalés |

Résultats **exacts** :

```
npx vitest run src/js/barre-fenetre-assistant-seul.test.js
  PASS (5)  FAIL (0)

npx vitest run            (suite complète, anti-régression)
  PASS (3224)  FAIL (0)
```

Aucun test Rust n'est concerné (aucun fichier Rust touché) : `cargo test` n'a
donc pas été lancé.

---

## 6. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/css/style.css` | **la correction** : jeton `--window-controls-width` (`:279`) + réservation à droite de `.sa-immersive-top` (`:10864`), commentaires à jour |
| `src/js/barre-fenetre-assistant-seul.test.js` | **nouveau** : le verrou (5 tests) |
| `spec_super_agent.md` | **documentation** : nouvelle section « Technique — angle haut droit du mode « Assistant seul » » (hors bloc `HELP`, le handbook généré n'est donc pas impacté) |
| `RAPPORT-boutons-assistant-seul.md` | ce rapport |

Rien n'a été supprimé, aucun autre fichier de code n'a été modifié.

---

## 7. Ce qui reste à faire

1. **Vérification à l'œil** par le propriétaire : onglet 🧭 → **Ctrl+Shift+A**,
   puis agrandir / restaurer / réduire / maximiser, et (si possible) changer le
   zoom système — les deux boutons doivent être entièrement visibles et
   cliquables, avec de l'air à droite.
2. **Aucune publication** : commit local seulement (pas de push, pas de tag),
   conformément à la consigne.
3. Si le propriétaire juge l'air de **8 px** insuffisant, la valeur se règle en
   **un seul endroit** (`var(--space-2)` dans la règle de `.sa-immersive-top`) ;
   le test ne fige pas cette valeur, il exige seulement qu'elle soit **> 0** et
   que le jeton couvre l'empreinte.
