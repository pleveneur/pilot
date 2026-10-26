# RAPPORT — Repli des menus du bas, LOTS 2 a 4 (clavier, toucher, mouvement reduit)

> Mission : reprendre le repli de `#project-footer` apres le **LOT 1** (commit
> `c760a8d`), en traitant les **LOTS 2, 3 et 4** de
> `RAPPORT-conception-repli-menus-bas.md` § 6, **sans refaire ce qui existe**.
> Documents lus en lecture seule avant toute ecriture : la conception
> (`RAPPORT-conception-repli-menus-bas.md`) et `RAPPORT-repli-menus-bas-lot1.md`.
> Date : 2026-10-27.

---

## 1. Constat RECOMPTE sur le disque (avant toute ecriture)

Je n'ai pas fait confiance aux rapports : j'ai relu le disque, puis j'ai compte.

| Element concu | Ce que j'ai trouve reellement | Verdict |
|---|---|---|
| LOT 1 — hauteur repliee recalculee, ancre en bas, `.pj-panel` incompressible, rognage dans la seule regle d'etat, infobulle Q2 | tout present (`src/css/style.css` `#project-footer` / `.pj-replie` / `.pj-panel`, `index.html` ligne 143 et 180, module `src/js/sidebar-footer-fold.js`) | **conforme, non refait** |
| LOT 2 — clavier : `focusin` deploie **sans animation**, `scrollTop = 0`, `focusout` arme le sursis de 300 ms, `Echap` ne double jamais le menu (ecoute en **capture**), focus rendu a la ligne visible | **deja ecrit** dans le module (LOT 1 l'avait livre en avance, ecart n°1 deja signale) ; 4 cas de test existants (`LOT 1 (g)` et `LOT 1 (j)`) | **code non refait** — **verrou du PARCOURS COMPLET manquant** |
| LOT 3 — toucher (Q1 : premier appui = deploiement seul) | **absent** : aucune ecoute de `pointerdown` / `pointerType` dans le module | **a faire** |
| LOT 4 — mouvement reduit : decision JS (`mouvementCoupe`, delais conserves) | **present et verrouille** (`LOT 1 (h)`, `LOT 1 (j)`) | conforme, non refait |
| LOT 4 — **classe `no-motion` + regle CSS** `#project-footer.no-motion { transition: none }` | **absente** : ni la classe dans le module, ni la regle dans `style.css` (le LOT 1 avait traite la seule decision JS) | **a faire** |
| Hauteur repliee = 50 px recalculee depuis le CSS, 7 lignes, plafond 60 %, `overflow: visible` de base | conformes | recontrôles par les tests, non touches |

**Conclusion du recomptage** : un seul lot etait entierement livre (LOT 1), un lot
etait livre **sans son verrou de parcours** (LOT 2), un lot etait **absent**
(LOT 3), un lot etait **a moitie livre** (LOT 4 : decision en JS, rien dans la
feuille de style).

---

## 2. Gestes faits

### 2.1 LOT 2 — le parcours clavier COMPLET est verrouille (aucun code de production touche)

Le code du clavier etait deja la. **Je n'en ai pas reecrit une ligne** : ce qui
manquait, c'est la preuve du **parcours entier** (et pas celle de ses morceaux).
Cinq cas ajoutes dans `src/js/repli-menus-bas.test.js` (`describe "LOT 2 (m)"`) :

1. **`du premier Tab a la sortie`** : `Tab` dans le bloc replie → deploiement
   immediat, **aucune hauteur en pixels posee** (donc aucune animation),
   `scrollTop = 0` ; focus porte sur la **ligne d'ancrage** → toujours deplie ;
   la ligne est activee → le menu s'ouvre → le focus **entre** dans le menu et
   **circule** sur ses deux lignes, avec **trois sursis complets (900 ms)** a
   chaque etape → **jamais replie** ; puis `Tab` sortant → repli apres exactement
   `GRACE_MS` (verifie a `GRACE_MS - 1` puis `GRACE_MS`).
2. **`le repli ne se declenche JAMAIS quand le focus est encore dans le menu`** :
   focus dans le menu + souris sortie + 5 sursis → non replie ; puis **menu
   referme mais focus encore sur une ligne du menu** → non replie (le focus seul
   retient).
3. **`Echap dans le menu ne double jamais le menu, et ne replie pas`** : le module
   s'efface (le menu a la priorite), `sidebar.js` referme et rend le focus au
   declencheur ; une fois le focus revenu dans le bloc, aucun repli.
4. **`Echap menu ferme`** : repli **immediat** (pas de sursis, pas de hauteur en
   pixels) et focus rendu a la **derniere ligne visible**.
5. **`le menu vit DANS le cadre repliable`** (verrou structurel, lu dans
   `index.html`) : `#pj-more-menu` est un descendant de `#project-footer`. C'est
   **ce qui rend la regle « focus dans le menu » vraie sans second mecanisme** :
   `cadre.contains(focus du menu)` est vrai, donc `focusin` deploie et
   `focusout` ne peut pas replier. Controle associe : aucune ligne du bloc ne
   recoit `tabindex="-1"` (aucune fonction retiree du parcours clavier).

### 2.2 LOT 3 — le toucher (Q1 : premier appui = deploiement seul)

Ajoute dans `src/js/sidebar-footer-fold.js` :

- `TYPE_APPUI_TACTILE = "touch"` et `estAppuiTactile(e)` (**pure**) : on ne
  regarde que `pointerType`, **jamais** `touchstart` (un seul chemin, celui du
  reste de l'application, § 4.2) ;
- un ecouteur **unique** `pointerdown` en **phase de capture** sur `document`
  (`surAppui`) :
  - appui **sur** le bloc **replie** → deploie, puis **consomme l'appui**
    (`preventDefault` + `stopPropagation`) : **aucun clic ne part**, la ligne
    sous le doigt n'agit pas ;
  - appui **hors** du bloc **deplie** → repli **immediat**, sans sursis (au doigt,
    il n'y a pas de « sortie de survol » a absorber) ;
  - appui **sur** le bloc **deplie** → rien (le second appui agit normalement) ;
  - appui **a la souris** → le module ne fait rien : le survol garde son role.
- cinq cas de verrou (`describe "LOT 3 (n)"`) : deploiement + appui consomme ;
  second appui non consomme ; souris non concernee ; appui hors du bloc = repli
  immediat ; detection par `pointerType` seul (et absence de `touchstart` dans le
  code, commentaires retires).

### 2.3 LOT 4 — le mouvement reduit est tenu AUSSI par la feuille de style

- `src/js/sidebar-footer-fold.js` : `CLASSE_SANS_MOUVEMENT = "no-motion"`,
  `appliquerSansMouvement(cadre, coupe)` (**pure**), `synchroniserMouvement()`
  appelee **a l'initialisation**, **a chaque deploiement** et **a chaque repli**,
  et un ecouteur de changement de la preference systeme (si le moteur expose
  `MediaQueryList.addEventListener`) qui termine proprement un mouvement en
  cours. La decision reste **celle du projet** (`mouvementCoupe` =
  `prefers-reduced-motion: reduce` **ET** `window._pilotModalAnimations === false`,
  convention de `modal-anim.js`) : aucun second reglage, aucune seconde
  convention.
- `src/css/style.css` : **regle SEPAREE** `#project-footer.no-motion {
  transition: none; }`, avec sa justification en commentaire ASCII. Elle est
  volontairement separee de `#project-footer.pj-replie` (qui ne doit porter que
  `height` et `overflow`, verrou `LOT 1 (k)`).
- **Les delais ne sont pas touches** : 100 ms a l'ouverture et 300 ms de sursis
  restent actifs dans ce mode (Q3). Verifie deux fois : cas existant du LOT 1 et
  nouveau cas `LOT 4 (o)`.
- cinq cas de verrou : la regle CSS ne porte **que** `transition` et vaut
  `none` ; la classe du CSS est **la meme** que celle du module ; posee **si et
  seulement si** reduction **et** reglage desactive (trois combinaisons testees) ;
  delais conserves, animation retiree ; `appliquerSansMouvement` seul.

### 2.4 Documentation (obligation du projet)

- `spec_pilot.md` § C : le paragraphe du repli gagne les **LOTS 2 a 4** (parcours
  clavier verrouille, menu qui vit dans le cadre, premier appui au doigt,
  `no-motion` avec delais conserves), et cite ce rapport.
- `help/overview.md` bloc `<!-- HELP:overview -->` : deux phrases utilisateur de
  plus (circulation dans le menu et `Echap`, premier appui au doigt, reduction
  des animations), puis `npm run build:handbook` regenere (45 blocs).

---

## 3. Gestes volontairement NON faits (deja presents)

| Ce que la conception demande | Pourquoi je ne l'ai pas refait |
|---|---|
| `focusin` deploie sans animation, `scrollTop = 0` | deja dans le module et deja verrouille — **verifie**, pas reecrit |
| `focusout` arme le sursis de 300 ms | idem |
| `Echap` ne double jamais le menu (ecoute en phase de capture) | idem (`LOT 1 (g)`) |
| `Echap` menu ferme : repli immediat + focus sur la ligne visible | idem |
| hauteur repliee recalculee depuis le CSS (50 px), `justify-content: flex-end`, `overflow: visible` de base, `overflow: clip` dans l'etat, `.pj-panel` en `flex: 0 0 auto`, `transition: height var(--transition)` | LOT 1 conforme : **aucune de ces declarations n'a ete touchee** |
| info-bulle enrichie Q2 | deja livree (commit `c760a8d`), **non touchee** |
| `OUVERTURE_MS = 100` / `GRACE_MS = 300` | deja presents, **non touches** |

Aucun bouton, aucun reglage, aucun libelle, aucun identifiant, aucune classe
existante n'a ete renomme ou retire.

---

## 4. Ecart avec la conception (signale, non contourne)

**§ 4.2 / LOT 3 — les etats `:hover` ne sont PAS passes sous
`@media (hover: hover) and (pointer: fine)`.** Raison technique, verifiee sur le
disque :

- les fonds de survol des sept lignes vivent dans une regle **multi-selecteurs
  partagee** avec la barre d'outils de l'editeur :
  `#global-actions button:hover, .pj-panel button:hover { … }` — la deplacer
  sous une media query toucherait un composant **hors du perimetre** de la
  mission ;
- le verrou existant `src/js/lot3-colonne-bas.test.js` lit
  `.pj-more-menu .pj-more-item:hover` avec le **selecteur en debut de ligne** :
  l'indenter sous une media query le rendrait invisible au verrou (regression de
  verrou, exactement ce qu'il ne faut pas faire).

Consequence assumee et **limitee** : sur un ecran tactile, apres le premier
appui, la ligne d'ancrage peut garder une teinte de survol « collee » jusqu'au
geste suivant. **Ce qui n'est pas fait** : aucune fonction n'est perdue, aucune
couleur n'est fausse, et le repli lui-meme n'en depend pas. C'est le seul point
du LOT 3 qui reste ouvert (voir § 6).

---

## 5. Verification — resultats EXACTS

### 5.1 Fichiers touches (et rien d'autre)

```
src/js/sidebar-footer-fold.js    +111 -3   LOT 3 (toucher) + LOT 4 (classe no-motion)
src/css/style.css                 +16 -0   #project-footer.no-motion { transition: none }
src/js/repli-menus-bas.test.js   +329 -0   15 cas nouveaux (LOT 2 : 5, LOT 3 : 5, LOT 4 : 5)
spec_pilot.md                      +1 -1   § C : LOTS 2 a 4
help/overview.md                   +8 -2   bloc HELP:overview
help/handbook.md                  (regenere par npm run build:handbook)
RAPPORT-repli-menus-bas-lots2-4.md (ce rapport)
```

**Non touches** : `index.html` (aucun noeud, aucun attribut), `src/js/sidebar.js`
(aucune des cinq chaines du verrou du menu), `src-tauri/src/agents.rs` (modifie
par une autre mission, **ni indexe ni commite**), tous les autres ecrans.

### 5.2 Commandes et comptes reels

| Commande | Resultat exact |
|---|---|
| `npx vitest run src/js/repli-menus-bas.test.js src/js/lot3-colonne-bas.test.js` | **PASS 76 / FAIL 0** (56 + 20) |
| `npx vitest run src/js/repli-menus-bas.test.js` (avant ma passe : 41 cas) | **PASS 56 / FAIL 0** (+15) |
| `npx vitest run` (suite complete) | **PASS 3432 / FAIL 0** |
| `npm run build` | **✓ built in 12.95 s** (seuls les avertissements de decoupage preexistants) |
| `npm run build:handbook` | ✅ `help/handbook.md` genere (45 blocs, 277 710 octets) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passed, 0 failed, 1 ignored** |

Aucun fichier Rust n'est touche par cette passe ; la suite Rust a quand meme ete
lancee (verte).

### 5.3 Contre-epreuves (remettre l'ancien comportement → un test doit rougir)

| Contre-epreuve | Resultat mesure | Restauration |
|---|---|---|
| regle CSS renommee (`#project-footer.no-motion-desactive`) | **2 echecs** : `regle CSS absente : #project-footer.no-motion` + `expected … to contain '#project-footer.no-motion {'` | fichier restaure a l'identique → **PASS 56 / FAIL 0** |
| `estAppuiTactile` force a `false` | **4 echecs** : `le premier appui deploie`, `aucun sursis au doigt`, + 2 | restaure → vert |
| `etat.focusDedans` force a `false` dans `surPerteFocus` | **1 echec** : le bloc se replie alors que le focus est dans le bloc / le menu | restaure → vert |

Aucune de ces trois contre-epreuves n'a laisse de trace sur le disque
(verifie par `git status --short` apres restauration).

---

## 6. Ce qui reste a faire

1. **Survol « colle » au doigt** (ecart du § 4) : passer les etats `:hover` des
   lignes sous `@media (hover: hover) and (pointer: fine)`. Demande de **scinder**
   la regle partagee avec `#global-actions button:hover` et d'**adapter le verrou**
   `lot3-colonne-bas.test.js` (lecture du selecteur en debut de ligne). Hors
   perimetre de cette passe.
2. **LOT 5** (documentation et cloture) : `docs/proposition-presentation-ui.md`
   § 3.3 et § 2 (regle d'etats) restent a completer avec le toucher et
   `no-motion` ; `spec_pilot.md` § C et `help/overview.md` sont, eux, a jour.
3. **Chronometrage reel** des 100 / 300 / 180 ms : non fait (seules les
   constantes et l'egalite avec les jetons de duree sont verrouillees).

---

## 7. Ce que je n'ai PAS pu verifier

- **Rien a l'ecran.** Aucune fenetre Pilot n'a ete ouverte et aucun automate de
  navigateur n'est disponible dans cet environnement : la fente qui monte, le
  debordement du menu et le rendu du survol ne sont **pas constates
  visuellement**. Les tests utilisent un **DOM simule** avec une horloge pilotee
  (`domFactice`), pas un vrai moteur de rendu (jsdom n'est pas installe).
- **Pas de test sur appareil tactile reel** : la decision Q1 est tenue par un
  evenement `pointerdown` simule (`pointerType: "touch"`), pas par un vrai
  doigt — le comportement de `preventDefault` sur `pointerdown` en capture
  (suppression du `click` de compatibilite) est **suppose conforme a Chromium**,
  non mesure.
- **Le changement de preference systeme en cours de session** (ecouteur `change`
  de `MediaQueryList`) n'est pas exerce par un test : le DOM simule n'expose pas
  `addEventListener` sur `matchMedia`, la branche est donc **seulement lue**.
- **Le cas « fenetre a 500 px de haut »** (plafond 60 % = 300 px pour 278 px de
  contenu) reste tenu par l'arithmetique, pas par une mesure d'ecran.

---

## 8. Commit

Un seul commit **local**, portant uniquement les sept fichiers du § 5.1. Aucun
`push`, aucun tag, aucune publication, aucun changement de version, aucune
suppression, aucune commande de nettoyage ou de reinitialisation Git, aucun
contournement de garde-fou. `src-tauri/src/agents.rs`, modifie par une autre
mission, reste **hors du commit**.
