# Rapport — barre du bas, portrait, panneaux bleutés (écran Vocal)

> Remarques du propriétaire n° 5, 7 et 8 (`docs/rapports/REMARQUES-interface-ecran-vocal-20261003.md`),
> traitées dans l'ordre demandé : 5 (régression), 7 (portrait/portrait + cercle), 8 (panneaux).
> Version de travail : **0.6.5** — aucun bump, aucun tag, aucune publication.
> Périmètre non touché : le micro, les trois sorties (logo, Échap, fermeture d'onglet),
> la zone d'image en haut à droite, les six hôtes cliquables (issue #381).

---

## 1. Point 5 — « la barre du bas ne s'efface plus »

### 1.1 Diagnostic (avant tout correctif)

Le mécanisme d'effacement **n'est pas cassé** : il existe, il est unique, et il tourne.

| Pièce | Fichier | Ligne | Rôle |
|---|---|---|---|
| décision pure | `src/js/vocal-chrome.js` | 70–95 | cinq règles qui **interdisent** le masquage |
| minuteur unique | `src/js/super-agent.js` | 5779 | 2 500 ms, reposé à chaque geste |
| remise à zéro du geste | `src/js/super-agent.js` | 5779–5785 | le geste de pointeur expire avec le décompte (`476ba3f`) |
| faits | `src/js/super-agent.js` | 5852–5872 | état, question, saisie, micro fermé, pointeur |
| expression de visibilité | `src/js/super-agent.js` | 5886 | `vocalBare \|\| minuteur \|\| vocalChromeVisible(faits)` |
| **règle 3** | `src/js/vocal-chrome.js` | **77** | `etat === "listening" \|\| "speaking"` ⇒ **le bas reste visible** |
| fait `etat` | `src/js/super-agent.js` | **5860** | avant le correctif : `vocalChromeEtat` = l'état de l'écran, tel quel |
| état « écoute réellement » | `src/js/super-agent.js` | **5729** | `vocalMicListening && vocalMicCapte` |
| seuils de capture | `src/js/super-agent.js` | **736–737** | `VOCAL_VOICE_ON = 0,06` / `VOCAL_VOICE_OFF = 0,03` |
| plancher « voix » du projet | `src/js/vocal-mic.js` | **229** | `BARGE_IN_MIN_LEVEL = 0,05` |
| gain automatique demandé | `src/js/vocal-mic.js` | **217** | `autoGainControl: true` |
| mesure ouverte à l'entrée, gardée tout le temps | `src/js/super-agent.js` | **6616** | `requestVocalMeasure("entree")` |

**Ce qui a cessé de fonctionner.** La règle 3 n'est pas fautive en soi : le
propriétaire a demandé que le bas reste allumé « pendant l'écoute ». Ce qui a
changé, c'est la **nature du fait** qui alimente cette règle. Depuis la mesure
du niveau (lot 3, `9a8c2cf`, 2026-10-28), `listening` ne veut plus dire « le
micro est ouvert » mais « le micro **capte** », et cette capture est une
**mesure de niveau ambiant** :

1. la mesure est ouverte **à l'entrée du mode et jamais refermée**
   (`requestVocalMeasure("entree")`, 6616) : `vocalMicListening` vaut vrai
   pendant toute la session ;
2. `vocalMicCapte` sort d'un RMS comparé à deux seuils, dont la **descente
   (0,03) est inférieure au plancher de voix du projet (0,05)** — le niveau
   qu'un autre module du même écran appelle déjà « du bruit, pas de la voix » ;
3. le micro demande `autoGainControl: true` (217) : le gain automatique remonte
   le plancher de bruit jusqu'à la cible de parole, ce qui place très
   normalement une pièce silencieuse au-dessus de 0,03.

Conséquence : l'état ne revient **jamais** au repos, la règle 3 interdit le
masquage pendant toute la session, et le décompte de 2 500 ms devient
décoratif. Le décompte sonne bien, `vocalSyncChrome` recalcule, et
`vocalChromeVisible` répond encore `true`.

**Pourquoi le propriétaire ne l'a pas vu comme un défaut d'état.** Les deux
phrases sont presque identiques à l'écran : repos « Je vous écoute. », écoute
« Je vous écoute… ». Un point de suspension ne se lit pas comme « l'écran est
bloqué en écoute ».

**Pourquoi `476ba3f` n'a pas suffi.** Ce correctif a réparé la règle 4 (la
position du pointeur ne retient plus, seul le geste retient). C'était juste, et
c'est toujours vrai. Mais la règle qui bloquait **derrière** était la règle 3 :
la barre restait allumée pour une raison qui n'avait rien à voir avec la souris.
D'où l'impression que « la correction n'a rien changé ».

### 1.2 Correctif retenu (aucun second mécanisme)

Le fait donné à la règle 3 devient un **fait d'usage**, jamais une mesure :

- `speaking` — Pilot lit une réponse : le bas reste allumé (le propriétaire
  doit pouvoir couper la parole) ;
- `listening` — **seulement si un mot a été réellement transcrit** dans la
  dictée ouverte (`vocalMotRecu`), c'est-à-dire si l'utilisateur se sert
  vraiment du bas ;
- tout le reste — `idle`.

Une pièce silencieuse, un souffle de ventilateur, un gain automatique qui
remonte le plancher : plus rien de tout cela ne peut retenir le bas. Le
mécanisme d'effacement, lui, n'est **ni doublé, ni déplacé, ni réglé** : même
minuteur unique, même point d'écriture de la classe, mêmes 2 500 ms, mêmes
quatre gestes de réveil, mêmes cinq règles.

Les quatre autres retenues du propriétaire sont conservées telles quelles :
curseur dans la zone, saisie en cours (`saisie`), enregistrement
(`voiceActive`), question en attente, micro fermé (bouton de dépannage
trouvable).

### 1.3 Verrou et mutation

`src/js/vocal-barre-s-efface-au-repos.test.js` (nouveau) :

- comportemental sur la fonction pure `vocalEtatQuiRetientLeBas` :
  `listening` sans mot ⇒ `idle` ; `listening` avec mot ⇒ `listening` ;
  `speaking` ⇒ `speaking` ; `thinking`/`idle` ⇒ `idle` ;
- il vérifie que `vocalChromeVisible({ etat: "idle", … })` **n'interdit pas**
  le masquage et que `vocalSyncChrome` ne donne plus l'état brut (`etat:
  vocalChromeEtat`), seul motif qui ramènerait le défaut ;
- il vérifie qu'il n'existe qu'un seul point d'écriture de
  `.vocal-chrome-hidden`, un seul minuteur, et aucun `localStorage`.

Mutation rejouée : retour de `etat: vocalChromeEtat` dans `vocalSyncChrome` →
**le verrou échoue** (voir § 5).

---

## 2. Point 7 — cercle remonté, portrait sous le cercle

**Non livré dans ce lot.** Analyse faite, décision technique claire, exécution
reportée : c'est la seule façon de livrer les points 5 et 8 sans casser les
quatorze fichiers de verrou qui encodent la décision du 2026-10-31 (« la zone
d'image est en haut à droite »).

Ce que le déplacement engage, mesuré sur le dépôt :

| Élément | Aujourd'hui | Ce que « sous le cercle » impose |
|---|---|---|
| nœud `.vocal-portrait` + `.vocal-portrait-name` | premier contenu de `.vocal-side-tasks` (colonne 3) | enfant de la colonne centrale, sous `.vocal-orb` |
| `vocalPortraitSize` (`vocal-sides.js`) | budget pris sur la **largeur** de la colonne (96 → 277 px) | budget pris sur la **hauteur** disponible sous le disque |
| hauteur fixe de la colonne des tâches | 51 px + (12 + médaille + 8 + 20 + 12) = 51 + 148 px | 51 px seuls : la liste **gagne 148 px**, soit **+3 tâches** (46 px l'unité) |
| verrous à réécrire | `ecran-vocal-portrait.test.js`, `vocal-portrait-detache.test.js`, `vocal-sides.test.js`, `ecran-vocal-marges-transparence-portrait.test.js`, `ecran-vocal-lot2.test.js`, `ecran-vocal-zone-image.test.js`, `vocal-taches-en-haut-portrait-en-bas.test.js` | 14 fichiers citent `vocal-portrait`, 47 assertions citent `.vocal-side-tasks` |

Le portrait garde sa taille acquise (~277 px à 1280 px et au-delà, 2,89 × le
plancher de 96 px), ne se recadre pas (`object-fit: cover` sur un médaillon
rond), garde une marge réelle (12 px au-dessus, 12 px sous le nom) et ne colle
jamais un bord : la place est **prise** dans la colonne centrale, jamais
ajoutée. En état nu, le cercle et le portrait restent les deux seuls objets,
sur le même axe vertical — c'est exactement ce que demandait la remarque.

---

## 3. Point 8 — panneaux : moins opaques, et bleutés comme la zone de saisie

### 3.1 D'où vient le bleu, exactement

Le bleu qui entoure la zone de saisie n'est écrit nulle part en dur : c'est
**`--accent`** (contour du champ au focus, `.agent-input:focus { border-color:
var(--accent); box-shadow: var(--ring) }`) et sa variante de **texte**
`--accent-text`. Dix palettes les définissent (`--accent` : lignes 401, 523,
642, 673, 697, 721, 745, 769, 793, 817 de `src/css/style.css`).

Les panneaux, eux, prennent aujourd'hui `--glass-frame` (80 % du **texte
secondaire**) et `--vocal-glass` (verre à 55 %). D'où le voile gris uniforme.

### 3.2 Jetons ajoutés (aucune couleur littérale, aucun sous-thème figé)

```
--vocal-panel-frame : color-mix(in srgb, var(--accent) 55%, transparent)   (nouveau)
--vocal-panel-text  : var(--accent-text)                                    (nouveau)
--vocal-glass       : color-mix(in srgb, var(--glass-tint) 46%, transparent)   (était 55 %)
```

Le cadre des deux colonnes devient `--vocal-panel-frame`, les deux titres et
l'identité des tâches `--vocal-panel-text`, et la surface reste le verre du
thème (`background-color: var(--vocal-glass)`), simplement plus translucide.
Ce sont des variables : un changement de thème les recalcule sans redémarrage,
dans les dix palettes, y compris les sous-thèmes (`684e9f3` reste vrai).

**Un troisième jeton a été essayé, puis retiré — c'est une mesure, pas un
oubli.** Un voile bleu sur la *surface* (`color-mix(in srgb, var(--accent) 6%,
var(--vocal-glass))`) rendait le panneau franchement bleu ; au calcul il coûtait
**0,28** de contraste au texte courant (`tokyo-day` 4,67 → **4,39**) et faisait
passer `solarized` **sous son propre plancher** (3,82 → **3,59**, seuil 3,8) ;
à 9 %, ce sont les titres qui tombent à **4,37**, sous 4,5. La demande porte sur « les cadres et le texte » : le bleu se voit
là où il a été demandé, et la surface reste du verre. Le compromis est donc :
**pas de bleu de surface**, plutôt qu'un bleu qui prend la lisibilité.

### 3.3 Mesures de contraste (dix palettes, calcul WCAG)

Voile cumulé sur le fond de l'application : **0,43** (contre 0,52 avant ce lot) —
le panneau est donc plus transparent, et son cadre et ses titres sont bleus.

| Palette | Titres (`--accent-text`) | Résumé de tâche (`--text-primary`) | Secondaire (ancien titre) |
|---|---|---|---|
| sombre | 5,61 | 12,41 | 6,23 |
| one-dark | 5,33 | 5,58 | 3,75 |
| dracula | 5,06 | 10,36 | 6,10 |
| nord | 5,21 | 8,11 | 6,92 |
| tokyo-night | 5,44 | 8,49 | 6,49 |
| clair | 4,98 | 14,09 | 5,19 |
| github | 5,02 | 12,49 | 5,45 |
| one-light | 5,39 | 9,87 | 5,63 |
| solarized | 5,93 | 3,82 | 4,62 |
| tokyo-day | 5,31 | 4,67 | 3,74 |

**Le conflit, dit franchement.**

1. *Lisibilité des titres.* Le bleu (`--accent-text`) ne gagne pas partout — dans
   `clair` le gris du secondaire valait 5,19 contre 4,98 — mais il relève le
   **point faible** : le minimum passe de **3,74** (`tokyo-day`) à **4,98**
   (`clair`, `github`). Les dix palettes tiennent 4,5:1.
2. *Lisibilité du texte courant.* Elle est le vrai plancher, et elle commande :
   sous 46 % d'opacité, le panneau perd son **bord** (4,05 en `nord` pour un
   seuil de 4) et `solarized` passe sous son plancher de 3,8 (sa palette ne donne
   déjà que 4,13 sur son propre fond). C'est le verrou
   `ecran-vocal-transparence-visible.test.js` (T2/T3) qui fixe cette limite ; il
   arbitre, et ce lot s'y range : **46 %, pas moins**.
3. *Résultat du conflit* : l'opacité baisse de 55 % à 46 % (voile 0,52 → 0,43),
   le cadre et les titres prennent le bleu, et rien ne descend sous un seuil de
   lecture. Là où les deux demandes se contredisaient, c'est la transparence qui
   a cédé — jamais le texte.

### 3.4 Verrou et mutations

`src/js/vocal-panneaux-bleu-transparent.test.js` (nouveau, 10 tests) : les deux
jetons présents dans le thème de base, construits **uniquement** à partir de
`--accent`, `--accent-text`, `--glass-tint` (aucun `#hex`, aucun `rgba(`), aucun
sous-thème ne les fige, la surface reste `var(--vocal-glass)` et **aucun jeton de
voile de surface ne subsiste**, contraste des titres ≥ 4,5 sur les **dix**
palettes, texte courant au-dessus du plancher que la palette impose, bord ≥ 4 sur
les dix, voile cumulé ≤ 0,45 et verre effectivement plus transparent qu'avant.

Deux mutations rejouées (puis restaurées, `git diff` vérifié) :

| Mutation | Effet |
|---|---|
| `--vocal-panel-text: var(--text-secondary)` | **2 échecs** : le jeton ne dérive plus du bleu, et les titres tombent à **3,66** en `one-dark` (< 4,5) |
| `--vocal-glass` remis à 55 % | **1 échec** : le verre n'est plus plus transparent qu'avant |

---

## 4. Ce qui n'a pas bougé

micro (`vocal-mic.js`), trois sorties, zone d'image, six hôtes cliquables,
géométrie de `.vocal-input` (`width: min(720px, …)`, `margin: 0 auto 16px`),
`VOCAL_CHROME_IDLE_MS = 2500`, `VOCAL_CHROME_MOVE_PX = 4`, la règle
`pointer-events` de fin de section, les quatre gestes de réveil, l'état nu
(`vocal-bare`) et son bouton.

## 5. Preuves — les mutations rejouées

Chaque verrou a été **cassé exprès**, dans le vrai source, puis restauré (sauvegarde
`.pi/tmp-style.bak`, `git diff` relu après restauration).

### 5.1 Point 5 — retour de l'état brut

Mutation : dans `vocalSyncChrome`, le fait redevient ce qu'il était.

```js
etat: vocalChromeEtat,          // ← au lieu de vocalEtatQuiRetientLeBas({…})
```

Résultat : **2 échecs sur 11** dans `vocal-barre-s-efface-au-repos.test.js` (dont
celui qui nomme le défaut : « la barre ne s'efface plus »), **9 passent**. Restauré :
`git diff --stat src/js/super-agent.js` = **13 insertions, 1 suppression** — le
correctif seul, rien d'autre.

### 5.2 Point 8 — le bleu des titres, puis deux opacités de verre

| Mutation | Résultat | Ce que le verrou attrape |
|---|---|---|
| `--vocal-panel-text: var(--text-secondary)` | **2 échecs** | le jeton ne dérive plus du bleu **et** les titres tombent à **3,66** en `one-dark` (< 4,5) |
| `--vocal-glass` remis à **55 %** | **1 échec** | le verre n'est plus plus transparent qu'avant (0,55 ≠ 0,46) |
| `--vocal-glass` **42 %** | **1 échec** | `nord` : bord **3,87** < 4 — « plus aucun panneau » |
| `--vocal-glass` **40 %** | **2 échecs** | `nord` bord **3,68** < 4 **et** `solarized` **3,79** < 3,8 |

### 5.3 Ce que la mutation n'a pas cassé

Après restauration, la suite entière repasse : **4 932 tests, 0 échec** (§ 6). Aucun
test existant n'a été supprimé, et les trois tests retouchés pour suivre le jeton
(`cadre-listes-panneaux.test.js`, `ecran-vocal-marges-transparence-portrait.test.js`,
`panneaux-translucides-theme.test.js`) **vérifient davantage qu'avant** : le cadre doit
désormais dériver de `--accent`, rester `transparent`, et ne contenir aucune couleur
littérale — trois assertions qui n'existaient pas.

---

## 6. Résultat des vérifications

### 6.1 Comptes exacts

| Commande | Résultat |
|---|---|
| `npx vitest run` (suite entière) | **PASS 4 932 · FAIL 0** |
| `vocal-barre-s-efface-au-repos.test.js` (point 5) | PASS 11 · FAIL 0 |
| `vocal-panneaux-bleu-transparent.test.js` (point 8) | PASS 10 · FAIL 0 |
| `ecran-vocal-transparence-visible.test.js` (autorité du plancher, **inchangé**) | PASS 10 · FAIL 0 |

### 6.2 Valeurs réellement retenues

| Point | Valeur | Où |
|---|---|---|
| 5 | délai de remasquage **2 500 ms** (inchangé) ; règle 3 retient sur **parole** toujours, **écoute** seulement si un mot a été transcrit | `vocal-chrome.js` `vocalEtatQuiRetientLeBas`, appelé `super-agent.js:5860` |
| 8 | verre **46 %** (voile cumulé **0,43**, contre 0,52) ; cadre `--vocal-panel-frame` = 55 % d'`--accent` ; texte des titres `--accent-text` | `style.css`, `.pilot-vocal` |
| 8 | titres **4,98:1** au pire sur les dix palettes (contre **3,74:1** pour le texte secondaire qu'ils remplacent) ; bord **4,24:1** au pire ; texte courant **3,82:1** (`solarized`, plancher propre) | mesuré, voir § 3.3 |

### 6.3 Compromis assumés, avec leurs chiffres

1. **Point 7 n'est pas livré** (§ 2). Le porter dans ce lot imposait de réécrire
   **14 fichiers de verrou** et de déplacer un budget de taille calculé sur une
   largeur de colonne vers une hauteur sous le disque : le risque était de livrer
   trois points à moitié plutôt que deux justes. La décision est documentée, chiffrée,
   et se livre seule.
2. **Le bleu ne va pas sur la surface des panneaux.** À 6 % il coûtait **0,28** de
   contraste au texte courant et faisait passer `solarized` sous son plancher
   (**3,59** pour 3,8) ; à 9 %, les titres tombaient à **4,37**. Cadres et texte
   portent le bleu, la surface reste du verre de thème.
3. **46 % est le plancher, pas un choix esthétique** : à 44 % le bord tombe à
   **4,05** en `nord` (il faut 4), à 42 % à **3,87**. On ne descend pas plus bas sans
   que le panneau cesse d'exister comme panneau.
4. **`solarized` reste à 3,82:1** pour le texte courant : sa palette ne donne que
   **4,13:1** sur son propre fond. Aucune transparence ne peut rendre un texte plus
   lisible que la palette qui le porte, et la lisibilité gagne — on ne compense pas
   en assombrissant la teinte.

---

## 7. Où la spécification et l'aide ont suivi

- `spec_modes_ecran_vocal.md` : § 4bis (correctif de la règle 3, fait d'usage et non
  mesure), § « Le cadre des panneaux » (jeton bleu), § « La transparence qu'on voit »
  (46 %, plancher de bord, voile bleu écarté et pourquoi), tableau du code et liste
  des verrous.
- `docs/conceptions/CONCEPTION-ecran-vocal-cercle-et-bas.md` : § 2.3 règle 3 et § 2.5
  (dictée).
- `help/overview.md` : la phrase qui dit ce que la barre retient — et ce qu'elle ne
  retient plus ; `help/handbook.md` régénéré (`npm run build:handbook`).
