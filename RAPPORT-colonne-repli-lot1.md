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
