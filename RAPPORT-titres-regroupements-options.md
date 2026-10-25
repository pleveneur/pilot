# Rapport — Titres de regroupements de la liste de gauche des « Options » (Paramètres)

Demande du propriétaire : « la même chose pour la liste de gauche de cette même
fenêtre : les titres de regroupements qui coiffent les entrées ».

Rappel de la demande précédente (déjà traitée) : les titres de blocs du panneau
de **droite** prennent la couleur d'accent du thème (`RAPPORT-titres-blocs-parametres.md`).

---

## 1. État AVANT — les titres repérés sur le disque (recomptés par moi)

La liste de gauche est la `<nav class="settings-tabs">` de la fenêtre des
Paramètres, dans `index.html` (ligne 414). Elle contient **4 regroupements**
(et non 3) : chacun est un `<div class="settings-tabs-group-title">` posé
au-dessus de son `<div class="settings-tabs-group-items">`.

| # | Libellé écrit dans le balisage | Affiché (casse forcée) | Repère | Entrées coiffées |
|---|---|---|---|---|
| 1 | `Pilot` | PILOT | `index.html:416` | Général, Avatar |
| 2 | `IA` | IA | `index.html:423` | Agent Pi, Modèles IA, Fournisseurs, RAG, Graphe |
| 3 | `Connexions` | CONNEXIONS | `index.html:433` | Accès distant, Serveurs MCP, Service Laya |
| 4 | `Suivi` | SUIVI | `index.html:441` | Assistant |

Précisions vérifiées, pas supposées :

- Le libellé réel du 3e groupe est **« Connexions » (pluriel)** — pas
  « CONNEXION » ; l'affichage en majuscules vient de `text-transform: uppercase`,
  pas du texte écrit.
- Ces 4 titres ne sont **que** dans `index.html` : aucune occurrence dans
  `src/js/**` (aucun titre de groupe injecté par JavaScript). Vérifié par
  `grep -rn "settings-tabs-group-title"` → `index.html` (4) + `src/css/style.css`
  (1 règle) + `dist/index.html` (copie de build, non touchée).
- **Une seule règle CSS** les colore : `src/css/style.css:3316` (ligne du
  sélecteur AVANT retouche ; elle est aujourd'hui en `style.css:3326`, le
  commentaire ajouté ayant décalé le fichier de 10 lignes)
  `.settings-tabs-group-title`, avec `color: var(--text-secondary)` avant
  retouche — donc la même couleur que les entrées qu'ils coiffent
  (`.settings-tab` est aussi en `--text-secondary`). D'où l'impression que ces
  titres « ne se distinguent pas ».
- Le fond de cette liste : `.settings-tabs` **n'a pas de fond propre**, elle
  hérite du conteneur `.modal-content` → `var(--surface-floating)`
  (`style.css:2988`). Valeurs : sombre `#1c1f26` (`style.css:306`), clair
  `#ffffff` (`style.css:408`).
- Aucune variante par onglet ni par groupe : une seule règle suffit.

---

## 2. État APRÈS — ce qui a été changé

**Un seul fichier touché : `src/css/style.css`.** Une seule déclaration
change, plus un commentaire d'intention. Le balisage (`index.html`) est
**inchangé** : mêmes classes, mêmes libellés, même ordre, même structure.

```css
.settings-tabs-group-title {
  padding: 12px 12px 4px;            /* inchangé */
  font-size: var(--font-xs);         /* inchangé */
  font-weight: var(--fw-semibold);   /* inchangé (600) */
  letter-spacing: 0.04em;            /* inchangé */
  text-transform: uppercase;         /* inchangé (petites capitales) */
  color: var(--accent-text);         /* ← seule retouche : était --text-secondary */
}
```

Rien d'autre n'est modifié : ni taille, ni espacement, ni casse, ni ordre, ni
libellés, ni disposition. Le panneau de droite (déjà traité) n'est **pas**
retouché, et aucune nouvelle palette n'est créée.

---

## 3. Couleur retenue, et son origine exacte

**Jeton : `--accent-text`** — exactement celui qui colore déjà les titres de
blocs du panneau de droite (`.settings-section-title`, `style.css:3402`) et les
rubriques du menu « Autres écrans » (`.pj-more-group-label`, `style.css:1730`).

Où il est défini (**deux lignes, une par thème de base — rien d'autre**) :

- thème **sombre** : `src/css/style.css:340` → `--accent-text: #7d97ff;`
- thème **clair** : `src/css/style.css:433` → `--accent-text: #3b57d6;`

Ce que j'ai retenu, et pourquoi : **une seule décision de couleur pour tous les
titres de cette fenêtre**. Le point de décision unique est la variable de thème
`--accent-text` ; la règle CSS ne fait que la citer (`var(--accent-text)`), donc
aucune valeur hexadécimale n'est recopiée nulle part et il n'y a **aucun second
réglage à maintenir**. Je n'ai pas fusionné les trois sélecteurs
(`.settings-tabs-group-title`, `.settings-section-title`, `.pj-more-group-label`)
dans une règle commune : cela obligerait à modifier les deux règles déjà
validées (droite + menu), ce que la demande exclut explicitement ; citer le même
jeton donne le même résultat sans toucher à l'existant.

Pourquoi **pas** `--accent` : ce jeton est destiné aux **fonds** (bouton plein,
filet de l'onglet actif) ; posé en texte, son contraste tombe à 3.92:1 en thème
clair, sous le seuil AA (constat déjà documenté, `style.css:2206`).
`--accent-text` est la variante prévue pour le texte.

---

## 4. Contrastes mesurés (calculés, pas estimés)

Formule WCAG 2.x (luminance relative), fond réel de la liste de gauche.

### Thèmes de base

| Thème | Fond de la liste | Couleur AVANT (`--text-secondary`) | Couleur APRÈS (`--accent-text`) | Seuil AA texte normal (4.5:1) |
|---|---|---|---|---|
| Sombre (défaut) | `#1c1f26` | `#a0a6b4` → 6.76:1 | `#7d97ff` → **6.08:1** | ✅ |
| Clair (défaut) | `#ffffff` | `#5a6170` → 6.22:1 | `#3b57d6` → **5.97:1** | ✅ |

Lecture : dans les deux thèmes, le titre reste **au-dessus** du seuil AA et
reste **légèrement moins contrasté** que les entrées qu'il coiffe (c'est
voulu : il se distingue par la **teinte**, pas par la force — il ne « prend pas
le pas » sur les entrées). Casse et espacement inchangés : le caractère
« petites capitales discrètes » est conservé.

### Sous-thèmes (le fond change, `--accent-text` reste celui du thème de base)

| Sous-thème | Fond | Contraste APRÈS | Verdict |
|---|---|---|---|
| one-dark | `#2c313a` | 4.82:1 | ✅ |
| dracula | `#2f3240` | 4.69:1 | ✅ |
| tokyo-night | `#24283b` | 5.37:1 | ✅ |
| nord | `#3b4252` | **3.71:1** | ⚠️ sous AA (voir § 6) |
| github | `#ffffff` | 5.97:1 | ✅ |
| one-light | `#ffffff` | 5.97:1 | ✅ |
| solarized | `#fdf6e3` | 5.53:1 | ✅ |
| tokyo-day | `#ffffff` | 5.97:1 | ✅ |

Cas « Options ouvertes dans un onglet » (lot A déjà en place :
`#settings-modal.modal-in-tab > .modal-content { background: transparent; }`,
`style.css:3044-3046`) : le fond effectif devient celui de l'application
(`--bg-app`) → sombre `#0f1115` = **6.97:1**, clair `#f4f5f7` = **5.47:1**. AA
respecté dans les deux cas.

---

## 5. Vérifications effectuées

- `src/css/style.css` relu après retouche : **une seule** occurrence de
  `.settings-tabs-group-title` dans tout le fichier (pas de doublon ni de
  surcharge qui écraserait la couleur).
- `index.html` **non modifié** (4 titres, libellés intacts).
- Aucun test ne verrouille ces classes/couleurs :
  `grep -rn "settings-tabs-group-title" --include=*.test.js` → **0** occurrence ;
  `grep "settings-tab" src/js/reglages-lot-a.test.js src/js/reglages-lot-b.test.js`
  → **0** occurrence. **Aucun test n'a donc été modifié** (rien à mettre à jour).
- Aucun fichier Rust, aucune spec, aucun plan, aucune fonctionnalité, aucun
  autre écran touchés. `git diff --stat` → `src/css/style.css | 12 +++++++++++-`,
  `1 file changed`.
- Aucune couleur codée en dur ajoutée (le commentaire et la déclaration ne
  contiennent que `var(--accent-text)`).

### Résultat exact de la suite de tests

Commande : `npx vitest run` (suite complète frontend).

- **AVANT retouche** : `PASS (2932) FAIL (0)`
- **APRÈS retouche** : `PASS (2932) FAIL (0)`

Aucun écart : compteurs identiques, code de sortie 0. (Relevés par moi à
l'exécution, avant puis après.)

---

## 6. Écarts et doutes signalés — non corrigés volontairement

1. **Sous-thème `nord`** : le fond (`#3b4252`) est clair pour un thème sombre,
   et `--accent-text` garde la valeur du thème sombre de base → **3.71:1**, sous
   le seuil AA. C'est le **même** point que celui déjà signalé dans le rapport
   du panneau de droite, pas un nouveau problème. Le corriger proprement
   demanderait d'ajouter `--accent-text` dans le bloc `.theme-nord`, donc de
   **créer une couleur de palette** : hors périmètre. À décider par le
   propriétaire.
2. **Teinte sous les sous-thèmes** : `--accent-text` n'est défini que par les
   deux thèmes de base ; les sous-thèmes surchargent `--accent` mais pas
   `--accent-text`. Les titres restent donc bleu indigo sous dracula (violet) ou
   nord (cyan). Volontaire ici (lisibilité garantie, aucune palette ajoutée),
   mais si le propriétaire veut la teinte exacte du sous-thème, il faut définir
   `--accent-text` dans les 8 blocs de sous-thème — hors périmètre.
3. **Fond différent entre gauche et droite** : les titres de droite sont sur des
   cartes (`--surface-2`), ceux de gauche directement sur la fenêtre
   (`--surface-floating`). Le **jeton est identique**, les contrastes mesurés
   diffèrent donc légèrement (5.94/5.28 à droite, 6.08/5.97 à gauche). Aucune
   correction demandée : c'est le fond qui diffère, pas la décision de couleur.
4. **Vérification visuelle** : elle n'a pas été faite dans l'application lancée
   (je n'ai pas démarré `npm run tauri dev`) ; les chiffres du § 4 sont des
   contrastes **calculés** à partir des jetons réellement présents dans
   `style.css`, pas des mesures d'écran. Si le propriétaire veut un contrôle à
   l'œil, c'est une simple ouverture de ⚙️ → Options, en thème sombre puis clair.

---

## 7. Ce qui reste à faire

- Rien sur le périmètre demandé.
- Décisions ouvertes côté propriétaire : points 1 et 2 du § 6 (sous-thème nord,
  teinte des titres sous les sous-thèmes).

VERDICT : retouche appliquée et conforme — les 4 titres de regroupements de la liste de gauche des Options (Pilot, IA, Connexions, Suivi, repérés `index.html:416/423/433/441`) prennent désormais `--accent-text`, le même jeton de thème que les titres de blocs de droite, cité par une seule règle (`src/css/style.css:3326`) sans valeur en dur ; contrastes 6.08:1 en sombre et 5.97:1 en clair (AA respecté, et toujours légèrement en retrait des entrées qu'ils coiffent), taille/espacement/casse/libellés/ordre/balisage inchangés, suite `npx vitest run` verte avant comme après (2932 passés, 0 échec) ; deux points d'attention signalés sans les corriger (sous-thème nord à 3.71:1, teinte de base conservée sous les sous-thèmes).
