# Rapport — le badge « Distant » rejoint la ligne du moteur, en bas de la colonne

> Mission : déplacer le badge `#remote-badge` (« Distant ») du haut de la colonne
> de gauche vers le **bas** de la colonne, **à droite** de la ligne d'information
> qui nomme le moteur, et récupérer la ligne libérée en haut.
> Décision du propriétaire n° 375 (base de suivi de l'assistant) : *« Le badge
> descend EN BAS de la colonne de gauche, à DROITE de la ligne d'information qui
> nomme le moteur (du genre « Agent Pi (Suivi) »). »*
>
> Aucun envoi vers GitHub, aucun tag, aucune publication. Un seul commit local.

---

## 1. État AVANT (constaté sur le disque, `fichier:ligne`)

| Élément | Où / combien |
|---|---|
| Badge | `<span id="remote-badge">` **seul enfant** de `<div id="global-actions">` — `index.html:80-82` |
| Conteneur du haut | `#global-actions`, 2ᵉ enfant de `#sidebar`, entre le bandeau du projet (`#project-selector`) et la barre des projets ouverts (`#open-projects-bar`) |
| Hauteur du conteneur | **0 px badge masqué** (`margin: 0; padding: 0`), **44 px badge affiché** (`.remote-badge { margin: 8px 8px 8px auto; height: 28px }` — `src/css/style.css:7332`) |
| Largeur du badge | `width: auto`, contenu ≈ 89 à 98 px (icône 14 + « Distant » 11 px/600 + compteur) |
| Ligne qui nomme le moteur | `<span id="project-engine" class="project-engine">` — **dans le bandeau**, sous le nom du projet (`#project-identity`, `index.html:44`) ; texte écrit par `main.js:634` (`"Moteur · " + agentDisplayLabel()`) |
| Bas de la colonne | `#project-footer` (bloc accentué, SEPT lignes de 32 px = **278 px**), dernier enfant de `#sidebar` |
| Largeur de la colonne | `#sidebar { width: 280px; min-width: 280px }` — `src/css/style.css:754` |
| Hauteur minimale de fenêtre | `minHeight: 500` — `src-tauri/tauri.conf.json` |
| Tests avant modification | `npx vitest run` → **PASS (3288) FAIL (0)** |

### 1.1 Le point à trancher (dit franchement)

La décision 375 parle de « la ligne d'information **du bas** qui nomme le
moteur ». Sur le disque, **cette ligne n'existe pas en bas** : la seule ligne qui
nomme le moteur dans la colonne est `#project-engine`, et elle vit **en haut**
(sous-titre du bandeau d'identification, décision Q1 = option b). Il n'y a
**aucune** autre ligne d'information dans le bas de la colonne : le bloc du bas
ne contient que des boutons.

Deux issues possibles, aucune sans coût :

1. créer une **seconde** ligne « moteur » en bas → le même texte s'afficherait
   deux fois dans la même colonne (information dupliquée, et donc deux sources
   d'affichage à garder d'accord) ;
2. **descendre** la ligne `#project-engine` elle-même en bas de la colonne, et
   poser le badge à sa droite → une seule ligne, un seul texte, un seul
   emplacement, et la décision 375 est tenue à la lettre.

C'est la solution 2 qui est appliquée. Conséquence assumée, écrite ici pour être
vérifiable à l'écran : **le bandeau du haut ne porte plus le sous-titre du
moteur** ; sa hauteur (48 px), son logo et son bouton « Projets » ne changent
pas. Le sous-titre garde **le même identifiant** (`#project-engine`), la **même
classe** (`.project-engine`), le **même texte** et la **même source unique**
(`backend-info.js` via `main.js`).

---

## 2. État APRÈS

| Élément | Où / combien |
|---|---|
| Badge | `<span id="remote-badge">` dans `<div id="sidebar-engine-row">`, **dernier élément de `#sidebar`**, sous le bloc accentué des menus |
| Ligne d'information | `#sidebar-engine-row` : `#project-engine` (texte du moteur) **puis** `#remote-badge` → le badge est **à droite** du texte |
| Conteneur du haut | `#global-actions` **vide**, `margin: 0; padding: 0` → **0 px** en permanence (la ligne est rendue à la liste des fichiers) |
| Hauteur de la ligne du bas | **28 px** (celle du badge) + 8 px de marge basse = 36 px, **fixes** : l'arrivée d'un client ne fait pas sauter la liste |
| Largeur de la colonne | **280 px** (inchangée, aucune largeur écrite sur la ligne) |
| Badge | identifiant, classe, libellé « Distant », compteur, icône 🌐, infobulle et **clic → Réglages** inchangés ; 28 px, largeur au contenu, **non cliquable autrement** |
| Bandeau du haut | **48 px**, logo et bouton « Projets » inchangés ; il ne porte plus le sous-titre du moteur (§ 1.1) |
| Fichiers touchés | `index.html`, `src/css/style.css`, `src/js/lot2-colonne-haut.test.js` (deux verrous mis à jour), `src/js/badge-distant-bas.test.js` (nouveau), `spec_pilot.md` + `spec_web_remote.md` (deux lignes de spec devenues fausses) |
| Aucun fichier Rust touché | ✔ (le `src-tauri/src/agents.rs` modifié sur le disque appartient à une autre mission : **non committé ici**) |

---

## 3. Mesures AVANT / APRÈS

Les valeurs ci-dessous ne sont pas des estimations : la colonne réelle
(`index.html` + `src/css/style.css`, extraits tels quels) a été chargée dans un
navigateur et mesurée (`getBoundingClientRect`).

| Mesure | Avant | Après |
|---|---|---|
| Largeur de la colonne | 280 px | **280 px** |
| Hauteur du bandeau du haut | 48 px | **48 px** |
| Hauteur du conteneur du haut | 44 px badge affiché / 0 px masqué | **0 px** en permanence |
| Position du badge | rangée propre en haut, sous le bandeau | **sous le bloc des menus**, en bas de la colonne |
| Hauteur de la ligne d'accueil | — | **28 px** (identique badge affiché ou masqué) |
| Badge : largeur × hauteur | 82,2 × 28 px | **82,2 × 28 px** (identique) |
| Badge : bord droit | bord droit de la rangée du haut | **263 px** = bord intérieur droit de la ligne (il touche l'inset, il ne le dépasse pas) |
| Texte du moteur, libellé long | tronquait dans le bandeau | **tronque** (`scrollWidth > clientWidth`) ; le badge **ne bouge pas** (x inchangé) |
| Badge masqué | 0 px, texte sur toute la largeur | 0 px, texte = **247 px** (toute la largeur intérieure) |
| Débordement horizontal de la page | aucun | **aucun** |
| Fenêtre minimale 500 px | — | bandeau 48 + ligne 28 : la ligne **tient dans la fenêtre**, sous le bloc des menus |

---

## 4. Tests

| Moment | Commande | Résultat |
|---|---|---|
| Avant toute modification | `npx vitest run` | **PASS (3288) FAIL (0)** |
| Après modification | `npx vitest run` | **PASS (3301) FAIL (0)** (+13 = le nouveau fichier) |

Nouveau verrou : `src/js/badge-distant-bas.test.js` — **13 tests**. Il **recalcule
toutes ses valeurs depuis le disque** (largeur de la colonne, hauteurs, marges,
padding, `gap`, taille de police, icône, nombre de lignes du bloc des menus,
fenêtre minimale) : aucun nombre n'est figé. Il vérifie que le badge est dans la
ligne du bas **et plus en haut**, qu'il est **après** le texte du moteur, que la
ligne **ferme** la colonne, que le haut ne laisse **aucun trou**, que la colonne
reste à 280 px et que **le texte se réduit avant le badge** (`min-width: 0` +
ellipse, badge `flex: 0 0 auto`), que rien n'est rogné (ligne = hauteur du badge),
que le badge **n'est pas un bouton** et garde son libellé, son compteur, son
infobulle et son clic, et que le bandeau garde ses 48 px et son logo.

Contre-épreuve faite : le badge **remis en haut** de la colonne fait **rougir 5
tests** de ce fichier (dont celui qui porte la décision). État restauré ensuite
(`index.html` identique à l'octet près avant/après l'essai).

Deux verrous de `src/js/lot2-colonne-haut.test.js` ont été **mis à jour**, pas
supprimés, parce que la décision 375 change leur vérité : le badge n'est plus
dans `#global-actions`, et le sous-titre du moteur n'est plus dans le bandeau. Le
reste du fichier (bandeau 48 px, nom 15 px, bouton « Projets », aucun bouton en
haut, cadre accent unique, couleurs par jetons) est inchangé et passe.

---

## 5. Ce qui n'a PAS pu être vérifié à l'écran

- **Aucun lancement de l'application** (`npm run tauri dev` n'a pas été exécuté) :
  les mesures viennent d'une page de test qui reprend la colonne et la feuille de
  style réelles, pas de la fenêtre Tauri.
- **Le libellé réel du moteur** n'a pas été affiché par la vraie sonde
  (`backend-info.js`) : le texte a été posé à la main dans la page de mesure.
- **Un vrai client distant** n'a pas été connecté : le badge a été affiché par
  classe, pas par `web_status`.
- **Le mode « Assistant seul »** n'a pas été basculé : la ligne est un enfant de
  `#sidebar`, elle disparaît donc avec la colonne, mais cela n'a pas été vu.
- **Le bloc des menus à 7 lignes (278 px)** n'a pas été mesuré en conditions
  réelles avec un projet ouvert (dans la page de mesure, les lignes `project-only`
  sont masquées, d'où 94 px) : son plafond reste verrouillé par
  `lot3-colonne-bas.test.js`, que la ligne d'info ne touche pas (elle est **hors**
  du cadre du bas).
- **Rendu à d'autres échelles** (zoom Windows, 125 %/150 %, autre police) non
  mesuré : les tailles viennent des jetons de thème, rien n'est écrit en dur.

---


## 6. Ce qui est resté intact (vérifié, pas supposé)

- Largeur de la colonne **280 px** ; bandeau du haut **48 px** et logo validé ;
  bloc des menus du bas **inchangé** (7 lignes, ordre figé, 278 px, verrou du
  LOT 3 toujours vert).
- Badge : même identifiant, même classe, même libellé « Distant », même compteur,
  même icône, même infobulle, **même clic** (il ouvre les Réglages) ; il n'est pas
  devenu un bouton, il n'a pas grossi.
- Texte du moteur : même identifiant `#project-engine`, même classe, **même
  texte**, **même source unique** (`backend-info.js` via `main.js`), et il suit
  toujours la re-sonde du backend ; **jamais dupliqué** (un seul élément dans la
  page).
- Modes « Assistant seul » et normal : la ligne est un enfant de la colonne, elle
  suit la colonne (rien n'est accroché à la fenêtre).
- Aucun bouton, réglage ni fonctionnalité ajouté ; aucun fichier Rust, aucun plan
  éditable, aucun document d'aide (`help/`) touché — `npm run build:handbook`
  relancé : `help/handbook.md` **inchangé**.
- Aucun rapport supprimé.

## 7. Commit

Un seul commit local, en français :

```
style(colonne): le badge Distant rejoint l'info du moteur en bas
```

Aucun envoi vers GitHub, aucun tag, aucun changement de version.

---

## 8. Second passage (re-verification sur le disque et a l'ecran)

Le deplacement demande par la decision 375 **etait deja fait** sur le disque
(commit `9db5ea7`, « style(colonne): le badge Distant rejoint l'info du moteur en
bas »). Ce second passage n'a donc rien eu a deplacer : il a **re-verifie**
l'emplacement, la tenue de la colonne et la lisibilite, et n'a **modifie aucun
fichier de code**.

### 8.1 Ou se trouve le badge aujourd'hui (fichier:ligne, verifie)

| Element | Emplacement reel |
|---|---|
| Badge | `<span id="remote-badge" class="remote-badge hidden">` — `index.html:233`, **apres** `<span id="project-engine">` (`index.html:232`) dans `<div id="sidebar-engine-row">` |
| Ligne d'accueil | `index.html:231-234`, **dernier element de `<aside id="sidebar">`** (donc sous le cadre accentue `#project-footer`, qui commence `index.html:141`) |
| Conteneur du haut | `#global-actions` — `index.html:85`, **vide** (aucun enfant) |
| Style de la ligne | `src/css/style.css:816-836` (`#sidebar-engine-row`), texte elastique `:833` |
| Style du badge | `src/css/style.css:7418-7458` (`.remote-badge`, `:not(.off)`, `:hover`, `.off`, `.hidden`) |
| Texte du moteur | ecrit par `src/js/main.js:629-641` (`syncEngineSubtitle`, source unique `backend-info.js`) |
| Comportement du badge | `src/js/settings.js:3194` (clic → Options) et `3195-3212` (`pollRemoteBadge` : connecte / hors service / masque, sonde `web_status` toutes les 5 s) |

### 8.2 Preuve que la colonne ne deborde pas (mesure dans un navigateur)

La page de mesure reprend **telle quelle** la feuille `src/css/style.css` et le
bloc `<aside id="sidebar">` de `index.html` (commentaires HTML retires). Elle a
ete chargee dans Chrome et mesuree par `getBoundingClientRect()`, avec un projet
ouvert (sept lignes du bloc du bas, classe `pj-replie` retiree) et un client
distant connecte (compteur a 3), a la **hauteur de fenetre minimale de 500 px**
(`minHeight: 500` de `tauri.conf.json`).

| Mesure | Valeur relevee | Attendu | Verdict |
|---|---|---|---|
| Largeur de la colonne | **280 px** | 280 px figes | conforme |
| Hauteur du cadre des menus (7 lignes) | **278 px** | 278 px, plafond 60 % = 300 px | conforme |
| Hauteur de la ligne du badge | **28 px** | 28 px, une seule ligne | conforme |
| Badge × ligne | hauteur 28 px, aligne au centre de la ligne (ecart vertical < 1,5 px) | meme ligne | conforme |
| Bord droit du badge | **263 px** | ≤ bord interieur droit de la ligne (263 px) | ne sort pas |
| Bas de la ligne | **492 px** | ≤ bas de la colonne (500 px) | tient dans la fenetre |
| Ligne sous le cadre des menus | haut de ligne 464 px ≥ bas du cadre 457 px | aucun recouvrement | conforme |
| Largeur du badge | 82,2 px (largeur au contenu, inchangee) | identique a avant | conforme |
| Libelle de moteur long | texte tronque (`scrollWidth > clientWidth`), **badge immobile** (x = 181 px avant et apres) | le texte cede avant le badge | conforme |
| Badge masque | largeur 0 px, texte = 247 px (toute la largeur interieure), ligne toujours a 28 px | aucun saut de la liste | conforme |
| Place restante pour la liste des fichiers | **146 px** a 500 px de haut | > 0 | conforme |
| Debordement horizontal de la page | **aucun** | aucun | conforme |
| Ordre dans la ligne | `["project-engine", "remote-badge"]` | texte d'abord, badge a droite | conforme |
| Badge = dernier enfant de la colonne | `sidebar.lastElementChild === #sidebar-engine-row` | oui | conforme |

### 8.3 Le badge ne capte pas le clic d'une action voisine

`document.elementFromPoint()` au centre du badge renvoie le libelle du badge
lui-meme (`.remote-badge-label`, donc `#remote-badge` ou un de ses enfants) : il
n'y a **aucun autre element sous le badge**. Juste au-dessus de la ligne, le
meme test renvoie **`#project-footer`** : le badge ne recouvre aucune ligne de
menu, et aucun bouton ne se trouve dans son rectangle. Le badge n'est **pas un
`<button>`** (il reste un `<span>`), garde `cursor: pointer` et le meme clic vers
les Options : ce n'est pas une action nouvelle.

### 8.4 Lisibilite dans les deux themes (jetons de theme, mesures)

| Etat | Theme sombre | Theme clair |
|---|---|---|
| Connecte (`.remote-badge`) | `#4ade80` sur `#1e2128` → **9,25:1** | `#30a46c` sur `#f0f1f4` → **2,80:1** |
| Hors service (`.off`) | `#a0a6b4` sur `#1e2128` → **6,60:1** | `#5a6170` sur `#f0f1f4` → **5,50:1** |
| Texte du moteur | `#a0a6b4` → **8,61:1** | `#5a6170` sur `#f4f5f7` → **5,70:1** |

Le theme sombre est confortable dans les trois etats. Le theme clair est
conforme **sauf l'etat connecte** (2,80:1 pour un libelle de 11 px / 600, alors
que le seuil AA du texte courant est 4,5:1).

### 8.5 Ecart signale, NON corrige (decision du proprietaire)

Le contraste faible de l'etat connecte **en theme clair** ne vient pas du
deplacement : le badge portait **deja** `color: var(--success)` avant, et le
jeton clair `--success` vaut `#30a46c` (`src/css/style.css:469`). Le corriger
serait un choix de palette, pas un deplacement : il n'a donc **pas** ete fait.
Deux pistes possibles, aucune appliquee :

1. une regle de theme clair propre au badge, `body.theme-light .remote-badge:not(.off) { color: #1f7a4d }` → **4,71:1** (mesure), sans toucher au jeton `--success` ni a la taille du badge ;
2. changer le jeton clair `--success` (`#30a46c` → `#1a7f37` = **4,50:1**), ce qui toucherait **tous** les usages du vert dans le theme clair (badges Git, toasts, etats d'agents...).

### 8.6 Tests apres ce second passage

| Commande | Resultat exact |
|---|---|
| `npx vitest run src/js/badge-distant-bas.test.js` | **PASS (13) FAIL (0)** |
| `npm test` (suite complete) | **PASS (3348) FAIL (0)** — fichiers 0 en echec |

Aucun test n'a ete modifie ni supprime : ceux qui verrouillent l'emplacement
decrivent deja le nouvel emplacement (bas de colonne, a droite du moteur).
Aucune documentation d'aide (`help/`) ne cite l'emplacement du badge ;
`spec_pilot.md:35-36` le decrit deja au bon endroit.

### 8.7 Ce qui reste a faire

- Trancher l'ecart 8.5 (contraste en theme clair) : rien d'autre n'est en attente.
- Voir a l'ecran, dans l'application lancee, ce que la page de mesure ne montre pas : mode « Assistant seul », vrai client distant connecte, rendu a 125 % / 150 % de zoom systeme.
