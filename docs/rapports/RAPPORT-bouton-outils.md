# Rapport — le bouton « Outils » et son menu « Autres outils »

Date : 2026-10-27 · Projet : `G:\IA_PL\pilot` (front-end Tauri + JS, tests Vitest)
Demande du propriétaire, en un seul lot borné : renommer le bouton `Action` en
**« Outils »** et son menu en **« Autres outils »**, faire **disparaître le
bouton tant que le menu est ouvert**, le faire **revenir exactement comme
avant** à la fermeture, **sans saut de mise en page**, et **ne rien casser
d'autre**.

---

## 1. Ce qui change à l'écran

| Endroit | Avant | Après |
|---|---|---|
| Ligne du bloc du bas | `Action` | **`Outils`** (au pluriel) |
| Infobulle de la ligne (`title`) | `Action — le bloc s'ouvre au survol : …` | `Outils — le bloc s'ouvre au survol : …` (les six autres lignes sont toujours nommées) |
| Nom accessible du bouton (`aria-label`) | `Action — autres écrans du projet` | `Outils — autres outils du projet` |
| Titre du menu déployé (`aria-label`) | `Autres écrans` | **`Autres outils`** |
| Menu ouvert | le bouton restait affiché | **le bouton s'efface** ; le menu prend sa place |
| Menu refermé | — | le bouton **revient tel quel**, à la même place |
| Aide de première ouverture | « première ligne du menu « Action » » | « première ligne du menu « **Outils** » » |

Rien d'autre ne change : contenu du menu, ordre des dix entrées, groupes,
identifiants (`#btn-more-screens`, `#pj-more-menu`, `btn-terminal-cmd`…),
couleurs, animations, réglages, mode Vocal, cercle des agents, dictée, lecture à
voix haute, rangement des documents.

---

## 2. La décision technique : effacer la peinture, jamais la place

Le renommage ne pose aucun problème. La disparition du bouton, si.

Le bouton est la **dernière ligne** du bloc du bas, et le menu s'ouvre **vers le
haut**, ancré sur le conteneur `.pj-more-wrap` (`bottom: calc(100% + 4px)`). Trois
façons de le masquer étaient possibles :

| Moyen | Effet sur la place | Verdict |
|---|---|---|
| `display: none` | la ligne de **32 px** disparaît : le bloc se réduit, le menu **descend de 32 px** à l'ouverture | **refusé** (saut visible) |
| `visibility: hidden` | la place est conservée, mais l'élément devient **non focalisable** : le focus quitte le bouton, `Tab` repart du début du document, `Échap` ne peut plus rendre le focus au déclencheur | **refusé** (clavier cassé) |
| `opacity: 0` + `pointer-events: none` | la place est conservée **et** le bouton reste focalisable ; il ne peint plus rien et n'est plus une cible de clic | **retenu** |

La règle ajoutée est donc, et c'est tout :

```css
#btn-more-screens.open {
  opacity: 0;
  pointer-events: none;
}
```

avec, juste au-dessus, le commentaire qui dit pourquoi (le fichier de styles est
la mémoire du projet sur ce point).

**Aucun JavaScript nouveau.** L'état du menu est écrit à **un seul endroit**,
`setOuvert` dans `_initProjectFooterMenu` (`src/js/sidebar.js`) : il pose et
retire la classe `hidden` du panneau, puis la classe `open` du bouton et
`aria-expanded`. La classe `open` était déjà là (elle retourne le chevron) : la
règle CSS s'y accroche, donc **un seul état, un seul écrivain, aucun drapeau
parallèle**. `open` tombe **en même temps** que le menu se ferme — le retour du
bouton est structurel, pas un rattrapage.

`pointer-events: none` mérite d'être dit : la ligne invisible n'est pas une cible
de clic fantôme. Un clic à cet endroit traverse jusqu'au panneau, donc il compte
comme un **clic extérieur** et ferme le menu — exactement ce que faisait avant un
second clic sur le bouton.

---

## 3. LE PIÈGE PRINCIPAL — la zone de survol qui maintient le menu ouvert

**Le piège était réel, et il ne s'est pas refermé sur nous : il ne fallait rien
corriger, mais il fallait le vérifier.**

La surface qui garde le menu ouvert n'est **pas le bouton** : c'est le cadre
`#project-footer`, tenu par `src/js/sidebar-footer-fold.js`. Une lecture ligne à
ligne du module donne trois faits qui décident de tout :

1. **le survol est écouté sur le cadre** (`#project-footer`), pas sur ses lignes :
   effacer une ligne ne retire aucune surface de survol ;
2. l'état « menu ouvert » du repli est **`!menu.classList.contains("hidden")`** —
   la **vraie** classe du panneau, jamais la classe `open` du bouton. Le module ne
   contient même pas le mot `open` ; il ne peut donc pas croire que le menu est
   fermé parce que le bouton a cessé de se peindre ;
3. le compte des lignes visibles se fait, lui aussi, sur `hidden` et
   `.closest(".hidden")` : la ligne « Outils » **reste comptée** (seule sa
   peinture a disparu), donc les hauteurs mesurées pendant l'animation de
   déploiement sont **identiques** à avant.

Conséquence vérifiée : la zone de survol est **intacte**, l'état du repli est
**inchangé**, la sortie de souris referme le menu **comme avant** (le repli
appelle `this._fermerMenuAutresEcrans`, donc la fermeture et le retour du bouton
sont la même décision), et le `focus` clavier reste **dans** le cadre, ce qui
empêche le repli de se déclencher tant que le menu vit.

Ce que le lot a demandé dans ce fichier : **rien**, sinon deux commentaires
remis au nouveau nom du menu (aucune ligne de logique touchée).

---

## 4. Le seul effet de bord assumé (et sa justification)

Pendant que le menu est ouvert, le bouton reste **focalisable** mais **invisible** :
un utilisateur au clavier qui vient d'ouvrir le menu garde le focus sur une ligne
qui ne se peint plus (son anneau de focus n'est donc pas visible **à cet instant
précis**). C'était le prix du maintien du clavier : `visibility: hidden` aurait
supprimé le focus et cassé la boucle `Tab → menu → Échap → retour au
déclencheur`. La première touche `Tab` amène dans le menu, où le focus est de
nouveau visible ; `Échap` referme, rend le focus au bouton **et le fait
revenir** dans le même geste.

---

## 5. Tests

**Nouveau verrou** — `src/js/bouton-outils.test.js` (11 tests) :

- **(a) les deux libellés** : `<span class="pj-btn-label">Outils</span>` présent,
  aucun ancien libellé (`Action`, `Actions`, `Autres outils` recopié sur la
  ligne) ; `title` **et** `aria-label` du bouton commençant par `Outils —`
  (l'infobulle continue de nommer les six autres lignes) ; `role="menu"
  aria-label="Autres outils"` et **plus aucun** `aria-label="Autres écrans"` ;
  texte d'aide de première ouverture passé à « Outils » ; identifiants et
  `aria-controls` conservés.
- **(b) le bouton masqué menu ouvert** : la règle `#btn-more-screens.open` existe,
  contient `opacity: 0`, et **ne déclare que** `opacity` et `pointer-events` —
  aucune propriété de mise en page (`display`, `visibility`, `height`, `width`,
  `margin`, `padding`, `position`, `top`, `bottom`, `inset`, `flex`,
  `font-size`, `transform`) ; la ligne garde ses **32 px**
  (`.pj-panel button`), `.pj-more-wrap` reste `position: relative` **sans**
  hauteur et le menu garde son ancre `bottom: calc(100% + 4px)` ; pas de `:has()`
  (non disponible sur toutes les webviews du projet).
- **(c) le retour à la fermeture** : **une seule** écriture de la classe `open`
  dans la méthode (`classList.toggle("open", ouvert)`, donc pose **et** retrait),
  écrite **après** celle du panneau ; `aria-expanded` sur la même variable ; les
  **trois** fermetures (ligne choisie, clic extérieur en phase de capture,
  `Échap` avec retour du focus) passent par la **même** fonction `fermer` ; la
  zone de survol du repli ne lit **jamais** `open` et garde
  `_fermerMenuAutresEcrans`.

**Tests adaptés** (ils verrouillaient les anciens mots) :
`src/js/lot3-colonne-bas.test.js` (libellé de la ligne + commentaires) et
`src/js/repli-menus-bas.test.js` (début de l'infobulle, libellé affiché,
commentaires).

---

## 6. Documentation mise à jour

| Fichier | Ce qui change |
|---|---|
| `spec_pilot.md` § C | « Outils ▾ », menu **« Autres outils »**, et la phrase qui dit que la ligne s'efface menu ouvert **sans** toucher à la place (classe `open`, `opacity`, pas de `display`) |
| `spec_help.md` § 5 | même état de référence, en deux phrases |
| `help/overview.md` | texte utilisateur : « Outils ▾ » / « Autres outils » (quatre passages) **+** la phrase « pendant que le menu est ouvert, la ligne « Outils » elle-même s'efface » |
| `index.html` (commentaires) | la décision, le piège de la hauteur et la règle CSS sont écrits à l'endroit où la ligne est déclarée |

`help/handbook.md` est **régénéré** par `npm run build:handbook` (jamais édité à
la main).

---

## 7. Vérifications

Compteurs réels de la suite complète (`npx vitest run`), sortie brute :

```
PASS (3906) FAIL (0)
```

Détail du même passage (rapport JSON de Vitest) :

| Mesure | Valeur |
|---|---|
| fichiers de test | **212** |
| suites | **1227** |
| tests | **3906** |
| réussis | **3906** |
| échoués | **0** |
| code de sortie | **0** |

`npm run build:handbook` a été relancé après la mise à jour des textes :
`help/handbook.md` est régénéré (46 blocs, 289 602 octets) et suit exactement les
mêmes phrases que `help/overview.md` / `spec_help.md`.

Les tests ciblés du lot, dans le même passage :
`src/js/bouton-outils.test.js` (11 tests), `src/js/lot3-colonne-bas.test.js`,
`src/js/repli-menus-bas.test.js` — tous verts.

Aucun test n'a été supprimé pour faire passer le lot. Aucune garde-fou n'a été
contourné, aucune commande de nettoyage ou de réinitialisation Git n'a été
lancée.
