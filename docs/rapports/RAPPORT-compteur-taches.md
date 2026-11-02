# Rapport — le compteur à côté de « Travail »

> Mission : remplacer, à côté de « Travail » (en haut à droite, à gauche des
> trois boutons système), le nombre actuel par « tâches en cours / tâches
> totales » (ex. `2/5`). Lecture seule : **aucun fichier de code modifié**.
> Verdict : c'est faisable **sans une ligne de Rust, sans nouvelle place à
> l'écran et sans toucher aux décisions déjà prises**.

---

## 1. Ce que compte le compteur aujourd'hui (preuves)

**L'élément.** Le bouton `#agent-activity-entry` (`index.html:225`) vit entre la
barre d'onglets et les trois boutons système, donc exactement à la place que tu
décris. Il contient trois morceaux, dans cet ordre :

| morceau | rôle |
|---|---|
| `#agent-activity-dot` (8 px) | le point qui respire quand du travail est en cours |
| `.agent-activity-entry-label` | le mot **Travail** |
| `#agent-activity-badge` | **le compteur que tu veux voir disparaître** |

**Ce qu'il compte : des ÉVÉNEMENTS NON LUS, pas des tâches.**
`agentPanelNoteEvent()` (`src/js/agent-activity.js:1343`) incrémente un simple
compteur (`panelUnread`, `:1136`) à chaque **événement système** poussé par
l'Assistant dans le journal — `pushSuperAgentSystemEvent()`
(`src/js/super-agent.js:2484`) : délégation lancée, agent démarré/arrêté, erreur,
connexion perdue, tâche terminée. Aucune tâche n'entre jamais dans ce nombre.

| propriété | valeur constatée |
|---|---|
| nature | nombre d'événements **pas encore regardés** |
| alimentation | à chaque événement (aucun rythme périodique) |
| plafond | `99+` (`AGENT_PANEL_UNREAD_MAX`, `agent-activity.js:1169`) |
| remise à zéro | dès que l'onglet « Événements » est regardé (`:1263`), **pas** quand une tâche se termine |
| à zéro | le badge est **masqué** (`hidden`, `agent-activity.js:1225-1231`) |
| persistance | aucune : le nombre repart de 0 à chaque démarrage |
| forme | pastille pleine violette, 15 px, clignotante (`style.css:1977-1995`) |

**Pourquoi il est illisible.** Quatre raisons cumulées : (1) il ne parle pas de
travail mais de messages non lus ; (2) il **apparaît et disparaît** tout seul, donc
on ne sait jamais s'il « compte » quelque chose en ce moment ; (3) il clignote en
permanence, ce qui attire l'œil sur une information secondaire ; (4) sa valeur
n'est ni un compte de tâches ni un compte d'agents, elle n'a donc aucun référent
clair. Ton constat (« ou je ne sais pas quoi ») est exactement le symptôme attendu.

**Vérification factuelle, à ne pas rouvrir.** La décision « plus de bande haute »
est bien celle du disque : la bande de 32 px **n'existe plus**, la rangée d'onglets
en porte la place (`index.html:192-207`, `style.css:1849` : `min-height: 36px`), et
les trois boutons prennent 28 px de haut avec 4 px d'air (`index.html:263-273`).
Le compteur s'installera **dans le bouton existant** (22 px de haut,
`style.css:1919-1940`) : **zéro pixel de rangée ajouté**, aucun air retiré aux
boutons, colonne de gauche à 280 px intacte.

---

## 2. Recommandation tranchée

### 2.1 Ce que comptera le nouveau compteur

**« en cours » = le nombre de tâches que des agents sont en train de faire
maintenant. « total » = celles-là plus celles qui attendent dans les files.**
C'est-à-dire **exactement la somme des deux titres de groupes de l'onglet
« Tâches »** : « En cours (n) » + « En attente (n) ».

Source unique : `renderSuperMissions()` (`super-agent.js:2569`) construit **un
seul** tableau de missions, puis le découpe avec la fonction pure `splitMissions()`
(`agent-activity.js:655`). Le bouton et les deux titres liront **le même tableau,
découpé par la même fonction** : par construction, le bouton ne pourra **jamais**
contredire l'onglet. C'est cette égalité qui servira de verrou de test.

| question | réponse retenue | pourquoi |
|---|---|---|
| « en cours » | agents réellement au travail (`busy` ou outil long en cours) **tous projets** | c'est déjà la vérité de l'indicateur d'activité (`isAgentWorking`) et du groupe « En cours (n) » |
| « total » | en cours **+** en attente (délégations et missions en file) | un « total » qui n'inclut pas la file donnerait `2/2` alors que 3 demandes poireautent |
| l'Assistant qui réfléchit | compté comme une tâche en cours | il figure déjà comme une ligne « En cours » de l'onglet |
| projet actif ou tous | **tous** les projets ouverts | l'indicateur d'activité et l'onglet sont déjà globaux ; un compteur limité au projet actif contredirait les deux |
| tâches **terminées** | **jamais** dans le total | sinon le dénominateur monte à vie et `2/5` devient `2/280` : le chiffre perdrait tout sens |

### 2.2 Les quatre sources de données recensées (et le sort de chacune)

| # | source | ce qu'elle donne | sort |
|---|---|---|---|
| A | store d'activité partagé (`get_agent_supervision`, `dashboard.rs`, poll 2 s + push `agent-state-changed`) | agents qui travaillent, tous projets | **RETENUE** pour « en cours ». Disponible dès le démarrage, sans projet ouvert, sans appel supplémentaire. |
| B | files de missions : `getProjectMissionQueue` + `getProjectDelegationQueue` (`super-agent.js:699`, `:1195`) | missions qui attendent | **RETENUE** pour la partie « en attente » (c'est déjà la source de l'onglet). |
| C | file des commandes manuelles (`project-task-queue.js:415`) + file d'exclusivité des agents (`agents-bus.js:1256`) | demandes tapées à la main qui attendent leur tour | **MANQUE aujourd'hui dans l'onglet Tâches.** Voir § 2.5 et le lot 2. |
| D | carnet de tâches suivi par l'Assistant (`task_counts`, `super_agent.rs:2574` ; `get_project_tracking`, `dashboard.rs:1076`) | tâches du suivi, par projet, persistées | **ÉCARTÉE** : c'est un backlog qui ne redescend pas (des dizaines de « done » dans le total), et elle est **par projet**. `dashboard.js:715` affiche déjà `2/5` avec cette source : ton `2/5` à toi ne peut pas être celui-là sans afficher des dizaines au dénominateur. C'est la question 1. |

### 2.3 Le libellé et l'apparence (exactement)

On **garde** le mot « Travail » (c'est le nom de l'entrée, il est dans la
documentation) et on **remplace** le contenu du compteur : `● Travail 2/5`.

| propriété | valeur |
|---|---|
| texte | `2/5` — en cours, barre oblique, total. **Aucun autre signe.** |
| position | dans le bouton, après le mot, 6 px d'écart (le `gap` existant du bouton) — donc à gauche des boutons système, comme demandé |
| taille | `--font-xs` (11 px), même graisse 600 que le mot : le compteur est de la même voix que le nom |
| chiffres | `font-variant-numeric: tabular-nums` (convention déjà utilisée 6 fois dans la feuille) : les chiffres ne dansent pas quand ils changent |
| largeur | `min-width: 22px`, aligné à droite : de `2/5` à `12/14` le bouton grandit de quelques pixels vers la gauche, jamais sous la souris |
| repos | `--text-secondary` → **7,85:1** (sombre) / **5,70:1** (clair) sur le fond de la rangée : AA pour du 11 px |
| au moins une tâche en cours | `--text-primary` → 15,4:1 / 15,5:1 : le chiffre « s'allume » quand ça travaille, sans clignoter |
| survol / ouvert | suit le bouton (déjà `--text-primary`) : rien à ajouter |
| pas de pastille | **aucun fond, aucune bordure, aucune animation.** Une pastille pleine à 11 px ne peut pas atteindre AA en thème clair : celle d'aujourd'hui mesure **3,64:1** (mesuré), sous le seuil de 4,5:1. Un simple texte sur le fond, si. |

**Infobulle** (et `aria-label`, **la même chaîne**, une seule source) :

| état | texte exact |
|---|---|
| au moins une en cours | `Travail : 2 tâches en cours sur 5 (3 en attente)` |
| aucune en cours, des attentes | `Travail : aucune tâche en cours (3 en attente)` |
| rien du tout | `Suivi du travail` *(inchangé)* |

**Cas « rien »** : `running + waiting = 0` → **le compteur n'est pas affiché** (le
bouton redevient `● Travail`, infobulle « Suivi du travail »). Pas de `0/0` qui
occupe la place en permanence et ne dit rien ; et son apparition devient un
signal en soi. *(Question 3 non retenue — c'est tranché ici.)*

**Cas « beaucoup »** : chaque nombre est plafonné à `99+` **dans le texte visible**
(le bouton ne s'allonge pas indéfiniment) ; l'infobulle, elle, donne **toujours
les nombres réels** — le plafond ne ment jamais.

**Fenêtre étroite** : **aucun point de rupture ajouté.** Le bouton ne rétrécit
pas ; c'est `#tab-bar` qui cède (`min-width: 0`, défilement horizontal, décision
déjà prise). À la largeur minimale de fenêtre (800 px, `tauri.conf.json:47`), la
rangée garde ~260 px pour les onglets. Le mot « Travail » n'est jamais masqué :
le retirer ramènerait exactement la confusion que tu signales.

**Réglage « onglet Tâches » désactivé** : le compteur disparaît avec l'onglet
(une seule règle, appliquée là où la visibilité des onglets est déjà appliquée,
`super-agent.js:2539`). Un compteur qui renvoie à un onglet absent serait un
mensonge de plus.

### 2.4 Où passe le signal « événements non lus » (on ne le perd pas)

Il n'a plus sa place dans le bouton (c'est ta demande), mais il ne disparaît pas :

1. **le point du bouton continue de s'allumer** en couleur d'accent tant qu'il
   reste des événements non vus (`#agent-activity-dot.agent-unread`,
   `style.css:1997` — code inchangé) ;
2. **un point de 6 px apparaît sur l'onglet « Événements »** du panneau, avec le
   nombre exact **dans son infobulle** (`12 événements non lus`) et dans le nom
   lu par la synthèse vocale.

Pourquoi un point et pas le nombre : le nombre posé dans la barre d'onglets coûte
de 16 à 26 px sur les 320 px de largeur minimale du panneau, dont il ne reste que
**20,3 px** de marge calculée (verrou `taille-et-style-panneau.test.js:386-431`) — et
une pastille pleine y échouerait AA (§ 2.3). Un point de 6 px + 4 px d'écart
consomme 10 px, laisse 10,3 px de marge, et ne porte aucun texte : il n'a qu'à
respecter 3:1, qu'il respecte (3,3:1). *(Alternative si tu préfères le nombre :
question 2.)*

### 2.5 Ce qu'il manque pour que le compte soit complet (petite brique)

L'onglet Tâches — et donc le futur compteur — **ignore deux familles d'attente
réelles** : les **commandes tapées à la main** (`project-task-queue.js`) et les
**agents qui attendent leur tour** (`agents-bus.js`). Aujourd'hui `/file` peut
afficher une file non vide alors que l'onglet Tâches dit « Aucune mission ».

La plus petite brique à ajouter est **deux fonctions pures d'export**, sans
nouvelle structure ni commande Rust : un compte global des commandes
(`state.queues`, déjà en mémoire dans le module) et un compte global des entrées
d'exclusivité (déjà en mémoire dans `busState`). Elles alimentent **à la fois**
le compteur **et** l'onglet, ce qui garde l'égalité du § 2.1. Aucune donnée
nouvelle n'est créée : rien que du déjà-là, rendu visible. → lot 2.

---

## 3. Lots (chacun livrable et testable seul)

### Lot 1 — La permutation (le compteur arrive, l'événement s'en va)

| fichier | ce qui change |
|---|---|
| `index.html:225` | dans le bouton : le badge de non-lus **sort**, `#agent-activity-count` **entre** (même place, après le mot) ; les attributs `title` / `aria-label` / `aria-haspopup` / `aria-expanded` posés sur le point sont retirés (doublons du bouton : l'infobulle du point masquait celle du bouton) |
| `index.html:235` | sur l'onglet « Événements » : le point `#agent-activity-events-unread` (6 px, masqué par défaut) |
| `style.css:1977-1995` | le bloc de la pastille est remplacé par deux blocs : `#agent-activity-count` (§ 2.3) et le point de l'onglet |
| `style.css:5272` | `.sa-events-tab` : `gap: 4px` (aucune hauteur ajoutée — un verrou l'interdit) |
| `agent-activity.js` | fonctions **pures** `agentTaskCounterText(running, waiting)`, `agentTaskCounterLabel(running, waiting)`, `agentUnreadTooltip(n)` ; `setAgentPanelTaskCount(running, waiting)` (écrit le texte, `hidden`, `title` + `aria-label` du bouton) ; `updateAgentPanelBadge` écrit désormais sur le point de l'onglet (masqué + infobulle + nom de l'onglet), sans chiffre affiché |
| `super-agent.js:2569` | `renderSuperMissions()` publie le compte : `splitMissions(missions)` → `setAgentPanelTaskCount(running.length, running.length + waiting.length)` |
| `super-agent.js:2550` + `:2827` | la surveillance cesse d'être liée à l'onglet affiché : **un seul abonné permanent** au store partagé (aucun appel Rust ajouté, le store polle déjà toutes les 2 s). Seule la **peinture de la liste** reste conditionnée à l'onglet Tâches. Sans cela, le compteur se figerait dès que tu regardes un autre onglet |
| `super-agent.js:2539` | le compteur suit le réglage « onglet Tâches » (§ 2.3) |
| `panneau-suivi-trois-onglets.test.js:127-136, 601-646` | identifiants du faux DOM + les 4 assertions de « signal d'attention » réécrites sur le point de l'onglet |
| **nouveau** `compteur-taches-travail.test.js` | (a) `2/5`, `0/3`, `""`, plafond `99+/120+` ; (b) les 3 infobulles mot pour mot ; (c) **verrou d'égalité** : le nombre du bouton = somme des deux titres de groupes de l'onglet, sur les mêmes données |

### Lot 2 — Complétude du compte (§ 2.5)

Export des deux compteurs globaux (commandes manuelles + entrées d'exclusivité),
prise en compte **dans l'onglet Tâches d'abord**, puis dans le compteur, et
extension du verrou d'égalité aux quatre familles. C'est ce lot qui fait que le
bouton ne contredira plus jamais `/file`.

### Lot 3 — Textes, docs, aide

`spec_super_agent.md:115-119` (le paragraphe « pastille … 99+ » devient le
nouveau comportement) ; bloc `<!-- HELP:super-agent -->` (même fichier, ouvert
ligne 7) sur le compteur ; `README.md` si le cercle y est décrit ; puis
`npm run build:handbook`.

**Vérification après chaque lot :** `npx vitest run` (puis `npm test` complet) et
`npm run build:handbook` pour le lot 3. Aucun test Rust n'est concerné.

---

## 4. Trois questions fermées

**Q1 — Le « total », c'est quoi ?**
(a) **le travail confié aux agents** = en cours + en attente (ma recommandation :
`2/5` veut dire 2 tournent, 3 attendent) — ou
(b) **le carnet de tâches suivi par l'Assistant** (alors le dénominateur inclut
les tâches terminées, et le compteur dépend du projet ouvert).

**Q2 — Les 2 familles d'attente oubliées (§ 2.5) :**
(a) **on complète maintenant** (lot 2 dans la même livraison) — ou
(b) **plus tard**, et on assume que le compteur peut sous-estimer la file.

**Q3 — Le signal des événements non lus (§ 2.4) :**
(a) **un point de 6 px** sur l'onglet « Événements », nombre dans l'infobulle
(ma recommandation : coût 10 px, lisible AA) — ou
(b) **le nombre en clair** dans l'onglet (coût 16 à 26 px sur une marge de
20,3 px : ça tient, mais serré, et il faut abaisser la largeur minimale du
panneau ou renoncer à l'AA du chiffre).

*Décisions déjà prises ici, sans te déranger : le mot « Travail » reste ; rien
n'est affiché à zéro ; plafond `99+` dans le texte, nombres réels dans
l'infobulle ; aucun point de rupture de largeur ; le compteur suit le réglage de
l'onglet Tâches.*
