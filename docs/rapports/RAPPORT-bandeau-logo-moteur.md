# RAPPORT — la zone haute : le logo, et le mot « Agent Pi »

Deux demandes du propriétaire, après essai de la version installée :

1. « J'aimerais aussi agrandir un peu le logo de Pilot en haut à gauche, il est un peu petit je trouve. »
2. « À quoi correspond "Agent Pi" en dessous du mot "Pilot" en haut à droite ? Si c'est le même que "Agent Pi (Suivi)" indiqué dans l'onglet assistant tout en bas, alors on enlève ce qu'il y a dans le chat ? »

Ce document est une **proposition écrite**. Aucun fichier de code n'a été modifié.

**Réponse en deux phrases.** Le logo peut passer de 20 à **24 px** sans toucher à rien d'autre (le
bandeau garde sa hauteur, les trois boutons du coin haut droit gardent leur air) — au-delà, il faut
rouvrir la décision des 48 px. Et le mot « Agent Pi » du bandeau **n'est pas** un doublon à
supprimer : c'est le **moteur** (Pi ou PLh) sur lequel Pilot tourne, à l'endroit exact où vous avez
décidé qu'il vit ; celui du bas dit **la même chose, plus le contexte** (« suivi »), et il est le
seul à rester lisible quand la colonne de gauche est masquée (F11).

---

## 0. Ce que j'ai lu pour répondre (preuves)

| Sujet | Fichier:ligne |
|---|---|
| Bandeau de gauche : structure et ordre (logo · mot « Pilot » · sous-titre · bouton « Projets ») | `index.html:40-52` |
| Bandeau : 48 px, remplissage `8px 8px 8px 16px`, filet bas 1 px, `gap: 8px` | `src/css/style.css:1039-1049` |
| Logo du bandeau : `height: 20px; width: auto` | `src/css/style.css:1102-1107` |
| Mot « Pilot » : 15 px / 600, interligne 1,2 | `src/css/style.css:1109-1123` |
| Sous-titre du moteur : 11 px, interligne 1,2, couleur `--text-secondary` | `src/css/style.css:1128-1137` |
| Bloc identité : colonne, `flex: 1`, `min-width: 0`, `gap: 1px` | `src/css/style.css:1054-1061` |
| Bouton « Projets » : 28 px de haut, poussé à droite | `src/css/style.css:1063-1086` (hauteur ligne 1082) |
| Largeur de la colonne : 280 px (minimum), jamais moins | `src/css/style.css:740-741` ; `src/js/sidebar.js:1719` (`Math.max(280, …)`, maximum 600) |
| Fenêtre : minimum 800 × 500 | `src-tauri/tauri.conf.json:47-48` |
| Le logo est une **image** (aucun gestionnaire de clic nulle part) | `index.html:41` ; `#btn-project-logo` n'apparaît **que** dans le CSS et le HTML |
| Le bandeau est une **zone de déplacement de la fenêtre** | `src/js/window-controls.js:56` (`WINDOW_DRAG_ZONE_IDS`), `:63-65` (garde-fou : seuls boutons/liens/champs bloquent) |
| Dessin du logo : encre comprise entre x 30→188 et y 16→210 sur une boîte 224 × 225 | `public/logo_pilot_vector.svg:1` et les 4 tracés `path` du fichier |
| D'où vient le sous-titre du moteur | `src/js/main.js:628-632` → `src/js/backend-info.js:69-71` |
| Sonde du moteur : le chemin configuré, comparé à `--version` | `src-tauri/src/lib.rs:1881-1900` ; re-sonde sur changement de réglage : `src/js/main.js:635-638` |
| La barre du bas pour l'onglet Assistant affiche `${agentDisplayLabel()} (Suivi)` | `src/js/tabs.js:2360-2363` |
| La barre du bas pour l'onglet agent affiche `${agentDisplayLabel()} (RPC)` | `src/js/tabs.js:2354-2355` |
| L'Assistant démarre avec **le même** moteur configuré (`cfg.rpc_pi_path`) | `src-tauri/src/super_agent.rs:252-259` et `:284-287` |
| L'Assistant peut avoir **son propre modèle**, réglé à part | `src-tauri/src/super_agent.rs:276-283` ; choix visible dans l'onglet : `src/js/super-agent.js:2735` |
| F11 (mode Zen) masque toute la colonne de gauche | `src/css/style.css:3802-3806` ; `src/js/main.js:324` (raccourci déclaré ligne 67) |
| Décision : le sous-titre du moteur vit **dans le bandeau** (Q1 = option b) | `docs/proposition-presentation-ui.md:554-561` ; `RAPPORT-lot2-presentation-colonne-haut.md` |
| Décision : 4 px d'air autour des trois boutons du coin haut droit (Q1 = option 1) | `RAPPORT-coin-haut-droit.md` |
| Décision : colonne de gauche fixe à 280 px (Q3 = option a) | `docs/proposition-presentation-ui.md:572-579` |

---

# 1. Le logo — constat, puis taille retenue

## 1.1 Ce qui existe aujourd'hui, mesuré

| Grandeur | Valeur réelle | Preuve |
|---|---|---|
| Hauteur du bandeau | **48 px** | `style.css:1040` |
| Place utile dans le bandeau (hauteur − remplissages − filet) | 48 − 8 − 8 − 1 = **31 px** | `style.css:1040-1042` |
| Boîte du logo | **20 px de haut**, 19,9 px de large (image proportionnée 224 × 225) | `style.css:1102-1107` ; `logo_pilot_vector.svg:1` |
| **Dessin réellement visible** (l'encre) | **14,0 × 17,2 px** seulement | image : encre de y 16 à 210 sur 225 → 86 % de la hauteur |
| Marge transparente **dans** l'image, autour du dessin | gauche 2,7 px · droite 3,2 px · haut 1,4 px · bas 1,3 px | idem |
| Air au-dessus / au-dessous de la boîte | 5,5 px / 5,5 px | (31 − 20) / 2 |
| Air réellement vu au-dessus / au-dessous du dessin | 6,9 px / 6,8 px | 5,5 + 1,4 / 5,5 + 1,3 |
| Distance du bord gauche de la colonne au **dessin** | **18,7 px** (16 px de remplissage + 2,7 px transparents) | `style.css:1041` |
| Hauteur du texte à côté du logo | 18 px (mot) + 1 px + 13,2 px (sous-titre) = **32,2 px** | `style.css:1114` (mot), `:1130` (sous-titre), `:1060` (écart de 1 px) |
| Largeur laissée au mot « Pilot » et au sous-titre | **144,6 px** | 280 − 16 − 8 − 19,9 − 16 − 75,5 |
| Hauteur / largeur du bouton « Projets » | 28 px / 75,5 px | `style.css:1063-1086` (hauteur ligne 1082) ; `RAPPORT-lot2-presentation-colonne-haut.md` |

**Deux constats qui expliquent le « il est un peu petit » :**

1. À 20 px de boîte, le dessin ne fait que **17,2 px de haut et 14 px de large** : le fichier du logo
   contient des marges transparentes autour du dessin (environ 14 % de la largeur et 14 % de la
   hauteur). Votre œil voit donc 17 px là où le code dit 20.
2. Le bloc de texte à côté est **déjà 1,2 px plus haut que la place disponible** (32,2 px pour 31 px
   utiles). Le bandeau est donc **plein côté texte** : c'est la marge de manœuvre exacte pour le logo.

## 1.2 Taille retenue : **24 px** (+4 px, soit +20 %)

| Grandeur | Aujourd'hui | Cible | Écart |
|---|---|---|---|
| Boîte du logo | 20 px | **24 px** | +4 px |
| **Dessin vu** | 14,0 × 17,2 px | **16,9 × 20,7 px** | **+2,8 × +3,5 px** |
| Air au-dessus / au-dessous de la boîte | 5,5 / 5,5 px | 3,5 / 3,5 px | −2 px |
| Air réellement vu autour du dessin | 6,9 / 6,8 px | 5,2 / 5,1 px | −1,7 px |
| Place du mot « Pilot » et du sous-titre | 144,6 px | 140,6 px | −4 px (le nom tronque 4 px plus tôt, ellipse déjà en place) |
| Hauteur du bandeau | 48 px | **48 px (inchangée)** | 0 |
| Bouton « Projets » | x = 195,5 | **inchangé** | 0 |
| Trois boutons du coin haut droit | air de 4 px | **inchangé** (autre rangée, aucun contact) | 0 |
| Largeur de la colonne | 280 px minimum | **inchangée** | 0 |

**Pourquoi 24 et pas 26 ou 28.**

- **24 px** est la plus grande valeur qui laisse **au moins 3,5 px d'air** au-dessus et au-dessous à
  l'intérieur du bandeau de 48 px. C'est le même ordre que les **4 px d'air** que vous avez décidés
  autour des trois boutons du coin haut droit : le bandeau et la rangée d'onglets respirent pareil.
- **26 px** tombe à 2,5 px d'air et **28 px** à 1,5 px : le dessin vient toucher le filet du bas, et le
  logo devient aussi haut que le bouton « Projets », donc plus « gros » que les actions.
- **32 px et au-delà** : impossible sans agrandir le bandeau, donc sans rouvrir la décision des 48 px.

**Maximum tenable sans rien rouvrir : 28 px** (1,5 px d'air en haut et en bas, dessin de 24,1 × 19,7 px).
C'est le plafond technique ; je ne le recommande pas, le bandeau paraît alors rempli à bloc.

**Ce que je ne touche pas, et pourquoi :** je ne recadre **pas** le fichier du logo. Ce même fichier
sert aussi au grand logo de l'écran de chargement (160 px) et au filigrane de la zone vide
(`style.css:35-39` et `:894-900`) : un recadrage rapetisserait le dessin à ces deux endroits aussi.
On agit donc sur **la seule taille d'affichage du bandeau** (une valeur).

## 1.3 États, contraste, fenêtre étroite

**États.** Le logo n'a **aucun** état : ni survol, ni appui, ni désactivé, ni focus — ce n'est pas un
bouton (aucun gestionnaire de clic, vérifié par recherche exhaustive). **Il doit le rester** : le
bandeau est une des deux surfaces qui déplacent la fenêtre, et seuls les boutons, liens et champs
bloquent ce geste (`window-controls.js:63-65`). Un logo transformé en bouton retirerait une zone de
glissement et exigerait trois états de plus : hors sujet.

**Contraste.** Le logo est une image : il ne suit **aucun** des 10 thèmes (2 thèmes de base + 8
sous-thèmes, `src/js/theme.js:8-20`). Mesuré sur les couleurs du fichier :

| Partie du dessin | Thème sombre (#0f1115) | Thème clair (#f4f5f7) |
|---|---|---|
| Cyan clair (#55D9D3) | 11,02:1 — net | **1,57:1 — presque invisible** |
| Bleu (#19B9E8) | 8,23:1 | **2,10:1 — très pâle** |
| Indigo (#6654E9) | **3,61:1 — faible** | 4,80:1 — net |

Conséquence honnête : **agrandir aide surtout en thème clair** (plus de surface pour un dessin pâle),
mais **ne corrige pas** la pâleur du logo en thème clair : sur les 5 palettes claires, la partie cyan
reste entre **1,33 et 1,64:1**. C'est un sujet distinct (voir question Q3).

**Fenêtre étroite.** Aucun effet : la colonne de gauche garde 280 px de large au minimum
(`style.css:740-741`, `sidebar.js:1719`) et la fenêtre s'arrête à 800 px de large
(`tauri.conf.json:47`). Le bandeau a donc **exactement la même géométrie** à 800 px et à 1920 px : la
valeur retenue ne dépend pas de la taille de la fenêtre.

---

# 2. Les deux libellés — identification certaine

## 2.1 Le mot « Pilot » (au-dessus) et le sous-titre (en dessous)

**Sur votre mot « en haut à droite » :** ce texte est à **droite du logo**, à l'intérieur du bandeau de
la **colonne de gauche** — c'est le seul endroit de la fenêtre où un « Agent Pi » se trouve **sous** le
mot « Pilot ». Vérifié : le mot « Pilot » seul n'est écrit qu'une fois dans la fenêtre, à l'endroit
précis où le sous-titre se trouve juste en dessous (`index.html:43` puis `:44`) ; il n'y a **aucun**
« Pilot » au-dessus d'un « Agent Pi » dans le coin haut droit (là se trouvent les trois boutons de
fenêtre et l'entrée « Travail »).

- Le mot **« Pilot »** est un texte **fixe** écrit dans la page (`index.html:43`). Aucun code ne le
  remplace : il ne s'agit donc **pas** du nom du projet ouvert, mais du **nom de l'application**.
  *(Écart documenté : `docs/proposition-presentation-ui.md:73` et `:488` appellent cette zone « le nom
  du projet ». À trancher — voir Q2.)*
- Le sous-titre **« Agent Pi »** est écrit par l'application au démarrage, sous le mot « Pilot »
  (`main.js:628-632`), avec une seule source : `agentDisplayLabel()` (`backend-info.js:69-71`).

## 2.2 Ce que dit exactement ce sous-titre

Il dit **quel moteur fait tourner les conversations d'agents** : **Pi** ou **PLh**. C'est le résultat
d'une sonde sur l'exécutable configuré (`lib.rs:1881-1900` : on demande sa version et on lit le genre).

**Quand il change de valeur :**

1. au démarrage, dès que la sonde a répondu (asynchrone : le mot s'affiche d'abord « Agent Pi », puis
   se corrige en « Agent PLh » si c'est PLh qui répond) ;
2. quand vous changez l'exécutable de l'agent dans les réglages (`main.js:635-638` → re-sonde →
   événement `pilot-backend-changed` → `main.js:632`).

Il ne dit **jamais** : quel projet est ouvert, quel modèle est utilisé, ni quel agent (rôle) travaille.

## 2.3 Ce que dit exactement « Agent Pi (Suivi) » (en bas)

- **Où** : dans la barre d'état, tout en bas (`index.html:319`, la zone « type de fichier »), qui
  décrit **l'onglet affiché**.
- **Quand** : uniquement quand l'onglet actif est l'onglet **🧭 Assistant** (`tabs.js:2360-2363`).
- **D'où vient le mot** : de **la même fonction**, `agentDisplayLabel()` — donc **la même valeur**,
  au même instant, que le sous-titre du bandeau.
- **D'où vient « (Suivi) »** : de rien d'autre que le contexte de l'onglet. L'onglet agent de codage
  affiche, lui, « Agent Pi (RPC) » (`tabs.js:2354`). C'est le même moteur dans deux contextes :
  **(RPC)** = la conversation de codage, **(Suivi)** = l'assistant de suivi.
- **Quelle session** : la session dédiée de l'Assistant, démarrée avec **le même** exécutable
  configuré (`super_agent.rs:252-259`, `:284-287`), mais avec **son propre modèle**, réglé à part
  (`super_agent.rs:276-283`). Ce modèle-là se choisit et se lit dans l'onglet Assistant lui-même
  (`super-agent.js:2735`) — pas dans la barre du bas.

## 2.4 La comparaison, sans ambiguïté

| Question | Sous-titre du bandeau | « Agent Pi (Suivi) » (barre du bas) |
|---|---|---|
| Même source de valeur ? | **Oui** — `agentDisplayLabel()` | **Oui** — `agentDisplayLabel()` |
| Même information ? | Le **moteur** en service | Le **moteur** en service **+ le contexte de l'onglet** |
| Visible quand ? | **Toujours** (sauf F11 qui masque la colonne) | **Seulement** si l'onglet Assistant est actif |
| Change avec l'onglet ? | Non | **Oui** |
| Ajoute une information ? | Non (c'est la référence) | **Oui** : « suivi » (et « (RPC) » sur l'autre onglet) |

**En une phrase :** en haut, « Agent Pi » dit **sur quel moteur Pilot tourne** ; en bas, « Agent Pi
(Suivi) » **redit le même moteur** en ajoutant que l'onglet affiché est celui du suivi — **le moteur est
le même, la session ne l'est pas**.

**Ce n'est donc pas un doublon franc, et il y a une raison de garder celui du bas :** en mode Zen
(F11), la colonne de gauche entière disparaît (`style.css:3802-3806`) — le sous-titre du bandeau
n'existe plus, et **la barre du bas devient le seul endroit où le moteur est lisible**.

## 2.5 Pourquoi vous avez eu l'impression d'un doublon (et ce que ça révèle)

Les deux textes sont **rigoureusement identiques** sur trois plans :

| Critère | Bandeau | Barre du bas |
|---|---|---|
| Libellé | « Agent Pi » | « Agent Pi » (suivi de « (Suivi) ») |
| Taille | 11 px (`--font-xs`) | 11 px (`--font-xs`) |
| Couleur | `--text-secondary` | `--text-secondary` |

Même mot, même taille, même couleur, à deux endroits de l'écran : votre lecture « c'est écrit deux
fois » est **juste visuellement**. Et le bandeau, en plus, ressemble à une carte de visite « nom du
projet » + « son agent » — alors qu'il dit « nom de l'application » + « le moteur ».

**Le mot « Agent Pi » est en réalité écrit à cinq endroits** de l'application, tous pour le même
moteur :

| # | Endroit | Source | Fidèle au moteur réel ? |
|---|---|---|---|
| 1 | Sous-titre du bandeau de gauche | `main.js:630` | Oui |
| 2 | Nom de l'onglet de codage (« π Agent Pi », puis « π Agent Pi (RPC) » après une re-sonde) | `tabs.js:295` (le nom), `:3025` (le « π »), `:212` (après re-sonde) | Oui |
| 3 | Barre du bas, onglet agent : « Agent Pi (RPC) » | `tabs.js:2354` | Oui |
| 4 | Barre du bas, onglet Assistant : « Agent Pi (Suivi) » | `tabs.js:2363` | Oui |
| 5 | Onglet des réglages nommé « Agent Pi » | `index.html:469` — **texte figé** | **Non : reste « Agent Pi » même si c'est PLh qui tourne** |

Le seul des cinq qui peut **mentir** est donc le n° 5 (dans les réglages), et il n'est pas dans votre
question : je le signale, je ne le corrige pas (hors périmètre de cette demande).

## 2.6 La décision d'écran est respectée

La décision (Q1 = option b, `docs/proposition-presentation-ui.md:554-561`) dit : **le sous-titre du
moteur va dans le bandeau, pas dans l'onglet**. L'écran la respecte : le bandeau le porte
(`main.js:630`), et **l'onglet Assistant ne le porte pas** — son titre reste « 🧭 Assistant »
(`tabs.js:739`, `:747`) et sa barre d'outils affiche le **modèle**, pas le moteur.

Conclusion : la décision n'est **pas** contredite par l'écran. Il n'y a donc **rien à retirer du
bandeau**.

---

# 3. Recommandation tranchée sur le doublon supposé

**Les deux restent. Aucun des deux ne disparaît.** Et **un seul mot** est ajouté, dans le bandeau,
pour que vous n'ayez plus jamais à poser la question.

| Endroit | Aujourd'hui | Cible | Pourquoi |
|---|---|---|---|
| Bandeau (sous « Pilot ») | « Agent Pi » | **« Moteur · Agent Pi »** | Vous lisez **ce que c'est** sans le demander : c'est le moteur, pas un projet ni un agent de travail. |
| Barre du bas, onglet Assistant | « Agent Pi (Suivi) » | **inchangé** | Le mot « moteur » est dit une fois, en haut ; le bas garde sa forme courte et son « (Suivi) » qui dit le contexte. |
| Barre du bas, onglet agent | « Agent Pi (RPC) » | **inchangé** | Même famille, même logique. |

**Pourquoi cette solution plutôt qu'une suppression :**

- **Retirer celui du bandeau** contredirait la décision Q1 (le moteur vit dans le bandeau) : refusé.
- **Retirer celui du bas** vous priverait du seul affichage du moteur en mode Zen (F11), et laisserait
  la barre du bas **vide** sur l'onglet Assistant alors qu'elle affiche « (RPC) » sur l'onglet
  agent — deux onglets voisins traités différemment sans raison visible.
- **Ajouter le mot « Moteur »** règle la confusion à la source, coûte **un mot** (aucune ligne de plus
  à l'écran, aucune information retirée) et reste dans une largeur confortable : environ 95 px pour
  140,6 px disponibles à la largeur minimum de la colonne, et la troncature par ellipse reste en place
  si la place manquait un jour.
- Le mot **« moteur »** est déjà votre vocabulaire à l'écran, pas un mot que j'invente : la prise en
  main dit « **Le moteur constaté** » et « **Revérifier le moteur** » (`index.html:1584` et `:1587`), et
  l'aide embarque la même phrase (`help/overview.md:45`, recopiée dans `help/handbook.md:41`).

---

# 4. Lots d'application — chacun livrable seul

Chaque lot est indépendant : on peut n'en appliquer qu'un. Les valeurs sont celles du projet
(`--space-*`, `--font-*`, `--radius-*`) et **aucune couleur n'est écrite en dur**.

## Lot A — le logo passe à 24 px *(le plus petit, le plus sûr)*

Une seule valeur change, dans le bloc du logo du bandeau :

| Propriété | Avant | Après |
|---|---|---|
| `height` | `20px` | **`24px`** |

| À ne pas toucher | Pourquoi |
|---|---|
| `#project-selector` (48 px, `padding: 8px 8px 8px 16px`) | verrouillés par un test : hauteur ligne 94, remplissage ligne 100 (`lot2-colonne-haut.test.js`) |
| `width: auto`, `object-fit: contain` | conserve la proportion de l'image |
| Taille du mot « Pilot » (15 px), du sous-titre (11 px) | verrouillés par le même test |
| Bouton « Projets » (28 px), trois boutons du coin haut droit | décisions prises |
| Largeur de la colonne (280 px) | décision Q3 |

**Contrôle à faire après application :** `npm test` doit rester **vert**. Deux points vérifiés :
(a) aucun test ne nomme `#btn-project-logo`, donc la nouvelle valeur ne casse rien ; (b) le test qui
interdit un texte de plus de 13 px dans le bandeau ne regarde que des `font-size`
(`lot2-colonne-haut.test.js:104-110`) et ne voit donc pas une hauteur d'image. Puis vérifier à l'œil :
à 280 px de colonne, le mot « Pilot » et le sous-titre ne sont pas tronqués, et le logo ne touche ni
le haut ni le filet du bas.

## Lot A2 — (optionnel) le dessin retrouve l'alignement de 16 px

Le dessin a 2,7 px de transparent à sa gauche (3,2 px à 24 px). Aujourd'hui l'encre commence donc à
18,7 px du bord, alors que la règle de la colonne est **16 px**. Une seule valeur rétablit
l'alignement du **dessin visible** (pas de la boîte) :

| Propriété | Avant | Après |
|---|---|---|
| `margin-left` | *(aucune)* | **`-3px`** |

Effet : le dessin repart à **16,2 px** du bord (0,2 px d'écart avec la règle des 16 px, invisible), et
le mot « Pilot » récupère **3 px** — la place perdue par le lot A est donc rendue (140,6 px → 143,6 px,
au lieu de 144,6 px). Contrepartie : la boîte de l'image commence à 13 px du bord. **Je recommande ce lot** : la règle des 16 px porte sur ce
que l'œil voit.

## Lot B — le bandeau dit « Moteur · Agent Pi »

| Élément | Avant | Après |
|---|---|---|
| Texte du sous-titre (écrit au démarrage et à chaque re-sonde) | `agentDisplayLabel()` | **`"Moteur · " + agentDisplayLabel()`** |

| À ne pas toucher | Pourquoi |
|---|---|
| La source du libellé (`backend-info.js:69-71`) | un seul libellé pour toute l'application |
| Le texte de la barre du bas (« (Suivi) », « (RPC) ») | contexte d'onglet, utile |
| `.project-engine` : 11 px, `--text-secondary`, ellipse (`style.css:1128-1137`) et sa règle « vide = pas de hauteur » (`:1140`) | verrouillés par test (`lot2-colonne-haut.test.js:303-315`) |
| L'onglet Assistant (titre 🧭, modèle dans sa barre d'outils) | décision Q1 |

**Contrôle après application :** `npm test` vert ; à l'écran, le sous-titre tient sur **une** ligne aux
deux valeurs (« Agent Pi » comme « Agent PLh »), et le bandeau garde 48 px. **Piège à éviter :** la
ligne modifiée doit continuer de contenir `agentDisplayLabel()` **écrit tel quel** — le test du
bandeau le cherche littéralement (`lot2-colonne-haut.test.js:303-309`) — et la règle
`.project-engine:empty { display: none; }` doit rester intacte (`:312-315`).

## Lot C — (à décider) le logo en thème clair

Non proposé en l'état : il faut choisir entre **une variante claire du dessin** (une image de plus,
un choix par thème) et **ne rien faire** (le logo reste pâle en clair). Voir Q3. Tant que ce n'est pas
tranché, le lot A s'applique seul sans risque.

---

# 5. Questions fermées (3 au maximum)

**Q1 — Le logo doit-il s'arrêter à 24 px ?**
Oui = lot A (+ A2) tel quel, le bandeau garde 48 px.
Non (vous le voulez franchement plus gros, 28 px et plus) = il faut **rouvrir la hauteur du bandeau**
(48 px → 56 px), ce qui touche un test et la décision du lot 2 : je ne le fais pas sans votre accord.

**Q2 — Le mot « Pilot » du bandeau doit-il rester le nom de l'application, ou devenir le nom du projet ouvert ?**
Aujourd'hui il est **figé** sur « Pilot » (aucun code ne le change) alors que la présentation l'appelle
« nom du projet ». Réponse « reste le nom de l'application » = le bandeau devient lisible tel quel
(nom de l'app + moteur) et le lot B suffit. Réponse « nom du projet ouvert » = les deux lignes du
bandeau parlent du projet, et le libellé du lot B doit alors changer (« Moteur · » devient ambigu sous
un nom de projet).

**Q3 — Le logo pâle du thème clair (1,33 à 1,64:1) est-il traité maintenant ?**
Oui = lot C à concevoir (une variante claire du dessin) avant de livrer.
Non = le lot A s'applique tel quel, et le point reste noté.

---

# VERDICT

**Prêt à appliquer.**

- **Lot A** : le logo passe de 20 à **24 px** — une seule valeur, +3,5 px de dessin réellement vu, bandeau
  à 48 px, rien d'autre ne bouge. Contrôlé : aucun test ne verrouille cette taille, aucun écran voisin
  n'utilise cette règle, la fenêtre étroite n'y change rien.
- **Lot A2** : `margin-left: -3px` pour que le **dessin** reparte de 16 px et rendre au mot « Pilot »
  la place perdue.
- **Lot B** : le sous-titre du bandeau devient **« Moteur · Agent Pi »**. C'est le seul changement de
  libellé proposé, et il ne retire rien à personne.

**Tranché et sans appel (les deux restent).** « Agent Pi » en haut = le **moteur** ; « Agent Pi
(Suivi) » en bas = le **même moteur**, dans l'onglet de suivi. Ce n'est pas un doublon à supprimer :
celui du bas est le **seul** affichage du moteur quand la colonne de gauche est masquée (F11), et
l'onglet voisin affiche « (RPC) » — les deux onglets doivent se comporter pareil.

**Reste à décider.** Q1 (24 px ou rouvrir la hauteur du bandeau), Q2 (le mot « Pilot » = application ou
projet), Q3 (thème clair du logo).

**Ce que je n'ai pas pu vérifier.** Le **rendu à l'écran** n'a pas été capturé : toutes les valeurs
ci-dessus sont des **géométries calculées** sur la page et la feuille réelles, plus les couleurs du
fichier du logo (contrastes calculés par formule WCAG). Deux chiffres sont des **estimations** à
confirmer d'un coup d'œil après application : la largeur du texte « Moteur · Agent Pi » (estimée à
environ 95 px pour 140,6 px disponibles) et le rendu du dessin à 24 px sur un écran à forte densité.
Un dernier point, hors périmètre et **signalé sans être corrigé** : l'onglet des réglages nommé
« Agent Pi » est un texte figé (`index.html:469`), qui restera faux si c'est PLh qui tourne.
