# Pilot — Rendre la navigation évidente

> **Document de proposition.** Ce texte ne contient **aucune modification de code** :
> il décrit l'existant, nomme les gênes, puis propose une réorganisation de la
> navigation. Rien n'est publié, aucune version n'est changée.
> Rédigé pour être lu sans connaissance technique du projet.

---

## Résumé en dix lignes

- L'application propose aujourd'hui **22 sortes d'écrans différents**, ouverts par
  **118 boutons** dans la seule page `index.html`, dont **14 boutons à icône seule**
  empilés en bas de la colonne de gauche et **7 icônes sans texte** en haut.
- Ces 14 boutons sont répartis dans **3 sous-onglets** dont **un seul est visible à
  la fois** : pour trouver le Kanban, il faut deviner qu'il est rangé dans
  « Assistant ».
- **Quatre écrans différents** répondent à la même question « où en est mon
  projet ? ». **Deux conversations** se ressemblent au point qu'un réglage a été
  ajouté pour éviter d'écrire dans la mauvaise.
- Les Paramètres comptent **11 onglets** et **70 cases à cocher**, et leur
  découpage ne suit pas celui des écrans (la voix se règle dans « Assistant » mais
  sert aussi la conversation de l'agent).
- La proposition tient en **une règle** : *une intention = un bouton, toujours au
  même endroit, avec son nom écrit en clair*.
- Elle ramène l'entrée de l'application à **4 portes** : **Projet**, **Travail**,
  **Assistant**, **Réglages**.
- Elle ramène le bas de la colonne de gauche de **14 boutons à 3** (+ un menu
  « Autres écrans »), le haut de **7 icônes à 3**, les Paramètres de **11 onglets à 6**.
- Elle ne supprime **aucune fonctionnalité** : elle déplace des boutons, renomme,
  et ajoute un fil d'Ariane.
- Coût estimé : **5 étapes petites, 1 petite-moyenne, 4 moyennes, 1 grosse** —
  détaillé au § 5.
- Les changements d'apparence sont limités au **texte des boutons** et à un
  **bandeau de titre** : couleurs, thèmes et disposition générale restent identiques.

---

## 1. Inventaire factuel de l'existant

Chaque ligne renvoie au fichier et à la ligne du code réel.

### 1.1 Le haut de la colonne de gauche — le projet

| Élément | Ce qu'il fait | Preuve |
|---|---|---|
| Logo + nom du projet | ouvre le menu des projets | `index.html:26-27` |
| Bouton dossier | choisir un projet existant sur le disque | `index.html:28` |
| Menu « Projets » | Nouveau projet, Depuis GDS, Projets récents, Fermer ce projet | `index.html:31-40` |

### 1.2 La rangée d'icônes globales — 7 boutons sans texte

Tous ces boutons n'affichent **qu'une icône** : leur sens n'apparaît qu'au survol
(attribut `title`). Preuve : `index.html:44-53`.

| # | Identifiant | Icône | Sens (infobulle seule) | Ligne |
|---|---|---|---|---|
| 1 | `btn-scratchpad` | 📝 | Brouillon (Ctrl+Shift+N) | 45 |
| 2 | `btn-settings` | ⚙ | Paramètres | 46 |
| 3 | `btn-vault` | 🔐 | Coffre fort de mots de passe | 47 |
| 4 | `btn-feedback` | 💬 | Envoyer une remarque | 48 |
| 5 | `btn-help` | ❓ | Aide sur Pilot | 49 |
| 6 | `btn-gds-admin` | 🖥️ | **GDS Serveur — administration** | 50 |
| 7 | `btn-gds-params` | 🌐 | **GDS — paramétrage utilisateur** | 51 |
| — | `remote-badge` | — | état de l'accès distant | 52 |

### 1.3 Les projets ouverts

Barre « Projets en cours » sous le menu : un clic bascule de projet, la croix ✕
ferme. Rendue par `sidebar.js:1303-1364`, conteneur `index.html:54`.

### 1.4 Les fichiers

Filtre de l'arborescence (`index.html:56`), section Favoris (`index.html:58`),
arbre (`index.html:59`), menus contextuels (`index.html:1257`, `1281`, `1288`).

### 1.5 Le bas de la colonne de gauche — 3 sous-onglets, 14 boutons

Preuve : `index.html:65-95` ; bascule des sous-onglets `sidebar.js:1610-1644`.
Les trois sous-onglets sont `Projet` / `Vues` / `Assistant`
(`index.html:67-70`), et **un seul** panneau est affiché.

**Sous-onglet « Projet » — 6 boutons** (`index.html:72-80`)

| Identifiant | Icône | Infobulle | Ligne | Remarque |
|---|---|---|---|---|
| `btn-explorer` | 📂 | Ouvrir le dossier dans l'explorateur | 74 | ouvre le Finder/Explorateur Windows |
| `btn-terminal` | ⌨ | Ouvrir le terminal | 75 | |
| `btn-terminal-cmd` | 🤖 | **« Agent / Terminal »** | 76 | **ouvre l'un ou l'autre selon un réglage** |
| `btn-commands` | ⌨ | Commandes du projet | 77 | |
| `btn-prompt-builder` | 🧩 | Prompt Builder | 78 | |
| `btn-dashboard` | 📊 | Tableau de bord du projet | 79 | |

**Sous-onglet « Vues » — 4 boutons** (`index.html:82-87`)

| Identifiant | Icône | Infobulle | Ligne |
|---|---|---|---|
| `btn-code-graph` | 🕸 | Graphe du projet (visualisation 2D) | 83 |
| `btn-review` | 🔍 | Revue de code du diff Git | 84 |
| `btn-history` | 🕘 | Historique des sessions agent | 85 |
| `btn-gds` | 🗄 | GDS du projet | 86 |

**Sous-onglet « Assistant » — 4 boutons** (`index.html:89-94`)

| Identifiant | Icône | Infobulle | Ligne |
|---|---|---|---|
| `btn-agents` | 🎭 | Équipe d'agents multi-rôles | 90 |
| `btn-superagent` | 🧭 | Assistant : suivi multi-projets | 91 |
| `btn-superkanban` | 🗂 | **Vue Kanban** | 92 |
| `btn-interproject` | 🔗 | Discussion inter-projets | 93 |

### 1.6 La barre d'onglets

Un onglet par document ouvert, plus des onglets « spéciaux ».
Preuve du routage : `src/js/tabs.js:288-395`.

Les **22 sortes d'onglets** existantes :

| Famille | Onglets |
|---|---|
| Documents | édition, prévisualisation Markdown, PDF, image, CSV, brouillon, terminal |
| Agents | `agent` (π Agent Pi / PLh), `agents` (🎭 équipe), `superagent` (🧭 Assistant) |
| Suivi | `superagent-kanban` (🗂 Kanban), `dashboard` (📊 Tableau de bord) |
| Outils projet | `code-graph`, `review`, `history`, `prompt-builder` |
| Système | `vault` (🔐), `help` (❓ Aide), `feedback` (💬) |
| GDS | `gds`, `gds-admin`, `gds-params` |

Ordre imposé dans la barre : l'onglet 🧭 reste toujours le premier, le 📊 peut y
être verrouillé (`tabs.js:3054-3074`). Le bouton « + » d'un nouvel onglet agent
n'apparaît que si un réglage est activé (`tabs.js:233-241`, `settings.js:322`).

### 1.7 Le panneau « Suivi du travail »

Pastille animée en haut à droite, qui ouvre un panneau à **3 onglets** :
`index.html:108-132` (pastille 109, panneau 110, onglets 112-116, boutons
**Tout effacer** 118 et **Fermer** 119, trois vues 122-130, carte de détail 132).

### 1.8 Les barres et panneaux secondaires

Barre d'état (`index.html:165`, seul bouton : Aide-mémoire des raccourcis),
panneau Plan (`index.html:139`), panneau Recherche globale (`index.html:149`).

### 1.9 Les fenêtres (modales) — 11 + 1 palette

`shortcuts-modal` 181 · `commands-modal` 235 · `command-form-modal` 250 ·
`command-palette` 268 · `settings-modal` 277 · `update-modal` 1309 ·
`pi-update-modal` 1331 · `audit-modal` 1347 · `interproject-modal` 1370 ·
`context-menu` 1257 · `preview-link-context-menu` 1281 · `edit-context-menu` 1288.

### 1.10 Les Paramètres — 11 onglets, 70 cases à cocher

Onglets : `index.html:282-292`. Contenu : **156 lignes** de réglages,
**70 cases à cocher**.

| Onglet | Lignes | Cases | Ce qu'on y règle |
|---|---|---|---|
| Général | 296-358 | 7 | apparence, animations, sauvegarde, terminal, démarrage |
| Avatar | 362-393 | — | avatar parlant |
| Service Laya | 396-475 | 2 | service de classification local |
| Agent Pi | 478-627 | **17** | RPC, onglets agents, **tableau de bord** (496-506), réflexion/outils, notifications, anomalies, arrêt auto, **contexte/RAG/imports/specs** |
| Modèles IA | 629-745 | — | alias de modèles |
| Fournisseurs | 748-771 | — | providers |
| Accès distant | 773-857 | — | serveur web, sécurité |
| RAG | 859-884 | — | moteur d'embeddings |
| Code Graph | 886-920 | — | moteur d'extraction |
| **Assistant** | 922-1135 | **24** | nom, prompt, réglages, suivi, mémoire, **lecture à voix haute** (1071-1085), clients (1089), Telegram (1117) |
| MCP | 1136-1255 | 7 | serveurs MCP |

### 1.11 Les raccourcis clavier

Listés dans `index.html:181-231`. La palette de commandes `Ctrl+Shift+P`
n'exécute que **19 commandes d'édition** (`src/js/main.js:41-61`) : sauvegarder,
fermer un onglet, split, table des matières, recherche, mode Zen, gras/italique,
brouillon, mises à jour, fichiers récents, remarque. **Aucun écran du projet n'y
figure** (ni Kanban, ni Coffre, ni Aide, ni Graphe, ni Réglages).

---

## 2. Où l'utilisateur doit-il aller aujourd'hui ?

Le tableau ci-dessous compte les gestes nécessaires, en partant de l'application
ouverte sur un projet.

| Intention | Chemin actuel | Gestes |
|---|---|---|
| Ouvrir un fichier | arbre de gauche | 1 |
| Ouvrir le terminal | bas de la gauche → sous-onglet « Projet » → icône ⌨ | 2 |
| Lancer l'agent sur ce projet | bas → « Projet » → icône 🤖 (qui peut ouvrir un terminal) | 2 |
| Parler à l'Assistant | bas → sous-onglet « Assistant » → 🧭 | **3** |
| Voir les tâches (Kanban) | bas → « Assistant » → 🗂 | **3** |
| Voir le tableau de bord | bas → « Projet » → 📊 | 2 |
| Savoir où en est mon projet | pastille en haut à droite, **ou** Kanban, **ou** tableau de bord, **ou** panneau de suivi de l'Assistant | **4 endroits** |
| Régler la voix de lecture | ⚙ → onglet « Assistant » → descendre à la section « Lecture des réponses » | **3 + défilement** |
| Régler le tableau de bord | ⚙ → onglet « **Agent Pi** » (496-506) alors que le tableau de bord a son propre onglet | **3 + chercher** |
| Administrer le serveur GDS | icône 🖥️ en haut (à côté d'une icône 🌐 presque identique) | 1, mais **confusion** |
| Retrouver « Coffre » par son nom | impossible : aucune recherche de commande ne le propose | — |

---

## 3. Les problèmes, du plus gênant au moins gênant

### P1 — 14 boutons muets cachés derrière 3 sous-onglets *(le plus gênant)*

**Preuve** `index.html:67-95`, bascule `sidebar.js:1610-1644` (aucune mémoire du
choix), 14 boutons sans un seul mot visible (leur sens est dans `title`).

**Gêne** Pour ouvrir le Kanban, l'utilisateur doit : (1) savoir que le Kanban
existe, (2) deviner qu'il n'est pas dans « Projet », (3) cliquer sur « Assistant »,
(4) reconnaître l'icône 🗂 parmi quatre icônes. Un non-spécialiste ne fait pas ce
raisonnement : il ouvre les trois sous-onglets et survole les 14 icônes au hasard,
une par une.

**Effet mesurable** Au plus **6 des 14 boutons** sont visibles à un instant donné :
les 8 autres n'existent pas pour l'œil.

---

### P2 — Deux conversations presque identiques

**Preuve** Les deux barres portent **la même classe CSS**, `agent-chat-toolbar`
(`agent-pi.js:360`, `super-agent.js:2690`) : ce sont littéralement les mêmes
boutons, au même endroit, avec le même style.
Agent : `agent-pi.js:360-378` — Arrêter, Nouvelle session, Compacter, Orchestration,
Quality-gate, Contexte, Mémoire, AGENTS.md, Export MD, Export HTML, sélecteur de
modèle, statistiques.
Assistant : `super-agent.js:2690-2702` — Mode plein écran, Arrêter, Nouvelle
session, Initialiser, Projets, Réglages, Suivi, Bilan, Analyse, Telegram,
sélecteur de modèle.

**Gêne** Mêmes icônes, mêmes mots (« Arrêter », « Nouvelle session »), même zone de
saisie. L'utilisateur ne sait pas à qui il parle, ni qui a répondu.

**Preuve que la confusion est déjà constatée** Il existe un réglage intitulé
« Bloquer la saisie de l'agent quand l'onglet Assistant est ouvert », dont
l'infobulle dit explicitement : *« éviter de répondre à l'agent au lieu de
l'assistant »* (`index.html:978-979`). Autrement dit : on a dû **brider
l'interface** pour empêcher l'utilisateur de se tromper de destinataire.

---

### P3 — Quatre écrans pour la même question « où en est mon projet ? »

**Preuve** (1) panneau Suivi du travail, 3 onglets (`index.html:108-132`) ;
(2) onglet 🗂 Kanban (`super-agent-kanban-view.js:182-198`) ; (3) onglet 📊
Tableau de bord (`dashboard.js`) ; (4) panneau de suivi **masqué** dans l'onglet
Assistant (`super-agent.js:2825-2837`, bouton `tracking` en `2698`).

**Gêne** Quatre mises en page différentes pour la même information. L'utilisateur
croit voir quatre choses différentes, et ne sait pas laquelle fait foi.

---

### P4 — Sept icônes globales, dont deux « GDS » voisines

**Preuve** `index.html:44-53`. Les boutons 6 et 7 sont tous les deux « GDS »
(administration du serveur / paramétrage utilisateur), séparés par un seul pixel.

**Gêne** Deux boutons au sens voisin, sans texte : l'utilisateur clique au hasard
et arrive dans un écran d'administration serveur alors qu'il voulait son réglage.

---

### P5 — « Terminal » et « Agent / Terminal » côte à côte

**Preuve** `index.html:75` et `index.html:76`.

**Gêne** Deux boutons voisins dont l'un **change de fonction** selon un réglage
(`setting-integrated-terminal`, `index.html:331`). Cliquer sur 🤖 peut donc
ouvrir un terminal, ou l'inverse. Personne ne peut prédire le résultat.

---

### P6 — Le mot « agent » désigne trois choses

**Preuve** l'onglet π s'appelle « Agent Pi / PLh » (`tabs.js:213`) ; l'onglet 🎭
s'appelle « Agents » et désigne l'**équipe** d'agents (`index.html:90`) ;
l'onglet 🧭 « Assistant » **lance** des agents (`spec_super_agent.md`).

**Gêne** « Où sont mes agents ? » a trois réponses possibles, dans trois écrans
différents.

---

### P7 — Les Paramètres ne suivent pas les écrans

**Preuve** 11 onglets (`index.html:282-292`). Trois exemples nets :

- la **voix de lecture** est dans l'onglet « Assistant » (`index.html:1071-1085`)
  alors que le bouton 🔊 est posé sous **les deux** conversations
  (`agent-pi.js:7885` et `super-agent.js:2068`) ;
- les réglages du **tableau de bord** sont dans l'onglet « Agent Pi »
  (`index.html:496-506`) alors que le tableau de bord a son propre onglet ;
- le **contexte de l'agent** est éclaté en trois endroits : onglet « Agent Pi »
  (553-569), onglet « RAG » (859-884), onglet « Code Graph » (886-920).

**Gêne** On cherche un réglage là où est l'écran concerné ; il est ailleurs. Il
faut ouvrir 3 ou 4 onglets pour trouver une seule case.

---

### P8 — La palette de commandes n'ouvre aucun écran

**Preuve** `src/js/main.js:41-61` : 19 commandes, toutes d'édition. Aucun des 15
écrans du projet n'y est.

**Gêne** L'utilisateur qui a pris l'habitude de `Ctrl+Shift+P` (comme dans les
éditeurs connus) ne peut pas taper « kanban », « coffre », « historique » ou
« aide ». La palette est un cul-de-sac.

---

### P9 — Rien n'indique où l'on est

**Preuve** Aucun fil d'Ariane dans `index.html` ni dans `tabs.js`. Les onglets
spéciaux affichent bien leur nom et un suffixe (`tabs.js:3011-3016`) mais pas leur
rattachement au projet ; « Aide » (`help.js:37`) et « Review » (`review.js:45`)
utilisent **la même** classe de champ de saisie `help-input` et se ressemblent
fortement.

**Gêne** Après quelques minutes, on ne sait plus si l'on est dans l'assistant ou
dans la revue de code, ni sur quel projet.

---

### P10 — L'interface ne se souvient pas de ce qu'on a choisi

**Preuve** le sous-onglet du bas n'est jamais enregistré (`sidebar.js:1621-1632`) :
au redémarrage on revient sur « Projet » (`index.html:68`). L'onglet des Paramètres
n'est pas mémorisé non plus (`settings.js:255-262`).

**Gêne** Un utilisateur qui travaille dans « Vues » refait le même chemin 10 fois
par jour.

---

### P11 — Trois recherches différentes

**Preuve** filtre de l'arborescence (`index.html:56`), recherche globale
(`index.html:149`), recherche de l'éditeur (`Ctrl+F`), plus `Ctrl+P` « Filtrer les
fichiers » (`main.js:50`).

**Gêne** On ne sait pas laquelle chercher quoi.

---

### P12 — « Tout effacer » collé à « Fermer »

**Preuve** `index.html:118` (Tout effacer) et `index.html:119` (Fermer), deux
icônes voisines de même taille dans le panneau Suivi du travail.

**Gêne** Un clic à côté efface l'historique affiché.

---

## 4. Proposition — la cible

### 4.1 La règle unique

> **Une intention = un bouton. Toujours au même endroit. Avec son nom écrit.**

Trois conséquences concrètes :

1. Un bouton qui n'a pas de place évidente va dans un menu **nommé**, pas dans une
   rangée d'icônes.
2. Un bouton ne change **jamais** de fonction selon un réglage : on choisit
   l'écran, pas la surprise.
3. Le nom d'un écran est **le même** partout (bouton, onglet, titre).

### 4.2 Les quatre portes d'entrée

| Porte | Où | Ce qu'on y fait | Aujourd'hui |
|---|---|---|---|
| **Projet** | colonne de gauche | ouvrir un fichier, lancer le terminal | existe (mais noyé) |
| **Travail** | bouton en haut à droite (le cercle animé actuel) | savoir où en est le travail, ouvrir le Kanban | éclaté en 4 endroits (P3) |
| **Assistant** | bouton nommé en haut de la colonne de gauche | parler, déléguer, suivre | caché derrière 3 clics (P1) |
| **Réglages** | bouton « ⚙ Réglages » en haut à gauche | tout régler, y compris Coffre, Aide, GDS, Fournisseurs, Avatar, MCP | éclaté en 7 icônes + 11 onglets (P4, P7) |

Et par-dessus les quatre : la **palette de commandes** (`Ctrl+Shift+P`) permet de
nommer n'importe quelle porte ou n'importe quel écran (§ 4.8).

Le principe de lecture devient : *« la gauche, c'est mon projet ; le haut à droite,
c'est mon travail ; le haut à gauche, c'est ma maison »*.

### 4.3 Avant → après : le bas de la colonne de gauche

**Avant** — 3 sous-onglets, 14 icônes, 8 invisibles :

```
[ Projet | Vues | Assistant ]     ← 3 sous-onglets
📂  ⌨  🤖  ⌨  🧩  📊                ← 6 icônes (selon le sous-onglet)
🕸  🔍  🕘  🗄                       ← ou 4
🎭  🧭  🗂  🔗                       ← ou 4
```

**Après** — 3 boutons nommés, toujours visibles, plus un menu :

```
🧭  Assistant                        ← toujours visible, 1 clic
⌨   Terminal                         ← toujours visible, 1 clic
▸   Lancer l'agent                    ← toujours visible, 1 clic
⋯   Autres écrans ▾                  ← ouvre un menu nommé
```

Le menu « Autres écrans » (une simple liste de lignes avec leur nom, groupées) :

```
Mon projet      Ouvrir le dossier · Commandes du projet · Prompt Builder
Comprendre      Tableau de bord · Graphe du projet · Historique des sessions
Vérifier        Revue de code (diff Git)
Collaborer      Équipe d'agents · Discussion inter-projets
Sources         GDS du projet
```

**Gestes** Ouvrir le Kanban : aujourd'hui 3 clics + deviner ; demain **1 clic**
sur « Travail » puis l'onglet « Tâches ». Ouvrir le tableau de bord : aujourd'hui
2 clics + deviner qu'il est rangé dans « Projet » ; demain **1 clic** sur
« Travail » puis l'onglet « Projet ».

**Ce qui ne change pas** : mêmes boutons, mêmes fonctions, mêmes écrans, même
emplacement (bas de la colonne de gauche), même style visuel. On ajoute du texte,
on retire des sous-onglets.

### 4.4 Avant → après : le haut de la colonne de gauche

**Avant** — 7 icônes sans texte (`index.html:44-53`) :
`📝 ⚙ 🔐 💬 ❓ 🖥️ 🌐`

**Après** — 3 boutons :

```
📝 Brouillon      ⚙ Réglages      ❓ Aide
```

Et dans **Réglages**, une section « Accès directs » en tête de la fenêtre, qui
reprend exactement les quatre boutons retirés, **avec leur nom** :

```
Accès directs :  🔐 Coffre fort · 💬 Envoyer une remarque ·
                 🖥️ Serveur GDS (administration) · 🌐 GDS (mon compte)
```

**Gestes** Ouvrir le Coffre : aujourd'hui 1 clic (icône murale) ; demain
**2 clics** (Réglages → Coffre). C'est le seul recul assumé du projet : il est
volontaire — ces quatre écrans ne servent pas tous les jours, et leur nom devient
enfin lisible. *(Variante conservée en § 6, décision D2, si ce recul n'est pas
souhaité pour le Coffre.)*

### 4.5 Avant → après : les Paramètres

**Avant** — 11 onglets, dont plusieurs sans rapport avec leur voisin.

**Après** — 6 onglets, dont le contenu suit les portes d'entrée :

| Onglet | Absorbe | Exemple de réglage |
|---|---|---|
| **Général** | Général | animations, sauvegarde auto, terminal intégré, démarrage |
| **Assistant** | Assistant + le réglage « démarrer l'assistant » (aujourd'hui dans Général, `index.html:355`) + voix + clients + mémoire + Telegram | nom, prompt, notifications, voix |
| **Agents & modèles** | Agent Pi + Modèles IA + Fournisseurs + RAG + Code Graph + les réglages du tableau de bord | modèle par agent, moteur d'extraction, contexte |
| **Connexions** | Accès distant + MCP | port du serveur web, serveurs MCP |
| **Services locaux** | Service Laya + Avatar | mode de démarrage du service de classification |
| **Avancé** | ce qui reste : anomalies, arrêt automatique, journal d'audit, mise à jour de Pi, accès directs (§ 4.4) | |

**Gestes** Régler la voix : aujourd'hui 3 clics + défilement dans un onglet de
24 cases ; demain 2 clics (Réglages → Assistant → section « Lecture »), et la même
section est atteignable depuis le bouton 🔊 de n'importe quelle réponse.

**Règle de rangement retenue** : *un réglage vit dans l'onglet de la porte qu'il
concerne*, jamais ailleurs. C'est cette règle qui aurait empêché les trois
anomalies de P7.

### 4.6 Avant → après : « où en est mon projet ? » — un seul lieu

**Avant** — 4 écrans (P3).

**Après** — 1 panneau, ouvert par le bouton **Travail** (haut à droite, le cercle
animé actuel), avec des onglets qui correspondent aux quatre anciens écrans :

| Onglet du panneau | Remplace | Contenu |
|---|---|---|
| **Agents** | onglet 1 du panneau actuel | qui travaille, qui attend |
| **Événements** | onglet 2 du panneau actuel | journal du travail |
| **Tâches** | onglet 3 + **Kanban** + suivi de l'Assistant | mes tâches, avec un lien « Ouvrir en grand » → onglet Kanban |
| **Projet** | **Tableau de bord** | métriques, Git, langages |

Les écrans ne disparaissent pas : le Kanban et le tableau de bord restent des
onglets pleine largeur, mais **on n'y arrive plus que par ce panneau** (ou par la
palette `Ctrl+Shift+P`, voir § 4.8). Le panneau de suivi **masqué** de l'onglet
Assistant (`super-agent.js:2825`) est supprimé : il devient le lien « Voir le
suivi ».

**Gestes** « Où en est mon projet ? » : aujourd'hui on choisit entre 4 endroits ;
demain **1 clic** sur Travail, toujours le même.

### 4.7 Avant → après : lever les ambiguïtés de mots

| Aujourd'hui | Après | Pourquoi |
|---|---|---|
| 🤖 « Agent / Terminal » | **« Lancer l'agent »** (toujours l'agent) | un bouton = une fonction (P5) |
| ⌨ « Terminal » | **« Terminal »** (toujours le terminal) | idem |
| π « Agent Pi (RPC) » | **« Conversation avec l'agent »** (nom du modèle en dessous) | (P2, P6) |
| 🧭 « Assistant » | **« Assistant »** (nom choisi par vous, ex. « Pilot »), avec le sous-titre « je pilote vos projets » | (P2) |
| 🎭 « Agents » | **« Équipe d'agents »** | (P6) |
| 🔊 sous les réponses | inchangé, mais le réglage de la voix visible **depuis** le bouton | (P7) |

### 4.8 Avant → après : trouver un écran par son nom

**Avant** — `Ctrl+Shift+P` : 19 commandes d'édition seulement (P8).

**Après** — la même palette, avec **tous** les écrans et toutes les portes :

```
> kanban        → Travail › Tâches (ouvre en grand)
> coffre        → Réglages › Coffre fort
> historique    → Historique des sessions
> tableau       → Travail › Projet
> agent         → Conversation avec l'agent
> assistant     → Assistant
> projet toto   → basculer sur le projet « toto »
> terminal      → terminal du projet
```

**Gestes** Aujourd'hui : impossible. Demain : `Ctrl+Shift+P`, trois lettres, Entrée.

*(Le raccourci reste `Ctrl+Shift+P` : `Ctrl+K` est déjà pris par « Lien
(Markdown) », `main.js:53` — on ne le réattribue pas.)*

### 4.9 Le fil d'Ariane — savoir où l'on est (P9)

Un bandeau fin, en haut de la zone de travail, au-dessus des onglets, qui affiche
toujours la même chose :

```
Projet « pilot »  ›  Travail  ›  Tâches
Projet « pilot »  ›  Réglages  ›  Assistant  ›  Lecture des réponses
Projet « pilot »  ›  Fichiers  ›  spec_pilot.md  (modifié)
```

Il ne remplace rien : il **ajoute** une ligne de contexte. Il rend aussi service
aux onglets « Aide » et « Review », qui se ressemblent aujourd'hui.

### 4.10 Ce que la proposition ne touche pas

- Couleurs, thèmes sombre/clair, polices, icônes, animations : **inchangés**.
- Disposition générale (colonne de gauche, barre d'onglets, zone de travail) :
  **inchangée**. Seuls les **textes de boutons** et **un bandeau de titre**
  apparaissent.
- Aucune fonctionnalité n'est retirée : les 14 boutons, les 22 types d'onglets et
  **tous** les réglages existent toujours, à un autre endroit.
- Les raccourcis existants (`Ctrl+Shift+P`, `F11`, `Ctrl+Shift+E`, `Ctrl+Shift+A`…)
  restent valides.

---

## 5. Plan de migration, effort et fichiers à toucher

L'ordre est choisi pour que **chaque étape apporte seule un gain visible** et
puisse être arrêtée sans laisser l'application à moitié réorganisée.

| # | Étape | Effort | Fichiers concernés | Ce que l'utilisateur gagne |
|---|---|---|---|---|
| 1 | **Nommer les 14 boutons** (icône + texte court) sans rien déplacer | petit | `index.html:65-95`, `src/css/style.css` | lit enfin ce que fait chaque bouton |
| 2 | **Mémoriser le sous-onglet** du bas et l'onglet des Paramètres | petit | `src/js/sidebar.js:1610-1644`, `src/js/settings.js:255-262`, config Rust | ne refait plus le même chemin |
| 3 | **Désambiguïser** Terminal / Agent, et renommer « Agents » → « Équipe d'agents » | petit | `index.html:75-76,90`, `src/js/main.js` (handler terminal) | un bouton = une fonction |
| 4 | **Palette universelle** : ajouter les 15 écrans + les projets à `COMMANDS` | petit-moyen | `src/js/main.js:41-61` et ses handlers, `index.html:268` | trouve un écran par son nom |
| 5 | **Regrouper le bas** : 3 boutons + menu « Autres écrans » (suppression des 3 sous-onglets) | moyen | `index.html:65-95`, `src/js/sidebar.js:1610-1644`, `src/css/style.css` | P1 réglé : 14 icônes → 3 boutons |
| 6 | **Regrouper le haut** : 7 icônes → 3, avec accès directs dans Réglages | moyen | `index.html:44-53`, `src/js/main.js` (câblage), `src/js/settings.js` (section Accès directs) | P4 réglé |
| 7 | **Un seul panneau Travail** : 4 onglets, suppression du panneau de suivi masqué de l'Assistant | moyen | `index.html:108-132`, `src/js/super-agent.js:2825-2837`, `src/js/agent-activity.js` | P3 réglé : 1 endroit pour « où en est-on » |
| 8 | **Fusion des Paramètres** 11 → 6 onglets, et ranger chaque réglage dans son onglet | **gros** | `index.html:277-1255` (~980 lignes à réordonner), `src/js/settings.js`, tests de réglages | P7 réglé — c'est le plus long, mais purement mécanique |
| 9 | **Fil d'Ariane** en haut de la zone de travail | moyen | `index.html` (zone principale), `src/js/tabs.js` (rendu), `src/css/style.css` | P9 réglé |
| 10 | **Finitions** : « Tout effacer » éloigné de « Fermer » (confirmation), une seule recherche annoncée | petit | `index.html:118-119`, `index.html:56/149` | P11, P12 réglés |

**Points de vigilance** (protocole anti-régression) :

- Les identifiants de boutons (`btn-terminal`, `btn-superagent`…) sont utilisés par
  les tests et par les événements de l'interface : les **conserver** en changeant
  seulement leur libellé et leur emplacement.
- Les 22 modes d'onglet et leurs `mode` de routage (`tabs.js:288-395`) ne doivent
  pas changer de nom : on déplace les **entrées**, pas les écrans.
- L'ordre imposé de la barre d'onglets (🧭 premier, 📊 verrouillé —
  `tabs.js:3054-3074`) doit rester respecté.
- Chaque étape se termine par `npm test` + `cargo test --manifest-path
  src-tauri/Cargo.toml --lib`.

**Total** : 5 petits, 1 petit-moyen, 4 moyens, 1 gros. Les étapes 1 à 4 (petites)
peuvent être livrées en premier : elles règlent à elles seules les problèmes P5,
P6, P8 et une partie de P1, sans toucher à la disposition.

---

## 6. Ce qui demande une décision de votre part

| # | Question | Choix possibles | Ma recommandation |
|---|---|---|---|
| **D1** | Faut-il **3 boutons nommés** en bas de la colonne de gauche, ou garder les icônes et n'ajouter que le texte ? | (a) 3 boutons + menu (b) icônes + texte partout | **(a)** : c'est ce qui fait passer de 14 à 3 |
| **D2** | Faut-il **déplacer le Coffre** dans Réglages, avec un clic de plus ? | (a) oui (b) non, le garder en haut | **(a)** pour la cohérence ; **(b)** si vous l'ouvrez tous les jours |
| **D3** | L'onglet **« Conversation avec l'agent »** doit-il garder le nom du moteur (« Agent Pi » / « Agent PLh ») ? | (a) nom fixe + moteur en sous-titre (b) nom du moteur comme aujourd'hui | **(a)** : le mot « agent » cesse d'avoir trois sens |
| **D4** | Le panneau **Travail** doit-il s'ouvrir **au clic** (comme aujourd'hui) ou **au survol** ? | (a) clic (b) survol | **(a)** : le survol ouvre des panneaux par accident |
| **D5** | Faut-il **fusionner les Paramètres** (étape 8, la plus lourde) maintenant, ou seulement après les étapes 1 à 7 ? | (a) maintenant (b) plus tard | **(b)** : les étapes 1 à 7 règlent déjà 7 problèmes sur 12 |

---

## 7. Limites de ce document

- L'inventaire porte sur le **code d'interface réel** (`index.html`, `src/js/*.js`)
  au moment de la rédaction. Il ne décrit pas le **contenu** des écrans (ce qu'on
  y lit), seulement leur **accès**.
- Les estimations sont données en **petit / moyen / gros**, pas en jours : elles
  comparent les étapes entre elles.
- Ce document **ne tranche pas** les décisions D1 à D5 : il les pose.
- Aucune modification de code, aucune publication, aucun changement de version
  n'a été effectué pour l'écrire.
