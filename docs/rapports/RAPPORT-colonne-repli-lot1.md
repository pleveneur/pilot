# RAPPORT — LOT 1 du repli au survol des menus du bas (colonne de gauche)

> Mission : appliquer **TEL QUEL** le LOT 1 de `RAPPORT-conception-repli-menus-bas.md`.
> Aucun envoi vers GitHub, aucun tag, aucune publication, aucune suppression, aucune
> commande de nettoyage ou de reinitialisation Git.

## 1. Etat AVANT

- `#project-footer` (`src/css/style.css`) etait un cadre accentue **toujours deplie** :
  `flex-shrink: 0`, colonne, `gap: 6px`, `overflow: visible`, `max-height: 60%`,
  `padding: 8px 0`, sans `height` ni `justify-content` ni `transition`.
- `.pj-panel` n'avait **aucun `flex`** (donc `flex: 0 1 auto`, compressible).
- `index.html` : `<div id="project-footer">` **sans classe**.
- Aucun survol, aucun clavier, aucun module de repli : les seules occurrences de
  `mouseenter`/`pointerenter` du depot sont dans `recent-files.js` et `toast.js`.
- Verrou existant : `src/js/lot3-colonne-bas.test.js` (vert avant modification).

## 2. Etat APRES (ce qui a ete applique)

Valeurs prises **dans la conception**, § 2.5, sans invention :

| Element | Ajout |
|---|---|
| `#project-footer` | `justify-content: flex-end` (colle le contenu en bas), `transition: height var(--transition)` (0.18s, jeton existant) |
| `.pj-panel` | `flex: 0 0 auto` (jamais comprime, § 5.2) |
| `#project-footer.pj-replie` | `height: 50px` (2 + 2x8 + 32), `overflow: clip` (§ 5.1 : `overflow: visible` reste dans le bloc de base, verrou tenu) |
| `index.html` | `class="pj-replie"` sur `#project-footer` : etat peint au premier rendu, sans clignotement |
| nouveau module | `src/js/sidebar-footer-fold.js` : `OUVERTURE_MS = 100`, `GRACE_MS = 300`, `hauteurDeplieePx`, `mesurerHauteurDepliee`, `doitResterDeplie`, `mouvementCoupe`, `initRepliMenusBas` |
| `sidebar.js` | branchement : `import` + appel dans `init()` a cote de `_initProjectFooterMenu()` ; `this._fermerMenuAutresEcrans = fermer;` expose APRES l'ecouteur `keydown` (§ 5.4, les cinq chaines du verrou du menu ne sont pas touchees) |

Comportement obtenu (conception § 2.2 a § 2.4) :

- **Ouverture** : `pointerenter` sur le cadre → deploiement apres **100 ms**
  (`--transition-fast`) ; `focusin` → deploiement **immediat, sans animation**, avec
  `scrollTop = 0` force.
- **Repli** : seulement si `survol` ET `focus` ET `menu` sont tous sortis/fermes →
  **300 ms** de sursis (`--transition-smooth`) puis **180 ms** d'animation
  (`--transition`). La sortie de l'une des trois conditions annule le sursis.
- **Echap** : menu ouvert, le menu a la priorite (aucun doublon, l'ecouteur du module
  est en phase de **capture**, il voit le menu encore ouvert et ne fait rien) ; menu
  ferme et focus dans le bloc → repli **immediat** + focus rendu a la ligne visible.
- **Ancre** : `justify-content: flex-end` → la ligne du bas ne bouge jamais d'un
  pixel ; pendant l'animation, `overflow: clip` reste pose (la classe n'est retiree
  qu'a la fin du deploiement, posee au debut du repli) : la fente s'ouvre et se ferme
  vers le haut, les lignes ne sont ni deplacees ni montrees d'un coup.
- **Hauteur** : JS mesure (`panneau.offsetHeight` + paddings + bordures lus par
  `getComputedStyle`), pose des pixels, puis **retire la valeur** a la fin : le bloc
  reste auto-ajustable si le nombre de lignes change (projet ouvert / ferme).
- **Mouvement reduit** : `mouvementCoupe(win)` reprend **la convention existante**
  (`prefers-reduced-motion: reduce` **et** `window._pilotModalAnimations === false`,
  cf. `modal-anim.js:43-44`) : la bascule devient franche, les **delais 100/300 ms
  restent actifs** (Q3). Aucun second reglage invente.
- **Aucun noeud ajoute** : les 7 lignes restent dans le DOM, aucun `tabindex="-1"`,
  aucun bouton, aucun reglage, aucun libelle change, colonne toujours 280 px.
- **Menu et rognage (§ 5.4)** : si le declencheur « Autres ecrans » est clique alors
  que la fente monte encore, le deploiement est **termine sur-le-champ** (la classe de
  rognage tombe) : un menu ouvert n'est jamais coupe par `overflow: clip`.

## 3. Ecarts et points signales (je n'ai rien corrige de ma propre initiative)

1. **Chevauchement de perimetre assume** : la mission demande LOT 1 seulement, mais sa
   liste de vigilance exige explicitement le **clavier** et le **respect du mouvement
   reduit** — que la conception range dans ses LOT 2 (clavier) et LOT 4 (mouvement
   reduit). J'ai donc livre ces deux comportements **dans le module du LOT 1**, et je
   n'ai PAS touche au toucher (LOT 3 de la conception), ni a l'interruption / re-mesure
   complete / verrous / handbook (LOT 3 de la mission).
2. **`no-motion` non pose comme classe CSS** : la conception (LOT 4) prevoyait
   `#project-footer.no-motion { transition: none }`. J'ai traite le mouvement reduit en
   JS seul (bascule sans animation), pour ne pas preempter le LOT 4. Le LOT 4 reste donc
   a livrer : sa regle CSS et son verrou.
3. **Infobulle enrichie de `btn-more-screens` (Q2, § 3.2 point 4) NON appliquee** : le
   § 6 du document ne la met pas dans la liste du LOT 1. A trancher avec le
   proprietaire (c'est la seule ligne du document qui puisse changer le `title`).
4. **Plan B `translateY` non utilise** : `justify-content: flex-end` suffit sur
   WebView2 ; je n'ai pas pu verifier a l'ecran le cas de debordement (voir § 5).
5. **Mode zen** : `#project-footer` est masque (`style.css`), donc aucun survol ne
   peut armer un minuteur ; je n'ai pas ajoute de code specifique.
6. **Un ajout minuscule, signale** : la conception ne dit pas quoi faire si le menu
   « Autres ecrans » est ouvert **pendant** les 180 ms d'ouverture (le rognage est
   encore pose, le menu serait coupe une fraction de seconde). Conformement a la regle
   « un menu n'est jamais rogne » (§ 5.4), le module **termine le mouvement sur-le-champ**
   des que le menu s'ouvre (4 lignes, testees). Ce n'est pas un comportement nouveau
   visible : c'est la regle existante appliquee au trou qu'elle laissait.
7. **Verrou comportemental sur DOM factice** : aucun navigateur (jsdom / happy-dom)
   n'est installe dans le projet. Plutot que d'ajouter une dependance (hors mission),
   le verrou simule le DOM et **pilote l'horloge a la milliseconde** dans son propre
   fichier de test. Le rendu reste donc a confirmer a l'ecran (voir § 5).

## 4. Fichiers touches

- `src/css/style.css` (3 declarations dans `#project-footer`, 1 dans `.pj-panel`,
  1 regle d'etat `#project-footer.pj-replie`)
- `index.html` (attribut `class="pj-replie"` sur `#project-footer`)
- `src/js/sidebar-footer-fold.js` (**nouveau**)
- `src/js/sidebar.js` (1 import, 1 appel dans `init()`, 1 reference exposee)
- `src/js/repli-menus-bas.test.js` (**nouveau verrou du LOT 1**)
- `docs/proposition-presentation-ui.md` § 3.3 + `spec_pilot.md` § C (lignes de doc du
  LOT 1 ; la documentation d'aide `help/*` n'est PAS touchee — LOT 3). Note :
  `docs/proposition-presentation-ui.md` n'est **pas suivi par git** (comme ses pairs
  `proposition-barre-fenetre.md`, `proposition-reglages-en-onglet.md`,
  `proposition-bande-contexte-allegee.md`), donc sa ligne de doc reste sur le disque
  et n'entre pas dans le commit.

## 5. Verifications (resultats exacts, executees)

| Verification | Resultat |
|---|---|
| Suite complete **avant** modification (reference) | `PASS (3307) FAIL (0)` |
| Verrou du LOT 1 : `npx vitest run src/js/repli-menus-bas.test.js` | `PASS (36) FAIL (0)` |
| **Verrou du bas de colonne** : `npx vitest run src/js/lot3-colonne-bas.test.js` | `PASS (20) FAIL (0)` — inchange |
| Suite complete **apres** modification : `npx vitest run` | `PASS (3343) FAIL (0)` (3307 + 36) |
| Construction de l'interface : `npm run build` | `✓ built in 13.30s`, aucune erreur (seuls les avertissements de decoupage de chunks preexistants) |

Ce que le verrou `src/js/repli-menus-bas.test.js` tient (36 cas) :

- **(a)** la hauteur repliee est **recalculee depuis le disque** : `2 x bordure +
  2 x padding + 1 ligne` = **50 px**, avec la bordure (1 px), le padding (8 px) et la
  hauteur de ligne (32 px) **relus dans `style.css`** — aucune valeur recopiee ;
- **(b)** `justify-content: flex-end` present dans `#project-footer {`, `overflow:
  visible` **toujours** dans ce meme bloc, aucun `clip`/`hidden` n'y entre ;
- **(c)** le rognage n'existe **que** dans `#project-footer.pj-replie`, avec
  `overflow: clip`, jamais `hidden` ;
- **(d)** `.pj-panel` porte `flex: 0 0 auto` et chaque ligne garde ses 32 px ;
- **(e)** `transition: height var(--transition)` seule (aucune duree en dur, aucun
  `transform`, aucun `will-change`) ;
- **(f)** `OUVERTURE_MS === --transition-fast === 100` et `GRACE_MS ===
  --transition-smooth === 300`, **relus dans le CSS** ; tous les `setTimeout` du module
  passent par l'une de ces deux constantes ;
- **(g)** les trois portes et le branchement (`sidebar.js` : import + appel + reference
  exposee, cinq chaines du menu intactes) ;
- **(h)** le mouvement reduit est **la convention de `modal-anim.js`** (verifiee dans
  les deux fichiers), et les delais y restent actifs ;
- **(i)** les fonctions pures (`doitResterDeplie`, `hauteurDeplieePx` : 260 + 18 = 278 px
  pour sept lignes, 70 + 18 = 88 px sans projet, jamais `NaN`) ;
- **(j)** la **machine a etats** elle-meme, sur un DOM factice et une **horloge pilotee
  a la milliseconde** (aucun navigateur n'est installe dans ce projet) : rien avant
  100 ms, deploiement a 100 ms avec la hauteur en pixels, sursis de 300 ms **annule par
  un retour de souris**, clavier immediat **sans hauteur en pixels**, focus qui reste
  dedans = pas de repli, menu ouvert = pas de rognage, menu ouvert en pleine ouverture
  = mouvement termine, `Echap` menu ouvert = rien / menu ferme = repli immediat + focus
  sur la ligne visible, mouvement reduit = bascule franche mais delais conserves.

### Ce qui n'a PAS pu etre vu a l'ecran (dit franchement)

Aucune application graphique n'a ete lancee pendant cette mission : le **survol reel**
(passage de souris, `pointerenter`/`pointerleave` de WebView2), l'**animation de
180 ms** (que le test simule par une horloge, sans `transitionend` reel), le
**non-deplacement de la ligne du bas** et le cas de debordement du `flex-end` sont
couverts **par la lecture des valeurs et par le verrou**, pas par l'oeil. Trois points
restent a confirmer a l'ecran : (1) la fente monte bien vers le haut sans faire glisser
la derniere ligne ; (2) le `transitionend` du moteur retire la valeur en pixels au bon
moment ; (3) le menu « Autres ecrans » s'ouvre au-dessus du cadre sans etre rogne, que
le deploiement soit fini ou non.

## 6. Ce qui reste a faire

- **LOT 2** (conception) — verrou clavier dedie (`scrollTop = 0`, aucun `tabindex="-1"`,
  `Echap` qui ne double jamais le menu) : partiellement livre ici, verrou complet a
  ecrire.
- **LOT 3** — le **toucher** : `pointerdown` de type `touch` = deploiement seul (1er
  appui), `:hover` du bloc sous `@media (hover: hover) and (pointer: fine)`, appui
  exterieur = repli immediat.
- **LOT 4** — `#project-footer.no-motion { transition: none }` + son verrou.
- **LOT 5** — documentation et cloture (handbook, `spec_pilot.md` complet).- **A l'ecran** : le survol reel, l'animation de 180 ms, le non-deplacement de la ligne
  du bas et le cas de debordement du `flex-end` n'ont pas pu etre observes ici (pas
  d'application graphique lancee) ; ils sont couverts par le verrou de valeurs et par la
  lecture du code uniquement.

---

## 7. SECONDE PASSE — verification apres les missions « badge Distant » et « compteur Travail »

### 7.1 Etat trouve sur le disque au depart (relu, pas recopie d'un ancien rapport)

**Le LOT 1 etait deja livre.** Preuves lues sur le disque avant toute action :

| Element | Etat trouve |
|---|---|
| `src/css/style.css:830` | `#project-footer {` porte `justify-content: flex-end` et `transition: height var(--transition)` ; `overflow: visible` **intact** |
| `src/css/style.css:894` | regle d'etat `#project-footer.pj-replie { height: 50px; overflow: clip; }` |
| `.pj-panel` | porte `flex: 0 0 auto` |
| `index.html:141` | `<div id="project-footer" class="pj-replie">` |
| `src/js/sidebar-footer-fold.js` | module present (444 lignes), `OUVERTURE_MS = 100`, `GRACE_MS = 300` |
| `src/js/sidebar.js:28 et :255` | import + appel `initRepliMenusBas({...})` dans `init()`, apres `_initProjectFooterMenu()` |
| `src/js/repli-menus-bas.test.js` | verrou present (36 cas) |
| `spec_pilot.md` § C | decrit deja le repli (50 px, 100 ms, 300 ms, ancre bas) |
| commit | `c760a8d feat(colonne): lot 1 du repli au survol des menus du bas` |

**Conclusion : appliquer le LOT 1 une seconde fois aurait ete un doublon.** Je ne l'ai donc
pas refait, et je n'ai **rien supprime ni reecrit** de ce qui existe.

### 7.2 Les missions posterieures n'ont rien casse (verifie)

- Le **badge « Distant »** a ete descendu dans `#sidebar-engine-row`, qui est un **frere**
  de `#project-footer`, **sous** lui (dernier enfant de `#sidebar`). Le repli s'ancre sur
  le **bas du cadre** : la ligne d'information du bas ne bouge donc toujours pas, et le
  cadre garde son `margin: 0 8px 8px`. **Aucune interaction** : le verrou de valeurs
  (`lot3-colonne-bas.test.js`, 20 cas) et le verrou du repli (38 cas) sont verts.
- Le **compteur « Travail »** vit dans la rangee d'onglets, hors de la colonne : sans
  effet sur ce bloc.

### 7.3 Le lot tel que la conception le nomme

`RAPPORT-conception-repli-menus-bas.md` § 6 — **« LOT 1 — le repli et le deploiement au
survol (le coeur, 1 test + 1 module) »**. Les lots 2 (clavier), 3 (toucher), 4
(mouvement reduit) et 5 (documentation et cloture) portent les numeros suivants : ils
n'ont **pas** ete faits dans cette passe.

### 7.4 Ce que cette passe a reellement applique (3 retouches, aucun code de comportement)

1. **`help/overview.md` (bloc `<!-- HELP:overview -->`)** — le texte d'aide decrivait les
   menus du bas et affirmait qu'ils etaient « **toutes visibles** », ce qui etait devenu
   **faux** depuis le repli. Corrige en « toutes presentes », et **un paragraphe ajoute**
   decrit l'etat reel : replie au repos sur une ligne de haut, derniere ligne visible
   (`Autres ecrans` avec un projet, `Options` sans projet), deploiement au survol (un
   dixieme de seconde) et a la **premiere touche Tab**, refermeture un tiers de seconde
   apres la sortie de la souris et **jamais quand on se deplace a l'interieur**, ligne du
   bas immobile, largeur inchangee. Le **toucher n'y est pas annonce** : il appartient au
   LOT 3 et n'est pas livre (voir 7.6).
2. **`help/handbook.md`** — regenere par `npm run build:handbook` (45 blocs,
   276 344 octets). Fichier **genere**, jamais edite a la main.
3. **`src/js/repli-menus-bas.test.js`** — **2 cas ajoutes** (36 -> 38), sans en modifier
   ni en supprimer aucun :
   - *« la souris qui se deplace A L'INTERIEUR du bloc deplie n'arme aucun repli »* : 5
     deplacements internes espaces de 150 ms, puis controle que le bloc ne se referme
     qu'a la **sortie** du cadre et apres le sursis complet (point 5 des verifications
     attendues) ;
   - *« la regle d'etat ne porte QUE la hauteur et le rognage (aucune couleur) »* : les
     proprietes de `#project-footer.pj-replie` sont exactement `height` et `overflow`,
     aucune couleur/ombre/opacite (point 4 : les deux themes).

### 7.5 Cas verifies, modalite par modalite

| Modalite | Verifie | Preuve |
|---|---|---|
| **Souris** | deploiement apres 100 ms, sursis de 300 ms, retour qui annule le sursis, **deplacement interieur sans fermeture** | verrou (j) + nouveau cas ; `pointerenter`/`pointerleave` ne se declenchent qu'aux frontieres du cadre |
| **Clavier** | `focusin` deploie **immediatement et sans animation**, `scrollTop = 0`, aucun `tabindex="-1"`, `Echap` ne double jamais le menu (ecoute en capture), `Echap` menu ferme = repli immediat + focus sur la ligne visible | verrou (g) et (j) ; code `surFocus` / `surTouche` |
| **Toucher** | **NON LIVRE — LOT 3.** Aucun `pointerdown` / `pointerType === "touch"` dans le module, aucune media query `(hover: hover) and (pointer: fine)` dans `style.css` (verifie : 0 occurrence). Ce qui fonctionne deja au doigt : l'appui donne le focus au bouton, donc `focusin` deploie, et l'ouverture du menu **termine le mouvement** (`surMenuChange`), donc le menu n'est jamais rogne. **Il reste a livrer** : 1er appui = deploiement seul, et les etats `:hover` sous media query. | `grep` sur le module et la feuille : aucune trace |
| **Theme clair** | le repli n'introduit **aucune couleur** (regle d'etat = `height` + `overflow`) ; le cadre garde `accent 16 %` + bordure accent ; **aucune teinte de survol** n'a ete ajoutee (`#project-footer:hover` : 0 occurrence), donc le contraste du libelle reste **4,71:1** (>= 4,5) au lieu de tomber a 4,15:1 | nouveau cas (k), conception § 5.6 |
| **Theme sombre** | memes jetons, meme regle : contraste **6,25:1** ; rien de specifique au theme n'a ete ecrit | idem |

### 7.6 Desaccords SIGNALES, non tranches par moi

1. **350 ms (mission) contre 300 ms (conception et code).** La demande ecrit « se
   referment **350 ms** apres que la souris a quitte la zone » ; le document de conception
   qui fait foi (§ 2.3) justifie **300 ms** (= le jeton existant `--transition-smooth`) et
   le code applique 300 ms. Je n'ai **pas** change la valeur : c'est la conception que la
   mission elle-meme declare validee et ferme (« Applique-la, ne la reinvente pas »). A
   trancher par le proprietaire si 350 ms est bien la decision 374.
2. **Le LOT 1 etait deja livre** (commit `c760a8d`) alors que la mission le presente comme
   a faire. Signale, non refait.
3. **L'infobulle enrichie de `btn-more-screens` (Q2, conception § 3.2)** n'est **pas**
   appliquee : le § 6 ne la range pas dans le LOT 1 et elle touche l'attribut `title` d'une
   ligne verrouillee. Elle reste a trancher.
4. **Le clavier et le mouvement reduit** ont ete livres **en avance** dans le module du
   LOT 1 (la mission les exigeait comme points de vigilance) : les verrous dedies des lots
   2 et 4 restent donc a ecrire.

### 7.7 Resultats exacts des verifications de cette passe

| Commande | Resultat |
|---|---|
| `npx vitest run src/js/repli-menus-bas.test.js` | **PASS (38) FAIL (0)** (36 avant, +2 nouveaux cas) |
| `npx vitest run src/js/repli-menus-bas.test.js src/js/lot3-colonne-bas.test.js` | **PASS (58) FAIL (0)** (38 + 20, le verrou du bas de colonne est inchange) |
| `npm test` (suite complete) | **191 fichiers, 3357 tests, 3357 passed, 0 failed** (11,44 s) |
| `npm run build:handbook` | **OK** — `help/handbook.md` regenere (45 blocs, 276 344 octets) |

### 7.8 Ce qui reste pour les lots suivants

- **LOT 2 — clavier** : `focusin` sans animation (livre), verrou dedie a ecrire, `Echap`
  deja couvert.
- **LOT 3 — toucher** : `pointerdown` / `pointerType === "touch"` (1er appui = deploiement
  seul), media query `(hover: hover) and (pointer: fine)` pour les etats `:hover`,
  appui exterieur = repli immediat.
- **LOT 4 — mouvement reduit** : regle `#project-footer.no-motion { transition: none }` +
  son verrou (le comportement JS est deja en place).
- **LOT 5 — documentation et cloture** : `spec_pilot.md` § C (deja a jour), handbook
  (fait ici), ce rapport passe en « livre ».
- **A l'ecran, non observe ici** : survol reel, animation de 180 ms, immobilité de la
  ligne du bas, absence de rognage du menu (aucune application graphique lancee).

