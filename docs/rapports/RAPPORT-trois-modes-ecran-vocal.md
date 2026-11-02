# Rapport de conception — Trois modes d'écran (Détaillé · Assistant seul · Vocal)

> **Document de conception.** Aucun fichier de code n'a été modifié, aucun réglage
> ajouté, aucune décision du propriétaire rouverte.
> Chaque affirmation sur l'existant porte sa preuve `fichier:ligne`.
> Écrit pour être lu sans connaissance technique du projet.

- Date : 2026-10-27
- Portée : un bouton unique de bascule entre trois modes d'écran, et l'écran du
  mode Vocal décrit écran par écran.
- Ce document **remplace** un point de `docs/architecture-conversation-vocale-interruptible.md`
  (§ étape 8) : le « mode conversation » n'est plus un réglage dans
  ⚙️ Paramètres → Assistant, il devient le **3e mode d'écran** piloté par un
  bouton. Tout le reste de ce document de conception reste valable.

---

## 0. Résumé en huit lignes

- **Un seul bouton**, posé à droite de la rangée d'onglets, fait tourner les trois
  modes : Détaillé → Assistant seul → Vocal → Détaillé.
- Le mode est **mémorisé dans une clé unique** et rejoué au redémarrage, sans
  nouvel écran de réglage.
- Le mode « Assistant seul » **existe déjà** : c'est un plein écran posé par-dessus
  l'application (preuve : `src/css/style.css:10990`). On ne le refait pas, on
  l'intègre dans le cycle.
- Le mode **Vocal** est un second plein écran : un objet lumineux au centre, une
  seule ligne de texte, une zone de saisie discrète en bas.
- **La colonne de gauche disparaît** dans les deux modes plein écran : rien ne la
  remplace. Le retour se fait par le même bouton, par Échap, ou en fermant l'onglet
  Assistant.
- Quatre états, quatre couleurs, **mesurées** sur les dix palettes du projet.
- Une seule chose n'existe pas encore et coûte cher : **couper la voix en parlant**
  (2 à 4 semaines, document dédié). Elle est isolée dans le dernier lot.
- Les lots 1 et 2 sont applicables tout de suite ; les lots 3 et 4 demandent trois
  réponses (fin de ce document).

---

## 1. Le bouton unique

### 1.1 Où il se place (deux emplacements, un seul et même bouton)

Le bouton est **un seul nœud DOM**. Il est **déplacé** d'un écran à l'autre, comme le
projet le fait déjà pour l'entrée « Travail » : `#agent-activity` est déplacée dans
la barre du mode immersif avec mémorisation de sa place d'origine
(`src/js/super-agent.js:3577-3582`), puis **restituée exactement** au même endroit
(`:3621-3628`). On réutilise ce patron, on n'en invente pas un second.

| Écran | Emplacement du bouton | Preuve de la place |
|---|---|---|
| **Détaillé** | Dans `#tab-row`, **entre** l'entrée « Travail » et les trois boutons système | `index.html:257` (`#tab-row`), `:284` (`#agent-activity`), `:333` (`#window-controls`) |
| **Assistant seul** | Dans `.sa-immersive-top`, juste après le titre « Pilot » | `src/css/style.css:11024` (barre du mode), `src/js/super-agent.js:3577` (barre de l'overlay) |
| **Vocal** | Dans sa propre barre `.vocal-top`, à gauche | nouvelle barre, même placement que `.sa-immersive-top` |

**Pourquoi à droite de la rangée d'onglets, et pas à gauche ?** La colonne de gauche
est déjà pleine (bandeau du projet, moteur, liste des projets) et large de 280 px
(`src/css/style.css:762`). À droite, le bouton est **à côté des boutons de fenêtre**,
c'est-à-dire là où l'utilisateur cherche déjà « l'état de l'écran ». Et il ne prend
la place d'aucun onglet : leur largeur disponible diminue de la sienne, sans
recouvrement (la rangée est en flux, aucun élément en position fixe — commentaire
`index.html:255-256`).

**Un verrou à ne pas casser.** Un test fixe l'ordre du DOM de la rangée :
rangée → barre d'onglets → « Travail » → boutons système → contenu
(`src/js/barre-fenetre-etats.test.js:205-213`). Insérer le bouton **entre
« Travail » et les boutons système** laisse cet ordre vrai : le test passe sans
modification.

**Un test devra être étendu (pas assoupli).** En mode Assistant seul, un test fixe
l'ordre des enfants de la barre : retour, titre, agents, ⚙
(`src/js/barre-fenetre-assistant-seul.test.js:237`). Le bouton de mode entre dans
cette liste **en 3e position** (retour, titre, **mode**, agents, ⚙). C'est un ajout
voulu : le test gagne une entrée, il ne perd aucune vérification.

### 1.2 Apparence, libellé, icône

| Propriété | Valeur | Pourquoi |
|---|---|---|
| Forme | Bouton carré de la rangée, hauteur **28 px** (hauteur des touches de la rangée), rayon `--radius-sm` | Aligné sur les boutons de fenêtre voisins |
| Largeur | **88 px fixes** en mode Détaillé ; **auto** (icône + mot) dans les deux plein écran | Une largeur fixe évite que la rangée d'onglets « saute » à chaque bascule |
| Fond | transparent au repos, `--surface-2` au survol | C'est une commande d'écran, pas une action principale |
| Texte | `--font-sm` (12 px), `--text-secondary` | Règle du projet : jamais sous 13 px pour du texte lu… le libellé du bouton reste un repère, l'infobulle porte la phrase complète |
| Icône | 14 px (`.icon-sm`), `currentColor` | `src/js/icons.js:52-58` (`setIcon`) |
| **Libellé** | Le nom du mode **courant** : `Détaillé` · `Assistant seul` · `Vocal` | Afficher ce qui est **vrai** maintenant, pas une promesse |
| **Infobulle** (`title` + `aria-label`) | « Mode d'écran : Détaillé. Passer à « Assistant seul ». » | Annonce l'action **suivante** : un bouton qui tourne doit dire où il emmène |
| Icônes | `panels-top-left` (Détaillé) · `message-circle` (Assistant seul) · `audio-lines` (Vocal) | Trois silhouettes franchement différentes ; `audio-lines` évite la confusion avec le micro de dictée (`src/js/super-agent.js:2925`) et avec la boussole de l'entrée « Assistant » (`index.html:156`, icône `compass`) |

Les trois icônes existent bien dans la version de Lucide installée (vérifié à
l'exécution : `panels-top-left`, `message-circle`, `audio-lines` → présentes).

**Où est l'indicateur du mode courant ?** Il y en a **deux**, et c'est voulu :
1. le **mot** dans le bouton (lecture immédiate) ;
2. la **pastille de couleur** de 6 px collée à gauche du mot, qui reprend la teinte
   du mode (`--accent-text` pour Détaillé, `--superagent-accent` pour Assistant seul,
   `--vocal-listen` pour Vocal).

Aucun bandeau, aucun badge supplémentaire : la rangée d'onglets reste à 36 px
(`src/css/style.css`, `#tab-row` `min-height: 36px`, verrou
`src/js/compteur-taches-travail.test.js:399`).

### 1.3 Persistance : quelle config existante réutiliser

Deux mécanismes de « mode » coexistent aujourd'hui, et **un seul concerne le poste** :

| Mécanisme | Où | Valeurs | Verdict |
|---|---|---|---|
| `localStorage` `pilot_superagent_immersive` | `src/js/super-agent.js:3462` (clé), `:3522` / `:3569` (écriture « 1 »/« 0 »), `:3947` (relecture au montage de l'onglet) | **binaire** : overlay présent ou absent | **À réutiliser — c'est le bon endroit** |
| `web_mode` dans `config.json` | `src-tauri/src/lib.rs:482-483` (champ), `:1006` (défaut `"assistant"`) | `"assistant"` / `"agents"` | **Ne pas y toucher** : c'est le mode de la **page web distante** (`web/js/app.js:230-233`, routage `:837`, `applyMode` `:1022-1023`), un autre réglage, une autre application |

**Décision : une clé unique `pilot_screen_mode`, dans `localStorage`, avec trois
valeurs** `"detailed"` · `"assistant"` · `"vocal"`.

Pourquoi `localStorage` et non `config.json` :

- **Aucun écran de réglage n'est créé** : la bascule s'écrit à chaque clic, comme
  aujourd'hui (`src/js/super-agent.js:3522`). Rien à ajouter dans ⚙️ Paramètres.
- **Aucun aller-retour disque** : `save_config` réécrit tout le fichier de
  configuration (`src-tauri/src/lib.rs:1446`). Un clic de bascule ne doit pas
  écrire 300 lignes de JSON.
- **C'est déjà le patron du projet** pour la préférence d'écran de l'onglet
  Assistant, et c'est déjà lu au démarrage par le même chemin.

**Migration obligatoire (sinon on perd la mémoire des utilisateurs existants).**
Au premier lancement de la nouvelle version : si `pilot_screen_mode` est absent et
que `pilot_superagent_immersive` vaut `"1"`, on écrit `"assistant"`. La valeur `"1"`
n'est **pas** supprimée (retour arrière possible). Coût : six lignes.

**Rejeu au redémarrage.** Le chargement de Pilot masque son écran de démarrage à la
fin de l'initialisation (`src/js/main.js:1374-1375`). Le mode est appliqué **avant**
ce masquage : l'utilisateur ne voit jamais l'écran « Détaillé » clignoter avant son
écran mémorisé.

---

## 2. L'écran du mode Vocal, de haut en bas

Structure : un plein écran `position: fixed; inset: 0; z-index: 99990` — **exactement
le patron déjà en place** pour le mode Assistant seul (`src/css/style.css:10990-10999`).
Les trois boutons système restent peints au-dessus (`z-index: 100001`, preuve
`src/css/style.css:11002-11011`) : on peut toujours réduire, agrandir ou fermer.

### 2.1 Le haut — une barre de 44 px

| Élément | Détail |
|---|---|
| Hauteur | 44 px, décalée de `--window-controls-height` (36 px) vers le bas : elle vit sur la **seconde ligne**, sous les boutons système — même règle que `.sa-immersive-top` (`src/css/style.css:11021-11025`) |
| À gauche | le **bouton des trois modes** (§1) |
| Au centre | rien |
| À droite | rien (les boutons système sont au-dessus, dans leur propre bande) |

**Pourquoi 44 px et non 58 px comme le mode Assistant seul ?** Ce dernier porte un
titre et un résumé des agents (`src/js/super-agent.js:3577`). L'écran Vocal ne porte
que le bouton : 44 px suffisent, et 14 px rendus au centre.

### 2.2 Le centre — l'objet lumineux

Un disque, rien d'autre. Esprit « interface Cornelius » : pas de cadre, pas de
carte, pas de bordure.

| Élément | Valeur | Pourquoi |
|---|---|---|
| Disque | **168 px** de diamètre, `border-radius: 50%` | À 800×500 (taille minimale de la fenêtre, `src-tauri/tauri.conf.json:47-48`), il reste 168 px au centre sans écraser la ligne d'état ni la saisie |
| Remplissage | dégradé radial de la couleur d'état, de 18 % d'opacité au centre à 0 % aux bords | C'est la « lumière » ; aucune image, aucun fichier |
| Anneau | 2 px, couleur d'état pleine | Porte la couleur d'état de façon stable, même quand le remplissage est très transparent |
| Trait du niveau | **200 × 3 px**, rayon 2 px, à **24 px** sous le disque, centré | Le « niveau » demandé, séparé de l'objet pour rester lisible |
| Longueur du trait | de **8 %** (silence) à **100 %** (fort) de sa largeur | Seule variation : la longueur. La couleur ne change pas pendant un état |
| Position verticale | bloc (disque + trait) centré dans l'espace entre la barre haute et la zone de saisie | Il monte et descend avec la fenêtre, sans calcul |

**Ce que le trait mesure, état par état** — et c'est le point honnête de ce rapport :

| État | Source du niveau | Existe ? |
|---|---|---|
| Écoute | niveau réel du micro | **Non — à créer** (voir §2.7) |
| Parole | niveau de la voix de Pilot | **Non capturable** : la synthèse vocale ne rend pas son signal (`speechSynthesis`). Le trait suit une **enveloppe** lente et bornée, dessinée pour ne pas mentir (amplitude faible et régulière, jamais synchrone avec les mots) |
| Réflexion | pas de niveau : le trait se réduit à 8 % et **respire** lentement | — |
| Repos | trait à 8 %, immobile | — |

### 2.3 La ligne d'état unique

Une seule ligne de texte, sous le trait, à 24 px. Jamais deux phrases, jamais un
paragraphe.

| État | Ce qui est écrit | Couleur |
|---|---|---|
| Repos | `Je vous écoute.` | `--text-primary` |
| Écoute | `Je vous écoute…` | `--text-primary` |
| Réflexion | `Je réfléchis…` | `--text-primary` |
| Parole | `Je réponds.` | `--text-primary` |
| Micro refusé | `Le micro est fermé.` + bouton de dépannage (§2.5) | `--text-primary` |
| Agent occupé (on parle pendant qu'il réfléchit) | `Je finis ce que je fais, puis je vous réponds.` | `--text-secondary` |

Taille **15 px** (`--font-zone`, le seul texte de l'écran), graisse 500, centrée.
Couleur **toujours neutre** : la couleur d'état vit dans l'objet, jamais dans le
texte. C'est ce qui garantit la lisibilité dans les dix palettes : `--text-primary`
donne **15,4:1** en sombre (`style.css:340`) et **15,6:1** en clair (`:442`) — très
au-dessus du seuil AA de 4,5:1.

`--text-muted` est **interdit** ici : il ne donne que 2,90:1 en thème clair
(`style.css:444`), sous le seuil.

### 2.4 La zone de saisie, en bas

**Décision : toujours visible, mais discrète.** Elle n'est pas révélée au clic.

Pourquoi : un écran qui ne montre aucun chemin vers le clavier oblige à deviner.
Or ce mode doit rester utilisable par quelqu'un qui ne peut pas parler (bruit,
voix enrouée, réunion). La discrétion, oui ; l'invisibilité, non.

| Propriété | Valeur | Preuve / raison |
|---|---|---|
| Ce qu'elle est | **la barre de saisie de l'onglet Assistant, déplacée** — même nœud, même code, même envoi | Patron existant : `src/js/super-agent.js:3567` déplace `inputBar` ; `:3611` le restitue |
| Contenu | le `textarea` existant plus le micro de dictée et le bouton d'envoi | `src/js/super-agent.js:2922` (barre), `:2924` (champ), `:2925` (micro) |
| Hauteur au repos | **36 px** (une ligne), puis jusqu'à **120 px** en mode Vocal (au lieu de 200 px) | Le CSS existant plafonne à 200 px (`src/css/style.css:5297-5301`) ; 120 px évite d'écraser le disque à 500 px de haut |
| Place | barre de 16 px de marge en bas, largeur **max 720 px centrée** | La barre standard est collée aux bords, pleine largeur, avec un filet haut (`style.css:5164-5171`) : en mode Vocal, la variante retire le filet et le fond |
| Aspect au repos | fond transparent, contour `--border-subtle`, texte `--text-secondary` | Elle se distingue du vide sans attirer l'œil |
| Au survol / au focus | contour `--accent`, ombre `--ring` (0,18 s) | Comportement standard du projet (`style.css:5314-5317`) |
| Placeholder | `Écrivez, ou parlez.` | Plus court que celui de l'assistant (28 mots sont inutiles ici) |

**Que se passe-t-il si on écrit pendant que Pilot parle ?**

| Geste | Ce qui se passe | Pourquoi |
|---|---|---|
| Écrire | **rien d'autre** : la voix continue, le texte s'écrit | Le clavier ne doit pas couper la parole : couper se fait **en parlant**, jamais en tapant |
| Appuyer sur Entrée | la voix se tait **immédiatement** (`stopReading()`, `src/js/read-aloud.js:594`) et le message part par le chemin d'envoi habituel | Même règle que le bouton 🔊, un seul chemin de lecture et d'arrêt |
| Écrire pendant la **réflexion** | le texte s'écrit, l'envoi est refusé, la ligne d'état dit pourquoi | Comportement déjà en place pour l'assistant (`src/js/super-agent.js:3337`, même refus pour la dictée) |
| Parler pendant que Pilot parle | **(lot 4, pas encore possible)** — voir §2.7 | — |

### 2.5 Les boutons de dépannage — rares, et jamais décoratifs

Deux boutons, **cachés par défaut**, affichés seulement dans le cas qui les justifie.
Style : bouton secondaire existant, 28 px de haut, 13 px de texte.

| Bouton | Quand il apparaît | Ce qu'il fait |
|---|---|---|
| **« Autoriser le micro »** | seulement quand le micro a été refusé ou est indisponible | Relance la demande d'autorisation déjà utilisée par la dictée (`src/js/super-agent.js:3339` construit `SpeechRecognition`) |
| **« Reprendre ici »** | seulement quand Pilot parle et que vous voulez repartir de votre phrase (lot 4) | Coupe la voix, marque l'arrêt comme **manuel** dans l'unique entonnoir d'arrêt (`src/js/agent-stop-funnel.js`, exception `R3-EXCEPTION-MANUEL`) |

Aucun autre bouton sur cet écran. Pas de « nouveau sujet », pas de « vider », pas de
réglage : ce sont des gestes de dépannage, pas un tableau de bord.

### 2.6 Ce qui n'existe pas encore (mesuré, pas supposé)

| Besoin | État dans le dépôt | Conséquence |
|---|---|---|
| Niveau du micro (le trait) | `getUserMedia`, `AnalyserNode`, `AudioContext` : **aucune occurrence** dans `src/js`, `web/js`, `src-tauri/src` | À créer — c'est le lot 3 |
| Couper Pilot en parlant | absent ; le document `docs/architecture-conversation-vocale-interruptible.md` §1.2 le dit et l'estime à 2-4 semaines | Lot 4, séparé |
| Savoir que Pilot parle | **existe** : événement `pilot-read-aloud-state`, `src/js/read-aloud.js:124` et `:726-734` | Réutilisé tel quel, sans second mécanisme |
| Savoir qu'un agent travaille | **existe** : `subscribeAgentActivity`, `src/js/agent-activity.js:763`, et `getAgentActivitySnapshot`, `:773` | Réutilisé tel quel |
| Demander le micro | **existe** (dictée) : `src/js/super-agent.js:3333-3339` | Réutilisé |

---

## 3. La colonne de gauche et la sortie du mode

### 3.1 Ce qui remplace la colonne : rien

| | Avant (mode Détaillé) | Après (modes Assistant seul et Vocal) |
|---|---|---|
| Colonne de gauche (280 px) | Bandeau du projet, moteur, projets en cours, 6 accès du bas | **Disparue** — recouverte par le plein écran (`position: fixed; inset: 0`, `style.css:10990`) |
| Rangée d'onglets | visible | recouverte |
| Boutons système | en haut à droite | **conservés**, peints au-dessus (`z-index: 100001`, `style.css:11002-11011`) |
| Contenu | éditeur | écran du mode |

Aucun menu, aucun tiroir, aucun « burger » ne remplace la colonne. C'est une
décision du propriétaire (elle disparaît), et c'est aussi ce qui donne tout leur
sens aux deux modes : ils sont **plein écran** ou ils ne sont rien.

### 3.2 Comment on quitte le mode — trois voies, aucune surprise

| Voie | Effet | Pourquoi c'est permis |
|---|---|---|
| **Le même bouton** (il affiche « Vocal », un clic passe à « Détaillé ») | retour à l'écran normal | Un seul bouton pour entrer et sortir : rien à apprendre |
| **Échap** | idem | Le mode Assistant seul écoute déjà cette touche (`src/js/super-agent.js:3649`, retirée à `:4037`) — même geste, même sens |
| **Fermer l'onglet Assistant** | idem | Garde déjà écrite pour l'autre mode : si l'onglet est fermé en mode plein écran, l'overlay est retiré (`src/js/super-agent.js:4030`) |

**Règle de symétrie (à ne pas oublier).** Tout nœud déplacé à l'entrée doit être
**restitué exactement** à la sortie, dans le bon ordre — c'est déjà écrit et testé
pour le mode Assistant seul (`src/js/super-agent.js:3598` pour `exitImmersive`,
`:3621-3628` pour la restitution du nœud « Travail », commentaire « rester
symétrique avec enterImmersive (sans doublon ni perte) »). Le lot 2 doit livrer son
test de symétrie avant son habillage.

**Bascule directe Assistant seul → Vocal.** On **sort** d'abord du mode Assistant
seul (`exitImmersive()`), puis on entre dans l'écran Vocal. Deux plein écrans ne se
superposent jamais : sinon la conversation resterait attachée à l'overlay précédent
et deviendrait orpheline.

---

## 4. Les états visuels exacts

Quatre états, **une seule classe à la fois** sur l'overlay
(`vocal-state-idle` · `vocal-state-listening` · `vocal-state-thinking` ·
`vocal-state-speaking`) : deux états simultanés sont impossibles par construction.

### 4.1 Couleurs, mouvement et contrastes mesurés

Les quatre teintes sont **les couleurs du projet**, ajustées pour être lisibles dans
les **dix palettes** (2 thèmes × 5 sous-thèmes). Mesures faites sur les fonds réels
de chaque palette.

| État | Jeton | Sombre | Clair | Mouvement du disque | Mouvement du trait |
|---|---|---|---|---|---|
| **Repos** | `--vocal-rest` | `#7d97ff` (= `--accent-text`, `style.css:371`) | `#3b57d6` (= `--accent-text`, `:464`) | respiration lente, 4 s | 8 %, immobile |
| **Écoute** | `--vocal-listen` | `#4ade80` (= `--success`, `:376`) | `#1f7a4d` (vert assombri) | aucune pulsation propre : il **suit le micro** | **suit le niveau**, lissage 80 ms |
| **Réflexion** | `--vocal-think` | `#b06ef7` (= `--superagent-accent`, `:374`) | `#6d28d9` (violet assombri) | un arc de 60° tourne en 3 s | 8 %, respiration rapide |
| **Parole** | `--vocal-speak` | `#fbbf24` (= `--warning`, `:377`) | `#b45309` (ambre assombri) | halo qui ondule, 1,6 s | enveloppe bornée, jamais synchrone |

**Contrastes mesurés (sur le fond de l'application de chaque palette)**

| Jeton | Sombre (5 palettes) | Clair (5 palettes) |
|---|---|---|
| `--vocal-rest` | 6,97 / 5,16 / 5,25 / 4,60 / 6,30 | 5,47 / 5,97 / 5,72 / 5,53 / 4,79 |
| `--vocal-listen` | 10,84 / 8,03 / 8,17 / 7,17 / 9,81 | 4,87 / 5,32 / 5,09 / 4,93 / 4,27 |
| `--vocal-think` | 5,78 / 4,28 / 4,35 / 3,82 / 5,22 | 6,51 / 7,10 / 6,81 / 6,59 / 5,71 |
| `--vocal-speak` | 11,32 / 8,39 / 8,53 / 7,48 / 10,24 | 4,60 / 5,02 / 4,81 / 4,66 / 4,03 |

Lecture : ordre des palettes sombres = défaut, One Dark, Dracula, Nord, Tokyo Night ;
clair = défaut, GitHub, One Light, Solarized, Tokyo Day.

- **Le minimum de tout le tableau est 3,82:1** (réflexion sous Nord), au-dessus du
  seuil de 3:1 exigé pour un élément graphique non textuel.
- Aucune teinte ne porte de **texte** : le texte de l'écran reste `--text-primary`
  (15,4:1 en sombre, 15,6:1 en clair). C'est ce qui rend le tableau acceptable :
  on n'a pas besoin que la couleur d'état atteigne 4,5:1.
- **Pourquoi trois teintes neuves (`#1f7a4d`, `#6d28d9`, `#b45309`) ?** Les jetons
  `--success` (2,89:1) et `--warning` (1,87:1) du thème clair (`style.css:469-470`)
  échouent même le seuil de 3:1 sur fond clair. On ne peut donc pas les réutiliser
  tels quels en clair. Les trois valeurs ci-dessus sont les mêmes teintes,
  **assombries**, exactement comme le projet a déjà assombri `--accent-text`
  (méthode et mesures documentées dans `style.css:530-575`).
- Coût : **huit déclarations** (quatre par thème de base), héritées par les huit
  sous-thèmes comme tout jeton non redéfini (les sous-thèmes sont des classes
  cumulées : `body.theme-dark.theme-one-dark`, `style.css:556`).
- **Aucun nouvel écran de réglage** : ces jetons ne sont pas modifiables par
  l'utilisateur, ils suivent le thème.

### 4.2 Les transitions

| Passage | Durée | Courbe | Détail |
|---|---|---|---|
| Couleur d'état (anneau, remplissage) | **0,3 s** (`--transition-smooth`, `style.css:312`) | `--ease-spring` | jamais de saut de teinte |
| Longueur du trait | **80 ms** (lissage du niveau) | linéaire | plus court que la couleur : la voix doit se voir « en direct » |
| Apparition / disparition de la ligne d'état | 0,18 s (`--transition`, `style.css:313`) | `--ease-spring` | le texte change sur place, il ne glisse pas |
| Entrée / sortie du mode | 0,3 s de fondu du fond | `--transition-smooth` | pas de zoom : on change d'écran, on ne déplie pas un panneau |

### 4.3 Réduction de mouvement — réutilise le réglage existant, n'en crée aucun

Le projet décide déjà des animations à un seul endroit :
`prefers-reduced-motion` **plus** le paramètre utilisateur `modal_animations`
(`src/js/modal-anim.js:14` et `:43`, valeur exposée en `window._pilotModalAnimations`).

L'écran Vocal lit **ce même drapeau**. Si l'utilisateur a demandé moins d'animation :

| Élément | Comportement réduit |
|---|---|
| Disque | immobile ; la **couleur** et le **mot** portent l'état |
| Trait | longueur **fixe par état** : 8 % (repos), 45 % (écoute), 20 % (réflexion), 70 % (parole) |
| Transitions | 0 s |

Aucun nouveau réglage, donc : aucune ligne à ajouter dans ⚙️ Paramètres.

---

## 5. Découpage en LOTS — chacun livrable seul, dans cet ordre

Chaque lot se termine par quelque chose que **l'utilisateur voit**, et par ses
tests. Aucun lot ne laisse l'application dans un état intermédiaire cassé.

### Lot 1 — Le bouton et les trois modes (aucune nouveauté visuelle)

**Ce qu'on fait.** Un module unique `src/js/screen-mode.js` (source unique des trois
modes) ; le bouton dans `#tab-row` ; la clé `pilot_screen_mode` et sa migration
depuis `pilot_superagent_immersive` ; le rejeu au démarrage avant le masquage de
l'écran de chargement ; le mode « Vocal » **branché sur l'écran de l'assistant seul**
(provisoire, une ligne à changer au lot 2).

**Ce qui change pour l'utilisateur.** Il voit un bouton nommé, avec une pastille de
couleur, qui fait la navette entre l'écran actuel et l'écran « Assistant seul »
existant. Il retrouve son écran au redémarrage, y compris s'il utilisait déjà le mode
Assistant seul (migration).

**Risque principal.** L'ordre des enfants de la barre de l'assistant seul (test à
étendre, §1.1).

**Recette.** Basculer trois fois de suite : rien ne manque, rien ne double. Fermer et
rouvrir Pilot : le mode est le même. Fermer l'onglet Assistant en mode plein écran :
retour à l'écran normal.

### Lot 2 — L'écran Vocal (sans micro)

**Ce qu'on fait.** Le plein écran `.pilot-vocal` : barre haute, disque, trait figé à
8 %, ligne d'état, barre de saisie déplacée et discrète, Échap, symétrie de sortie.
Les quatre classes d'état, les jetons `--vocal-*`, les transitions, la réduction de
mouvement. La réponse de l'assistant est **lue à voix haute automatiquement** en
mode Vocal (via `read-aloud.js`, sans second mécanisme) ; hors mode Vocal, la règle
« aucune lecture automatique » ne change pas.

**Ce qui change pour l'utilisateur.** Il a un vrai écran vocal : un objet qui respire,
une phrase d'état, une zone de saisie discrète. Il peut y écrire, envoyer, et
entendre la réponse sans cliquer.

**Recette.** Entrer en Vocal, écrire « bonjour » : Pilot parle, la ligne dit
« Je réponds. », le disque change de couleur. Appuyer sur Entrée pendant qu'il
parle : la voix se tait, le message part. Échap : retour, la conversation est intacte
dans l'onglet Assistant, avec les mêmes messages.

### Lot 3 — Le niveau du micro

**Ce qu'on fait.** Ouvrir le micro (`getUserMedia`) à l'entrée en mode Vocal, mesurer
le niveau (`AnalyserNode`), animer le trait. Le bouton « Autoriser le micro » quand
c'est refusé. Un seul flux micro, jamais deux.

**Ce qui change pour l'utilisateur.** Le trait suit vraiment sa voix. Il voit que
Pilot l'entend.

**Recette.** Parler : le trait suit. Se taire : il retombe. Refuser le micro : le
bouton de dépannage apparaît, la ligne d'état le dit, l'écran reste utilisable.

**Point non vérifié.** Faire tourner **en même temps** un flux `getUserMedia` et la
reconnaissance vocale de la dictée dans la fenêtre de Pilot (WebView2) n'a jamais été
essayé ici. Parade prévue : mesurer le niveau **depuis le flux déjà ouvert par la
dictée** quand elle tourne, et n'ouvrir le flux du niveau que lorsqu'elle est
arrêtée. Si cela ne tient pas, le trait retombe sur son enveloppe et le mode reste
utilisable.

### Lot 4 — Couper Pilot en parlant (le gros morceau, séparé)

**Ce qu'on fait.** La détection de voix pendant la parole, l'anti-écho, et
l'interruption qui coupe la voix **et** réoriente l'agent. C'est le contenu de
`docs/architecture-conversation-vocale-interruptible.md` (étapes 2 à 7), avec sa
propre estimation : 2 à 4 semaines.

**Ce qui change pour l'utilisateur.** Il coupe Pilot en parlant, sans bouton.

**Pourquoi ce lot est à part.** C'est le seul qui touche au cœur du dialogue et le
seul dont le coût n'est pas comparable aux trois autres. Les lots 1 à 3 restent
utiles même s'il n'est jamais fait : on peut écrire, dicter et entendre.

---

## 6. Trois questions fermées (les seules qui ne se déduisent pas des décisions)

**Q1. Quand vous parlez pendant que Pilot réfléchit** (pas pendant qu'il parle) :
- **(a)** on **arrête** l'agent et il repart de votre phrase (vous coupez),
- **(b)** on **garde** votre phrase et elle part dès qu'il a fini (vous ne coupez pas).

> Le document vocal liste cette question comme non tranchée (§9, question 3). Elle
> change le comportement de tout le mode. Ma proposition par défaut, si vous ne
> répondez pas : **(b)**, parce que rien n'est perdu et que couper un travail en
> cours est un geste fort qui mérite d'être explicite.

**Q2. L'autorisation du micro** est demandée :
- **(a)** **à l'entrée** en mode Vocal (une seule fois, puis mémorisée par la fenêtre),
- **(b)** **au premier geste** (premier clic sur le micro).

> **(a)** rend le mode immédiatement utilisable à la voix, mais affiche une demande
> du système sans que vous ayez cliqué. **(b)** ne demande rien sans geste, mais le
> premier mot peut être perdu. Ma proposition : **(a)**, avec la ligne d'état qui
> dit « J'ai besoin du micro. » avant l'ouverture.

**Q3. En mode Vocal, voit-on un peu de la conversation ?**
- **(a)** **rien** : seulement l'objet, la ligne d'état et la saisie. On retrouve tout
  en revenant à l'écran normal.
- **(b)** les **deux ou trois derniers échanges** en petit, sous l'objet (13 px,
  `--text-secondary`).

> **(a)** est l'épure demandée ; **(b)** évite de perdre le fil quand une réponse est
> longue et qu'on n'a pas tout entendu. Ma proposition : **(a)**, et la réponse
> reste réécoutable dans l'onglet.

---

## 7. Ce que je n'ai pas vérifié

1. **Le niveau du micro dans la fenêtre de Pilot** : aucun code de ce type n'existe
   aujourd'hui (aucune occurrence de `getUserMedia` / `AnalyserNode` / `AudioContext`
   dans le dépôt). La tenue d'un flux micro permanent dans WebView2 est une
   **hypothèse**, testée au lot 3.
2. **Le rendu exact du halo** à 800×500 : les dimensions proposées (168 px, 200 px,
   24 px) sont calculées, pas vues. À ajuster au premier lancement du lot 2.
3. **Le coût en batterie / processeur** d'une animation continue : non mesuré.
4. **La demande d'autorisation micro à l'entrée** : je n'ai pas vérifié comment
   WebView2 se comporte quand la demande est refusée puis redemandée dans la même
   session.
5. **Le lieu exact de la restauration au démarrage** : le point d'appel est décrit
   (§1.3) mais je n'ai pas écrit le code, donc l'ordre réel avec les autres
   initialisations reste à confirmer à l'exécution.

---

## VERDICT

**Prêt à appliquer pour les lots 1 et 2.** Toutes les décisions du propriétaire sont
respectées, aucun écran de réglage n'est créé, chaque affirmation sur l'existant a sa
preuve, et le mode « Assistant seul » est réutilisé au lieu d'être refait.

**Reste à décider pour les lots 3 et 4** : les trois questions du §6 (surtout Q1,
qui change le comportement du dialogue), et le lot 4 qui dépend du document vocal
existant (2 à 4 semaines).

**Non vérifié** : le niveau du micro dans WebView2 (§7.1) — c'est le seul point
technique qui peut faire changer le lot 3, pas les lots 1 et 2.

DONE: conception écrite livrée dans RAPPORT-trois-modes-ecran-vocal.md — aucun fichier de code modifié, aucun réglage ajouté ; lots 1-2 prêts, lots 3-4 en attente de 3 réponses.
