# RAPPORT — Repli des menus du bas, LOT 3 : le TOUCHER

> Mission : livrer le **toucher** du repli de `#project-footer` (LOT 3 de
> `RAPPORT-conception-repli-menus-bas.md`), decision **383** du proprietaire, ferme :
> « au toucher, le premier appui deploie la barre sans rien declencher ; il faut donc
> deux appuis pour agir sur un menu ». Delai de reference : **300 ms** (`GRACE_MS`,
> jeton `--transition-smooth`), non modifie.
> Documents lus en lecture seule : `RAPPORT-conception-repli-menus-bas.md`
> (§ 4.2 « Toucher », § 6 LOT 3, Q1), `RAPPORT-colonne-repli-lot1.md`,
> `RAPPORT-repli-menus-bas-lots2-4.md`.
> Date : 2026-10-27.

---

## 1. Constat RECOMPTE sur le disque (avant toute ecriture)

La demande affirme qu'« aucune occurrence de `pointerdown` ni de `hover: hover` »
n'existe. **C'est faux sur le disque** : le LOT 3 a deja ete livre par le commit
`65e6828` (« lots 2 a 4 du repli des menus du bas »). Verification :

| Element du LOT 3 | Ce que j'ai trouve reellement | Verdict |
|---|---|---|
| detection du doigt | `estAppuiTactile(e)` (pure, `pointerType === "touch"`) — `sidebar-footer-fold.js:187` | **present, non refait** |
| appui sur le bloc replie | `surAppui` : deploie + `preventDefault` + `stopPropagation` (appui consomme) | **present, non refait** |
| appui hors du bloc deplie | `surAppui` : repli immediat (aucun sursis) | **present, non refait** |
| ecouteur unique | `doc.addEventListener("pointerdown", surAppui, true)` (capture) | **present, non refait** |
| verrous | `describe "LOT 3 (n)"` — 5 cas, verts | **present, non refait** |
| `hover: hover` sous media query | **absent** (ecart deja signale et argumente : la regle `:hover` est partagee avec `#global-actions button:hover`, cf. § 5) | **hors perimetre, non touche** |
| **le panneau ouvert au doigt RESTE ouvert** | **absent** : `surEntree` / `surSortie` ne regardaient pas `pointerType` | **LE TROU REELLEMENT A COMBLER** |

**Le trou, mesure et non suppose.** Un pointeur tactile emet, dans cet ordre :
`pointerenter` → `pointerdown` → `pointerup` → `pointerout` → `pointerleave`. Le
module traitait les deux evenements de survol comme ceux d'une souris :

1. `pointerenter` du doigt armait l'ouverture a **100 ms** — un appui **long**
   depliait donc par le survol, puis l'appui arrivait sur un bloc **deja deplie**
   (donc non consomme) : le bouton sous le doigt **agissait**. C'est exactement ce
   que la decision 383 interdit.
2. `pointerleave` du doigt (le doigt se leve) armait le sursis de **300 ms** — le
   panneau **se refermait tout seul 300 ms apres le premier appui**. Le second
   appui, celui qui doit agir, retombait alors sur un bloc replie : il etait
   **consomme a son tour** et **aucun menu ne pouvait jamais s'ouvrir au doigt**.

Autrement dit : le code du LOT 3 etait **ecrit mais inoperant**. Six verrous
nouveaux (`describe "LOT 3 (p)"`) ont ete poses **avant** la correction, sur le
code tel qu'il etait : **5 echecs sur 6** (§ 5.2).

---

## 2. Ce que je change (et rien d'autre)

Un seul fichier de code : `src/js/sidebar-footer-fold.js`, dans les deux portes du
survol.

- `surEntree(e)` : **si le pointeur est tactile, on ne fait rien**. Un doigt ne
  survole pas : il ne doit ni poser `etat.survol`, ni armer les 100 ms.
- `surSortie(e)` : **si le pointeur est tactile, on ne fait rien d'autre que
  retirer un eventuel survol** (et annuler l'ouverture en cours) : **aucun sursis
  n'est arme**. Le doigt leve ne referme donc pas le panneau.
- `surAppui` (le seul chemin du doigt) est **inchange** : premier appui sur le bloc
  replie = deploiement seul (appui consomme) ; appui sur le bloc deplie = rien (la
  ligne agit) ; appui hors du bloc deplie = repli immediat.

Aucun noeud, aucun bouton, aucun reglage, aucun libelle, aucun identifiant, aucune
classe existante n'est ajoute, retire ou renomme. Aucune constante de delai n'est
touchee (`OUVERTURE_MS = 100`, `GRACE_MS = 300`, `180 ms` d'animation).

---

## 3. Comment je distingue le toucher de la souris SANS casser le survol

**Methode : `pointerType`, sur les evenements de pointeur eux-memes.** Pas de
`touchstart` (un second chemin interdirait de raisonner sur un seul etat), pas de
`window.matchMedia("(hover: none)")` (qui decrirait la *machine* et non le *geste*
— une tablette avec stylet ou un portable tactile a les deux), pas de drapeau
« dernier geste vu » (qui mentirait des qu'un doigt et une souris se suivent).

Consequences, verifiees par les verrous :

- **souris** : `pointerenter` / `pointerleave` ont `pointerType === "mouse"` ⇒
  chemin **inchange** a l'identique (ouverture 100 ms, repli 300 ms de sursis, les
  trois portes qui retiennent le bloc). Cas `LOT 3 (p)` « la SOURIS garde
  exactement son role, avant comme apres un geste au doigt » ; les 41 cas des LOT 1,
  2 et 4 restent verts **sans une ligne de modification**.
- **doigt** : seuls les `pointerdown` tactiles agissent (§ 2). Le `pointerleave`
  du doigt leve ne declenche plus rien ⇒ le panneau ouvert au doigt **reste
  ouvert** jusqu'a un appui **hors** du bloc, qui le replie tout de suite. Cas
  « le doigt leve ne referme pas le panneau » et « le SECOND appui atteint la
  ligne ».
- **clavier** : **aucune ligne touchee**. `focusin` deploie sans animation,
  `focusout` arme le sursis, `Echap` ne double jamais le menu (ecoute en capture),
  `Echap` menu ferme rend le focus a la ligne visible. Les 5 cas du parcours
  complet `LOT 2 (m)` restent verts.
- **un doigt et une souris se suivent** (portable tactile) : le doigt n'a pas laisse
  de survol derriere lui (cas « aucun survol colle »), donc le premier mouvement de
  souris se comporte comme sur une machine sans ecran tactile.

**Ce que je n'ai pas fait, et pourquoi** : les etats `:hover` du bloc ne sont
**toujours pas** passes sous `@media (hover: hover) and (pointer: fine)`. La regle
de fond de survol des sept lignes est **partagee** avec la barre d'outils de
l'editeur (`#global-actions button:hover, .pj-panel button:hover`) : la deplacer
toucherait un composant **hors perimetre**, et le verrou `lot3-colonne-bas.test.js`
lit `.pj-more-menu .pj-more-item:hover` avec le selecteur **en debut de ligne** —
l'indenter sous une media query le rendrait muet. Consequence **limitee et
assumee** : sur un ecran tactile, une ligne peut garder une teinte de survol
« collee » jusqu'au geste suivant. Aucune fonction n'est perdue, la teinte ne
deplace rien, et **le repli n'en depend pas** (il ne lit jamais `:hover`).

---

## 4. Les cinq exigences de la mission, une par une

| Exigence | Tenue par | Verrou |
|---|---|---|
| 1. premier appui sur la zone repliee = deploiement seul, aucun bouton active | `surAppui` (appui consomme) + `surEntree` qui ignore le doigt (sinon un appui long deploierait par le survol) | `LOT 3 (n)` 1er cas, `LOT 3 (p)` « appui LONG » |
| 2. une fois depliee, un appui sur un bouton fait ce que fait ce bouton | `surAppui` ne consomme plus rien sur un bloc deplie, et le doigt leve ne referme plus le panneau | `LOT 3 (p)` « le SECOND appui atteint la ligne » |
| 3. a la souris, rien ne change d'un pouce (survol, ouverture, refermeture) | `surEntree` / `surSortie` ignorent **seulement** `pointerType === "touch"` | `LOT 3 (p)` « la SOURIS garde exactement son role », + LOT 1 (j) |
| 4. le clavier ne change pas (premier `Tab` ouvre, `Echap` ferme sans conflit) | code clavier non touche | `LOT 2 (m)` (5 cas) |
| 5. la ligne du bas ne bouge jamais, la largeur ne change pas | ancre `justify-content: flex-end` (CSS non touche) ; le module ne pose **que** `height` | LOT 1 (b) / (c) + `LOT 3 (p)` « seule la HAUTEUR bouge » |

---

## 5. Verification — resultats EXACTS

### 5.1 Fichiers touches (et rien d'autre)

```
src/js/sidebar-footer-fold.js    +34 -3   surEntree / surSortie ignorent un pointeur tactile (+ en-tete)
src/js/repli-menus-bas.test.js  +153 -3  6 verrous nouveaux ("LOT 3 (p)") + 1 ancre de verrou existant adaptee
spec_pilot.md                    +2 -2   § C : le bloc ouvert au doigt reste ouvert
help/overview.md                 +3 -2   bloc HELP:overview (meme fait, cote utilisateur)
help/handbook.md                 regenere par npm run build:handbook (45 blocs)
RAPPORT-repli-menus-bas-toucher.md (ce rapport)
```

**Non touches** : `index.html` (aucun noeud, aucun attribut, aucun libelle),
`src/css/style.css` (donc ni la hauteur de 50 px, ni les 280 px de colonne, ni les
regles `:hover`), `src/js/sidebar.js` (aucune des cinq chaines du verrou du menu),
`src-tauri/src/agents.rs` (modifie par une autre mission : **ni indexe, ni
commite**), tous les autres ecrans, tous les autres fichiers de code.

### 5.2 Commandes et comptes reels

| Commande | Resultat exact |
|---|---|
| `npx vitest run src/js/repli-menus-bas.test.js src/js/lot3-colonne-bas.test.js` (avant la passe) | **PASS 76 / FAIL 0** |
| les 6 verrous nouveaux sur le code **non corrige** | **PASS 1 / FAIL 5** — echecs : « le doigt leve ne referme JAMAIS le panneau », « le second appui n'est plus consomme », « le doigt ne deploie pas par le survol », « la souris referme ce que le doigt a ouvert », « un doigt n'est pas un survol » |
| `npx vitest run src/js/repli-menus-bas.test.js src/js/lot3-colonne-bas.test.js` (apres correction) | **PASS 82 / FAIL 0** (62 + 20) |
| `npx vitest run` (suite complete) | **PASS 3443 / FAIL 0** |
| `npm run build` | **✓ built in 13.03 s** (4132 modules ; seuls les avertissements de decoupage preexistants : `search-panel.js` importe deux fois, un chunk > 500 kB) |
| `npm run build:handbook` | ✅ `help/handbook.md` genere (45 blocs, 277 973 octets) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **786 passed, 0 failed, 1 ignored** (aucun fichier Rust touche par cette passe) |

### 5.3 Contre-epreuves (casser expres le code → un verrou doit rougir)

| Contre-epreuve | Resultat mesure | Restauration |
|---|---|---|
| `surSortie` ne teste plus `estAppuiTactile(e)` (retour au comportement d'avant) | **3 echecs** : `le doigt leve ne referme JAMAIS le panneau`, `le second appui n'est plus consomme`, `la souris referme ce que le doigt a ouvert` | fichier restaure a l'identique → **PASS 82 / FAIL 0** |
| `surEntree` ne teste plus `estAppuiTactile(e)` | **2 echecs** : `le doigt ne deploie pas par le survol` (appui long), `un doigt n'est pas un survol` | restaure → **PASS 82 / FAIL 0** |

Aucune contre-epreuve ne laisse de trace : le module a ete restaure par copie du
fichier d'origine, puis les deux fichiers de test relances (verts), et
`git status --short` ne montre que les fichiers listes au § 5.1.

### 5.4 Un verrou EXISTANT adapte (et signale)

Le verrou `LOT 1 (h)` « les DELAIS restent actifs en mouvement reduit (Q3) » lit
le source du module entre deux ancres, dont `const surEntree = () => {`. La porte
du survol recoit desormais l'evenement (necessaire pour ignorer un doigt), donc
l'ancre s'arrete aux parametres : `const surEntree = (`. **L'assertion est
identique** (`}, OUVERTURE_MS)` present, `}, GRACE_MS)` present) ; seule l'ancre
a bouge, pour ne plus dependre de la signature. Sans cela, le verrou existant
aurait rougi sur une modification legitime — c'est exactement le piege que le
quality-gate demande de traiter en adaptant l'ancre, jamais en retirant
l'assertion.

---

## 6. Ce qui n'est PAS verifiable sans appareil tactile reel

- **Le vrai doigt.** Les verrous emettent des `pointerdown` / `pointerenter` /
  `pointerleave` **simules** avec `pointerType: "touch"` dans un DOM factice
  (`domFactice`, horloge pilotee), pas avec un doigt sur un ecran. Ce qui est
  verifie est la **decision du module**, pas le rendu du moteur.
- **Le `preventDefault` sur `pointerdown` en capture supprime-t-il bien le `click`
  de compatibilite ?** Suppose conforme a Chromium ; non mesure ici.
- **La teinte `:hover` « collee »** apres un appui (ecart du § 3) : non observable
  sans moteur de rendu.
- **Rien a l'ecran** : aucune fenetre Pilot, aucun automate de navigateur dans cet
  environnement. La fente qui monte, le debordement du menu et la position de la
  ligne du bas ne sont **pas constates visuellement**.
- **Chronometrage reel** des 100 / 300 / 180 ms : seules les constantes et leur
  egalite avec les jetons de duree sont verrouillees.

---

## 7. Ce qui reste des lots 2, 4 et 5

- **LOT 2 (clavier)** : **livre et verrouille** (`LOT 2 (m)`, 5 cas). Rien a faire.
- **LOT 4 (mouvement reduit)** : **livre et verrouille** (`LOT 4 (o)` : classe
  `no-motion`, delais conserves). Reste ouvert, hors perimetre : passer les etats
  `:hover` sous `@media (hover: hover) and (pointer: fine)` (§ 3), ce qui demande de
  **scinder** la regle partagee avec `#global-actions` **et** d'adapter
  `lot3-colonne-bas.test.js`.
- **LOT 5 (documentation et cloture)** : `spec_pilot.md` § C et `help/overview.md`
  decrivent le toucher (dont le fait que le panneau ouvert au doigt reste ouvert) ;
  `help/handbook.md` est regenere. Reste : `docs/proposition-presentation-ui.md`
  § 2 (regle d'etats) et § 3.3 (tableau des gestes) a completer avec le toucher
  s'il est conserve comme document vivant.

---

## 8. Commit

Commit **local** uniquement (aucun envoi, aucun tag, aucune publication), message :
`feat(colonne): lot 3 du repli des menus du bas -- le doigt deploie et le panneau reste ouvert`.
