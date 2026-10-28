# Rapport — double point : badge « Distant » en bas (dec. 375) + compteur « Travail » unique (dec. 361)

> Mission : deux retouches courtes du meme ecran regroupees en une seule mission,
> un seul passage de tests, un rapport qui traite les deux points separement.
> Protocole `quality-gate` applique (lecture complete des fichiers concernes,
> cartographie des points de connexion, verification apres coup).
>
> Aucun envoi vers GitHub, aucun tag, aucune publication, aucune suppression,
> aucune commande de nettoyage ni de reinitialisation Git.

---

## 0. Verdict en une ligne, avant tout le reste

**Les deux points sont DEJA sur le disque.** Ils ont ete livres et verrouilles par
des tests dedies (commits `9db5ea7`, `23a8599` pour le badge ; `5af237d`, `80adab2`
pour le compteur), et une conception posterieure les a re-verifies.

**Conséquence : je n'ai modifie AUCUN fichier de l'application.** Les appliquer
« de nouveau » aurait ete, dans le cas du point A, une **regression** : la
conception citee par la mission decrit le mouvement **inverse** de la decision
375 (elle remonte le badge dans la barre du haut). Detail et preuve au § 1.4.

Fichiers applicatifs touches : **0**. Fichier ajoute : ce rapport, seul.

---

## POINT A — badge « Distant » descendu en bas de colonne (decision 375)

### A.1 Ce que j'ai lu

| Fichier | Ce que j'y ai cherche |
|---|---|
| `index.html` (colonne de gauche, `#sidebar` et ses enfants) | ou vit `#remote-badge`, ordre du DOM |
| `src/css/style.css` (`#global-actions`, `#sidebar-engine-row`, `.remote-badge`, `.project-engine`) | hauteurs, marges, `flex`, ellipse |
| `src/js/settings.js` (`pollRemoteBadge`, ajout du clic) | cablage du badge (ne pas casser) |
| `src/js/main.js` (`syncEngineSubtitle`) | source unique du texte du moteur |
| `src/js/badge-distant-bas.test.js` (verrou, 378 lignes) | ce que la decision 375 impose deja |
| `RAPPORT-badge-distant-bas.md` | rapport d'execution de la decision 375 |
| `RAPPORT-conception-bouton-distant-barre-haute.md` (604 lignes) | la conception citee par la mission |

### A.2 Etat du disque (preuves, `fichier:ligne`)

| Point | Preuve |
|---|---|
| Le badge a quitte le haut : `#global-actions` ne porte **plus rien** et ne consomme **aucune** hauteur (`margin: 0; padding: 0`) | `src/css/style.css:784-801`, `index.html:76` (commentaire d'intention reecrit) |
| Le badge vit dans `#sidebar-engine-row`, **dernier enfant de `#sidebar`**, donc en bas de la colonne, **sous** le bloc accentue des menus | `index.html:231-234`, puis `</aside>` |
| Il est **a droite** de la ligne qui nomme le moteur : ordre du DOM texte d'abord, badge ensuite | `index.html:232` (`#project-engine`) puis `:233` (`#remote-badge`) |
| Cale a droite de la ligne : `margin: 0 0 0 auto`, `flex: 0 0 auto` (le badge ne se reduit ni ne grossit) | `src/css/style.css:7431-7455` |
| C'est le **texte** qui se reduit avant le badge : `#sidebar-engine-row .project-engine { flex: 1 1 auto; min-width: 0 }` | `src/css/style.css:833-836` |
| Hauteur fixe de la ligne = 28 px : l'arrivee/le depart d'un client ne fait pas sauter la liste des fichiers | `src/css/style.css:816-830` |
| Badge inchange : meme `id`, meme classe, meme libelle « Distant », meme compteur, meme icone, meme infobulle, meme clic (ouvre les Reglages) | `index.html:233`, `src/js/settings.js` (`remoteBadge.addEventListener("click", () => btnSettings.click())`) |
| Un seul element porte le texte du moteur dans toute la colonne : pas de doublon | `index.html` — une seule occurrence de `id="project-engine"` |
| Colonne toujours a 280 px, bandeau du haut toujours a 48 px | `src/css/style.css:754` (colonne), test `badge-distant-bas.test.js` (« le bandeau du haut garde ses 48 px ») |

### A.3 La consigne est contredite par le disque : je la refuse, et voici pourquoi

La mission demande d'appliquer **telle quelle** la conception de
`RAPPORT-conception-bouton-distant-barre-haute.md`. Or ce document decrit
exactement le contraire du point A :

- § 2.1, verbatim : « Le badge devient un **enfant direct de `#tab-row`**, placé
  **entre `#tab-bar` et `#agent-activity`** » — c'est-a-dire **en haut de la
  fenetre, dans la rangee d'onglets, a gauche de « Travail »**.
- § 14 (VERDICT) : « l'emplacement est decide et decrit au pixel : le badge
  devient un enfant direct de `#tab-row` ».
- Son objectif declare : « **gagner une ligne** dans la colonne de gauche » en
  **remontant** le badge.

C'est l'inverse du point A (« badge **descendu en bas** de colonne, a droite de la
ligne du moteur »). Appliquer ce document « tel quel » aurait donc :

1. **remonte** le badge dans la barre du haut (regression visible) ;
2. **casse** le verrou `src/js/badge-distant-bas.test.js`, qui dit noir sur blanc,
   a sa ligne 8 : « La proposition qui le placait dans la barre du haut est
   ECARTEE » — et dont 5 tests rougissent quand le badge remonte (contre-epreuve
   deja faite et documentee dans `RAPPORT-badge-distant-bas.md` § 4) ;
3. contredit la **decision 375** elle-meme, qui est la reference de la mission.

Chronologie sur le disque (elle leve l'ambiguite) :

| Date (mtime) | Fichier | Sens |
|---|---|---|
| 2026-10-26 13:25 | `RAPPORT-conception-bouton-distant-barre-haute.md` | **proposition** : badge en HAUT (barre d'onglets) |
| 2026-10-26 16:47 | `RAPPORT-badge-distant-bas.md` | **execution de la decision 375** : badge en BAS (etat actuel) |

La proposition est donc **anterieure** au travail livre : elle a ete ecartee par la
decision 375, puis remplacee. Le document qui decrit reellement le mouvement
demande n'est pas celui cite par la mission, c'est `RAPPORT-badge-distant-bas.md`
— et son contenu est deja applique.

**Point ou le disque contredit la conception (signale, non corrige a ma facon,
comme demande) :** la conception suppose en outre, en § 1.1, que le badge est
« seul enfant de `#global-actions` » et que « `#global-actions` reste dans le DOM
mais vide (0 px) » ; sur le disque, cette seconde moitie est **vraie**, mais la
premiere est fausse : le badge n'y est plus du tout. Rien a corriger : c'est le
resultat direct de la decision 375.

### A.4 Ce qui n'a pas pu etre verifie (dit franchement)

- **Le rendu a l'ecran : impossible pour moi.** Aucune fenetre Pilot n'a ete
  ouverte. Les valeurs (28 px de ligne, `margin-left: auto`, ellipse du texte)
  sont **lues dans le CSS** et verifiees par les tests, pas vues.
- **L'etat « client connecte »** (badge vert + compteur) n'a pas ete provoque : le
  serveur distant n'a pas ete lance.
- **Le libelle long du moteur** (ellipse du texte, badge qui ne bouge pas) n'a pas
  ete rendu en conditions reelles.
- Le proprietaire jugera a l'oeil.

---

## POINT B — compteur « Travail » identique dans les deux modes (decision 361)

### B.1 Ce que j'ai lu

| Fichier | Ce que j'y ai cherche |
|---|---|
| `src/js/agent-activity.js` (`splitMissions`, `agentTaskCounterText`, `agentTaskCounterLabel`, `paintAgentPanelTaskCount`, `setAgentPanelTaskCount`) | le calcul et le peintre |
| `src/js/super-agent.js` (`publishSuperMissionsCount`, `enterImmersive`, `exitImmersive`) | le producteur du compte et le mode « Assistant seul » |
| `src/css/style.css` (`.superagent-immersive-active #agent-activity`, `.sa-immersive-top`) | ce que le mode immersif fait du compteur |
| `src/js/compteur-taches-travail.test.js` (bloc `(h)`) | les verrous deja poses |
| `RAPPORT-compteur-travail-assistant-seul.md` | rapport d'execution de la decision 361 |

### B.2 Etat du disque (preuves)

| Point | Preuve |
|---|---|
| **Un seul calcul** : `buildRunningMissions(...)` puis `splitMissions(...)`, puis `setAgentPanelTaskCount(running.length, waiting.length)` | `src/js/super-agent.js`, `publishSuperMissionsCount()` — un seul appelant de `setAgentPanelTaskCount` |
| **Un seul peintre** : `paintAgentPanelTaskCount()` ecrit dans `#agent-activity-count` (texte, `hidden`, `working`) et dans l'infobulle/`aria-label` de `#agent-activity-entry` | `src/js/agent-activity.js:1248-1273` |
| La valeur est bien « en cours + en attente » : `agentTaskCounterText(r, w)` rend `r/(r+w)` | `src/js/agent-activity.js:1204-1216` |
| **Le mode « Assistant seul » n'a pas de second compteur** : `enterImmersive()` **deplace le MEME noeud** `#agent-activity` dans la barre du mode, et memorise sa place (`immersiveActivityHome`) | `src/js/super-agent.js:3509-3522` |
| `exitImmersive()` restitue le **meme** noeud a sa place exacte, **avant** le retrait de l'overlay (sinon le mode normal perdrait son compteur) | `src/js/super-agent.js:3555-3566` |
| Une seule entree « Travail » dans la page (`id="agent-activity"` apparait **1** fois) | `index.html:282` |
| Le mode immersif **ne masque plus** le compteur : la regle est passee de `display: none` a `display: flex` (centre verticalement, sans marge laterale) | `src/css/style.css:11253-11258` |
| Libelle et place **inchanges** : « Travail » + chiffre, dans la rangee d'onglets en mode normal, dans la barre du mode en mode immersif | `index.html:282-...`, `src/css/style.css:11253` |

Nuance honnete : `paintAgentPanelTaskCount()` est appele depuis **deux** endroits
(`setAgentPanelTaskCount` et `setAgentPanelTabsVisibility`), mais le second repeint
les **nombres memorises** (`panelTaskRunning` / `panelTaskWaiting`) sans jamais
recalculer : il n'y a donc pas deux calculs, seulement deux occasions de repeindre
le meme etat. C'est conforme a « calculee UNE seule fois ».

### B.3 Ce qui a change dans cette mission

**Rien.** Le point B etait deja conforme : la divergence historique (l'entree
« Travail » etait `display: none` en mode immersif, donc le compteur *manquait*)
a ete corrigee par le commit `5af237d` via un **deplacement de noeud**, et
verrouillee par le commit `80adab2` (bloc `(h)` de
`src/js/compteur-taches-travail.test.js`, qui interdit aussi qu'une regle CSS du
mode immersif cache une partie du compteur).

### B.4 Ce qui n'a pas pu etre verifie

- **La bascule a l'ecran** vers le mode « Assistant seul » n'a pas ete faite : le
  deplacement du noeud est verifie par lecture de code et par test, pas par
  observation.
- **La valeur affichee sur un travail reel** (agents qui tournent) n'a pas ete
  observee en conditions de production.
- Le proprietaire jugera a l'oeil.

---

## 3. Fichiers touches

| Fichier | Nature |
|---|---|
| `RAPPORT-double-point-badge-bas-compteur-travail.md` | **ajoute** (ce rapport, seul fichier de la mission) |

Aucun fichier de code, de style, de test, de specification, ni d'aide n'a ete
modifie. En particulier : colonne 280 px, bandeau, themes, trois onglets du
panneau, barre de boutons systeme, boutons du mode « Assistant seul » et libelle
du moteur dans les Options sont **intacts**. Le repli des menus du bas n'a pas ete
traite (mission separee).

Note d'hygiene : `src-tauri/src/agents.rs` etait **deja** modifie avant mon
intervention (travail d'un autre agent, hors mission). Je n'y ai pas touche et je
ne l'ai pas committe.

---

## 4. Verifications lancees, resultats exacts (recomptes par moi)

| Commande | Resultat exact |
|---|---|
| `npx vitest run src/js/badge-distant-bas.test.js` | **PASS (13) FAIL (0)** |
| `npx vitest run src/js/compteur-taches-travail.test.js` | **PASS (35) FAIL (0)** |
| `npx vitest run src/js/lot2-colonne-haut.test.js` | **PASS (27) FAIL (0)** |
| `npx vitest run` (suite complete du projet) | **PASS (3397) FAIL (0)** |

Non lance : `cargo test` — aucun fichier Rust n'est concerne par cette mission
(et `src-tauri/src/agents.rs` n'est pas de mon fait).

Ecart signale vs les chiffres cites dans les rapports anterieurs : ceux-la
annoncaient **3288** puis **3301** tests. La suite en compte aujourd'hui **3397**
(la suite a grandi depuis, ce n'est pas une contradiction, seulement une mesure
plus recente — c'est pourquoi j'ai recompte).

---

## 5. Ce qui reste a faire

1. **Rien sur le code** pour ces deux points : ils sont livres et verrouilles.
2. **Verification visuelle par le proprietaire** (la seule chose que je ne peux pas
   faire) : badge en bas a droite de la ligne du moteur, et compteur identique en
   basculant en mode « Assistant seul ».
3. **Corriger la reference documentaire de la mission** : la conception a citer
   pour le point A est `RAPPORT-badge-distant-bas.md` (decision 375, deja
   appliquee), **pas** `RAPPORT-conception-bouton-distant-barre-haute.md`, qui
   decrit la proposition ecartee. Tant que cette confusion dure, la meme mission
   sera rejouee et re-refusee.
4. Si le proprietaire veut malgre tout **remonter** le badge dans la barre du
   haut (contenu de la conception citee), c'est une **autre decision** — elle
   annulerait la decision 375 et exigerait de retourner le verrou
   `src/js/badge-distant-bas.test.js`. A faire sur demande explicite, pas dans
   cette mission.
