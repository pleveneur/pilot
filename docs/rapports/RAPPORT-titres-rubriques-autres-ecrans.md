# Rapport — Titres de rubriques de la liste « Autres écrans »

Demande du propriétaire (mots exacts) : « Pareil pour la liste “Autres écrans” qui apparaît quand on clique en bas à droite. Les titres de chaque rubrique devraient être dans une autre couleur, comme précédemment. »

Contexte : la même retouche vient d'être faite sur les titres de blocs des Paramètres
(commit `ead5d2e`, rapport `RAPPORT-titres-blocs-parametres.md`). Il s'agit ici de la
**réutiliser**, pas d'en inventer une seconde.

---

## 1. État AVANT — le panneau repéré, vérifié sur le disque

### Où il est construit

- **Balisage** : `index.html:127-166` — commentaire de bloc « MENU “Autres écrans” (lot 3 de
  la presentation) » puis le menu lui-même :
  - déclencheur `#btn-more-screens` : `index.html:139` (bouton de la dernière ligne du bloc
    du bas de la colonne de gauche, libellé « Autres écrans » + chevron) ;
  - panneau `#pj-more-menu` : `index.html:140` (`class="pj-more-menu hidden"`, `role="menu"`) ;
  - rubriques = `div.pj-more-group-label` (avec `role="group"` parent `div.pj-more-group`
    et `aria-labelledby` vers le libellé).
- **Comportement** : `src/js/sidebar.js:1627-1660` (ouverture vers le haut, Échap, clic
  extérieur, fermeture à la sélection). **Aucun titre n'est généré en JavaScript** :
  `grep "pj-more-group-label" src/js/*.js` ne renvoie que le fichier de test
  `lot3-colonne-bas.test.js` (qui les compte et les mesure, sans en créer).
- **Style** : une seule règle, `src/css/style.css:1717` (avant retouche) →
  `.pj-more-group-label { padding: 8px 8px 4px; color: var(--text-secondary); … }`.

### Les 5 titres de rubriques (`index.html:ligne`)

| Rubrique | Repère | Identifiant de l'`aria-labelledby` |
|---|---|---|
| Mon projet | `index.html:142` | `pj-more-groupe-projet` |
| Comprendre | `index.html:148` | `pj-more-groupe-comprendre` |
| Vérifier | `index.html:154` | `pj-more-groupe-verifier` |
| Collaborer | `index.html:158` | `pj-more-groupe-collaborer` |
| Sources | `index.html:164` | `pj-more-groupe-sources` |

Une **seule classe** (`.pj-more-group-label`) pour les cinq : une seule règle CSS suffit,
aucune rubrique ne peut rester en arrière.

### Ce qui devait continuer à fonctionner (et fonctionne toujours)

Identifiants et fonctions des 14 entrées (`btn-explorer`, `btn-commands`,
`btn-prompt-builder`, `btn-dashboard`, `btn-code-graph`, `btn-history`, `btn-review`,
`btn-agents`, `btn-superkanban`, `btn-interproject`, `btn-gds`, `btn-superagent`,
`btn-terminal`, `btn-terminal-cmd`), ouverture vers le haut (`bottom: calc(100% + 4px)`),
plafond `max-height: 60vh`, fermeture à Échap / clic extérieur, cadre accent du bloc,
largeur du cadre, `role="menu"` / `role="group"` / `aria-*`.

**État AVANT de la couleur** : les titres de rubriques prenaient `--text-secondary`
(`#a0a6b4` en sombre, `#5a6170` en clair) — la même couleur que le texte secondaire du
menu (icônes des lignes). Ils ne se lisaient donc pas comme des titres.

---

## 2. Couleur retenue — et son origine exacte

**Variable : `--accent-text`** — exactement celle retenue pour les titres de blocs des
Paramètres (`.settings-section-title`, `src/css/style.css:3392`). **Aucune seconde couleur
introduite, aucune nouvelle palette.**

Origine du jeton (déjà défini par le thème, jamais recopié) :

| Portée | Repère | Valeur |
|---|---|---|
| Thème sombre | `src/css/style.css:340` | `--accent-text: #7d97ff;` |
| Thème clair | `src/css/style.css:433` | `--accent-text: #3b57d6;` |

Le CSS documente ce jeton comme « l'accent quand il porte du TEXTE » (`style.css:334`) et
il est déjà employé pour les onglets spéciaux (`style.css:2209-2218`), l'icône de la ligne
principale du bloc du bas (`style.css:1645`) et les titres de blocs des Paramètres
(`style.css:3392`).

Choix assumé de **ne pas** prendre `--accent` : ce jeton sert aux fonds/filets ; posé en
texte il descend sous le seuil AA en thème clair (mesuré et documenté au lot 1 de la
présentation).

### Solution retenue pour « un seul endroit décide de la couleur »

**Une seule variable partagée** (`--accent-text`), et non une nouvelle variable dédiée ni
une règle commune groupée. Pourquoi :

- `--accent-text` est **déjà** le jeton unique du produit pour « l'accent qui porte du
  texte » ; il n'est défini qu'à **un endroit par thème** (`style.css:340` et `:433`), donc
  changer la teinte des deux endroits se fait bien en une seule ligne par thème ;
- créer un jeton intermédiaire (`--titre-rubrique: var(--accent-text)`) aurait ajouté une
  couche d'indirection et une couleur de plus dans la palette — explicitement hors
  périmètre (« ne pas créer de nouvelle palette ») ;
- une règle groupée `.settings-section-title, .pj-more-group-label { color: … }` aurait
  cassé la lecture des deux blocs (deux composants éloignés dans le fichier, chacun avec
  son commentaire) sans rien garantir de plus : la valeur resterait écrite deux fois.

Les deux sélecteurs référencent donc **le même jeton de thème**, sans aucune valeur littérale.

---

## 3. Rendu attendu — thème par thème (contraste calculé, pas estimé)

Fond réel du menu = `var(--surface-2)` (`style.css:1709`) ; fond des cartes de réglages =
`var(--bg-input)` = `var(--surface-2)` (`style.css:367`, `:460`) — **le même fond**, donc
les mêmes chiffres que pour les Paramètres.

| Thème | Fond du menu | Couleur du titre | Contraste | Seuil AA (4.5:1) |
|---|---|---|---|---|
| Sombre (défaut) | `#1e2128` | `#7d97ff` | **5.94:1** | ✅ |
| Clair (défaut) | `#f0f1f4` | `#3b57d6` | **5.28:1** | ✅ |

Pour mémoire, l'ancienne couleur : `--text-secondary` donnait 6.60:1 en sombre et
5.50:1 en clair — lisible, mais *indifférenciée* du texte secondaire : c'est ce que la
demande corrige.

Sous-thèmes (le fond change, `--accent-text` reste celui du thème de base) :

| Sous-thème | Fond | Contraste | Verdict |
|---|---|---|---|
| one-dark | `#2c313a` | 4.82:1 | ✅ |
| dracula | `#2f3240` | 4.69:1 | ✅ |
| tokyo-night | `#24283b` | 5.37:1 | ✅ |
| nord | `#3b4252` | **3.71:1** | ⚠️ sous AA (voir §6, déjà signalé pour les Paramètres) |
| github | `#f0f3f6` | 5.36:1 | ✅ |
| one-light | `#f0f0f0` | 5.23:1 | ✅ |
| solarized | `#eee8d5` | 4.87:1 | ✅ |
| tokyo-day | `#e9e9f0` | 4.94:1 | ✅ |

Hiérarchie visuelle **inchangée** : `font-size: var(--font-xs)` (11 px),
`font-weight: var(--fw-semibold)` (600), `text-transform: uppercase`,
`letter-spacing: 0.04em`, `padding: 8px 8px 4px` — **aucune** de ces déclarations n'a bougé.
Seule la couleur change : le titre se distingue du texte courant sans devenir criard.

---

## 4. État APRÈS — modification exacte

### Fichiers touchés

1. **`src/css/style.css`** (règle `.pj-more-group-label`, `style.css:1717-1736`) :

```css
/* En-tete de groupe — le TITRE de chaque rubrique du menu « Autres ecrans » … */
.pj-more-group-label {
  padding: 8px 8px 4px;
  color: var(--accent-text);   /* ← seule vraie retouche : était --text-secondary */
  font-family: var(--font-ui);
  font-size: var(--font-xs);
  font-weight: var(--fw-semibold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
```

2. **`src/js/lot3-colonne-bas.test.js`** (test « lignes de 28 px, icone secondaire,
   en-tete de groupe accentue ») : le test **verrouillait la couleur** avec
   `expect(g).toContain("color: var(--text-secondary)")`. Il aurait donc échoué. Son
   attente est alignée sur la décision du propriétaire (`color: var(--accent-text)`) et
   commentée (même règle que `.settings-section-title`, taille/graisse/casse/espacement
   du lot 3 conservés). **Aucun autre test n'a été touché**, aucune assertion n'a été
   supprimée : les verrous de structure (14 identifiants, ouverture vers le haut, Échap,
   cadre accent, « aucune couleur écrite en dur ») sont **intacts** — et ce dernier passe
   toujours, `--accent-text` étant un jeton, pas une valeur en dur.

**Balisage : non modifié.** `index.html` est inchangé (aucune retouche nécessaire : la
classe existe déjà sur les cinq titres). Aucun fichier Rust, aucune spec, aucun plan,
aucun autre écran, aucune fonctionnalité.

---

## 5. Vérifications

- `grep -n "pj-more-group-label" src/css/style.css` → **1** occurrence (la règle retouchée) :
  pas de doublon ni de surcharge ailleurs, donc les **5** titres en héritent.
- `grep -n -e "--accent-text" src/css/style.css` → définitions uniquement aux lignes
  `340` (sombre) et `433` (clair) ; usages `1645` (icône ligne principale du bloc),
  `2209/2214/2218` (onglets spéciaux), `1730` (ce panneau), `3392` (Paramètres).
- Contrastes recalculés par script (fond `surface-2` vs `accent-text`) : voir § 3 —
  **5.94:1** en sombre, **5.28:1** en clair.
- Suite de tests frontend complète, compteurs relevés par moi-même en exécution réelle.
- Aucun code Rust touché → compilation Rust non concernée (pas lancée).

### Résultat exact des tests

Commande : `npx vitest run` (suite complète, lancée depuis la racine après la retouche)

```
PASS (2932) FAIL (0)   — code de sortie 0
```

- **2932 tests passés, 0 échec, exit 0.** Aucun écart par rapport à l'état d'avant
  (même total de 2932, la retouche porte sur une assertion existante, pas sur un nouveau
  test).
- Aucun test n'a été contourné ni désactivé.

---

## 6. Écarts et doutes signalés (non corrigés volontairement)

1. **Sous-thème « nord »** : `--accent-text` (#7d97ff, valeur du thème sombre de base) sur
   le fond `--surface-2` de nord (#3b4252) donne **3.71:1**, sous le seuil AA pour du
   texte de 11 px. C'est **le même point déjà signalé** pour les titres des Paramètres
   (`RAPPORT-titres-blocs-parametres.md` § 6.1) : je ne le corrige pas seul, car corriger
   demanderait d'ajouter `--accent-text` au bloc `.theme-nord` (ajout d'une couleur à la
   palette = hors périmètre) ou de changer la taille du titre (interdit).
2. **Teinte sous les sous-thèmes** : les sous-thèmes surchargent `--accent` mais pas
   `--accent-text` — les rubriques restent donc dans la teinte du thème de base (bleu
   indigo) même sous dracula (violet) ou nord (cyan). Volontaire (lisibilité, pas de
   nouvelle palette). Décision ouverte côté propriétaire, identique au point 2 du rapport
   des Paramètres.
3. **Emplacement du déclencheur** : la demande dit « quand on clique en bas à droite ».
   Le déclencheur `#btn-more-screens` est en réalité la dernière ligne du bloc du **bas de
   la colonne de gauche** (`#project-footer`, `index.html:139`), et le menu s'ouvre **vers
   le haut**. Vérifié qu'il n'existe **aucun autre** panneau du même nom ni aucune autre
   liste de rubriques dans l'interface (`grep "Autres écrans"`, `grep "group-label"`) : le
   panneau visé est bien celui-là. Si le propriétaire pensait à un autre écran, il faut le
   dire — je n'ai rien retouché ailleurs.
4. **Le libellé des rubriques en majuscules** (`text-transform: uppercase`) est conservé
   tel quel : le passer en casse normale changerait la hiérarchie validée au lot 3, ce qui
   est hors de la demande (« sans changer la taille, l'espacement ni la disposition déjà en
   place »).

---

## 7. Ce qui reste à faire

- Rien sur le périmètre demandé.
- Décisions ouvertes côté propriétaire : points 1 et 2 du § 6 (sous-thème nord ;
  teinte des titres sous les sous-thèmes) — à trancher **ensemble** pour les Paramètres et
  les Autres écrans, puisqu'ils partagent désormais le même jeton.
- Point 3 du § 6 : confirmer que c'est bien ce panneau qui était visé.

VERDICT : retouche appliquée et conforme — les 5 titres de rubriques de la liste « Autres écrans » portent désormais `--accent-text`, exactement le même jeton de thème que les titres de blocs des Paramètres (une seule variable partagée, rien de codé en dur, aucune nouvelle palette), lisibles en clair (5.28:1) comme en sombre (5.94:1), taille/graisse/casse/espacement/balisage et les 14 entrées du menu inchangés ; `npx vitest run` vert (2932 passés, 0 échec, exit 0) après alignement d'une seule assertion qui verrouillait l'ancienne couleur ; deux points d'attention déjà connus signalés sans les corriger (sous-thème nord à 3.71:1, teinte de base sous les sous-thèmes).
