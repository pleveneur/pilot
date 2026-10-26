# RAPPORT — boutons du mode « Assistant seul », 2e passe (re-verification mesuree)

**Mission** : en mode « Assistant seul », les deux boutons apparaissant dans le
coin haut droit (le point qui ouvre la liste des agents et la roue des options
⚙) sont jugés MAL PLACES par le propriétaire. Sa demande, mot pour mot :

> « Ils doivent être alignés à droite, en dessous des boutons système qui eux
> sont bien positionnés. »

**Conclusion en une ligne** : le placement demande **est deja celui du disque**
(il a ete livre par le commit `7e8f28c`, *apres* la release `v0.5.0`). Ce que le
proprietaire voit encore est l'**ancienne** position, celle de la version
installee. Les mesures de rendu le prouvent (§3 et §6). Aucune retouche CSS
n'a donc ete faite : elle aurait ete un mensonge sur le disque. Ce qui a ete
ajoute : deux verrous de plus sur le point le plus fragile (l'ordre reel de la
barre) et la mise a jour de la specification, qui decrivait encore la solution
abandonnee.

---

## 1. Etat TROUVE au depart (lu sur le disque, pas de memoire)

### 1.1 Le disque correspond-il au rapport precedent ?

**Oui, exactement.** `RAPPORT-boutons-assistant-seul.md` (1re passe) decrit la
reservation de 150 px ; `RAPPORT-boutons-assistant-seul-2.md` (2e passe) decrit
le placement sur la seconde ligne ; le commit `7e8f28c`
(« fix(assistant-seul): les deux boutons sous la barre systeme, alignes a
droite ») porte bien ces trois fichiers, et `7e8f28c` est un **ancetre de HEAD**
(`23a8599`).

### 1.2 Les lignes qui decident du placement (etat actuel)

| Element | Fichier:ligne | Valeur |
|---|---|---|
| Groupe des trois boutons systeme | `src/css/style.css:93` | `#window-controls`, `padding: 4px 4px 4px 0` (air droit **4 px**) |
| Une touche systeme | `src/css/style.css:117` | `width: 46px` (3 x 46 + 4 = **142 px**) |
| Boutons systeme au-dessus de l'overlay | `src/css/style.css:108` | `z-index: 100001` (garde-fou : la fenetre reste fermable) |
| Rangee qui les porte | `src/css/style.css:1944` | `#tab-row`, `min-height: 36px` (+ 1 px de filet, compris : `border-box` global) |
| Overlay du mode | `src/css/style.css:10964` | `.superagent-immersive`, `position: fixed; inset: 0` |
| Barre du mode | `src/css/style.css:10995` | `.sa-immersive-top`, `height: 58px` |
| Decalage vertical | `src/css/style.css:11014` | `margin-top: var(--window-controls-height)` = **36 px** |
| Air droit de la barre | `src/css/style.css:11015` | `padding: 0 var(--window-controls-air) 0 18px` = **4 px** |
| Jetons de mesure | `src/css/style.css:281,284,288` | `--window-controls-width: 142px`, `--window-controls-air: 4px`, `--window-controls-height: 36px` |
| Dernier bouton de la barre | `src/css/style.css:11099` | `.sa-immersive-settings`, `flex-shrink: 0` (aucune marge) |
| Construction de la barre | `src/js/super-agent.js:3436` | retour, titre, agents, ⚙ (ligne `3440`) |
| Entree « Travail » deplacee | `src/js/super-agent.js:3517` | `insertBefore(activity, agentsHost)` -> **devant** le point des agents |
| Le point des agents | `src/js/agent-activity.js:813` | `<button>` 10 px, `title` + `aria-label="Agents"` |

### 1.3 Pourquoi le proprietaire voit autre chose : la PREUVE de version

La version publiee et installee est `v0.5.0` (`package.json` = `0.5.0`,
tag `v0.5.0` = `5a230eb`). Mesures Git :

```
git merge-base --is-ancestor v0.5.0 7e8f28c   -> vrai  (la 2e passe est APRES la release)
git merge-base --is-ancestor 7e8f28c v0.5.0   -> faux  (elle n'est PAS dans v0.5.0)
```

Et dans `v0.5.0`, la feuille dit :

```
git show v0.5.0:src/css/style.css | grep -A 8 ".sa-immersive-top {"
  height: 58px;
  padding: 0 18px;      <-- aucune marge haute, air droit de 18 px
```

Autrement dit, dans l'application installee : la barre demarre a `y = 0`, le ⚙
occupe `18 a 56 px` du bord droit, et le bouton Fermer `4 a 50 px` : les deux
zones **se recouvrent** (18 a 50 px). C'est tres exactement le defaut que la 2e
passe corrige, et c'est ce que l'oeil du proprietaire voit encore.

---

## 2. Ce qui a change dans cette passe

**Aucune regle de placement n'a ete modifiee** : elle est deja celle que le
proprietaire demande (mesuree au §3). Changer le CSS ici n'aurait fait que
deplacer un placement deja juste, sans preuve d'un desaccord reel.

| Fichier | Nature du changement |
|---|---|
| `src/js/barre-fenetre-assistant-seul.test.js` | **2 verrous ajoutes** (12 tests au lieu de 10) : (a) le ⚙ doit rester le **dernier** element de la barre *apres* le deplacement de l'entree « Travail » ; (b) le dernier bouton ne doit porter **aucune marge** qui decollerait le bord droit |
| `spec_super_agent.md` | section « Technique — angle haut droit du mode « Assistant seul » » **reecrite** : elle decrivait encore la reservation de 150 px abandonnee (mensonge sur le disque) ; elle decrit maintenant le placement reel, les trois jetons, les deux defauts successifs et le verrou de 12 tests |
| `RAPPORT-boutons-assistant-seul-2.md` | ce rapport (reecrit avec des mesures de rendu reelles) |

Pourquoi ces deux verrous : le bord droit de la barre est **son dernier enfant
dans le flux**. Le ⚙ n'est dernier que parce que `enterImmersive()` insere
`#agent-activity` *devant* le bloc des agents (`super-agent.js:3517`). Si une
evolution future l'inserait apres le ⚙, le bord droit deviendrait le compteur
« Travail » et l'alignement demande serait perdu **en silence** — aucun test
existant ne le voyait. Idem pour une marge ajoutee sur `.sa-immersive-settings`.

---

## 3. Comment l'alignement a ete verifie (mesure, pas calcul sur papier)

Le rendu a ete **reproduit pour de vrai** : un harnais HTML (hors depot) charge
la **feuille reelle** `src/css/style.css` et reproduit le DOM reel du coin haut
droit (`#tab-row` + `#window-controls` + overlay `.superagent-immersive` avec sa
barre, l'entree « Travail » deplacee, le point et le ⚙), servi en local et
ouvert dans un navigateur. Les rectangles ont ete lus par
`getBoundingClientRect()` — donc les valeurs ci-dessous sont des **mesures de
rendu**, plus des valeurs lues dans le CSS.

Resultats en 1280 px (theme clair ; chiffres identiques en sombre) :

| Element | x | y | largeur | bord droit |
|---|---|---|---|---|
| Bouton Fermer (systeme) | 1230 | 4 | 46 | **1276** |
| ⚙ Options de l'assistant | 1238 | 49 | 38 | **1276** |
| Point des agents | 1212 | 60 | 10 | 1222 |
| Barre du mode | 0 | **36** | 1280 | 1280 |
| Groupe systeme | 1138 | 0 | 142 | 1280 |

Lecture :

- **meme bord droit** : 1276 pour le ⚙ et pour le bouton Fermer -> alignes a
  droite sur la colonne des boutons systeme ;
- **en dessous** : la barre commence a `y = 36`, soit exactement au bas de la
  rangee systeme ; le ⚙ occupe `49 a 80`, entierement sous les boutons systeme
  (`4 a 32`) ;
- ecart au bord de la fenetre : **4 px**, identique pour les deux (aucun bouton
  colle au bord).

### 3.1 Aucune zone invisible ne recouvre les boutons systeme

Test `document.elementFromPoint()` au **centre** de chaque bouton systeme, et au
centre du ⚙ : l'element rendu est bien celui du bouton (ou son enfant `<svg>`),
dans les deux largeurs testees. Donc les boutons systeme restent **cliquables**,
et rien de l'overlay ne les recouvre.

### 3.2 Chevauchement geometrique

Test de recouvrement entre la bande des trois boutons systeme et la bande de la
barre du mode : **faux** (aucun recouvrement) en 800 px et en 1280 px.

---

## 4. Cas genants testes

| Cas | Mesure | Verdict |
|---|---|---|
| Fenetre **800 px** (largeur minimale `tauri.conf.json`) | ⚙ bord droit 796 / Fermer 796 ; barre `y = 36` ; `scrollWidth = clientWidth = 800` | **OK**, aucun debordement, aucun chevauchement |
| Fenetre **1000 px** | ⚙ 996 / Fermer 996 | **OK** |
| Fenetre **1280 px** | ⚙ 1276 / Fermer 1276 | **OK** |
| Bandeau **deja charge** (retour + titre + « Travail » + compteur + point + ⚙) | contenu minimal a gauche = 18 + 38 + 12 + 34 + 12 + 92 = **206 px** ; les deux boutons de droite sont pousses par `margin-left: auto` | **OK**, la barre ne pousse rien et ne sort pas |
| Thème **sombre** et thème **clair** | geometries **identiques** (aucune couleur introduite par le placement) | **OK** |
| Zoom / echelle DPI | toutes les valeurs sont en px CSS du meme document (46 px, 4 px, 36 px) : elles changent d'echelle ensemble | **OK par construction** |
| Clavier | les 4 boutons de la barre sont des `<button>` ; regle globale `button:focus-visible { outline: 2px solid var(--accent) }` (`style.css:11368`) | **OK** |
| Infobulles | « Revenir au mode standard », « Suivi du travail », « Agents au travail / au repos — afficher la liste » + `aria-label="Agents"`, « Options de l'assistant » | **OK** |

**Ce que je n'ai pas pu faire** : ouvrir l'application Pilot elle-meme (pas de
session graphique ici). La reproduction ci-dessus utilise la **vraie feuille** et
le **vrai DOM** reconstruit a la main ; le rendu du WebView2 de Tauri peut
differer a la marge (polices, echelle), pas sur ces alignements en px.

---

## 5. Resultat des tests

```
npx vitest run src/js/barre-fenetre-assistant-seul.test.js
  PASS (12)  FAIL (0)          <-- 10 avant cette passe, 12 apres (2 verrous ajoutes)

npm test                       (suite complete, Vitest)
  Test Files  191 passed (191)
      Tests  3350 passed (3350)

npm run build:handbook         (aide integree)
  45 blocs regeneres, AUCUN changement de help/handbook.md
  -> la section reecrite de spec_super_agent.md n'est PAS un bloc HELP
```

Aucun fichier Rust n'est touche : `cargo test` n'est pas concerne.

Ce que les deux verrous ajoutes empechent, verifie en les desactivant un par un
(le test doit rougir, sinon il ne verrouille rien) :

| Sabotage temporaire | Test qui rougit |
|---|---|
| `insertBefore(activity, agentsHost)` -> insertion apres le dernier enfant | « le ⚙ reste le DERNIER bouton de la barre » |
| `margin-right: 6px` ajoutee a `.sa-immersive-settings` | « aucune marge qui decollerait le bord droit » |

---

## 6. Desaccord signale (non corrige tout seul)

**1. L'application installee ne contient pas la correction.** Le proprietaire
regarde `v0.5.0`, qui porte encore l'ancienne position (§1.3). Tant qu'une
nouvelle version n'est pas construite, l'ecran **ne peut pas** montrer le
placement demande, quel que soit le travail sur le disque. Cette mission
n'autorise ni publication ni tag : je n'ai donc **rien publie**. A trancher par
le proprietaire : construire/installer une version qui contient `7e8f28c` (et
les commits suivants) avant de re-juger le coin haut droit.

**2. Ecart vertical restant, non tranche.** Le ⚙ commence 17 px sous le bouton
Fermer (4 px de bas de rangee + 13 px de haut de barre : les boutons du panneau
sont **centres** dans une barre de 58 px). Cela se lit comme « en dessous »,
mais si le proprietaire veut les voir **colles** sous les boutons systeme, il
faut decider de changer l'alignement vertical **dans** la barre (le titre et le
bouton retour suivraient, et la maquette V4 a valide cette hauteur de 58 px).
Je n'ai pas pris cette decision de design a sa place.

**3. Le point des agents n'est pas sur le bord.** Il est a 25 px du bord droit
(le ⚙ occupe les 4 derniers px, il est a sa gauche par construction : ordre
point puis ⚙). Ce n'est pas corrigeable sans changer l'ordre ou le contenu, ce
que la mission interdit.

---

## 7. Reste a faire

- Construire une version qui contient `7e8f28c` et re-juger **a l'oeil** (point
  n° 1 du §6) : onglet 🧭 -> Ctrl+Shift+A, puis agrandir / restaurer / reduire.
- Trancher, si besoin, l'ecart vertical du §6 point 2 (reglable a **un seul
  endroit**, `--window-controls-height` ou l'alignement de la barre ; le test
  recalcule, il ne fige pas la valeur).
- Aucune publication : commit local seulement, conformement a la consigne.

---

## 8. Vérifications effectuees (quality-gate)

- [x] Tous les fichiers concernes lus en entier (`style.css` autour du coin,
      `super-agent.js` de la barre a `enterImmersive`, `agent-activity.js` du
      point, le test existant, la spec).
- [x] Points de connexion verifies : `#window-controls` (index.html), les trois
      jetons (`:root`), la barre (CSS + JS), l'entree « Travail » deplacee, le
      point (`agent-activity.js`), la regle de focus globale.
- [x] Ce qui doit continuer a fonctionner : boutons systeme (place, taille,
      `z-index`), hauteur de la barre (58 px), air de gauche (18 px), mode normal,
      colonne de gauche (280 px), bandeau (48 px), thèmes.
- [x] Test cible relance apres modification : 12/12.
- [x] Fin de ligne : les tests lisent le source avec `.replace(/\r\n/g, "\n")`
      (quality-gate §3.4) ; aucune ancre multi-ligne ajoutee sans cette garde.
- [x] Aucun fichier hors perimetre modifie, rien supprime, aucun garde-fou
      contourne, aucune commande Git de nettoyage/reset.
