<!-- PILOT-HELP generated=2026-10-30 topics=overview,demarrage,raccourcis,theme-parametres,terminal,recherche-outline,edition-lint,aide,dev-mode,pi-update,pilot-update,multi-agents,modes-ecran,lire-reponses,gds,commands,agent-pi,orchestration,web-remote,dictee-vocale,vocal-colonnes-portrait,pdf,context-engine,code-graph,diff-review,project-memory,review,orchestration,session-history,agents,agents-md,multiprojets,interprojets,super-agent,super-agent-session-memory,super-agent-mcp,super-agent-checklist,super-agent-tracabilite,super-agent-temps,super-agent-taches-longues,super-agent-extensions-fiables,file-attente-limites,dashboard,vault,anomaly,telegram,laya -->
<!-- FICHIER GÉNÉRÉ — ne pas éditer. Source : help/overview.md + spec_*.md (blocs HELP). -->

# Aide Pilot

Tu es l'assistant d'aide de l'éditeur Pilot. Réponds aux questions de
l'utilisateur en te basant sur le contenu de ce handbook.

<!-- HELP-TOPIC:overview -->
## Pilot en bref

Pilot est un éditeur de texte multiplateforme pensé pour les agents IA. Il
combine un éditeur de code (CodeMirror 6), une prévisualisation Markdown, un
terminal intégré, un agent de codage IA (l'agent Pi **ou** PLh selon le moteur
en service, onglet π) et un mode orchestration. Tout se fait dans une seule
fenêtre, sans passer par un terminal externe.

- **Onglets** : édition (📝), prévisualisation (👁️), mode split (📝👁️),
  terminal (🖥️), agent (π).
- **Barre latérale** : explorateur de fichiers du projet, filtre, favoris,
  brouillon (scratchpad).
- **Panneau d'actions** (bas de la barre latérale, cadre accentué) : **sept** lignes
  nommées, **toutes de la même taille** (aucune n'est mise en évidence) et, dès qu'un
  projet est ouvert, toutes présentes — **Brouillon**, **Options**, **Assistant**, **Dossier du projet** (ouvre le
  dossier du projet dans l'explorateur du système), **Terminal**, **Commandes du
  projet**, puis **Outils ▾** : ce dernier ouvre vers le haut un menu groupé de
  **dix** entrées, dont **Lancer l'agent** en toute première ligne (groupe « Mon
  projet »), puis Prompt Builder, Tableau de bord, Graphe du projet, Historique des
  sessions, Revue de code, Équipe d'agents, Kanban, Discussion inter-projets et GDS du
  projet. **Lancer l'agent** se fait donc maintenant en **deux clics** (ouvrir le menu,
  puis la ligne) : aucun raccourci clavier ne le double. La ligne s'appelle **Outils**
  (au pluriel) et son menu **Autres outils** : c'est la porte des **autres outils** du
  projet, à ne pas confondre avec **Commandes du projet**. Déployé, ce menu est entouré du **même filet bleu**
  que le panneau : on voit qu'il en fait partie. **Pendant que le menu est ouvert, la ligne
  « Outils » elle-même s'efface** : le menu prend sa place, et elle revient telle quelle
  dès qu'il se referme (rien ne se déplace dans le panneau).
- **Ce panneau est replié au repos et s'ouvre au premier geste** : au repos il
  n'occupe qu'**une ligne de haut** et seule sa **dernière** ligne reste visible —
  **Outils ▾** (le menu des autres outils) quand un projet est ouvert, **Options** sans projet. Le
  **survol** le déploie en un dixième de seconde ; la **première touche Tab**
  l'ouvre immédiatement. Il se referme seul **un tiers de seconde** après que la
  souris l'a quitté, et seulement si ni le clavier ni le menu **Outils** ne
  le retiennent : se déplacer **à l'intérieur** du panneau déplié ne le referme
  jamais, et son menu **Outils** non plus (on peut y circuler au clavier,
  `Échap` le referme tout seul). **Au doigt**, le premier appui déploie le panneau
  sans rien déclencher d'autre — un second appui agit, et le doigt levé ne le
  referme pas (sinon ce second appui n'aurait pas le temps d'arriver) ; toucher
  ailleurs le replie aussitôt. Si votre système demande de **réduire les animations** (et que
  le réglage « Animer l'ouverture des modales » est désactivé), le panneau
  s'ouvre et se referme **sans animation**, en gardant les mêmes temps de
  décision. Rien n'est donc perdu quand il est replié : la ligne qui reste nomme la
  porte, et cette ligne du bas **ne bouge jamais** (le panneau s'ouvre vers le
  haut). Sa largeur ne change pas — seul le cadre se replie en hauteur.
- **Le haut de la barre latérale ne porte plus aucun bouton** : « Brouillon » et
  « Options » ont rejoint le panneau du bas, dont elles sont les deux premières lignes
  (mêmes libellés, mêmes icônes, mêmes infobulles, mêmes raccourcis). L'espace ainsi
  rendu profite à la liste des fichiers. Le panneau du bas reste affiché **même sans
  projet ouvert** : il montre alors ces deux seules lignes. Ses sept lignes tiennent
  entières dans le cadre **même à la fenêtre la plus petite** : il peut occuper jusqu'à
  **60 %** de la hauteur de la fenêtre, sans jamais de ligne dessinée hors du cadre.

---

<!-- HELP-TOPIC:demarrage -->
## Démarrer un projet

### La toute première ouverture

Sur une installation neuve, Pilot propose une prise en main **une seule fois** :
une petite fenêtre, **trois écrans courts**, chacun un simple constat de ce qui
est réellement là.

1. **Le moteur constaté** : quel agent répond (Pi ou PLh) et sa version. S'il ne
   répond pas, la fenêtre dit **pourquoi** et **quoi faire** (⚙️ Options →
   l'onglet de l'agent, qui porte le nom du moteur en service), avec un bouton
   **Revérifier le moteur**.
2. **Le projet sur lequel on travaille** : le projet ouvert, ou le bouton
   **Choisir un dossier de projet** pour en ouvrir un tout de suite.
3. **Le modèle de l'assistant** : la liste des modèles **réellement
   disponibles**. Vous pouvez en choisir un (facultatif : « Garder le modèle
   déjà réglé » ne change rien). Si la liste est vide, la fenêtre dit où ajouter
   un fournisseur et propose **Réessayer**.

Ensuite, deux sorties :

- **Terminer** — règle en **une seule fois** ce qui fait que le bouton
  **« Lancer l'agent »** lance vraiment l'agent (l'onglet de conversation, et
  non un terminal), puis ferme la fenêtre.
- **Passer** (ou la touche **Échap**, ou la croix) — note seulement que vous
  avez vu la prise en main : **rien d'autre ne change**, et elle ne revient
  plus.

Un bouton **« Je découvre »** affiche trois repères courts (« Lancer l'agent »,
🧭 Assistant, ⚙️ Options) puis ouvre l'onglet **🧭 Assistant**.

Ce qu'elle ne fait **jamais** : elle n'appelle aucun modèle (donc aucun coût),
ne lance aucune session d'agent, ne règle rien de payant, ne supprime aucun
fichier et ne modifie pas l'apparence de Pilot. La passer est sans conséquence.

**La revoir plus tard** : elle ne s'affiche que sur une installation neuve et
ne revient pas d'elle-même. Ses réglages se retrouvent dans **⚙️ Options →
l'onglet de l'agent**, et le choix du modèle dans **⚙️ Options → Fournisseurs**.

### L'équipe d'agents, apprise plus tard et à la demande

Une équipe d'agents, c'est plusieurs agents qui se partagent le travail :
chacun a un **rôle**, un **modèle**, et parfois des compétences. C'est
🧭 Assistant qui répartit les demandes : vous décrivez la tâche, il choisit qui
travaille et dans quel ordre.

Pour apprendre à s'en servir, un **lien discret** « Apprendre à organiser mon
équipe d'agents » se trouve dans la fenêtre de première ouverture, et un **bouton
discret du même nom** en bas de l'écran **Équipe d'agents**. Tous deux ouvrent
**deux écrans courts** :

1. **À quoi sert une équipe** — ce qu'elle permet, et l'état réel de la vôtre.
   Si votre équipe est **déjà en place**, la fenêtre le dit et ne demande aucune
   modification. Si elle est **vide** ou si sa liste n'a pas pu être lue, elle
dit **pourquoi** et **quoi faire** (bouton ↻ pour remettre les agents fournis,
bouton + pour en ajouter) et propose **Réessayer**.
2. **Votre premier geste** — celui qui marche du premier coup : ouvrir une fiche
   d'agent pour **lire son rôle** (rien n'est lancé, rien n'est modifié tant que
   vous n'enregistrez pas), puis confier une tâche à 🧭 Assistant en une phrase.

À la fin, vous arrivez sur l'écran **Équipe d'agents** lui-même. Cette fenêtre
**ne s'ouvre jamais toute seule** et ne revient pas au démarrage ; on peut la
fermer à tout moment (bouton **Fermer**, croix, ou **Échap**) sans rien perdre.
Elle n'appelle aucun modèle, ne lance aucun agent, **ne modifie aucun de vos
agents** et n'écrit aucun réglage : elle explique, elle ne reconfigure rien.

### Ensuite, pour chaque projet

1. **Ouvrir un projet** : bouton **« 📁 Projets ▼ »** en haut de la barre
   latérale → « Ouvrir un dossier… » (ou via la palette de commandes
   `Ctrl+Shift+P`).
2. **Explorer** : l'arborescence s'affiche dans la barre latérale. Filtrer les
   fichiers avec `Ctrl+P`. Le **clic droit sur un ascenseur** (scrollbar) n'affiche
   aucun menu natif.
3. **Ouvrir un fichier** : double-clic dans l'arborescence → un onglet s'ouvre
   (détection automatique du mode : édition pour le code, prévisualisation pour
   `.md`, `.pdf`, images, `.csv`). Dans la **prévisualisation Markdown**, les
   liens sont cliquables : un lien interne ouvre le fichier cible dans un onglet,
   un lien externe (http/https) s'ouvre dans le navigateur, une ancre (`#section`)
   fait défiler la prévisualisation.
4. **Sauvegarder** : `Ctrl+S` (sauvegarde auto configurable dans les
   Options). Enregistrer sous : `Ctrl+Shift+S`.
5. **Fermer un onglet** : `Ctrl+W` ou clic sur la croix de l'onglet. On peut
   **réordonner** les onglets par glisser-déposer, et **renommer** un onglet par
   double-clic sur son titre.
6. **Brouillon** : `Ctrl+Shift+N` ouvre un brouillon rapide (scratchpad) non lié
   au projet courant. Vous pouvez y avoir **plusieurs pages** (mini-onglets en
   haut : « + » pour ajouter, clic sur le nom pour renommer, ✕ pour supprimer),
   sauvegardées localement par projet.

---

<!-- HELP-TOPIC:raccourcis -->
## Raccourcis clavier essentiels

### Fichiers et onglets
- `Ctrl+S` — Sauvegarder · `Ctrl+Shift+S` — Enregistrer sous… · `Ctrl+W` — Fermer l'onglet
- `Ctrl+Tab` / `Ctrl+Shift+Tab` — Onglet suivant / précédent (fonctionne aussi dans le terminal)
- `Ctrl+1`…`Ctrl+9` — Aller à l'onglet par position (ordre actuel)
- `Ctrl+Shift+E` — Basculer en mode split (éditeur + prévisualisation)
- `Ctrl+Shift+B` — Ajouter/retirer le fichier courant des favoris
- `Ctrl+Shift+N` — Ouvrir le brouillon (scratchpad)

### Navigation et recherche
- `Ctrl+P` — Filtrer les fichiers (barre latérale)
- `Ctrl+G` — Aller à la ligne…
- `Ctrl+Shift+F` — Recherche globale (full-text dans tous les fichiers du projet)
- `Ctrl+Shift+H` — Remplacement global (avec aperçu et confirmation)
- `Ctrl+Alt+R` — Fichiers récents (popover fuzzy)
- `Ctrl+Shift+O` — Table des matières Markdown (outline cliquable)
- `Ctrl+Shift+P` — Palette de commandes

### Édition Markdown
- `Ctrl+B` — Gras · `Ctrl+I` — Italique · `Ctrl+K` — Lien
- `Ctrl+D` — Sélectionner l'occurrence suivante (multi-curseur)
- `Alt+clic` — Ajouter un curseur à la position cliquée

### Divers
- `F11` — Plein écran

---

<!-- HELP-TOPIC:theme-parametres -->
## Thème et Options

- **Thème** : bascule dark/light depuis les **Options ⚙️** (bouton du panneau
  d'actions) → section « Apparence ». Le thème est mémorisé. Le changement
  s'applique **tout de suite**, y compris aux **panneaux translucides** (voiles
  des fenêtres, menus flottants, liste des agents) : leur teinte est celle du
  thème choisi — vous n'avez **pas** à redémarrer Pilot.
- **Options ⚙️** : les Options s'ouvrent dans un **onglet** (thème, éditeur,
  l'agent, accès distant, etc.). Le **✕ de l'onglet** équivaut à **« Annuler »**
  (rien n'est enregistré) ; « Annuler » et « Enregistrer » ne ferment pas
  l'onglet, vous voyez le résultat de ce que vous venez de changer. L'onglet
  reste ouvert quand vous changez de projet. Toute la configuration est
  persistée dans un fichier JSON (`app_data_dir/com.pilot.editor/config.json`).
- **Avatar (PLface)** : dans **Options ⚙️ → Avatar**, cochez « Lancer mon
  avatar (PLface) au démarrage ». Le **programme du visage est fourni avec
  Pilot** : laissez le **chemin de l'exécutable** vide pour l'utiliser tel quel,
  ou indiquez votre propre programme (bouton « Parcourir… »). Quand Pilot lance
  l'avatar, celui-ci **n'apparaît pas dans la barre des tâches** (mode discret) ;
  lancé à la main, il reste visible comme avant. Au démarrage de Pilot, si
  l'avatar n'est pas déjà
  lancé, il est démarré automatiquement. **Pilot referme l'avatar qu'il a
  lancé quand vous quittez Pilot** (un avatar lancé à la main reste ouvert).
  Vous pouvez aussi **choisir le modèle d'avatar** (`.vrm`, bouton
  « Choisir un modèle… ») : il est affiché au lancement. Laissez le champ vide
  pour utiliser le **modèle fourni par Pilot** ; si celui-ci est indisponible,
  le visage reprend son **modèle intégré** (aucune erreur). Le **bouton
  « Tester maintenant »** vérifie
  tout de suite et vous indique clairement ce qui s'est passé ; le **bouton
  « Arrêter mon avatar »** demande à votre avatar de se fermer proprement
  (décocher la case l'arrête aussi), et une indication vous dit s'il est lancé
  ou arrêté. Si aucun programme n'est trouvé, rien n'est lancé, sans message.
- **Palette de commandes** (`Ctrl+Shift+P`) : accès rapide à toutes les
  commandes (sauvegarder, ouvrir, fermer, basculer split/outline/recherche, etc.).

---

<!-- HELP-TOPIC:terminal -->
## Terminal intégré

- Bouton **Terminal** dans le panneau d'actions (ou palette de commandes).
- Si le terminal intégré est activé (Options ⚙️ → « Terminal intégré »),
  il s'ouvre dans un onglet 🖥️. Sinon, un terminal externe est lancé.
- Shell par défaut : `cmd.exe` (Windows), `$SHELL`/`/bin/zsh` (macOS),
  `$SHELL`/`/bin/bash` (Linux).
- **Windows** : le terminal intégré reconstruit le PATH système + utilisateur
  depuis la registry, pour que les commandes installées après le lancement de
  Pilot (ex: `cargo`) soient trouvées.
- Le terminal reste indépendant de l'éditeur ; on peut l'ouvrir et le fermer
  comme un onglet normal.

---

<!-- HELP-TOPIC:recherche-outline -->
## Recherche, remplacement et outline

- **Recherche globale** (`Ctrl+Shift+F`) : panneau de recherche full-text dans
  tous les fichiers du projet, avec support des expressions régulières et un
  filtre par extension. Cliquer un résultat ouvre le fichier à la ligne.
- **Remplacement global** (`Ctrl+Shift+H`) : bouton ▸ pour afficher la ligne de
  remplacement, puis « Tout remplacer » — un aperçu (nombre d'occurrences et de
  fichiers concernés) précède une confirmation avant écriture. Les onglets
  d'édition ouverts et non modifiés sont rechargés automatiquement.
- **Table des matières** (`Ctrl+Shift+O`) : bascule l'outline Markdown (titres
  cliquables, mise à jour en temps réel). Pratique pour naviguer dans un long
  fichier `.md`.
- **Mode split** (`Ctrl+Shift+E`) : éditeur à gauche, prévisualisation à droite.
  Le scroll est **synchronisé proportionnellement dans les deux sens** :
  défilement de l'éditeur → la prévisualisation suit, et inversement. La
  position de scroll est préservée pendant l'édition (pas de saut en haut à
  chaque frappe). Cliquer sur un titre (`h1`–`h6`) dans la prévisualisation
  fait défiler l'éditeur jusqu'à la ligne correspondante.

---

<!-- HELP-TOPIC:edition-lint -->
## Édition : multi-curseurs, lint, export HTML, fichiers récents

- **Multi-curseurs** : `Alt+clic` ajoute un curseur à la position cliquée ;
  `Ctrl+D` sélectionne l'occurrence suivante du mot sous le curseur (répète pour
  en sélectionner plusieurs). Pratique pour éditer plusieurs endroits à la fois.
- **Lint intégré** : pour les fichiers JS/TS, les diagnostics du linter du
  projet (eslint) s'affichent en direct dans la gouttière et sous les mots
  soulignés (debounce ~1.2 s). Silencieux si eslint n'est pas disponible.
- **Export HTML autonome** : clic droit sur un fichier `.md` → « Exporter en
  HTML » génère un fichier `.html` autonome (CSS inline + images en base64)
  partageable sans Pilot, via un dialogue de sauvegarde natif.
- **Fichiers récents** (`Ctrl+Alt+R`) : popover listant les 20 derniers
  fichiers ouverts du projet (filtre fuzzy, navigation clavier, Entrée pour
  ouvrir). L'historique est stocké localement (par projet), jamais envoyé au
  cloud.

---

<!-- HELP-TOPIC:aide -->
## Réponses sur la documentation (l'Assistant répond)

Il n'y a **plus d'onglet ni de bouton « Aide »**. Pour une question sur
l'utilisation ou le paramétrage de Pilot, pose-la à l'**Assistant** (onglet
🧭) : il répond **à partir de la documentation embarquée** (handbook généré à la
compilation depuis les specs) et te dit clairement quand la documentation ne
parle pas du sujet.

- Rien à régler : l'Assistant choisit lui-même le bon modèle (le réglage
  `help_model` reste présent en configuration comme repli, il n'est plus édité
  à l'écran).
- La réponse est **isolée** de l'agent de coding : elle est construite à partir
  de la documentation, pas de tes fichiers ni de la conversation de l'onglet π.
- Si l'Assistant ne trouve pas la réponse, la documentation à jour reste
  consultable dans les fichiers `spec_*.md` du dépôt du projet.
- Cette documentation est **embarquée dans le programme** au moment de la
  compilation (`help/handbook.md` inclus dans le binaire) : elle correspond donc
  toujours à la version installée, et il n'existe **aucune copie sur le disque**
  à ouvrir à côté — l'Assistant est le **seul** chemin pour la lire.

---

<!-- HELP-TOPIC:dev-mode -->
## Développer Pilot avec Pilot (mode dev)

Tu peux **développer Pilot avec Pilot** : lancer une version **dev** en parallèle
 de la version **installée**, sans conflit.

- **Lancement** : `npm run tauri dev` (le wrapper ajoute automatiquement un
  identifiant d'application séparé `com.pilot.editor.dev`).
- **Deux instances indépendantes** : la version dev utilise son propre
  `app_data_dir` (config, sessions, audit, extensions) et son propre verrou
  single-instance → elle peut tourner en même temps que la version installée.
- **Port web distant décalé** : en mode dev, le port réellement utilisé est le
  port configuré **+ 1** (ex: configuré 8787 → dev écoute sur 8788), pour
  éviter tout conflit de port avec la version installée.
- **Projets partagés** : les projets sont ouverts par chemin, donc tu peux
  ouvrir les mêmes projets dans les deux versions.

---

<!-- HELP-TOPIC:pi-update -->
## Mise à jour de l'agent Pi

**Au démarrage de Pilot** — et à l'ouverture de l'onglet agent — Pilot
**vérifie automatiquement** si une nouvelle version de Pi est disponible
(backend `pi` uniquement). C'est même la **toute première** chose qu'il fait :
tant que cette vérification n'est pas finie, **aucun travail ne démarre** (ni
commande, ni agent, ni mission, même déjà en attente) — et il en va de même
pendant une installation de Pi. Ce n'est jamais un blocage : si la vérification
échoue ou prend trop de temps, Pilot te le dit et le travail reprend
normalement.

Si une version plus récente existe, une modale te propose de la mettre à jour
via la commande intégrée de Pi (`pi update --self`).

- **Mettre à jour maintenant** : lance la mise à jour puis te confirme le
  résultat.
- **Plus tard** : ferme la modale (la vérification se refait à la prochaine
  ouverture de l'onglet agent).
- **Ne plus demander** : désactive la vérification automatique (réactivable en
  remettant `pi_skip_update_check` à `false` dans la config).

La vérification ne concerne que l'agent **Pi** (pas PLh) et n'est proposée que
si une version plus récente existe réellement.

---

<!-- HELP-TOPIC:pilot-update -->
## Mise à jour de Pilot

Pilot vérifie tout seul s'il existe une version plus récente : une première
fois peu après l'ouverture, puis **régulièrement** (toutes les 6 heures) et à
chaque **retour de Pilot au premier plan**. Une version publiée pendant que tu
travailles t'est donc proposée **sans redémarrer** l'application.

- **Proposition** : une fenêtre affiche la version, la date et le récapitulatif
  des changements, avec **Installer maintenant** ou **Plus tard**.
- **Jamais pendant ton travail** : la fenêtre n'apparaît que si **aucun agent ne
  travaille**. Si une tâche est en cours, elle **n'interrompt rien** : un petit
  message discret te prévient (et un rappel « ⬆ Mise à jour en attente » reste
  dans la barre de statut), puis la fenêtre s'affiche **d'elle-même** dès que la
  tâche est terminée. Tu n'as rien à relancer.
- **Tu restes libre de décider plus tard** : la fenêtre **ouverte ne bloque
  rien**. Tu peux lui laisser prendre tout l'écran et continuer à travailler :
  envoyer un message, l'assistant répond, les agents et les tâches en attente
  continuent. La décision attend ton bon vouloir.
- **Vous pouvez la revoir quand vous voulez** : après « Plus tard », le rappel
  « ⬆ Mise à jour … disponible — non installée » reste dans la barre de statut.
  Un clic dessus, ou palette de commandes → **Vérifier les mises à jour**, rouvre
  la fenêtre. Rien n'est oublié.
- **Une seule chose bloque : l'installation** : pendant qu'une mise à jour
  s'installe, **aucun agent ne démarre** (le message de refus explique quoi
  faire), et le travail repart au redémarrage de Pilot. Une demande déjà en file
  d'attente **n'est pas perdue** : elle démarre automatiquement quand
  l'installation ne bloque plus (ou après « Plus tard » si elle n'a pas été
  lancée).
- **« Plus tard » est retenu** : une fois la fenêtre reportée (bouton ou ✕),
  elle **ne revient plus d'elle-même** pour cette version, même à chaque retour
  sur Pilot — jusqu'au prochain démarrage. Une version **plus récente** t'est en
  revanche toujours proposée.
- **Une seule installation à la fois** : pendant le téléchargement, le bouton
  reste désactivé et la progression visible, quoi qu'il arrive ; si tu recliques,
  Pilot te le dit au lieu de lancer une seconde installation.
- **Vérifier tout de suite** : palette de commandes (`Ctrl+Shift+P`) →
  **Vérifier les mises à jour**. Si un contrôle est déjà en cours, Pilot te le
  dit (plus de commande apparemment sans effet).
- **Pas de sur-sollicitation du réseau** : les contrôles déclenchés par un retour
  sur la fenêtre sont espacés d'au moins **5 minutes**.
- **Savoir où on en est** : palette → **État des mises à jour** indique la date
  du dernier contrôle et son résultat, en clair : « Pilot est à jour » ou, si
  c'est le cas, « le contrôle a échoué » avec la raison (et la date du dernier
  contrôle réussi). Un échec n'est jamais présenté comme une absence de mise à
  jour.
- **Installation qui échoue** : Pilot t'explique quoi faire, sans fenêtre
  bloquante. Si la dictée ou la classification ne répondent plus (elles sont
  arrêtées le temps de l'installation), **relance Pilot** : les services
  redémarrent au lancement. Si un service n'a pas pu être arrêté avant
  l'installation, le message le dit et te demande de fermer puis relancer Pilot
  avant de réessayer.
- **Aucun arrêt de service ne se perd** : un service qui refuse de s'arrêter
  laisse une trace écrite (quel service, et pourquoi) dans le journal de
  l'application, dossier de données de Pilot, fichier `services-arret.log` — la
  mise à jour, elle, n'est jamais bloquée.

---

<!-- HELP-TOPIC:multi-agents -->
## Plusieurs agents sur un même projet (multi-onglets)

Tu peux ouvrir **plusieurs onglets agent indépendants** sur le même projet,
chacun avec sa propre conversation (bouton **« + »** dans la barre d'onglets).

- **Activer** : Options ⚙️ → onglet de l'agent → cocher « Multi-onglets
  agents ».
- **Ouvrir un agent** : bouton « + » de la barre d'onglets (toujours en
  première position, avant les autres onglets).
- **Renommer un onglet** : double-clic sur son nom.
- **Configurer le nombre et les noms au démarrage** : Options ⚙️ → onglet de
  l'agent → section « Agents du projet ». Définis les agents rechargés
  automatiquement à l'ouverture du projet, chacun avec son nom. La
  configuration est enregistrée dans `.pilot/agents.json` du projet (versionnée
  et partagée entre utilisateurs).
- Le **renommage manuel** d'un onglet (double-clic) **prime** sur le nom
  configuré.
- Le bouton « + » reste disponible pour ajouter des agents au-delà de ceux
  configurés.

---

<!-- HELP-TOPIC:modes-ecran -->
## Trois modes d'écran : Détaillé · Assistant seul · Vocal

**Le logo Pilot, en haut à gauche du bandeau, est le bouton des trois modes.**
Un clic fait le tour : **Détaillé** → **Assistant seul** → **Vocal** →
**Détaillé** … Le logo ne porte **ni mot ni pastille** : c'est son **infobulle**
(au survol) qui dit le mode où vous êtes et annonce le **mode suivant**. Un
double-clic réflexe ne change qu'un seul mode : le second clic est ignoré
pendant un peu moins d'une demi-seconde. Dans les deux écrans plein écran, le
logo reste **au même endroit**, en haut à gauche, et il reprend sa place exacte
en revenant à l'écran habituel.

Trois autres façons de changer de mode :

- **`Ctrl+Shift+A`** entre dans un plein écran, ou en sort, depuis n'importe où ;
- **`Échap`** sort du mode Vocal ;
- **fermer l'onglet 🧭** ramène à l'écran habituel.

Aucun de ces modes ne change le contenu de votre projet : ils ne font que choisir
ce qui est affiché.

- **Détaillé** : l'écran habituel (explorateur, onglets, éditeur, agent).
- **Assistant seul** : uniquement la conversation de l'assistant 🧭, en plein
  écran.
- **Vocal** : un **écran nu** — un objet lumineux dont la couleur dit l'état
  (**repos**, **écoute**, **réflexion**, **parole**) et **une seule ligne de
  texte**, posée **juste au-dessus de la barre de saisie** (elle n'est plus sous
  le cercle). **Rien de la conversation n'y est
  affiché** — ni bulle, ni message, ni « les derniers échanges » en petit sous le
  cercle : la conversation reste entière dans l'onglet de l'agent, où vous la
  retrouvez en quittant le mode. La seule chose qui en paraît est, sur un écran
  assez large, un **aperçu dans la colonne de gauche** (voir « Les colonnes de
  l'écran Vocal ») : quelques lignes de texte, qu'on lit sans les cliquer.

**Tout masquer d'un geste, tout remettre du même geste** : dans l'écran Vocal, un
petit **bouton-œil**, au centre du bandeau du haut, efface en un clic **tout ce que
l'écran affiche sauf le portrait du personnage et son nom** — le cercle et sa
lumières, la phrase d'état, les deux colonnes — puis remet tout en place d'un second
clic. Le bouton ne porte **qu'une icône** (un œil, puis un œil barré) : ce qu'il fait
est dit dans son **infobulle**. La **zone de saisie sous le cercle** n'est pas
concernée : le champ de texte et
le bouton de dictée restent **affichés et utilisables** dans les deux états. Son
infobulle dit **l'état d'abord, l'action ensuite** : « **tout est visible — cliquer
pour ne garder que le portrait** », puis « **tout est masqué — cliquer pour tout
réafficher** ». Masqué n'est pas perdu : **rien ne bouge**, l'espace reste réservé,
et le logo, `Échap` et la fermeture de l'onglet continuent de fonctionner. Sans
personnage, il ne reste que le bouton et la zone de saisie. Aucune mémoire : on entre
**toujours** avec tout visible, et l'état tombe en quittant le mode.

Sur l'écran **Vocal**, le bouton **« Travail »** est là lui aussi : **tout en
haut, juste à gauche des boutons de la fenêtre**. C'est **le même bouton** que
sur l'écran habituel (même point d'état, même compteur, même panneau) : un clic
y ouvre les **agents** et les **tâches** en cours, comme d'habitude. Le suivi
n'est donc plus à portée de main seulement hors du mode — il ne s'affiche pas
pour autant en permanence.

En mode **Vocal** :

- **L'intérieur du cercle s'allume avec votre voix** : une lueur verte (la
  couleur de l'écoute) remplit le disque au rythme du son que Pilot entend, puis
  s'éteint dès que vous vous taisez. Elle ne s'allume jamais quand vous ne
  parlez pas, et jamais avec la couleur de Pilot. Le contour du cercle, lui,
  reste la voix de Pilot.
- **Quand Pilot lit sa réponse**, une lueur ambre se lève **au bord** du cercle :
  c'est la voix de Pilot, **à l'extérieur** du disque (la vôtre s'allume
  **dedans**, en vert). Ce liseré **suit sa voix** : il s'étend quand ses mots
  portent, se resserre dans les pauses. Il s'étend loin — environ **88 px**
  au-delà du cercle (**256 px de rayon** au plus) — sans jamais toucher la phrase
  d'état ni la barre de saisie, et sans agrandir la fenêtre.
  **Comment il suit, selon la voix** : avec les **voix installées sur votre
  ordinateur** (les voix françaises locales), Pilot joue lui-même le son et
  l'écoute vraiment : la lueur suit le **timbre aigu** de ce qu'il dit. Avec la
  **voix du système** — celle qui est là par défaut — l'ordinateur ne laisse pas
  l'application écouter ce qu'elle dit ; Pilot ne fait donc pas semblant : il
  suit le **rythme de la phrase qu'il lit**, syllabe par syllabe, en s'arrêtant
  dans les **pauses de la ponctuation**. Dans les deux cas, le silence laisse la
  lueur au repos, et deux phrases de longueurs différentes ne bougent pas
  pareil.
- **Le halo du cercle reste allumé, même au repos.** Il ne s'éteint plus quand
  vous vous taisez : c'est **la couleur** qui dit l'état (thème au repos, vert
  quand il vous entend, violet quand il réfléchit, ambre quand il parle), et
  c'est la **forme** qui dit le reste (la couronne s'élargit quand Pilot parle,
  un arc tourne quand il réfléchit). L'écran n'est donc plus jamais éteint, et il
  ne change pas d'intensité d'un état à l'autre : rien ne clignote.
- **Le cercle est plus grand**, et il s'adapte à la hauteur de votre fenêtre : il
  occupe **de 120 à 336 px** de large (336 px sur un écran de bureau habituel),
  pour que sa lumière ne soit jamais rognée sur une fenêtre courte.
- **Le bas de l'écran s'efface quand vous ne faites rien.** Au repos, la phrase
  d'état et la zone de saisie disparaissent après **deux secondes et demie** :
  l'écran ne garde que le cercle. **Bougez la souris, cliquez, tournez la molette
  ou tapez une touche** : le bas revient aussitôt (`Échap`, lui, sort du mode).
  Il **reste affiché** tant que Pilot vous écoute ou vous répond, tant que le
  champ contient du texte (une dictée en cours de transcription), et tant qu'une
  panne de micro est annoncée. Le cercle, le bouton « Réveiller … », le logo et
  le bouton « Travail », eux, **ne disparaissent jamais**, et le cercle **ne
  bouge pas d'un pixel** quand le bas s'efface.
- **Si vous avez réduit les animations**, cette lueur reste **allumée et fixe**,
  à sa taille pleine — elle ne clignote pas et ne disparaît pas ; le bas, lui,
  apparaît et disparaît **d'un coup**, sans fondu.
- **L'écran distingue le silence de la parole** : quand vous vous taisez, il est
  au **repos** (couleur du thème, « Je vous écoute. ») ; dès que votre voix est
  réellement entendue, il passe en **écoute** (vert, « Je vous écoute… ») et y
  reste tant que vous parlez ; quand vous vous arrêtez, il revient au repos tout
  seul. Ouvrir le micro ne suffit donc pas à l'allumer : c'est votre voix qui le
  fait, et il ne clignote pas entre les deux (deux seuils, un pour entrer, un
  plus bas pour sortir).
- **Le micro et la dictée restent ouverts pendant tout le mode** — c'est ce qui
  vous permet de parler sans rien toucher — **sauf pendant que Pilot lit sa
  réponse et pendant qu'il travaille** : il ne se transcrirait pas lui-même.
  Les deux sont **refermés aux trois sorties** du mode (bouton, Échap,
  fermeture de l'onglet) : le témoin du système s'éteint, Pilot ne vous écoute
  pas en dehors de l'écran. Un repli de voix compte comme **Pilot qui parle**.
- **Pilot demande le micro de mesure dès l'entrée** dans cet écran — jamais
  dans les autres modes — **avant** d'ouvrir la dictée : la mesure passe la
  première, la dictée ensuite. Ainsi une panne ne se déguise jamais : si le
  micro de mesure ne s'ouvre pas, l'écran le dit et la dictée ne s'arme pas ;
  si c'est la dictée qui échoue, le halo continue de suivre votre voix.
- **Si vous refusez**, si aucun micro n'est branché, s'il est occupé ou s'il
  tombe en panne : l'écran le **dit en une phrase** et propose **« Autoriser le
  micro »**. Le mode reste **entièrement utilisable** (écrire, envoyer, écouter)
  — rien n'est bloqué, et Pilot ne redemande pas tout seul.
- **Sur un projet marqué sensible** (🔒), la dictée reste **bloquée** : l'écran
  attend de savoir si le projet est marqué avant d'ouvrir la dictée, et il
  repose la question à chaque changement de projet. La transcription (qui passe
  par le réseau) ne s'ouvre jamais sur un projet 🔒. Cette attente est **courte
  et bornée** : si la réponse tarde, l'écran vous le dit (« État du projet non
  vérifié : appuyez sur le micro pour dicter, ou écrivez votre demande. ») et
  **le bouton 🎙️ marche** — il ne vous laisse jamais devant un bouton sans
  effet, mais il n'ouvre jamais la dictée tout seul dans ce cas.
- **En quittant le mode, le micro est coupé** (le témoin du système s'éteint) :
  Pilot ne vous écoute pas en dehors de cet écran.
- **Parler par-dessus Pilot le fait taire** : pendant qu'il lit, prendre la
  parole **arrête la lecture net** (entre deux phrases, jamais au milieu d'un
  mot), l'objet repasse en **écoute** et la zone de saisie **reprend la main**.
  Pilot **ne se coupe jamais lui-même** : il vérifie que votre micro n'entend
  pas ses propres haut-parleurs (annulation d'écho, mesure du son résiduel **au
  tout début du son**, quand il commence vraiment à parler — pas quand il annonce
  qu'il va lire) et, si cette vérification n'est
  pas concluante, il relève le seuil **au double du son qu'il s'envoie** : il
  faut alors parler **plus longtemps** (une seconde d'affilée), mais **une voix
  franche et continue finit toujours par le faire taire** — **à chaque lecture**,
  la deuxième comme la première. En revanche, si vous
  parlez dans les tout premiers instants d'une phrase, pendant cette mesure, il
  ne s'arrête pas. Le **casque** est la situation où cela marche le mieux.
- **Parler pendant qu'il travaille l'arrête aussi** : si vous prenez la parole
  pendant que Pilot **réfléchit** (l'agent travaille), il **s'arrête tout de
  suite** — exactement comme si vous appuyiez sur le bouton **Arrêter** de la
  conversation. Ce qu'il avait déjà écrit reste affiché, rien n'est jeté, et la
  zone de saisie reprend la main pour que vous disiez ce que vous voulez à la
  place. Une phrase suffit à l'arrêter **une seule fois** : continuer de parler
  ne relance aucun arrêt, et un bruit court (une toux, une chaise) ne l'arrête
  pas. Hors du mode Vocal, rien ne change. Ce n'est pas encore fait : reprendre
  votre phrase pour relancer l'agent à votre place — il faut le redemander.
- La réponse se **lit à voix haute** (voir « Écouter une réponse à voix
  haute ») : comme l'écran est nu, c'est le moyen d'entendre la réponse. Au
  repos, **parler suffit** : la dictée s'ouvre toute seule, la demande part,
  et l'écoute reprend après la réponse (conversation continue). **Un silence
  n'arrête rien** : quand vous vous taisez un moment, l'écoute se referme
  simplement et **se rouvre toute seule** — vous pouvez reprendre la parole
  quand vous voulez, sans toucher à rien, et rien ne s'affiche comme un échec.
  Pilot ne cesse de rouvrir le micro tout seul que dans un seul cas : le moteur
  de reconnaissance rend la main **immédiatement**, plusieurs fois de suite,
  sans avoir rien transcrit (le micro tournerait en boucle pour rien). Alors
  **un clic sur le rond « Réveiller … » du cercle** (ou sur 🎙️) la rétablit. Une
  vraie panne (micro refusé, occupé,
  réseau absent) s'affiche **en une phrase**, dans la ligne d'état.
- **Le rond « Réveiller <votre personnage> » relance l'écoute.** Il **occupe
  tout l'intérieur du cercle** : quand il est là, il **est** le cercle, dont le
  contour lui sert de bord. Il porte « **Réveiller** » suivi du nom de votre
  personnage (par exemple « Réveiller Nova » ; « Réveiller Assistant » s'il n'y
  a pas de personnage) : un clic relance l'écoute et la conversation, exactement
  comme le bouton 🎙️ de la barre de saisie. Il est **visible quand la dictée ne
  tourne pas** et **disparaît pendant l'écoute** — d'un coup d'œil, vous savez
  donc si Pilot vous entend. Il ne déplace rien : ni le cercle, ni la phrase
  d'état, ni la zone de saisie. Un nom très long est abrégé au milieu du cercle,
  mais l'infobulle et la voix des lecteurs d'écran disent toujours le nom
  **entier**.
- **Une question de Pilot se répond sur place.** Quand il vous pose une
  question — un choix, une confirmation, une réponse à écrire — elle apparaît
  **juste au-dessus de la barre de saisie** (et rien d'autre de la conversation
  ne s'affiche pour autant). La zone de saisie est **déjà prête** : le curseur y
  est, vous pouvez **écrire, dicter 🎙️ ou appuyer sur Entrée** sans cliquer
  d'abord, et les **boutons de la question répondent du premier coup**. Une
  question **ne s'efface jamais toute seule** : elle attend votre geste. S'il y
  en a plusieurs, elles s'enchaînent dans l'ordre, sans en perdre aucune.
- **La demande part deux secondes après votre dernier mot** (par défaut).
  Pilot n'attend plus que le moteur de reconnaissance veuille bien se taire :
  **après ce délai sans nouveau mot entendu**, la demande part. Tant que vous
  parlez, rien ne part — **chaque nouveau mot repousse l'échéance** —, et rien
  ne part non plus pendant que Pilot lit sa réponse ou travaille, ni si vous
  avez repris la main pour écrire dans la zone.
- **Ce délai se règle**, à un seul endroit : ⚙️ **Options → onglet
  « Assistant » → section « Mode Vocal »**, de **1 à 5 secondes** par pas d'une
  demi-seconde, **2 secondes** au départ, et la valeur choisie s'affiche en
  toutes lettres (« 2,5 secondes »). Il est mémorisé et s'applique **tout de
  suite** : une demande déjà en train de partir n'est pas modifiée, c'est la
  suivante qui suit la nouvelle valeur.
- **Pilot parle court dans ce mode.** Comme la voix est le seul chemin, la
  réponse est celle d'une **conversation** : **deux phrases**, sans liste, sans
  titre, sans nom de fichier, sans code — juste ce qui est utile à entendre.
  **Demandez le détail** (« détaille », « explique », « pourquoi », « comment »)
  et Pilot développe, toujours de façon compréhensible à l'oreille. En revanche,
  une **panne**, un **refus**, une **erreur** ou une **demande de confirmation**
  sont toujours dits **en entier**, même si c'est plus long : la brièveté ne cache
  jamais une information utile. Les autres écrans gardent leurs réponses
  habituelles.
- **Cette longueur se règle**, à un seul endroit : ⚙️ **Options → onglet
  « Assistant » → section « Mode Vocal »**, sous le réglage du délai, avec quatre
  choix — **Très courte** (une phrase), **Courtes** (deux phrases, le choix de
  départ), **Moyenne** (quatre à six phrases, avec le
  pourquoi quand il aide) et **Détaillées** (une réponse complète, mais toujours
  dite à l'oreille : des phrases, jamais de tableau, jamais de code, jamais un
  nom de fichier lu à voix haute). Le choix s'applique **tout de suite à la
  demande suivante** : une demande déjà en train de partir n'est pas modifiée.
  Demander de développer (« détaille », « explique », « pourquoi », « comment »)
  passe **avant** le niveau choisi, et une panne, un refus, une erreur ou une
  demande de confirmation sont toujours dits **en entier**, quel que soit le
  niveau.

---

<!-- HELP-TOPIC:lire-reponses -->
## Écouter une réponse à voix haute 🔊

Chaque réponse de l'assistant (onglet **π** comme onglet **🧭 Assistant**) porte
un petit bouton **« 🔊 Écouter »** posé sous le message, à côté de la bulle.

- **Un clic lit la réponse**, un **second clic l'arrête** : le bouton affiche
  alors **« ⏹ Arrêter »** (le libellé, l'icône et l'encadré changent — l'état se
  comprend même sans couleur).
- **Rien ne se lit tout seul** : aucune lecture automatique et aucun son à
  l'ouverture de Pilot. C'est vous qui décidez, message par message — **sauf en
  mode « Vocal »**, où la réponse se lit à voix haute (c'est le principe même de
  cet écran, voir la section sur les modes d'écran). Écrire ou valider pendant la
  lecture l'arrête aussitôt, et sortir du mode Vocal aussi.
- **Une seule lecture à la fois** : lancer une autre réponse arrête proprement
  la précédente, jamais deux voix ensemble.
- **La voix ne débite pas le balisage** : titres, puces, gras, tableaux, liens
  et symboles sont retirés (un lien est lu par son libellé) et le contenu des
  **blocs de code n'est pas lu** (Pilot annonce seulement « bloc de code »). Les
  **émojis** ne sont pas prononcés non plus : la phrase lue reste naturelle. Le
  texte est découpé **phrase par phrase**, et une coupure tombe toujours sur une
  fin de phrase ou de mot — jamais au milieu d'un mot.
- **Le choix de la voix se règle à un seul endroit** : ⚙️ **Options → onglet
  « Assistant »** → section **« Lecture des réponses »**. Vous y trouvez le
  **choix de la voix**, l'**état de la lecture** et l'**explication**, regroupés
  au même endroit — ce réglage n'existe nulle part ailleurs (ni dans un autre
  onglet des Options, ni dans une fenêtre par message).
- **Juste en dessous, la section « Mode Vocal »** porte le **Délai d'envoi** de
  l'écran vocal (de 1 à 5 secondes, **2 secondes** par défaut) : le temps
  d'attente après votre dernier mot avant que la demande parte toute seule —
  puis la **Longueur des réponses à l'oral** (**Très courte**, **Courtes** par
  défaut, **Moyenne**, **Détaillées**), c'est-à-dire ce que la lecture a à lire.
  Aucun autre réglage ne les concerne, et ils n'existent nulle part ailleurs.
- **Vous écoutez chaque voix avant de choisir** : sous la liste, chaque voix
  proposée a son bouton **« ▶ Écouter »**, qui lit une **phrase d'exemple courte**
  en français. Le même bouton devient **« ⏹ Arrêter »** pendant la lecture, et
  **une seule voix est lue à la fois** : écouter une autre voix coupe la
  précédente. Quitter les Options ou fermer la fenêtre arrête aussi la
  lecture.
- **Ce que vous entendez est exactement ce que vous obtiendrez** : l'exemple
  passe par le **même chemin** que le bouton « 🔊 Écouter » posé sous les
  réponses (même voix, même nettoyage du texte, découpage par phrases identique).
- **Une voix pas encore téléchargée ne se fait pas passer pour une autre** :
  si son modèle manque, l'exemple ne lit **pas** la voix du système à la place ;
  la section écrit que cette voix **n'est pas encore installée** et le bouton
  **« Installer la voix locale »** la récupère — c'est la voix que vous avez
  choisie qui est installée, en plus des deux voix du paquet. Rien n'est
  téléchargé sans votre geste.
- **Si la voix locale échoue malgré tout**, l'exemple continue avec la voix du
  système et l'écrit sous la voix concernée, avec une ligne dans le journal
  (comme pour la lecture d'une réponse). Rien ne bloque.
- Par défaut, la voix est sur **« Automatique »** : Pilot prend la voix de la
  langue de l'interface. Si vous choisissez une voix précise, **ce choix est
  mémorisé** et réutilisé aux démarrages suivants.
- **La voix choisie a disparu de l'ordinateur** (désinstallée, autre poste,
  autre système) : Pilot revient **proprement** sur la voix de la langue de
  l'interface, l'annonce dans la section et **le dit aussi là où vous écoutez** —
  une ligne courte apparaît **à côté du bouton « 🔊 Écouter »** de la réponse
  (« Voix du système choisie indisponible (voix introuvable) : lecture avec la
  voix de la langue de l'interface. »). Ni erreur, ni lecture muette, et surtout
  **jamais un remplacement silencieux** : votre choix enregistré n'est pas
  modifié dans votre dos, vous êtes simplement informé. Quand la voix choisie
  est bien présente et sert réellement, **aucune ligne n'apparaît**.
- **La voix suit la langue de l'interface** (français si Pilot est en
  français) : quand vous êtes en « Automatique », Pilot demande la première
  voix disponible dans cette langue.
- **Si aucune voix n'est installée** (fenêtre sans voix disponible), la
  section affiche une phrase claire expliquant quoi installer et que la lecture
  reste inactive ; le bouton **« 🔊 Écouter »** reste visible mais **inactif**,
  avec une courte infobulle qui l'explique.
- **Une vraie voix française, sans Internet** : la liste des voix propose aussi
  des **voix françaises locales** (une entrée par voix, avec son **genre** écrit
  en clair — « voix de femme » ou « voix d'homme » — et sa taille). Elles
  fonctionnent **hors ligne**, **sans clé** et **sans carte graphique**.
- **Rien n'est téléchargé sans votre accord** : la section indique si la voix
  locale est en place et propose **un seul bouton : « Installer la voix
  locale »**. Ce **seul geste** installe, **une seule fois** et sur votre
  demande : le **moteur de lecture** et **deux voix françaises** — une voix de
  femme et une voix d'homme, en qualité moyenne (environ 60 Mo par voix, plus
  l'archive du moteur, compressée à environ 22 Mo). Rien ne part au démarrage,
  ni à l'ouverture des Options, ni pendant la lecture.
- **Seulement ce qui manque, jamais deux fois** : un fichier déjà présent et
  **complet** n'est jamais retéléchargé — le geste ne récupère que ce qui
  manque, et il le fait sans rien supprimer de ce qui existe déjà.
- **Le moteur est partagé entre les versions de Pilot** : installé **une fois**
  sur cet ordinateur, il est **réutilisé** — version installée et version de
  test partagent le même moteur, rien n'est copié ni supprimé. La section dit
  **où il se trouve** ; la voix locale est alors utilisable tout de suite.
- **Sur macOS et Linux**, Pilot ne fournit pas ce moteur : la section l'écrit
  en clair, sans erreur et sans rien télécharger en vain, et la lecture continue
  avec la voix du système.
- **La section se remplit toute seule** : à l'ouverture des Options (et à
  l'affichage de l'onglet « Assistant »), Pilot vérifie **une seule fois** si le
  moteur et les modèles sont en place — vous n'avez rien à cliquer. Pendant la
  vérification, la section l'écrit ; si elle n'aboutit pas, la section dit que
  l'état est **inconnu** (jamais une ligne vide) et le bouton « Vérifier à
  nouveau » reste là pour relancer. Rien n'est téléchargé pour autant.
- **L'installation s'affiche et s'arrête** : la section montre **l'étape en
  cours** (« étape 2 sur 3 : la voix de femme »), la **taille** et le
  **pourcentage** (« 26,0 Mo / 60,6 Mo, 42 % »), puis la fin. Un bouton
  **« × Arrêter l'installation »** interrompt le geste en cours, et **« Vérifier
  à nouveau »** revérifie à tout moment. **Rien n'est supprimé** : ce qui a déjà
  été reçu reste en place, et l'installation **reprend là où elle s'était
  arrêtée** au prochain geste.
- **Un fichier incomplet n'est jamais déclaré installé** : Pilot ne se fie pas
  à la présence du fichier mais à sa taille exacte. Une voix dont le fichier a
  été tronqué est annoncée **« incomplète »**, et le geste répare ce fichier
  (sans le supprimer). C'est ce qui fait que la lecture ne se lance jamais sur
  un modèle à moitié téléchargé.
- **Après l'installation, plus aucune connexion** : lire une réponse ne fait
  **aucun appel au réseau**. Tout est sur l'ordinateur.
- **Si le moteur local est absent ou échoue**, la lecture ne s'arrête pas : elle
  **continue avec la voix du système**, et vous le **voyez là où vous écoutez** :
  une **ligne courte** apparaît **à côté du bouton « 🔊 Écouter »** de la réponse
  (« Voix locale indisponible (moteur absent) : lecture avec la voix du
  système. »), avec la raison en quelques mots — moteur absent, modèle incomplet,
  état du moteur inconnu, ou synthèse locale en échec. Si vous êtes dans les
  Options, l'état de la section le dit aussi, et une ligne est écrite dans un
  **journal** (dossier de la voix locale). Rien ne bloque, rien ne plante. Quand
  la voix locale fonctionne, ou si vous n'avez jamais choisi de voix locale,
  **aucune ligne n'apparaît**.
- **Le choix reste le même qu'avant** : une seule voix à la fois, mémorisée,
  et le texte lu est nettoyé et découpé de la même façon quel que soit le moteur.
  Une configuration enregistrée avant cette évolution continue de fonctionner
  telle quelle (elle désigne la voix locale par défaut).
- **Vos propres messages** et les **événements système** ne portent pas ce
  bouton.
- **Ce que ça ne fait pas** : enregistrer le son dans un fichier, ni envoyer le
  texte à un service en ligne. Le bouton lit seulement, en direct, sur votre
  ordinateur.

---

<!-- HELP-TOPIC:gds -->
## GDS (gestionnaire de sources) — principe

Le **GDS** (Gestionnaire De Sources) **centralise les sources des projets**
(dépôts git + suivi partagé dans une base PostgreSQL unique), en remplacement
d'un hébergement externe type GitHub.

- **Serveur GDS en conteneur** : le GDS s'installe comme **un seul conteneur
  Docker** (dossier `gds-server/` du dépôt Pilot) qui réunit la base
  PostgreSQL, l'accès SSH aux dépôts git et le service HTTP. Un seul service à
  démarrer : inutile d'installer PostgreSQL ou un serveur SSH sur le poste.
- **Mise en place guidée** : `docs/gds-guide-mise-en-place.md` est le **parcours
  de retest complet** — une **liste de contrôle à cocher**, du poste vierge à
  l'usage **à plusieurs** (partie 0 ce qu'il faut avoir sous la main, partie 1
  serveur, partie 2 usage, partie 3 à plusieurs, partie 4 modifier le serveur,
  partie 5 tout refaire à la main, partie 6 gestes dangereux). Chaque étape dit
  **où l'on agit** (fichier `.env`, terminal, ou application Pilot) puis
  **ce que vous faites**, **ce que vous voyez** (le **point de contrôle**, messages
  cités mot pour mot) et **quoi faire si ce n'est pas ça** — commandes exactes
  comprises, sans valeur à compléter entre chevrons. Le **piège du port de base
  `5432` déjà occupé** ouvre le document. Le détail technique
  d'installation reste `docs/gds-server-setup.md`.
- **Premier compte administrateur** : au tout premier démarrage, **aucun**
  administrateur n'existe. Soit vous renseignez **les deux** variables
  `GDS_ADMIN_EMAIL` **et** `GDS_ADMIN_PASSWORD` dans le fichier `.env` du
  serveur (**avant** le premier démarrage) et le service **crée le compte
  lui-même** (un compte déjà présent n'est **jamais** écrasé ; une seule
  variable renseignée = simple avertissement, rien n'est créé), soit vous
  appelez **une seule fois** la route d'initialisation `POST /api/gds/setup`
  (elle répond ensuite `409`). Un mot de passe d'administration n'est **jamais**
  généré et **jamais** journalisé : c'est vous qui le choisissez.
- **Vérifier la base** : la commande de contrôle vise la base **dans le
  conteneur** — `docker exec pilot-gds sh -c 'PGPASSWORD="$POSTGRES_PASSWORD"
  psql -h 127.0.0.1 -p 5432 -U pilot -d pilot_gds -c "select 1"'` : le mot de
  passe est lu **dans** le conteneur (rien à recopier, aucun secret dans
  l'historique du terminal) et l'adresse est **interne**. Une commande passant
  par le port publié du poste échoue (« mot de passe incorrect ») si un autre
  PostgreSQL occupe déjà `5432` : elle aboutit alors sur la **mauvaise** base
  (piège et parade : `docs/gds-server-setup.md` §5.1). **Convention** : les
  textes entre chevrons `<…>` sont des **espaces à remplacer**, **chevrons
  compris** (les chevrons ne font pas partie de la valeur).
- **Activé projet par projet** : le GDS n'est jamais activé globalement.
  Chaque projet choisit explicitement son serveur via un fichier de
  configuration **dans le projet** (`.pilot/gds.json`). Aucun serveur par défaut,
  aucune configuration globale.
- **Trois rôles de compte** (appliqués par le serveur) : **`admin`** gère les
  **comptes** et les **dépôts** sur tous les projets ; **`dev`** publie et force
  le suivi de **tous** les projets du serveur ; **`standard`** est en
  **lecture seule**. Le premier compte créé est administrateur.
- **Interrupteur global (Options → GDS)** : un paramètre global **actif par
  défaut** permet de **couper toutes les opérations GDS** (synchronisation,
  suivi fusionné) d'un coup, indépendamment de l'activation par projet. Quand
  il est désactivé, aucune opération GDS n'est permise.
- **Saisie unique & secrets hors projet** : à la configuration, l'adresse
  PostgreSQL se renseigne en **champs séparés** (hôte, port, utilisateur dédié) et
  les **mots de passe sont stockés hors du projet** dans un fichier protégé
  de l'utilisateur — ils ne figurent jamais dans `.pilot/gds.json`. Sur la voie
  **compte GDS** (le cas normal), **aucun secret de base** n'est demandé : le
  serveur prépare **sa** base et le poste n'ouvre plus de connexion PostgreSQL ;
  seuls les serveurs déjà déclarés (fiches **héritées**) gardent ce chemin, sans
  rien à ressaisir. Aucune URL à
  mot de passe n'est affichée ni demandée à nouveau après la première saisie :
  au démarrage, Pilot se **reconnecte automatiquement** (auto-provisionnement
  en arrière-plan, sans jamais bloquer l'ouverture du projet) au serveur déjà
  configuré (sans re-provisionner). Un **mot de passe manquant** (secrets perdus
  ou poste changé) se **ressaisit seul** avec le bouton **« Enregistrer les mots
  de passe »** : **aucune nouvelle activation** n'est nécessaire, la base n'est
  jamais recréée. L'ajout initial d'un projet au GDS reste
  **manuel** : il n'est jamais automatisé à l'ouverture.
- **Identité globale saisie UNE seule fois** : votre **email** (qui identifie
  votre compte GDS) et votre **nom git** se règlent dans l'onglet **« ⚙️ GDS —
  paramétrage » → Mon identité**. Pré-remplis partout ensuite, plus aucun champ
  email n'apparaît dans l'interface simple. Stockés hors projet
  (`~/.pilot/gds_secrets.json`, permissions 0600), ils ne figurent jamais dans
  `.pilot/gds.json`.
- **Sans activation** : le projet reste 100 % local, exactement comme
  aujourd'hui.
- **Onglet « 🌐 GDS » (par projet)** : le bouton **GDS** du panneau **Vues**
  (sidebar) ouvre un onglet dédié au projet ouvert. Son en-tête affiche un
  **badge d'état** : « ● Connecté » / « ● Enregistré sur le serveur — dépôt
  vide, à publier » / « ● En attente » / « ○ À configurer ».
  Selon l'état, seuls les blocs utiles sont affichés :
  - **À configurer / En attente** : l'étape **« Connecter un serveur GDS »** —
    choisir un **serveur mémorisé** (sélecteur, mots de passe jamais affichés) :
    votre **compte GDS** porte l'identité, et c'est le **serveur** qui prépare
    **sa** base (les champs de **compte technique** — utilisateur dédié, mot de
    passe dédié, mot de passe admin — ne concernent plus que les fiches
    héritées). Deux boutons :
    **« Enregistrer la configuration »** (mémorise le serveur choisi **sans rien
    créer**) et **« Activer GDS »** (le serveur garantit sa base, puis active le
    GDS pour le projet). Le seul réglage demandé ici est le **Dossier local de
    clonage** (propre à ce poste). **Aucune valeur technique du serveur**
    (adresse, port du service, port SSH, racine des dépôts) n'est saisie sur
    l'écran du projet : elle vient de la **fiche du serveur** (onglet
    « ⚙️ GDS — paramétrage » → Serveurs GDS), et **aucune création de serveur
    n'est proposée ici** ;
  - **Ajouter ce projet au GDS** : une fois activé (si le projet n'est pas déjà
    sur le serveur), crée un dépôt git bare sur le serveur, ajoute le remote
    `gds` (sans toucher à un éventuel `origin`) et pousse la branche courante.
    L'**identité git** (email + nom) est réglée automatiquement et **localement**
    depuis votre identité globale (aucune saisie) ;
  - **Déjà sur le serveur** : badge **« ✅ Déjà ajouté »**, bouton d'ajout
    masqué ;
  - **Connecté** : bloc compact — statut **Suivi fusionné** (synchronisé /
    en attente / hors-ligne, avec le nombre de conflits), bouton
    **Synchroniser**, et **Retirer du GDS** (avec confirmation ; purge serveur
    uniquement si cochée) ;
  - **Projet déjà rattaché à un serveur, liaison à vérifier** : écran minimal —
    le **serveur choisi** (nom de sa fiche), puis **deux informations
    distinctes** : « **✅ Enregistré sur le serveur** » (l'inscription côté
    serveur) et « **⚠️ Liaison de ce poste : à vérifier** » (accès à la base et
    au dépôt du projet — hors serveur local natif de ce poste (dont la racine
    des dépôts est un chemin de ce poste), l'existence du dépôt est demandée
    **au serveur** et **jamais** déduite d'un dossier de ce poste : si le
    serveur ne répond pas, l'état reste **« à vérifier »**, jamais « Connecté »).
    Boutons : « **Vérifier la liaison** »,
    « **(Re)créer le raccourci vers le dépôt** » (refait le raccourci `gds` du
    dépôt local vers le dépôt du serveur, **sans rien supprimer** — aucun
    retrait ni réajout du projet) et « **Changer de serveur** » (rouvre le
    formulaire pré-rempli, puis « **Retour** »), ajout du projet si nécessaire
    et **Retirer du GDS**. **Aucun champ technique** (hôte de base, port SSH,
    racine des dépôts, dossier de clonage) n'est redemandé sur l'écran normal : ces valeurs sont
    conservées et relues automatiquement. La liste des projets GDS affiche de
    son côté « **Enregistré sur le serveur — liaison à vérifier** », et le nom du
    projet, dans le volet des fichiers, « **- (GDS — liaison établie)** » ou
    « **- (GDS — liaison à vérifier)** » (infobulle : inscription serveur et
    liaison du poste distinguées).
  - **Dépôt du serveur vide (projet jamais publié)** : le dépôt du projet
    existe côté serveur mais il est **vide** — la branche n'y a jamais été
    publiée. L'écran le dit clairement (badge « **● Enregistré sur le serveur —
    dépôt vide, à publier** ») au lieu d'annoncer « Connecté », et propose
    **« Publier ce projet sur le GDS »** (premier envoi de la branche). La
    synchronisation ne peut pas fonctionner avant ce premier envoi. Un dépôt
    que le serveur ne peut pas donner (service injoignable, chemin de dépôt
    obsolète) reste « **liaison à vérifier** », **jamais** « Connecté ».
    Ce premier envoi (comme « **Ajouter au GDS** ») **n'est pas immédiat** : un
    **avertissement** s'affiche d'abord — **à partir de maintenant, ce projet
    travaille avec le GDS : Pilot n'utilisera plus GitHub pour ce projet** ;
    ce qui est **déjà sur GitHub reste intact** (Pilot n'y touche jamais), et
    le **supprimer de GitHub est à votre main**. **Rien n'est envoyé avant votre
    confirmation.**
    Après un envoi, un ajout ou une **synchronisation** réussis, l'**explorateur
    se rafraîchit tout seul** : fichiers, **marqueurs Git** et « **voir le
    diff Git** » sont à jour sans rien faire.
- **Deux écrans transverses** (ouverts **sans projet**) — rangée **Accès
  directs** de l'onglet **Options ⚙️** : la **petite tour** 🖥️, bouton
  **« Serveur GDS »** (infobulle *« GDS Serveur — administration (onglet
  transverse, hors projet) »*), ouvre l'administration, les **curseurs** ⚙️,
  bouton **« GDS mon compte »** (infobulle *« GDS — paramétrage utilisateur
  (onglet transverse, hors projet) »*), le paramétrage ; l'onglet **« 🌐 GDS »**,
  lui, reste **dans le projet** (panneau **Vues**) :
  - **« 🖥️ GDS Serveur — administration »** : écran à **sous-onglets** —
    **Connexion serveur**, **Comptes** (créer, changer le rôle,
    activer/désactiver, réinitialiser un mot de passe), **Dépôts / projets**
    (retrait avec purge), **Espace utilisé + journal des connexions**, **Contrôle
    du service** (redémarrer le service GDS ou le conteneur). La page **Connexion
    serveur** liste les **serveurs déjà paramétrés** : une ligne par serveur,
    avec son **état** (« Connecté », « Enregistré », « Échec de connexion », « À
    compléter (mot de passe) ») et le bouton **« Administrer »** qui ouvre
    l'administration de **ce** serveur. Juste en dessous, **« Ajouter un
    serveur »** ouvre une petite fenêtre **par-dessus** l'écran (adresse, port,
    e-mail administrateur, mot de passe GDS) : la fiche n'est **ajoutée à la
    liste que si la connexion aboutit** — sinon le message d'erreur s'affiche
    dans cette fenêtre et **rien n'est enregistré**. Les champs de saisie
    restent à largeur modérée. Les quatre autres sous-onglets n'apparaissent
    qu'**après la première connexion réussie**, et restent fermés tant que les
    identifiants d'administration ne sont pas saisis et validés ;
  - **« ⚙️ GDS — paramétrage »** : **Serveurs GDS** mémorisés portant un **nom**
    (obligatoire) et une **description** (facultative). Une fiche décrit votre
    **compte GDS** sur ce serveur : **adresse**, **port du service** (8080 par
    défaut), **e-mail GDS** et **mot de passe GDS**. Le **mot de passe n'est
    jamais réaffiché** ; il est mémorisé hors projet, après un test réussi, et
    l'**appartenance est prouvée par un test** (les rôles non administrateurs
    sont acceptés). Chaque fiche indique son **état** (**joignable /
    injoignable / jamais testé**, avec la **date du dernier test**) et le
    **rôle reconnu** (administrateur, développeur, standard). Actions :
    ajouter, modifier, supprimer, tester, et **appliquer à un projet choisi dans
    une liste** (et non plus seulement au projet ouvert). Une fiche écrite avant
    cette version (compte technique de la base, affichée
    `utilisateur@adresse:port`) **reste lisible et utilisable** : renseignez
    simplement votre **e-mail GDS** pour la compléter, sans rien perdre, et il
    n'y a **pas de doublon** à créer. Chaque fiche porte aussi les **valeurs
    techniques du serveur** — **port SSH des dépôts** et **racine des dépôts
    sur le serveur** (`/srv/git/repos` par exemple) — saisies **une seule fois
    ici** et recopiées dans chaque projet qui applique la fiche. Autres blocs :
    **Mon identité**
    (email + nom git), **Mes clés** (clef SSH publique du poste : afficher,
    copier, enregistrer sur un serveur) et **Mes projets GDS** (état,
    synchroniser, ajouter, ouvrir, **détacher**).
- **Détacher un projet du GDS** : depuis **Mes projets GDS**, le bouton
  **« Détacher »** demande confirmation puis propose **explicitement** deux
  issues — **par défaut le travail est conservé côté serveur** ; cocher la case
  **« Retirer aussi le travail côté serveur »** supprime en plus le dépôt et les
  entrées en base. Le détachement peut viser un projet **choisi dans la liste**,
  même s'il n'est pas le projet ouvert. **Appliquer un serveur** mémorisé
  pré-remplit l'hôte, le port, l'utilisateur, l'identité, **le port SSH et la
  racine des dépôts** depuis la fiche (et **conserve** ce que le projet avait
  déjà si la fiche ne les porte pas). Une
  fiche **« compte GDS »** ne porte pas le compte technique de la base : c'est
  le **serveur** qui prépare **sa** base, et son bouton **Appliquer** est
  **actif** ; les fiches écrites avant cette version **gardent** leur bouton
  actif, comme avant.
- **Synchroniser** : une fois connecté, **Synchroniser** rapatrie le projet depuis
  le serveur (clone s'il est absent, sinon mise à jour).
- **Un seul poste travaille sur un projet à la fois** : quand un développeur a
  pris un projet, les autres postes peuvent l'**ouvrir et le consulter**, mais ne
  le **modifient pas** et n'y lancent **aucun agent**. Un **bandeau**, dans
  l'onglet « 🌐 GDS », dit que le projet est tenu par un autre développeur et
  **jusqu'à quelle heure**. Lire, naviguer et consulter restent possibles.
  - **Prendre le projet** : le bouton **« Prendre le projet pour publier »**
    apparaît quand le projet est **libre** et que des modifications attendent sur
    ce poste, ou quand un **autre** poste le tient (pour réessayer). Si le projet
    est encore tenu, Pilot le dit clairement, avec le motif.
  - **Rendre le projet** : le bouton **« Rendre le projet »** n'apparaît que si
    vous tenez le projet. Il publie le code, envoie l'avancement, **puis** libère
    le projet pour le suivant. Si une étape échoue, le projet **reste à vous**,
    rien n'est perdu, et vous pouvez recommencer.
  - **Votre travail déjà fait** n'est **jamais supprimé ni écrasé** : tant que
    vous ne tenez pas le projet, il **reste sur ce poste** et **n'est pas
    publié** — l'écran vous indique combien de fichiers sont concernés et vous
    propose de prendre le projet.
  - **Projet laissé à l'abandon** : après **15 minutes** sans activité, le projet
    se libère **tout seul**. Un **administrateur** peut aussi le libérer tout de
    suite, avec un **motif** obligatoire (l'opération est tracée).
- **Envoi au fil de l'eau** : l'**avancement** part **tout seul** dès qu'il a
  changé (Pilot le vérifie toutes les 30 secondes) ; la **prise en main** du projet
  est renouvelée toutes les **3 minutes**. Aucun clic à faire, et une coupure
  réseau ne bloque rien : l'envoi est simplement refait ensuite.
- **Conflits** : deux postes n'écrivent plus en même temps sur un même projet ; si
  deux écritures se croisent malgré tout, la plus récente s'applique et le conflit
  est **journalisé** (jamais totalement silencieux).
- **Autorisation du serveur local — automatique** : sur un serveur GDS
  **installé sur ce poste**, Pilot **autorise lui-même** le dossier des dépôts
  à être servi — une fois à la mise en place, et de nouveau avant la création
  d'un dépôt. **Rien à taper** : plus de commande à refaire à chaque nouveau
  projet, et l'autorisation reste **limitée au dossier des dépôts** (jamais une
  autorisation générale de l'ordinateur). Si un geste (ajouter le projet,
  publier, recréer le raccourci) tombe sur ce refus, l'écran affiche
  **« Le serveur local n'a pas encore autorisé ce projet. Pilot peut corriger
  cela tout seul, en un clic. »** et un bouton **« Autoriser ce projet
  automatiquement »** : il corrige, puis **reprend le geste tout seul**. Une
  **invitation Windows** peut apparaître — **acceptez-la**, c'est la seule chose
  à faire.
- **Ajouter un projet depuis le GDS** : dans le menu **Projet**, les entrées
  « Ajouter ou créer un projet » et « Ajouter un projet depuis le GDS »
  permettent de rajouter une source. La seconde ouvre une fenêtre qui commence par
  le **choix du serveur** : une liste déroulante des **serveurs mémorisés** de ce
  poste (les mêmes fiches que « GDS — paramétrage » → **Serveurs GDS**, jamais de
  mot de passe affiché). **Aucun projet n'a besoin d'être ouvert.** Dès qu'un
  serveur est choisi, la fenêtre affiche **les projets de ce serveur**, une ligne
  par projet :
  - **copie déjà présente sur ce poste** : la ligne reste **visible mais grisée**
    (« déjà sur ce poste » / « déjà récupéré ») avec le bouton **« Ouvrir le
    projet local »** — rien n'est récupéré, déplacé ni remplacé ;
  - **copie absente** : **« Récupérer une copie »** copie le projet du serveur
    dans votre dossier local habituel, puis l'ouvre (un dossier existant qui
    n'est pas un dépôt de travail fait **refuser** la récupération : rien n'est
    jamais écrasé) ;
  - **dans tous les cas** : **« J'ai déjà ce projet ailleurs »** rattache au
    serveur une copie **rangée ailleurs** (dossier renommé ou déplacé), sans en
    récupérer une seconde.
  Pilot ne fait que **lire et récupérer une copie** : le serveur n'est jamais
  modifié. Si aucune fiche serveur n'est utilisable, la fenêtre le dit clairement
  et vous oriente vers **« ⚙️ GDS — paramétrage » → Serveurs GDS** (ajouter la
  fiche, puis tester la connexion).
- **Obtenir un compte** : un compte ne se crée **pas tout seul** —
  l'**administrateur** le crée dans l'écran « 🖥️ GDS Serveur — administration »
  (bloc **Comptes** : e-mail, rôle `standard`/`dev`/`admin`, mot de passe initial).
  Il n'y a **plus rien à attribuer** : dès qu'une personne a un compte sur le
  serveur, elle **voit et publie tous les projets** de ce serveur (décision
  2026-09) ; seul le rôle `standard` reste en lecture seule.
- **Qui fait quoi** : Pilot s'occupe du **suivi partagé** et des opérations liées
  au serveur (création du dépôt et push initial lors de « Ajouter ce projet au
  GDS », synchronisation à l'ouverture d'un projet connecté). **Publier votre
  code reste votre geste** : vos commits ne partent pas tout seuls — poussez votre
  branche vers le raccourci `gds` (le bouton **Synchroniser** ne fait que
  rapatrier). Seul un **administrateur** peut redémarrer / arrêter le **service**
  du serveur (la base, elle, continue de tourner).
- **Modifier le serveur (conteneur)** : toute modification du **code** du
  serveur ou d'un fichier du conteneur (`Dockerfile`, `entrypoint.sh`,
  `sshd_config`, `supervisord.conf`) demande de **reconstruire l'image**
  (`docker compose up -d --build`) **et** de **recréer le conteneur** ; un
  changement de **`.env`** ou de `docker-compose.yml` ne demande qu'une
  **recréation** (`docker compose up -d`). Les **données survivent** dans tous
  les cas : comptes, suivi et dépôts vivent dans des **volumes nommés**
  séparés du conteneur, les migrations sont **rejouées au démarrage**
  (idempotentes) et un administrateur existant n'est **jamais écrasé**. Seul
  `docker compose down -v` **détruit les volumes**. Sauvegarde préalable :
  arrêter le service puis copier les volumes (`docs/gds-server-setup.md` §9).
  **Version automatique** (depuis la racine du projet) : **`npm run gds:reload`**
  enchaîne sauvegarde datée → reconstruction de l'image → recréation du
  conteneur → attente du service, et **`npm run gds:image`** ne fait que la
  reconstruction (le service n'est pas interrompu). Le script **ne supprime
  jamais** les volumes, **refuse** tout argument destructeur et ne recharge rien
  si la sauvegarde échoue. Le recharger reste **votre** décision.
- **Transmettre le serveur à un tiers** : on transmet **l'image** (extraite dans
  un fichier, rechargée sur l'autre machine) avec le fichier de composition, le
  modèle de variables et la notice de licence — le tiers obtient ainsi **son**
  serveur, **vide**. Ne partent **jamais** : le fichier `.env` (vos mots de
  passe), les **volumes** (base : comptes, projets, dépôts git, journal d'audit)
  et vos **sauvegardes** — ils contiennent **vos** comptes et **vos** projets.
  Le destinataire choisit **ses** mots de passe et règle lui-même les ports que
  son poste de travail doit joindre. Deux limites à annoncer : l'image publiée
  ne vaut que pour **une architecture** (`linux/amd64`), et les ports de la
  base et des dépôts doivent être **joignables depuis le poste de travail** —
  sur un serveur Linux distant, c'est Pilot qui prépare la base **à distance**
  et y enregistre sa clef, il n'administre **jamais** la machine.
- **Projet tenu par un autre développeur (travail à plusieurs)** : un seul
  développeur **tient** un projet à la fois. Si un autre le tient, votre écran
  « 🌐 GDS » affiche un **bandeau** : « Ce projet est tenu par un autre
  développeur, **jusqu'à HH:MM** ». Vous pouvez **lire, naviguer, consulter** ;
  en revanche **rien ne peut être publié ni écrit** depuis votre poste (code et
  avancement). Ce n'est pas seulement un message : **Pilot lui-même refuse
  d'enregistrer** un fichier, de le créer, de le supprimer, de le renommer, de
  coller une image, et de **lancer un agent** sur ce projet, en vous disant
  pourquoi. Les boutons qui publient (Activer GDS, Ajouter au GDS, Synchroniser,
  Publier, Retirer du GDS) **vous disent aussi pourquoi ils ne partent pas** au
  lieu de rester sans effet. Un projet **libre** ou **tenu par vous** n'affiche
  **aucun bandeau** et fonctionne comme d'habitude.
- **Sans réseau, rien ne change** : si le mode réseau n'est pas configuré, si le
  serveur GDS ne répond pas ou si vous n'êtes pas connecté, Pilot **écrit
  normalement** — une panne réseau ne vous empêche **jamais** de travailler sur
  votre poste.
- **Votre travail local n'est jamais perdu** : des modifications faites sur votre
  poste **restent** sur votre poste, **rien n'est supprimé ni écrasé**, et elles
  ne peuvent simplement pas être publiées tant que le projet est tenu ailleurs.
  L'écran le **dit** (nombre de fichiers) et propose **« Prendre le projet pour
  publier »** : le projet vous revient, la publication devient possible.
- **Rendre le projet** : quand **vous** tenez le projet, le bouton **« Rendre le
  projet »** publie **le code**, puis l'**avancement**, puis **libère** le projet
  pour le développeur suivant. Si l'une de ces étapes échoue, le projet **reste
  chez vous**, le message dit ce qui a bloqué, et vous pouvez **recommencer** :
  rien n'est perdu.
- **Libérer un projet (administrateur)** : dans « 🖥️ GDS Serveur —
  administration » → **Dépôts / projets**, un **administrateur** seul voit le
  bouton **« Libérer »** ; un **motif est obligatoire** et le geste est **tracé**
  (projet + compte + motif). Le bouton **libère réellement** le projet (il
  redevient libre pour le développeur suivant, aucune donnée n'est supprimée) et
  l'action est inscrite au **journal d'audit du serveur**. Un compte qui n'est
  pas administrateur est **refusé avec sa raison** : l'écran ne prétend jamais
  qu'une libération a eu lieu si elle a échoué.
- **Documentation technique** : installation du serveur en conteneur dans
  `gds-server/README.md` et `docs/gds-server-setup.md` du dépôt Pilot (dont
  **§9 : modifier le serveur — ce qui change pour le conteneur**, preuves
  fichier par fichier, et **§10 : transmettre le serveur à un tiers — image
  seule**) ; **parcours de retest complet** (serveur puis usage à
  plusieurs) dans `docs/gds-guide-mise-en-place.md`.

---

<!-- HELP-TOPIC:commands -->
## Commandes du projet (▶)

Lancez vos commandes de compilation / tests / etc. depuis la ligne
**« Commandes du projet »** du bas de la colonne de gauche (icône **▶
square-terminal**).

- **Ouvrir** : cliquez sur l'icône ▶ → la liste des commandes du **projet courant**
  s'affiche (vide au début).
- **Ajouter** : bouton **Ajouter**, renseignez un **nom**, la **commande** (ex:
  `npm run build`) et éventuellement un **dossier de travail** relatif au projet
  (ex: `web/`). Laissez vide pour partir de la racine du projet.
- **Modifier / Supprimer** : boutons ✏️ / 🗑 sur chaque ligne (la suppression est
  confirmée).
- **Lancer** : cliquez sur une commande → elle se lance dans le dossier configuré dans un **onglet terminal** (titre = nom de la commande), et la **sortie (temps réel)** s'affiche dans cet onglet. La liste des commandes se ferme. Vous pouvez continuer à travailler pendant l'exécution.
- **Relancer** : cliquez à nouveau sur la même commande → Pilot **bascule sur l'onglet déjà ouvert** (sans relancer le process).
- **Fermer** : fermez l'onglet pour **arrêter la commande** (comme un terminal intégré).
- Les commandes sont **propres à chaque projet** (fichier `.pilot/commands.json`,
  versionnable avec le projet).

---

<!-- HELP-TOPIC:agent-pi -->
## Agent Pi (onglet π)

L'onglet **π** intègre l'agent de codage **Pi** (pi.dev) directement dans Pilot :
dialogue avec l'IA, écriture/modification de code, sans quitter l'éditeur.

- **Démarrer** : bouton **Agent Pi** du panneau d'actions, ou onglet π. Pilot
  lance un processus `pi --mode rpc` en arrière-plan. Si vous changez le
  chemin du backend (ex: `plh` → `pi`) ou le répertoire de session dans les
  **Options**, l'agent est automatiquement redémarré à chaud (si l'onglet
  est ouvert) — un message « 🔄 Agent redémarré » confirme le basculement.
- **Poser une question / une tâche** : zone de saisie, `Entrée` pour envoyer
  (`Shift+Entrée` = saut de ligne).
- **Modèle** : sélecteur en haut de l'onglet (provider + modèle). Au
  démarrage, Pilot teste la reachabilité du modèle actif : s'il s'agit d'un
  serveur local éteint (ex: llama-cpp/ollama non lancé), un avertissement
  s'affiche pour éviter qu'un prompt échoue en silence. À l'envoi d'un prompt,
  Pilot vérifie que le modèle actif correspond bien au modèle sélectionné et
  le resynchronise (avec un message) si nécessaire.
- **Niveau de réflexion** : réglable dans ⚙️ (**Niveau de réflexion par défaut**),
  par agent dans l'éditeur 🎭, et pour l'Assistant dans son onglet des Options.
  Seuls les paliers **réellement supportés par le modèle** sont proposés, et le
  niveau demandé est **ajusté** au modèle au lancement : un palier inférieur peut
  être employé (message dans la conversation). Le réglage est **réappliqué quand
  vous changez de modèle en cours de session** (sélecteur ou alias `/…`), avec un
  message si le palier a dû être abaissé. Un modèle incapable de raisonner
  affiche un sélecteur désactivé qui en donne la raison.
- **Mode Orchestration** : à l'activation (bouton 🧠 + modale de test), le
  sélecteur standard est masqué et remplacé par deux sélecteurs (orchestrateur
  🧠 + codeur 🔨), inactifs en affichage. À la désactivation, le sélecteur
  standard réapparaît et le modèle standard est restauré.
- **Erreurs visibles** : si un prompt échoue (serveur LLM injoignable, erreur
  API…), le message d'erreur s'affiche dans la conversation au lieu d'une
  bulle vide sans réponse. Les résultats d'outil en erreur (ex. tool call
  tronqué par la limite de tokens) s'affichent même si les outils sont masqués.
  **Modèle injoignable / retries** : quand pi ne parvient pas à joindre le
  modèle (serveur local éteint, API cloud down), il retente automatiquement
  plusieurs fois. Pilot n'affiche qu'un seul bloc « 🔄 nouvelle tentative (n)… »
  mis à jour (au lieu d'empiler les erreurs), puis, si toutes les tentatives
  échouent, un message **❌ Modèle injoignable après n tentative(s)** avec un
  bouton **🔄 Réessayer** pour relancer votre dernier prompt en un clic.
- **Réponses tronquées** : avec un modèle local qui dépasse la limite de
  tokens de sortie (`stopReason:"length"`), la réponse est coupée en plein
  milieu (souvent un `write` de gros fichier). Pilot détecte la troncation et
  relance automatiquement le modèle pour qu'il reprenne (max 2), au lieu de
  rester silencieux. Vous voyez « ✂️ Réponse tronquée… Relance automatique… ».
- **Boucle dans la réflexion** : si le modèle se met à répéter à l'identique le
  même bloc de texte (réflexion qui tourne en boucle, plusieurs lignes), Pilot
  détecte la boucle sur les dernières lignes streamées, **arrête l'agent** puis
  le relance automatiquement avec une demande de correction (« tu tournes en
  boucle, corrige-toi »), max 2 fois. Vous voyez « 🔁 Boucle détectée dans la
  réflexion… » puis « ✍️ Reprise de l'agent avec correction… ». Ce comportement
  s'applique aussi aux sous-agents (H2) ; le **Mode Orchestration** est exclu.
- **Nouvelle conversation** : bouton ➕ (new session). **Reprendre une session** :
  commande `/resume` liste les sessions enregistrées pour le projet courant.
- **Prompt Builder** : clic-droit sur un fichier/dossier de l'explorateur →
  « Ajouter au prompt » pour l'envoyer comme contexte à l'agent.
- **Interrompre** : bouton ⏹️. **Stats tokens/coût** affichées en haut.
- **Boutons de choix / confirmation** : quand l'agent a besoin d'un choix, d'une
  confirmation ou d'une saisie, il affiche des **boutons cliquables directement
  dans le chat** (choix unique, cases à cocher pour plusieurs choix, Oui/Non,
  champ texte) — cliquez pour répondre sans taper. Un **champ de texte optionnel**
  permet d'ajouter une **précision** à votre réponse (choix unique, cases à
  cocher ou confirmation Oui/Non) : si vous la remplissez, elle est envoyée à
  l'agent avec votre choix ou votre confirmation. Vous pouvez aussi **valider
  sans rien saisir**, **ou saisir une précision et valider sans cocher d'option**
  (bouton **✓ Valider**).
- **Notification de fin** : réglable dans **Options ⚙️ → onglet « Agent »**
  via « Notifier quand l'agent a terminé (tâche locale) » — envoie une
  **notification native Windows/OS** à la fin d'une tâche, y compris pour un chat
  local (pas seulement à distance).
- **Quality-gate** (bouton 🛡️) : active un protocole anti-régression embarqué
  (vérifie que les modifications ne cassent aucune fonctionnalité existante).
- **Notifications Telegram** (Options ⚙️ → onglet **Agent**) : recevez les
  avis de Pilot (fin de tâche d'un agent, anomalie, arrêt automatique d'une
  session) sur **Telegram**, même loin de l'ordinateur. Désactivé par défaut :
  tant que l'interrupteur est décoché ou qu'un champ est vide, rien n'est
  envoyé et aucune erreur ne s'affiche. La **réception** des messages Telegram
  n'est **pas encore prise en charge**. Voir la section « Notifications
  Telegram » de cette aide.
- **Outils navigateur** : les sessions d'agents lancées par Pilot disposent des
  outils Chrome (`chrome_*`) du module navigateur lorsqu'il est installé — le
  correctif ne prend effet qu'après un **redémarrage de Pilot** (et un redémarrage
  des agents en cours).

L'agent a accès aux fichiers du projet courant (lecture/écriture).

---

<!-- HELP-TOPIC:orchestration -->
## Mode Orchestration

Le **Mode Orchestration** (onglet π, activable dans les Options ⚙️) fait
travailler ensemble deux IA :
- un **orchestrateur** (cloud) qui découpe la demande en micro-tâches et valide
  chaque étape,
- un **codeur** (local, agent Pi) qui exécute chaque micro-tâche sur le projet.

- Activer dans **Options ⚙️ → Agent Pi → Mode Orchestration**, choisir les
  modèles orchestrateur et codeur, la granularité des tâches.
- Pose ta demande dans l'onglet π : l'orchestrateur produit un **plan** (panneau
  dédié), puis les tâches s'exécutent l'une après l'autre, avec validation et
  linting entre chaque étape.
- Idéal pour les grosses refontes : édition chirurgicale `SEARCH/REPLACE`,
  boucles de révision automatiques, directive globale.
- **Journal des tentatives** : pour la tâche en cours, un bloc repliable
  « 📋 Journal des tentatives » affiche chaque tentative du codeur (marqueur,
  raison, durée, fichiers modifiés) et détecte les réponses en boucle. Clic sur
  une entrée pour voir l'extrait de la réponse et les erreurs de linting.
- **Auto-test post-modification (E2)** : option « 🧪 Auto-test » dans les
  Options → Mode Orchestration. Si activée, après chaque tâche du codeur,
  Pilot exécute les tests du projet (`npm test` / `cargo test` / `pytest` /
  `go test`) au lieu de ne valider que la syntaxe. Les échecs déclenchent une
  boucle de correction locale (SELF_FIX). Une baseline mémorise les tests déjà
  rouges au démarrage pour ne signaler que les régressions introduites. Opt-in,
  portée ciblée par défaut, override manuel possible.
- **Annulation de tâche (A1)** : bouton « ↩️ Annuler la dernière tâche » dans le
  panneau d'orchestration. Pilot capture un snapshot Git avant chaque tâche
  (`git stash create -u`, sans toucher au working tree). L'annulation restaure
  les fichiers modifiés à leur état d'avant la tâche (les fichiers créés par la
  tâche sont supprimés). Défaut activé ; désactivé gracieusement si le projet
  n'est pas un repo Git.
- **Nudge après réflexion** : si le codeur local s'arrête après la Phase 1
  (Réflexion) sans modifier de fichiers, il est relancé automatiquement dans la
  même session vers la Phase 2 (max 2 relances par tâche), pour éviter une
  escalade cloud systématique.
- **Granularité atomique** : 4e niveau de finesse (atomic / fine / medium /
  large), conçu pour les modèles locaux (7B/8B). Tâches triviales d'une ligne,
  1 fichier, 1 seul changement — le codeur applique scrupuleusement.
- **Reviewer à l'activation** : l'écran d'activation permet de choisir la
  granularité et d'activer/sélectionner le reviewer pour la session (overrides
  non persistés).

---

<!-- HELP-TOPIC:web-remote -->
## Accès distant (mode remote)

Pilot peut exposer une **interface web distante** pour consulter le travail,
discuter avec l'agent et dicter du texte depuis un téléphone ou un autre poste,
via le réseau privé **Tailscale** (WireGuard chiffré).

- **Activer** : Options ⚙️ → « Accès distant » → activer l'accès web, définir
  un **mot de passe distant** (hashé argon2).
- **Adresse d'écoute** : `127.0.0.1` par défaut. Pour un accès HTTP direct sur
  le mesh, élargir à l'IP Tailscale (mais préférer Tailscale Serve, ci-dessous).
- **HTTPS automatique (Tailscale Serve)** : cocher « Exposer en HTTPS
  automatique » → Pilot configure le proxy HTTPS 443 → `127.0.0.1:port`,
  affiche l'**URL** `https://<nom-magicdns>.ts.net/` et un **QR code** à scanner.
  Le proxy se **resynchronise tout seul** quand tu changes de port.
  ⚠️ exige « Adresse d'écoute » = `127.0.0.1`.
- **Connexion** : depuis l'autre appareil (Tailscale installé), scanner le QR
  code ou ouvrir l'URL, se logger avec le mot de passe.
- **Lecture seule** : option « mode lecture seule » (consultation sans
  modification). **Keep-alive (tray)** : garder le serveur + l'agent pi actifs en
  arrière-plan après fermeture de la fenêtre.
- **Notification de fin de tâche** : quand tu lances une tâche depuis le téléphone,
  le desktop émet une **notification native** « Agent terminé » à la fin de la
  réponse (permission demandée au 1er lancement). Pratique pour les tâches longues
  lancées à distance pendant que tu fais autre chose sur le desktop.
- **Prompt Builder (🧩)** : onglet « 🧩 Prompt » pour construire un prompt à partir
  de fichiers du projet. Ajoute des fichiers via le bouton **＋** dans l'onglet
  Fichiers, saisis des instructions (ou choisis un template), puis **Assembler**
  pour prévisualiser, **Envoyer à l'agent** (bascule sur le Chat) ou **Sauvegarder
  .md** à la racine du projet.
- **🧭 Mode Assistant** : en haut, un sélecteur **« 🧭 Assistant » / « 🤖 Agents »**
  choisit avec quoi discuter. **« Assistant »** (défaut) affiche une interface
  **minimaliste** pour parler à l'Assistant de suivi multi-projets (lecture
  seule, **aucun projet à ouvrir**) : il peut déléguer des tâches aux agents des
  projets et répondre sur leur état. **« Agents »** restitue l'interface complète
  (agent du projet, fichiers, projets, commandes, Prompt Builder). Le mode choisi
  est mémorisé côté serveur (cohérent sur tous vos appareils).
- **Dictée vocale 🎙️** : comme sur le bureau, **le message part tout seul à la fin
  d'une dictée** (rien ne part si tu n'as rien dicté, si la dictée s'arrête sur une
  erreur, ou si tu as tapé dans la zone pendant que tu dictais : ta saisie est
  respectée). Exige HTTPS (Tailscale Serve). Arrêter la dictée en réappuyant sur
  🎙️ n'envoie jamais le message.

---

<!-- HELP-TOPIC:dictee-vocale -->
## Dictée vocale 🎙️

Pilot intègre la dictée vocale (Web Speech API, langue `fr-FR`) pour saisir du
texte à la voix.

- **Dans l'éditeur / l'agent Pi (desktop)** : bouton 🎙️. Fonctionne en contexte
  sécurisé (HTTPS ou `localhost`).
- **Sur le web distant** : le micro exige **HTTPS** (Secure Context). Cocher
  « Exposer en HTTPS automatique (Tailscale Serve) » dans les Options →
  Accès distant, puis utiliser le bouton 🎙️ depuis le téléphone/autre poste.
- La transcription alimente directement la zone de saisie active (éditeur ou
  saisie de l'agent, ou saisie de l'Assistant 🧭).
- **Dans l'onglet agent Pi, dans l'Assistant 🧭 ET sur le web distant, à la fin
  d'une dictée, le message part tout seul** (comme si vous aviez appuyé sur
  Entrée) : vous n'avez plus à valider. Rien ne part si vous n'avez rien dicté, ni
  si la dictée s'arrête sur une erreur (micro refusé, réseau coupé) : dans ce cas
  le texte reste dans la zone, à vous de le relire. Un seul message part par
  dictée, même si vous parlez longtemps.
- **Vous gardez toujours la main** : si vous tapez dans la zone pendant que vous
  dictez, ce que vous écrivez n'est pas écrasé et rien ne part sans votre
  validation — sur le bureau comme sur le web distant.
- Arrêter la dictée en réappuyant sur 🎙️ n'envoie jamais le message : c'est vous
  qui décidez.
- **Dans l'écran Vocal, aucun bouton à toucher** : parler suffit. La dictée
  s'ouvre toute seule quand Pilot se tait, se ferme pendant qu'il parle ou qu'il
  travaille, et se rouvre à la fin de sa réponse — le texte part tout seul, comme
  ci-dessus, **après votre dernier mot** (chaque nouveau mot repousse l'échéance,
  donc rien ne part tant que vous parlez). **L'écoute repart d'elle-même après
  chaque réponse** : si Pilot finit à peine sa phrase ou si le micro se libère un
  instant plus tard, elle réessaie quelques instants (jamais indéfiniment) au lieu
  de rester fermée — le rond « Réveiller … » n'est donc qu'un **secours**. **Un
  silence n'arrête rien** : quand
  vous vous taisez un moment, l'écoute se referme et **se rouvre toute seule**,
  sans message d'échec — vous reprenez la parole quand vous voulez. Ce **délai
  d'envoi** (deux secondes
  par défaut) se règle dans ⚙️ Options → onglet **« Assistant »** → section
  **« Mode Vocal »**, de **1 à 5 secondes**. Un appui
  sur 🎙️ arrête la dictée et elle ne se rouvre pas contre
  votre volonté. En quittant le mode Vocal, le micro est coupé. Sur un **projet
  sensible** (dictée cloud), l'écran Vocal ne dicte pas. Si la dictée ne peut pas
  démarrer (micro refusé, occupé, réseau absent), la phrase s'affiche **dans la
  ligne d'état de l'écran** et vous continuez au clavier.

---

<!-- HELP-TOPIC:vocal-colonnes-portrait -->
### Les colonnes de l'écran Vocal, la discussion, les tâches et le portrait
Sur un écran assez large, l'écran Vocal encadre le cercle de **deux colonnes** : la
**discussion** à gauche, le **travail** à droite. Sous une certaine largeur (fenêtre
étroite), les colonnes **n'apparaissent pas du tout** : le cercle reste seul au milieu,
jamais écrasé, jamais décalé.

La colonne de **gauche** montre **ce qui vient d'être dit**, sous le titre
**« DISCUSSION »** : vos **questions** en petit et en gris (deux lignes au plus), les
**réponses** en plus grand (huit lignes au plus), du plus ancien en haut au plus récent
en bas, **collés au bas** de la colonne. **On distingue les deux voix d'un coup d'œil** :
vos questions sont **à droite**, dans une **bulle légèrement teintée** qui suit les
couleurs de votre thème, et les réponses de **Pilot** sont **à gauche**, en pleine largeur
et sans fond. C'est un **aperçu**, pas la conversation : elle
reste **entière dans l'onglet de l'agent**, prête à être relue en quittant le mode. Le
texte s'efface **par le haut**, vers le titre, et quand il y a plus ancien que ce qui
tient, la ligne **« … et N échange(s) plus haut »** le dit franchement. Rien n'est
cliquable dans la colonne : on la lit, on ne la manipule pas.

La colonne de droite parle du **travail** : le titre **« TÂCHES »**, puis la **liste des
tâches en cours** — l'agent et le projet, puis ce qu'il fait. Rien n'est écrit sous la
liste. Les tâches sont rangées en **« En cours »** d'abord, **« En attente »** ensuite. La
liste **ne défile pas** : elle montre ce que la hauteur permet (jusqu'à **8** tâches) et,
s'il y en a plus, la ligne **« + N autre(s) »** le dit — la liste complète reste dans le
bouton **« Travail »**. Aucune tâche en cours ? La colonne affiche « **Aucune tâche en
cours** », jamais du vide. La colonne s'arrête **avant le cercle** : elle ne le chevauche
jamais, même avec un titre très long.

Le **portrait du personnage** est **en haut à droite de l'écran**, dans cette colonne, **au-dessus**
de la liste et **détaché d'elle** : un médaillon rond **d'au moins 96 px**, qui **grandit avec la
place disponible** — jusqu'à trois fois sa taille de départ dans une grande fenêtre, jamais au
point de manger les tâches —, et son **nom** est écrit **juste
dessous**, sur
une seule ligne — le nom du personnage, à défaut celui de votre assistant, jamais les deux. On
voit donc toujours à qui l'on parle. Pas de personnage déposé par le projet **Présences** ?
Il n'y a **aucune image de remplacement**, pas même le logo Pilot : la zone laisse alors la
place à la fenêtre du visage de l'avatar, ou à rien du tout. Le portrait suit un éventuel
changement de personnage sans redémarrer Pilot. **Le cercle, lui, ne porte ni image ni nom.**

Les deux colonnes sont des **panneaux de verre** : on voit la lumière de l'écran au travers, et
eux-mêmes n'affichent jamais la conversation ni le contenu d'une autre fenêtre. Elles laissent
**de l'air** entre leur contenu et leur bord — le dernier message et la dernière tâche
s'arrêtent avant le trait, le médaillon ne touche pas le haut —, ce qui se lit comme une marge,
jamais comme une ligne coupée.

Le bas de l'écran — la **barre de saisie** et ses boutons — **s'efface au repos** et revient
au moindre mouvement de la souris, puis **s'efface de nouveau après quelques secondes**
d'immobilité — **même si le pointeur est resté posé dans le bas de l'écran** : c'est le
geste qui le rappelle, pas la position du curseur, sinon la barre ne partirait plus jamais.
Elle ne s'efface **jamais** pendant que tout est masqué : ce qui reste à l'écran doit rester
utilisable, ni pendant que vous écrivez ou dictez, ni pendant que Pilot vous écoute ou vous
répond, ni tant qu'une question attend votre réponse.

Rien de tout cela ne se règle et rien n'est mémorisé : la largeur des colonnes est
recalculée à chaque ouverture de l'écran et à chaque redimensionnement de la fenêtre. Les
colonnes ne captent **aucun clic** : les boutons de sortie et la barre de saisie restent
les seuls endroits cliquables de l'écran.

**Tout masquer d'un geste, tout remettre du même geste.** Le **bouton-œil** décrit plus
haut (« Trois modes d'écran ») emporte aussi **les deux colonnes** : un clic les range,
un clic les remet, sans un pixel de déplacement — l'espace reste réservé, **le portrait
et son nom ne bougent pas**, et **le cercle reste allumé, identique à lui-même** : c'est
lui qui dit encore si Pilot écoute, réfléchit ou répond. Le **cadre et le fond** de la
colonne des tâches s'effacent avec elle : il ne reste pas un rectangle vide autour du
personnage. La **barre de saisie**, elle, n'est pas concernée :
elle reste affichée et utilisable, même quand tout le reste est masqué. Aucune mémoire :
on entre **toujours** avec tout visible.

---

<!-- HELP-TOPIC:pdf -->
## PDF : conversion en Markdown et export

- **Conversion PDF → Markdown** : dans l'explorateur (barre latérale),
  **clic-droit sur un fichier `.pdf`** → « 📝 Créer un fichier Markdown ».
  Pilot extrait le texte du PDF puis le fait restructurer en Markdown propre par
  l'IA (agent Pi). Le fichier `.md` est créé à côté du PDF et s'ouvre dans un
  onglet. Modèle utilisé : Options ⚙️ → « Modèle de conversion PDF → MD ».
- **Export PDF** : dans l'explorateur, **clic-droit sur un fichier `.md`** →
  « 📕 Exporter en PDF ». Génère un PDF rendu de la prévisualisation Markdown.

---

<!-- HELP-TOPIC:context-engine -->
## Context Engine (auto-contexte agent)

Pilot injecte **automatiquement** un contexte projet avant le 1er prompt de chaque
session agent (chat standard) : `.pilot/context.md`, fichier actif, imports, manifestes,
specs référencées dans AGENTS.md, fichiers récemment édités — dans un budget de tokens configurable.

> `AGENTS.md` lui-même n'est pas réinjecté par Pilot : pi et plh le découvrent
> nativement. Le Context Engine l'utilise seulement comme index pour charger les
> specs qu'il référence.

- **Activation** : Options → section « Context Engine ». Désactivable.
- **Budget** : par défaut 8000 tokens (réglable 1000–32000).
- **Bouton 📑 Contexte** (toolbar agent) : force la ré-injection au prochain
  envoi (utile après avoir changé de fichier actif ou édité `AGENTS.md`).
- **Une fois par session** : le contexte est réinjecté automatiquement après un
  nouveau chat (➕), une compaction (📦), une reconnexion (🔄) ou un changement
  de projet.
- **Après une compaction** : juste avant de résumer l'historique, Pilot enregistre
  (puis vous réinjecte) un **état de travail** court — tâche en cours, dernière
  demande, dernière réponse — pour que l'agent ne perde pas le fil de ce qu'il
  faisait quand l'historique est coupé.
- **`.pilot/context.md`** : déposez un fichier contextuel à la racine du projet
  pour ajouter vos propres instructions permanentes (conventions, pièges à
  éviter) — il est injecté en priorité juste après `.pilot/context.md`.
- **RAG local (V2, optionnel)** : section **Options → RAG (Context Engine V2)**
  — activez le RAG, saisissez l'**adresse Ollama** (`http://127.0.0.1:11434`) et
  le **modèle d'embedding** (`nomic-embed-text`), puis « Tester la connexion ».
  Pilot indexe alors le projet en vecteurs et sélectionne les passages les plus
  pertinents par similarité sémantique au prompt (plus précis que l'heuristique
  V1). L'index SQLite est stocké dans `.pilot/context-index.db` et se met à jour
  incrémentalement. Le bouton 📑 force un rebuild complet. Sans Ollama, Pilot
  retombe automatiquement sur V1. Le chat ne fige jamais si Ollama est
  éteint ou lent : des timeouts bornent l'attente et le prompt part sans
  contexte au besoin. À la **première génération** de l'index **ou** au clic sur
  le bouton 📑 « Contexte » (rebuild RAG), un **spinner circulaire au centre de
  l'écran** s'affiche avec le texte « Construction de l'index RAG en cours… »
  en dessous, et disparaît quand l'index est prêt.

---

<!-- HELP-TOPIC:code-graph -->
` | Ajouté ici + regénérer handbook |

### Points de connexion à ne pas casser (l'existant à préserver)
- L'injection H1 (Context Engine) et H3 (mémoire) existantes — le graphe s'ajoute
  **en plus** dans le même `handoffBlocks`, ne remplace rien.
- La SQLite RAG (`chunks` / `meta`) — on **ajoute** des tables, on ne touche pas
  aux existantes.
- `pilot-context.ts` — inchangé (le bloc graphe arrive déjà dans
  `context-inject.md`).
- `project-memory.js`, `context-engine.js` — intacts.

---

## 10. Tests (qualité)

- **Rust (cargo test)** : tests unitaires sur les fonctions pures de `code_graph.rs`
  — extraction V1 (fixtures JS/Python/Rust/Markdown), build/upsert, incremental
  refresh (mtime/hash), requêtes (`explain`, `affected`, `path`, `query` scoring).
- **JS (Vitest)** : formateur Markdown du bloc graphe, construction du wiki,
  logique de config.
- **Anti-régression** : `cargo test --lib` + `npm test` avant merge.

---

## 11. Roadmap d'implémentation

1. ✅ **V1** : `code_graph.rs` extraction heuristique + SQLite + requêtes + commandes
   Tauri + config + injection mode A + wiki mode B + bouton/modale + tests.
2. ✅ **V2** : intégration tree-sitter (dépendances + `extract_v2`) + pass 2
   call-graph + switch `graph_extraction`.
3. ✅ **V2.1** : branchement watcher pour refresh différé auto
   (`refresh_by_watcher` + `is_graph_file` + verrou `GRAPH_DB_LOCK`).
4. ✅ **Option C** : onglet « Graphe » dédié (remplace la modale) + visualisation
   2D interactive `force-graph` (pan/zoom, clic nœud → ouvre fichier, survol,
   coloration, filtres, sous-graphe contextuel) + commande Rust `graph_export`.
5. Doc : AGENTS.md, README, bloc HELP, plan_dev.md.

---

<!-- HELP:code-graph -->
## Code Graph (graphe de connaissances projet)

Pilot construit localement un **graphe structurel** du projet (fichiers, fonctions,
classes, imports, appels) **sans LLM ni clé API**, et l'injecte à l'agent pour qu'il
réponde aux questions d'architecture **sans relire les fichiers** (économie de tokens).

- **Bouton 📊 Graphe** (panneau d'actions projet, en bas à gauche) : ouvre un
  **onglet « Graphe »** dédié. En haut : état du graphe + boutons
  « (Re)construire » / « Actualiser ». En dessous : **visualisation 2D interactive**
  (pan/zoom, clic sur un nœud → ouvre le fichier, survol → surligne les connexions,
  coloration par type, filtres par relation/fichier/recherche, sous-graphe du
  fichier actif en option).
- **Options → Code Graph** :
  - *Activer le graphe* : master switch.
  - *Moteur d'extraction* : `heuristique` (rapide, sans dépendance) ou
    `tree-sitter` (plus précis, V2). Un rebuild est requis après changement.
  - *Inclure les appels de fonctions* : inclut ou non les arêtes `calls`.
    Désactiver allège le sous-graphe injecté (économie de tokens) ; un rebuild
    est requis.
  - *Injection au 1er prompt* (mode A) : un sous-graphe pertinent au prompt est
    ajouté au contexte (budget configurable).
  - *Wiki interrogeable* (mode B) : un dossier `.pilot/graph-wiki/` est généré ;
    l'agent peut le consulter à la demande via ses outils.
- **Relations honnêtes** : chaque lien est marqué `EXTRACTED` (lu dans le code) ou
  `INFERRED` (déduit).
- **Mise à jour au fil de l'eau** : le graphe se re-synchronise automatiquement sur
  les fichiers modifiés (incrémental à la requête + refresh auto via le watcher de
  fichiers). Il ne bloque jamais le chat et fonctionne sans Ollama (contrairement au RAG).
- **Retour visuel pendant la (re)construction** : un **sablier animé** + la
  **progression** (fichiers traités / total) s'affichent dans l'onglet Graphe pendant
  un rebuild, via l'événement `graph-build-progress` émis par le backend.
- **Liaisons toujours visibles** : sur les gros graphes, les étiquettes des nœuds ne
  s'affichent qu'**en zoomant** (seuil `globalScale ≥ 1.5`) — dézoomé, seuls les
  cercles colorés sont dessinés, ce qui laisse les liaisons apparentes (les fonds de
  libellés semi-opaques les masquaient auparavant). La relation `contains` a sa
  propre couleur.
- **Liens inter-fichiers (vue « par fichier »)** : les imports relatifs sont résolus
  vers les fichiers réels du projet (`resolve_import_target` + `add_cross_file_imports`)
  → des arêtes `imports` **fichier → fichier cible** sont créées. Sans cela, toutes les
  arêtes étaient intra-fichier et la vue « par fichier » ne montrait aucun lien.
- **Labels d'import corrects** : les nœuds import portent le **nom du module** (dernier
  segment sans extension, ex: `rpc-client` pour `../src/modes/rpc/rpc-client.ts`) via
  `import_label` — l'ancien `short_name` coupait sur le dernier `.` et donnait `ts`.
- **Clic sur un nœud** : un **clic simple ouvre le fichier** dans un onglet d'édition
  (le double-clic a été supprimé).

---

<!-- HELP-TOPIC:diff-review -->
## Porte pré-écriture (confirmer les modifications de l'agent)

Par défaut, l'agent Pi modifie les fichiers librement. Activez **Options →
« Porte pré-écriture : confirmer les modifications de fichiers »** pour qu'avant
chaque `write`/`edit`, Pilot affiche un **diff (avant/après)** et vous demande :

- **✓ Accepter** : l'outil s'exécute, le fichier est modifié.
- **✗ Refuser** : l'outil est bloqué, le fichier **n'est pas touché**.

Le diff est calculé avant l'écriture (le fichier est intact pendant la décision).
En **Mode Orchestration**, la confirmation est automatique (le codeur est
autonome). Le changement du paramètre relance l'agent à chaud (session préservée).

---

<!-- HELP-TOPIC:project-memory -->
### 📝 Mémoire de projet (H3)

Pilot maintient un fichier `PROJECT_MEMORY.md` à la racine du projet, enrichi
par l'agent (conventions, pièges, décisions) et injecté automatiquement dans le
contexte de l'agent.

- **Bouton 📝** (toolbar agent) : ouvre/édite `PROJECT_MEMORY.md` (créé avec un
  template s'il n'existe pas). Éditable manuellement.
- **Options → Agent Pi ou PLh** :
  - *Mémoire de projet* : active l'injection du fichier avant chaque tâche
    (orchestration) et avant le 1er prompt d'une session (chat).
  - *Extraction auto* : après chaque tâche d'orchestration réussie, l'agent
    extrait 1–3 faits appris et les ajoute au fichier (1 tour LLM
    supplémentaire ; opt-in).
- Le fichier est git-committable : la mémoire devient partagée entre
  collaborateurs et machines.

---

<!-- HELP-TOPIC:review -->
## 🔍 Onglet Review (revue de code assistée)

L'onglet **🔍 Review** (bouton 🔍 dans la barre d'action, visible quand un projet
est ouvert) fait jouer à l'agent le rôle de **second reviewer** sur ton diff Git.

**Démarrage** :
1. Clique 🔍 → ouvre l'onglet Review.
2. Choisis la **portée** : « Modifs non commitées (vs HEAD) » ou « Dernier
   commit (HEAD~1..HEAD) ».
3. Choisis un **modèle** (comme pour l'aide ; se souvient du choix).
4. Clique **🔍 Lancer la revue**.

L'agent analyse le diff et produit une revue structurée : 🟢 points positifs,
🔴 bugs, ⚠️ sécurité, ⚡ perfs, 🎨 style, 📐 cohérence specs, 💡 suggestions.

**Questions de suivi** : tape dans la zone en bas (ex: « approfondis la sécurité
du fichier `lib.rs` ») + Entrée. L'historique est réinjecté à chaque tour.

**Points clés** :
- **Lecture seule** : l'agent ne modifie jamais tes fichiers (process pi isolé,
  n'accède pas au projet).
- **Diff Git uniquement** : pas de revue sur des fichiers non versionnés.
- **Repo Git requis** : ouvre un projet versionné, sinon message d'erreur.
- Si le diff est très grand, il est tronqué à 60 k caractères — passe en « dernier
  commit » ou committe par morceaux pour une revue complète.

Voir [`spec_review.md`](spec_review.md) pour le détail technique.

---

<!-- HELP-TOPIC:orchestration -->
### Reviewer indépendant (H2 V1)

- **Opt-in** (Options → Orchestration → Reviewer). Un second agent relit le diff
  de chaque tâche (ou seulement les fichiers sensibles en mode « critical ») avec
  un contexte vierge et répond `APPROVED` ou `CHANGES_REQUESTED`.
- Désactivé par défaut (coûte un tour cloud par tâche). Modèle reviewer configurable
  (défaut = modèle orchestrateur).
- Les corrections demandées par le reviewer sont renvoyées au codeur et partagent le
  même budget que lint/tests (`maxCorrections`).
- En cas d'indisponibilité du reviewer (crash/timeout), la tâche est validée sans
  relecture (non-bloquant).

---

<!-- HELP-TOPIC:session-history -->
## Historique des sessions (onglet 📜)

L'onglet **📜** indexe **toutes** vos sessions agent (passées et nouvelles)
pour retrouver une décision, un prompt ou les fichiers touchés par une
session.

- **Ouvrir** : bouton 📜 du panneau d'actions. Au premier ouvrage d'un projet,
  Pilot réindexe automatiquement vos sessions pi existantes (toast discret).
- **Rechercher** : tapez dans le champ de recherche (full-text sur le prompt,
  le résumé et les fichiers touchés). Filtres : tags, fichier (chemin relatif),
  type (chat / orchestration).
- **Consulter** : cliquez une entrée pour afficher le détail complet de la
  session (messages + tool calls, lecture seule).
- **Tags** : ajoutez des tags à une session (chips + autocomplétion) pour la
  retrouver plus tard (ex: `architecture`, `bug`, `refactor`).
- **Réindexer** : bouton 🔄 pour reconstruire l'index depuis le dossier de
  sessions pi (utile après des sessions hors Pilot, ou si l'index est
  désynchronisé).
- **Confidentialité** : l'index est local (`.pilot/sessions.jsonl`), jamais
  envoyé au cloud ni au web distant. Il contient vos prompts : ajoutez
  `.pilot/sessions.jsonl` au `.gitignore` si vous ne voulez pas le committer.
- **Purge automatique** : les sessions pi plus anciennes que le délai de
  rétention configuré (défaut 15 jours) sont supprimées automatiquement en
  arrière-plan. Réglez ce délai dans **Options ⚙️ → Agent Pi → Rétention
des sessions (jours)** (0 = désactivé).

---

<!-- HELP-TOPIC:agents -->
## Aide utilisateur — Agents

L'onglet **🎭 Agents** sert à **configurer l'équipe d'agents** et à **suivre** ce qu'elle fait. Pour lancer une tâche, utilisez l'onglet **🧭 Assistant** (ou la discussion d'un agent).

### L'écran
- **Colonne de gauche : l'équipe.** Chaque carte montre le nom, l'identifiant, les **modèles demandés** (`π` = pi, `ℓ` = plh ; « non réglé » si le champ est vide), et des badges : **lecture seule** et le **nombre de compétences**. Le **niveau de réflexion demandé** (`π` / `ℓ`) est affiché sur la carte dès qu'un niveau est réglé.
  - Attention : les modèles affichés sont **demandés**, pas **employés**. Au démarrage d'une session, Pilot applique le modèle du **backend actif**, sinon celui de l'**autre backend** (repli croisé), sinon le **modèle par défaut** du registre de modèles — et une session **déjà lancée** garde le modèle qu'elle utilise (modifier la carte ne la change pas). L'infobulle de la carte le rappelle.
- **Colonne de droite : l'activité.** Tableau de bord des runs en cours : qui travaille, sur quel outil, la **chaîne des appels**, le **budget restant** et la **profondeur**. L'agent en cours est surligné. Le bilan reste visible après la fin de la run.
  - **Un agent qui travaille sans onglet ouvert** (lancé en arrière-plan, ou dont vous avez fermé l'onglet) y apparaît quand même, dans un bloc **« Travail en arrière-plan (aucun onglet ouvert) »** : nom de l'agent, projet et tâche en cours. Ce bloc est purement informatif : **aucun onglet ne s'ouvre** tout seul.
- **➕ Ajouter** crée un agent ; **✏️ Modifier** ouvre l'éditeur ; **🗑️ Supprimer** retire un agent.
- **🔄 Réinitialiser** restaure les **7 agents fournis** (coordinateur, architecte, codeur, reviewer, testeur, documenteur, plan-maker). **Vos agents personnalisés sont conservés.**

### Créer / modifier un agent
- L'éditeur s'ouvre dans une **fenêtre large** organisée en **deux colonnes** : à gauche l'**identité** et les **modèles**, à droite le **rôle**, les **compétences** et les **garde-fous**. Le champ **Rôle** est haut et **redimensionnable verticalement**. Sur une fenêtre étroite, les deux colonnes se replient en **une seule** (rien n'est coupé) et la fenêtre défile si la hauteur manque.
- **ID** : identifiant machine en kebab-case, non modifiable après création. Un identifiant fourni par Pilot (ex. `codeur`) est refusé à la création : la réinitialisation écraserait cet agent.
- **Nom, icône, description, rôle** : la **description** sert au coordinateur pour router les tâches ; le **rôle** est le prompt système de l'agent.
- **Modèles** : modèle `π` (pi) et `ℓ` (plh) séparés ; « Modèle par défaut » laisse Pilot choisir. Ce réglage est une **intention** pour les sessions à venir (cf. l'encadré ci-dessus) : il n'est pas réappliqué à une session en cours.
- **Niveau de réflexion (`π` / `ℓ`)** : combien le modèle réfléchit avant de répondre (Désactivé → Maximal). Le menu ne propose que les paliers **réellement supportés** par le modèle ; « Non réglé » suit le réglage général de Pilot. Un modèle incapable de raisonner (ex. `llama-cpp`) affiche un sélecteur **désactivé** avec la raison. Au lancement, le niveau est **ajusté** aux capacités du modèle (jamais un palier supérieur).
- **Lecture seule** : consigne stricte de ne pas écrire de fichiers. **Garder le contexte** : la session n'est pas remise à zéro entre deux appels.
- **Max appels / run** et **Profondeur max** : garde-fous propres à l'agent.

### Compétences par agent
- Les compétences (skills) forment une **bibliothèque commune** dans `~/.pilot/skills/` : un dossier par compétence, contenant un fichier `SKILL.md`.
- Cochez dans l'éditeur les compétences que **cet** agent peut voir. Un agent ne voit **que** les compétences cochées (filtrage strict) — plus la compétence `quality-gate`, jamais filtrée.
- Compétence absente de la liste mais déjà cochée = dossier introuvable dans `~/.pilot/skills` : elle reste affichée pour ne pas disparaître sans que vous le sachiez.
- Pour en ajouter une : créez le dossier `<nom>/SKILL.md` dans `~/.pilot/skills`, puis rouvrez l'éditeur de l'agent.

### Poser une question : elle vous revient toujours
- Un agent **peut poser une question** (choix d'une approche, confirmation, saisie) : c'est souvent indispensable, et la question **remonte jusqu'à vous**. Elle s'affiche dans la conversation de l'**Assistant**, avec ses options, et **vous** y répondez (champ de précision optionnel).
- Cela vaut **aussi pour les agents lancés en arrière-plan** par l'Assistant, même si vous n'êtes pas sur l'onglet 🧭 : la question est relayée de la même façon, et elle est **signalée** dans le suivi. **Aucune réponse n'est décidée à votre place** (ni approbation, ni première option, ni annulation).
- Si vous ne répondez pas, la demande **reste en attente** : la limite d'attente de **45 minutes** déjà en place évite qu'elle bloque la file indéfiniment. Aucune réponse de repli n'est inventée.
- Les **demandes internes** (validation d'écriture, action Pilot, contrôle de l'écran) gardent leur propre dialogue et ne sont jamais tranchées automatiquement.

### Suivre et arrêter
- Une tâche lancée sur un agent **peut en appeler un autre** : Pilot relaie le résultat à l'appelant, un seul agent travaille à la fois (hors sous-tâches parallèles).
- **Détection de cycle** : un agent déjà dans la chaîne ne peut pas être rappelé.
- **Consulter n'est jamais une boucle** : relire `git status`, `git diff`, `git log`, `ls`, `grep`/`rg`, `sed -n`… entre deux corrections est un travail normal — ces lectures **ne déclenchent aucun arrêt**, quel que soit l'écran d'où la tâche a été lancée (onglet d'agent, bus d'agents, Assistant). Seules les **modifications** (écriture d'un fichier, commande qui écrit ou exécute) et la répétition d'un même **texte** peuvent fonder un arrêt.
- **Chaque arrêt automatique laisse une trace** dans `.pilot/agent-stops.log` du projet (cause, type de détection, agent, session) : boucle, inactivité, plafond de tours, agent bloqué, libération de verrou. Rien ne s'arrête sans motif écrit.
- **Une session qui vient de démarrer n'est jamais un « fantôme »** : après le démarrage d'une session, Pilot laisse passer une fenêtre de **2 minutes** avant qu'un verrou de projet puisse être déclaré fantôme puis libéré. Une session neuve n'a encore rien émis (ni travail, ni activité) : ce silence n'est pas une preuve d'arrêt. Passé ce délai, la règle habituelle s'applique — et une session **morte** est libérée sans attendre cette fenêtre.
- **Un agent qui meurt ne perd plus son travail écrit** : s'il s'arrête brutalement (processus mort, plantage), ce qu'il avait **déjà rédigé** est conservé. Le compte rendu de la tâche affiche ce texte, avec la phrase qui dit que la mission n'est **pas** terminée, et il est écrit dans le **même** journal des arrêts (champ `text=`) — jamais un second journal. Si la mémoire de la session est vide, Pilot relit la session de l'agent **sur le disque** ; s'il n'y a vraiment rien, c'est dit explicitement (« **aucun texte récupéré** »). Ni silence, ni texte inventé, et **aucune relance automatique**.
- **Timeout d'inactivité** : si un agent reste silencieux trop longtemps (**10 min par défaut**, soit 600 000 ms), la run s'arrête et un message le signale. Réglable dans **Options → Agents** (champ « Timeout d'inactivité (ms) », de 10 s à 30 min) ; la nouvelle valeur est relue à l'ouverture de l'onglet Agents ou au redémarrage de Pilot.
- **⏹ Arrêter** arrête les agents lancés depuis cet écran.
- **Changer de projet, fermer un projet ou en ouvrir un autre n'arrête JAMAIS un agent en cours** — quel que soit l'écran (agent du projet, agents multi-rôles 🎭, Assistant). L'agent du projet quitté est simplement **mis en pause** et reprend là où il en était au retour sur ce projet ; les agents des autres projets ouverts continuent leur travail. Seul un agent **au repos** (qui ne travaille pas) est libéré à la fermeture de son projet.
- **Travailler sans onglet reste visible** : dans la **liste des agents** (cercle en haut à droite) et dans le panneau du suivi du travail, une session qui travaille sans onglet ouvert reste **listée** avec son nom et son projet, sa pastille **respirant** — vous voyez qu'elle travaille, sur quel projet, même sans onglet. Cette liste n'affiche **aucune mention « arrière-plan »** (texte ou infobulle) : l'information est portée par la pastille et le nom en gras ; le libellé explicite reste dans la fiche de l'agent et dans le panneau Activité de l'onglet Agents. Elle reste listée **tant qu'elle travaille** (ou que son processus tourne) et **disparaît** dès qu'elle s'arrête : aucune entrée fantôme. Une session simplement **au repos** n'est jamais présentée comme travaillante. Ouvrir son onglet reste **votre** décision (bouton « Afficher l'onglet ») : rien ne s'ouvre ni ne change d'onglet tout seul.
- **Fond de la liste** : le fond de la liste des agents est **légèrement translucide** — on devine la page derrière, sans jamais gêner la lecture : les noms restent nets, en thème clair comme en thème sombre. **La teinte est celle du thème actif** et **suit un changement de thème immédiatement**, sans redémarrer Pilot — comme tous les panneaux translucides de Pilot (voiles de fenêtre, menus flottants), qui prennent leur teinte dans les jetons du thème et non dans une couleur fixe. Les pastilles ne changent pas (atténuées au repos, pleines et lumineuses quand l'agent travaille).
- **Taille et présentation du panneau** : le panneau du suivi (cercle en haut à droite) est assez large pour ses trois onglets **sur une seule ligne** — jamais plus de **40 % de la largeur** de la fenêtre — et ne dépasse jamais **60 % de la hauteur** de l'écran : au-delà, seule la liste défile, et le panneau reste **entièrement visible**. Les trois listes ont exactement la même présentation, celle du panneau d'origine (mêmes lignes, mêmes textes).

### Voir le travail en cours (une compilation n'est pas un arrêt)
- Pendant une **commande longue** (construction, série de tests, installation), l'écran **prouve** que le travail avance — à trois endroits :
  - dans l'**onglet de l'agent** : la commande en cours porte un **point qui respire**, un **compteur de durée** (« 3 min 12 s ») et la **sortie en direct** (les dernières lignes produites) ;
  - dans le **panneau d'activité** (cercle en haut à droite, clic) : la ligne « **En cours depuis 3 min 12 s** » et une « Dernière activité » **qui avance** ;
  - dans la **liste des tâches** (en bas à droite) : la mission porte un point qui respire et sa durée (« depuis 3 min »).
- Le libellé d'état dit la **vérité** : pendant une commande, il annonce « **⏳ bash en cours… (3 min 12 s)** » — jamais « Prêt », jamais « Réflexion… » (le modèle n'attend pas, il fait tourner un programme).
- **Ce que cela ne change PAS** : la détection des agents bloqués, les arrêts automatiques et les durées d'exécution. Seul l'**affichage** progresse ; la sortie en direct est **bornée** (dernières lignes) et aucun **défilement automatique** ne vous est imposé.

### Agent jetable (à la volée, jamais enregistré)
- Pour un besoin **ponctuel**, nul besoin de créer un agent : le rôle peut être
  décrit **dans la demande** elle-même. Cet agent est **jetable** — il existe
  pendant la tâche, puis n'existe plus.
- Il **n'entre pas** dans la liste des agents, **ne modifie rien** dans cette
  liste et **ne survit pas** à la tâche : aucun enregistrement, avant comme
  après.
- Son **travail reste visible** (session et compte rendu) : vous pouvez relire
  ce qu'il a fait après sa disparition.
- Dans une même mission, agents du registre et agents jetables peuvent
  cohabiter : seuls les jetables disparaissent ensuite.

### Écrire un fichier : il faut un agent qui écrit
- Un agent **lecture seule** ne modifie **aucun** fichier : il analyse, planifie
  ou rend un avis. Si on lui demande **explicitement** d'écrire, de créer ou de
  modifier un fichier, Pilot **refuse le lancement** : rien ne démarre et le
  message nomme l'agent, rappelle qu'il ne modifie aucun fichier et indique la
  sortie (désigner un agent qui écrit, par exemple le codeur).
- Le refus ne vise **que** les demandes claires. Une demande de **lecture**
  (« analyse », « vérifie », « relis »…) part normalement, et une demande
  **ambiguë** aussi (dans le doute, l'agent est lancé comme avant). Une mission
  qui contient **au moins un agent qui écrit** n'est jamais refusée.
- **Ce qui compte, c'est l'ORDRE, pas les mots.** Le refus se fonde sur une
  consigne **positive** adressée à l'agent (« écris », « modifie », « génère »,
  « il faut écrire », « merci de créer », « n'oublie pas de créer »…) **et** sur
  la cible qu'elle désigne (un fichier), dans la **même phrase**. Tout le reste
  ne déclenche **aucun** refus : une phrase **négative** (« n'écrire aucun
  rapport », « ne modifier aucun fichier », « sans rien modifier »), une
  **étiquette** de verdict (« À CORRIGER »), le mot « correction »,
  l'évocation d'un fichier **déjà** modifié, un message de commit **cité** ou un
  **nom de fichier** qui ressemble à un verbe (« corrige-guard.md »).
  Une mission de lecture seule n'est donc plus bloquée à cause d'un mot.
- **Fichiers attendus** : quand la demande **déclare** les fichiers réellement
  attendus, Pilot vérifie **en fin de tâche** que **chacun existe**. Un fichier
  déclaré **absent** fait **échouer** la tâche avec un message qui le nomme et
  dit où il était attendu — jamais « terminé » sans le fichier. Présent (même
  vide), la tâche se déroule comme avant, avec une confirmation.
- **Sans fichier déclaré, rien ne change.** Ce contrôle s'applique aussi aux
  **agents jetables** et aux demandes **mises en file** (vérification au moment
  où la tâche se termine réellement).

### Conseils
- Donnez un modèle puissant au coordinateur : c'est lui qui route les tâches.
- Le codeur et le testeur peuvent utiliser un modèle local plus léger.

### File d'attente du projet
- Sur un projet, **une seule tâche tourne à la fois**. Les demandes suivantes ne sont **pas perdues** : elles **attendent leur tour** et démarrent **automatiquement** dès que la place se libère.
- **L'ordre d'arrivée est respecté à l'admission** : une demande déposée alors qu'une autre attend déjà ne passe **jamais devant** — elle se place **derrière** et démarre à son tour. Une seule nuance, écrite noir sur blanc dans les **limites connues** (aucune perte, aucun doublon) : une mission **déjà sortie de file** qui ne peut pas démarrer repart **derrière** les suivantes. L'écran vous le dit (« N demande(s) attendent déjà — votre demande est mise en file DERRIÈRE elles ») et la raison reste écrite dans `.pilot/agent-stops.log`.
- Un **bloc discret** sous la barre d'outils de l'onglet de l'agent montre la file : la tâche **en cours**, puis les demandes **en attente** avec leur rang et **l'agent qui va les traiter** (« en attente (2e) : mission « … » · agent : Codeur »). Il n'apparaît que s'il y a quelque chose à dire.
- **Chaque demande en attente dit quel agent la traite** : l'agent est celui **enregistré avec la demande** au moment de sa mise en file (jamais un nom supposé à l'affichage). L'agent **principal du projet** (celui que Pilot ouvre pour chaque projet) s'affiche « agent : principal du projet » — son identifiant technique (`default`) n'est jamais montré. Si l'agent n'est pas connu, la ligne l'écrit noir sur blanc (« agent : agent non défini ») : **jamais un blanc** à la place du nom. La tâche **en cours** garde son affichage habituel.
- La commande **`/file`** affiche la file complète du projet dans la discussion (mêmes rangs, mêmes agents) ; **`/file vide`** abandonne les demandes **en attente** et annonce **combien** ont été abandonnées (la tâche en cours n'est jamais arrêtée).
- **Aucune demande ne disparaît en silence** : une demande en attente dont la tâche porteuse s'est arrêtée reste **visible** et **relançable** ; si elle est abandonnée (par vous, par le chien de garde ou par « tout arrêter »), son libellé est écrit dans `.pilot/agent-stops.log` et l'écran vous le signale.

---

<!-- HELP-TOPIC:agents-md -->
### 📄 Générer / mettre à jour AGENTS.md

Pilot peut générer ou mettre à jour le fichier `AGENTS.md` à la racine du
projet en utilisant l'IA.

- **Bouton 📄** (toolbar agent, à côté du bouton 📝 mémoire projet) : analyse
  le projet (structure, manifestes, fichiers source) et crée ou met à jour
  `AGENTS.md`. Utilise le **modèle actif du chat**.
- Pendant la génération (qui peut prendre 1–3 min), un **spinner circulaire
  centré** (identique à « Démarrage de Agent Pi ») s'affiche avec le message
  « Génération AGENTS.md en cours ».
- `AGENTS.md` est lu automatiquement par pi et plh au début de chaque session :
  c'est le fichier d'instructions projet (stack, structure, commandes,
  conventions, pièges). Pilot ne le réinjecte pas (discovery native).
- En **mise à jour**, l'agent conserve les sections existantes toujours
  pertinentes et enrichit/corrige le reste.
- Après génération, le fichier s'ouvre dans l'éditeur pour vérification.

---

<!-- HELP-TOPIC:multiprojets -->
## Projets multiples (multi-projets)

Pilot peut ouvrir **plusieurs projets en même temps** dans la même fenêtre et
basculer entre eux sans fermer l'application. Chaque projet garde **son agent
(pi/plh) actif en arrière-plan**, ses onglets et sa discussion.

- **Ouvrir** : sélecteur de projet en haut de la barre latérale → « Projets en cours ».
  La liste des projets ouverts est **conservée au redémarrage** (rouverte
automatiquement avec le projet actif).
- **Voir / basculer** : les projets ouverts sont listés **sous le bouton Projets**
  (toujours visibles, **projet actif en surbrillance avec une coche ✓**). Cliquer sur
  un projet → Pilot
  sauvegarde les onglets du projet courant, bascule l'affichage, puis restaure les
  onglets et **la discussion en cours** du projet ciblé.
- **Fermer** : bouton ✕ à droite d'un projet → son agent est **mis en pause**
  (il n'est **pas tué**) et reprend en revenant sur le projet. Fermer un projet,
  basculer ou en ouvrir un autre **n'arrête jamais un agent en cours** — y compris
  les agents des autres projets ouverts (qui continuent en arrière-plan).
- **Agent par projet** : chaque projet a **sa propre session d'agent** (processus
pi/plh dédié, vivant en arrière-plan). En revenant sur un projet, l'agent reprend
exactement là où il en était (contexte et historique préservés).
- **Indicateur d'activité** : une pastille à côté de chaque projet de la barre
« Projets en cours » indique si **son agent travaille** (animée) ou **est en
attente**. Un projet inactif dont l'agent réfléchit en arrière-plan est donc visible.
- **Accès distant** : depuis le mode remote, la liste des projets ouverts est
visible et on peut basculer de projet (route `/api/project/select`).

**Un verrou de projet n'est jamais laissé fermé** : si un agent meurt sans
signaler sa fin (plantage, processus tué), si une tâche échoue ou est arrêtée,
le projet redevient **libre de lui-même** — au plus tard deux à trois minutes —
sans redémarrer Pilot. Une mission dont l'agent travaille réellement n'est
**jamais** interrompue au passage, et le message « ⏳ Une tâche d'agents est déjà
en cours sur ce projet » ne s'affiche que si du travail est vraiment en cours.
Si un blocage persiste, tapez **`/verrou`** dans la discussion de l'agent pour
voir l'état du verrou du projet, puis **`/verrou libere`** pour le lever. Ces
deux commandes ne sont pas envoyées au moteur.

---

<!-- HELP-TOPIC:interprojets -->
## Discussion inter-projets (lier des projets)

Pilot peut **lier des projets entre eux** pour qu'un projet dépose une **analyse /
tâche** à un autre projet, dont l'agent est lancé pour la traiter.

- **Ouvrir** : bouton **🔗** de la barre d'actions (visible quand un projet est ouvert).
- **Lier** : dans la modale, choisis un projet ouvert et clique **Lier**. Le lien est
  conservé (config). Un projet lié est **exclu** des propositions une fois lié ; tu peux
  retirer un lien avec ✕.
- **Envoyer une tâche** : choisis un projet cible lié, décris l'analyse / ce qu'il faut
  faire, puis **« Déposer la tâche & lancer l'agent cible »**. Pilot :
  1. écrit un fichier de tâche dans `cible/.pilot/handoffs/` ;
  2. ouvre le projet cible (s'il ne l'est pas) et le rend actif ;
  3. lance son agent et lui demande de **lire et traiter le fichier**.
- Le projet source est indiqué à l'agent cible comme **accessible en lecture seule**
  (il peut le consulter pour le contexte, sans le modifier).
- L'agent cible traite la tâche **en arrière-plan** ; suis le résultat dans l'onglet
  agent du projet cible.
- **Si le projet cible travaille déjà** : la tâche est **déposée mais pas lancée**
  (message d'avertissement). Le fichier reste dans `cible/.pilot/handoffs/`. Pour
  la reprendre, demande à l'agent du projet cible de **lire ce fichier**, ou
  relance le dépôt quand le projet est libre (aucun rejeu automatique).

---

<!-- HELP-TOPIC:super-agent -->
## Aide utilisateur — Assistant

L'onglet **🧭 Assistant** est un assistant dédié qui **suit tous vos projets**
(organisés par client) sans jamais modifier vos fichiers. Il lit, observe,
apprend et répond.
- **Tâche #136 — Détection d'absence d'outils** : à l'ouverture de l'onglet,
  si l'assistant n'a **aucun outil** à sa disposition (ex: outils qui ne
  remontent pas depuis le backend), une bannière d'anomalie s'affiche en haut
  du chat (« ⚠️ Anomalie : l'assistant n'a aucun outil, il ne peut que
  réfléchir ») au lieu de laisser croire qu'il fonctionne normalement.
  Comportement normal (outils présents) inchangé.
- **#30 — Restauration au démarrage** : l'onglet 🧭 est **rouvert
  automatiquement au démarrage de Pilot** via le réglage **« Démarrer
  l'assistant au lancement de Pilot »** (**activé par défaut** — Options
  ⚙️ → onglet Démarrage). S'ajoute (mécanisme historique conservé) à la
  **reprise de l'état** : si l'onglet était **ouvert à la fermeture** de Pilot,
  il est rouvert aussi (état global persisté dans la config, pas par projet).
  Décochez le réglage si vous préférez ne rouvrir que l'onglet au moment de la
  fermeture.
- **Niveau de réflexion de l'Assistant** : Options ⚙️ → onglet Assistant →
  « Niveau de réflexion de l'Assistant ». Par défaut **« Non réglé (suit le
  réglage général) »**, c'est-à-dire le niveau par défaut de Pilot, puis celui du
  modèle, puis celui du moteur. Seuls les paliers réellement supportés par le
  modèle de l'Assistant sont proposés ; un modèle incapable de raisonner affiche
  un sélecteur désactivé. Le niveau est **ajusté** au modèle au démarrage de la
  session (jamais un palier supérieur).

### Donner un nom à votre assistant
- **Options ⚙️ → onglet « Assistant »** : donnez un nom à votre assistant
  (ex: « Aria », « Chef de projet »). Ce nom s'affiche dans le titre de l'onglet
  🧭 et dans ses réponses.
- Le nom est **injecté dans le prompt système** envoyé à chaque tour :
  l'assistant sait toujours qui il est et qu'il est l'assistant de suivi
  multi-projets (pas l'agent d'un projet). Même sans prompt personnalisé, il
  reçoit un prompt système par défaut qui rappelle son rôle (suivi de plusieurs
  projets par client, lecture seule).

<!-- HELP:super-agent-personnage -->
### Le personnage actif (nom et portrait)
- Quand un **personnage est activé** dans Présences, l'Assistant **prend son
  nom** et affiche **son portrait** à la place de l'icône 🧭 : dans le titre de
  l'onglet 🧭, dans la **liste des agents** (cercle en haut à droite) et, en
  mode « Assistant seul », dans l'accueil (« Bonjour, je suis … ») et dans le
  cercle.
- **Aucun personnage actif** (aucun fichier déposé) : rien ne change —
  l'Assistant garde le nom réglé dans **Options ⚙️ → Assistant** et son icône
  habituelle. Ce n'est **pas une panne** : aucun message, aucune erreur.
- **Changer de personnage ne demande aucun redémarrage** : l'Assistant relit le
  personnage **au démarrage**, **à l'ouverture de son onglet** et **quand la
  fenêtre reprend le focus**. Ce même relevé alimente toutes les surfaces qui
  affichent son nom (titre de l'onglet, liste des agents, écran Vocal), pas
  seulement l'onglet ouvert.
- Pilot **ne fait que lire** ces informations : il ne crée ni ne modifie jamais
  le dossier du personnage, et il n'écrit rien dedans.
- Le nom réglé dans les paramètres reste le **repli** : il réapparaît dès qu'il
  n'y a plus de personnage actif.
<!-- /HELP:super-agent-personnage -->

### Si l'assistant affiche « Connexion au super-agent perdue »
- Le processus de l'assistant n'a pas survécu à son lancement (ou s'est arrêté).
  Les **causes les plus fréquentes** : le chemin de l'agent (Options → Agent)
  pointe vers un **shim npm** (`pi.cmd`) dont le paquet installé est **scopé**
  (`@earendil-works/pi-coding-agent`), ou une **extension projet**
  (`<projet>/.pi/extensions/`) déclare des dépendances manquantes.
- Depuis la correction (issue #84), le message de connexion perdue affiche
  désormais un **court extrait de la sortie d'erreur réelle** (« Cause probable :
  … ») pour diagnostiquer l'échec au lieu de le masquer. Un faux départ unique
  (relance automatique) n'affiche rien.
- **Correctif V2 (démarrage lent + cycle « perdue »)** : la fenêtre de grâce
  avant d'afficher l'alerte est alignée sur la politique anti-crash Rust
  (~30 s, cooldown de redémarrage) au lieu de 8 s — un redémarrage/cooldown
  légitime ne déclenche plus l'alerte à tort. De plus, si le processus
  **redevient vivant** après un faux départ, le message « Connexion au
  super-agent perdue » déjà affiché est **automatiquement retiré** (il ne
  s'accumule plus et ne « apparaît/disparaît » plus à chaque crash). Un **vrai
  blocage** (session restée morte après la fenêtre) n'est jamais masqué :
  l'alerte reste affichée.

### Gérer les clients
- **Options ⚙️ → onglet « Assistant » → Clients** : saisissez la liste de
  vos clients.
- **Créer un client à la volée** : dans l'onglet 🧭 Assistant, le bouton **🏢
  (Projets & clients)** permet aussi de **créer un nouveau client** directement
  (champ « Nom du nouveau client » + bouton **+ Ajouter un client**), sans
  passer par les Options. Le nouveau client est aussitôt disponible dans les
  sélecteurs.
- Chaque projet suivi peut être **attaché à un client** : dans le panneau
  **🏢 (Projets & clients)**, choisissez le client de chaque projet dans le menu
  déroulant. L'association est enregistrée immédiatement.
- **Une seule source de vérité** : clients et associations vivent dans la
  **base de suivi locale** (`super-agent.db`), pas dans la config — c'est la même
  liste que celle du **Suivi**, du **Kanban** et de l'Assistant lui-même. La
  config n'en garde qu'un miroir relu depuis la base. Retirer un client
  **détache** ses projets (aucun projet ni tâche n'est supprimé).

### Rendu de la conversation (harmonisé avec l'agent)
- La conversation avec l'Assistant utilise **le même rendu que l'agent
  standard** : bulles, cadres, **pensée/réflexion**, **outils utilisés** et
  **boutons de choix** (avec l'accent **violet** dédié à l'Assistant au lieu du
  bleu).
- **Paramétrer** : **Options ⚙️ → onglet « Assistant »** → cochez/décochez
  « Afficher la réflexion de l'Assistant » et « Afficher les outils de
  l'Assistant » pour masquer (ou montrer) ces blocs.
- **Ordre chronologique** : les **messages d'info** de l'Assistant (ex: « ✅
  Tâche terminée… », « ⚠️ Connexion perdue… ») sont affichés **dans l'ordre
  de leur émission** grâce à un buffer d'ordonnancement + compteur de
  séquence (#20), même s'ils arrivent hors ordre (sources asynchrones).
- **#139 — Panneau du suivi du travail (UN SEUL endroit à l'écran)** : les
  **événements système** (délégations, démarrage/arrêt d'agents, erreurs,
  connexion perdue, notifications) **et** les **missions des agents** se suivent
  dans **un seul panneau**, ouvert par le **cercle d'activité en HAUT À DROITE**
  de la fenêtre (le cercle qui respire quand du travail est en cours). Il ne
  reste **ni second panneau, ni bouton « cloche »** à l'écran : le panneau de la
  cloche (bas à droite de l'onglet 🧭) a été **déplacé** dans celui-ci — rien
  n'est perdu (mêmes événements, mêmes missions, même mention « en attente »,
  mêmes réglages).
  - **Trois onglets, dans cet ordre DÉFINITIF** (de gauche à droite ; décision
    propriétaire, qui prime sur l'ordre initialement demandé) : **« Agents »**
    (la liste des agents du suivi, inchangée : pastille respirante, projet,
    état), **« Tâches »** (missions en cours et en attente), **« Événements »**
    (historique système).
  - **Onglet par défaut** : à l'ouverture du panneau, on arrive sur **« Agents »**
    tant que l'utilisateur n'a **jamais** choisi d'onglet (aucune mémoire).
  - **Onglet mémorisé** : dès qu'un onglet a été choisi, le panneau se rouvre sur
    le **dernier onglet utilisé** (la mémoire l'emporte sur le défaut). **Échap**,
    la croix **×** ou un clic sur le cercle referment le panneau ; les onglets
    sont atteignables au clavier (Tab) et commutables aux **flèches** (←/→,
    Début/Fin) **dans l'ordre d'affichage**, de gauche à droite.
  - **Compteur de travail sur l'entrée « Travail »** : à droite du mot, deux
    nombres **« en cours / total »** (par exemple **`2/5`**) disent d'un coup
    d'œil **combien de tâches tournent** et **combien sont prévues au total**
    (en cours **plus** en attente). Le total compte **tout ce qui attend
    vraiment** : les missions de l'assistant, les demandes qu'il a déléguées, les
    **commandes tapées pendant qu'une tâche tourne** et les **agents qui
    attendent leur tour**. **Rien** ne s'affiche quand il n'y a aucun travail ;
    le chiffre s'**allume** quand au moins une tâche est **en cours** (aucune
    animation). Les **nombres réels** (et le plafond « 99+ » quand ils deviennent
    grands) sont dans l'**infobulle**. Le compteur **et** le volet « Tâches »
    affichent **toujours les mêmes nombres**.
  - **Signal d'attention des événements non lus** (il ne se perd pas) : le
    **point du bouton** s'allume tant qu'il reste des événements non vus, et un
    **petit point** apparaît sur l'onglet « Événements » — **pas de nombre en
    clair** (il ne tient pas dans la marge du panneau), le nombre exact étant dans
    son **infobulle**. Regarder l'onglet « Événements » **éteint** le signal.
    Tant que la liste est sous vos yeux, un nouvel événement **ne compte pas**
    comme non lu.
  - Le panneau **reste ouvert** tant qu'on ne le ferme pas ; son état
    ouvert/fermé est **mémorisé**. Pendant l'ouverture, les nouveaux événements
    s'ajoutent en direct en haut de la liste.
  - **Dimension et présentation** : le panneau est dimensionné pour que les
    trois onglets tiennent sur **une seule ligne** — largeur entre **300 et
    360 px**, jamais plus de **40 %** de la largeur de la fenêtre (fenêtre
    étroite : le plancher de lisibilité des onglets l'emporte, et le panneau se
    recale pour rester **entièrement dans l'écran**) — et il ne dépasse jamais
    **60 %** de la hauteur de la fenêtre : au-delà, c'est le **contenu** de la
    liste qui défile, **jamais** le panneau. Le contenu des trois listes
    reprend **le style des listes déplacées** (mêmes classes et mêmes jetons de
    thème : lignes, textes, mentions « en attente », éléments d'événement,
    horodatage, espacements), sans aucune valeur de style recopiée : réglages
    uniques dans les variables `--agent-activity-panel-*` et gabarits de liste
    partagés (verrou `src/js/taille-et-style-panneau.test.js`).
  - Liste **chronologique** (plus récent en haut), pastille colorée par
    sévérité (succès / avertissement / erreur / info), horodatage discret.
  - Bouton **« tout effacer »** 🗑️ (dans l'onglet « Événements ») pour vider la
    liste. Tampon mémoire borné (~150 items) pour garder la liste lisible.
  - Les **éléments interactifs** (boutons de choix, confirmations, saisies)
    restent **au centre** de la discussion : ce sont des questions qui
    nécessitent votre action, pas des événements système.
  - **#160 — Événements en plein écran (optionnel)** : **Options ⚙️ → onglet
    « Assistant »** → « Événements en plein écran (bandeau central temporaire) »
    affiche **en plus**, au **centre de l'écran** (au-dessus de tout), chaque
    événement dans un **bandeau temporaire discret** — pratique quand l'onglet
    🧭 est en arrière-plan. **Désactivé par défaut** ; **durée réglable**
    (1-120 s, **5 s par défaut**). Le **dernier événement remplace** le
    précédent (jamais d'empilement) et le bandeau s'efface en douceur. Les
    **questions interactives** (choix, confirmations) ne sont **pas** concernées.
- **Onglet « Tâches » du panneau du suivi du travail** : l'ordre définitif des
  onglets est **« Agents », « Tâches », « Événements »** ; le panneau propose
  donc l'onglet **« Tâches »** juste après « Agents » (**Options ⚙️ →
  onglet « Assistant » → « Onglet « Tâches » dans le panneau du suivi du travail
  (missions des agents) »**, **activé par défaut** ; décoché, l'onglet est
  **masqué** et le panneau reste sur les deux autres). Il liste les **missions
  réellement en cours** de vos agents : pour chacune, une **phrase courte** qui
  dit la **tâche réelle**,
  affichée **en premier** (avant le nom de l'agent et le projet, qui suivent sur
  la ligne secondaire). Cette phrase vient de la **demande elle-même** (résumé
  court fourni par l'assistant ; à défaut, l'objectif de la demande). Les
  missions sont présentées en **deux
  groupes explicites et numérotés** — « **En cours (n)** » et « **En attente
  (n)** » (l'ordre de la file est visible) — et non plus en une liste unique
  indifférenciée. Un agent **au repos** n'y figure **pas** ; un agent
  **occupé** y figure **même s'il ne dit rien** (compilation, tests longs). Une
  mission qui **attend** qu'un agent se libère apparaît dans le groupe « **En
  attente** ». La liste se **met à jour toute seule** tant qu'elle est
  affichée (mêmes données que l'indicateur d'activité) et **défile** si elle est
  longue. Les **tâches** de votre suivi multi-projets restent dans leur onglet
  **Kanban** dédié (barre latérale).
- **#31 — Pas de bulle vide** : un message d'info **vide** ou qui ne contient
  **qu'un chemin de projet** (sans libellé/contexte) n'est **pas affiché** —
  chaque bulle porte toujours un libellé utile (ex: « Projet ouvert : X »).
- **Badges projet par bulle (snapshot à l'envoi)** : chaque bulle de
  l'Assistant porte le nom du/des projet(s) **concerné(s)**, choisi dans cet
  ordre (règle unique : `resolveBubbleBadgeNames`, module pur
  `super-agent-badges.js`) : **(1)** les projets **explicitement nommés dans le
  texte**, dans leur **ordre d'apparition**, sans doublon ; **(2)** sinon, les
  projets **réellement concernés par l'échange** (mission / agents lancés,
  agent ciblé, projet transmis à un agent, projet ouvert par l'Assistant) ;
  **(3)** sinon, **en dernier recours**, le **projet ouvert au moment de la
  création de la bulle** (snapshot figé) ; **(4)** sinon **aucune étiquette** —
  jamais de nom inventé. Un projet **visé** par l'échange prime donc toujours
  sur le projet simplement affiché à l'écran (mission sur `PLh` alors que
  `Pilot` est ouvert → badge « PLh »). Plusieurs projets cités → plusieurs
  badges compacts sur la même bulle. Aucune étiquette sur les bulles de
  l'**utilisateur**, les **messages système** et les **erreurs**. La détection
  du texte est **sans IA** : correspondance insensible à la casse sur le **nom
  affiché** du projet (ex: « PLh ») ou la **fin de son chemin** (ex:
  « ia_pl/plh »), avec **frontières de mots** (une demande qui parle de
  « pilotage » n'étiquette pas le projet « pilot »). La réponse hérite des
  badges **figés** de la demande qui l'a déclenchée et peut y **ajouter** les
  projets réellement cités dans le texte de la réponse (jamais en retirer un
  correct, jamais en inventer un). Les badges sont **figés pour toujours** :
  changer de projet actif (même via `open_project` pendant le tour) ne modifie
  **jamais** les badges déjà affichés, et aucune bulle n'est re-étiquetée
  rétrospectivement. La **bulle de continuation** après une question posée à
  l'utilisateur hérite des badges de la demande initiale (la paire
  question/réponse porte les mêmes étiquettes).
- **Une bulle par tour d'agent par projet** : un « tour » = depuis que
  l'Assistant commence à répondre jusqu'à `agent_end` (fin du tour, c'est à
  l'utilisateur de parler). Pendant un tour, l'Assistant peut enchaîner
  plusieurs messages (texte → appel d'outil → texte → appel d'outil → texte) :
  tout reste dans la **MÊME bulle**. On ne crée PAS de nouvelle bulle à chaque
  `message_end` intermédiaire ; le reset de la bulle courante se fait
  uniquement à `agent_end` ou quand l'utilisateur envoie un nouveau message.
  Changer de projet actif pendant un tour (ex: `open_project`) n'ouvre plus de
  nouvelle bulle : la réponse reste dans la bulle étiquetée par sa demande.
- **Couleur par projet** : chaque projet reçoit une **couleur stable**
  déterminée par un hash de son nom → palette de ~10 couleurs lisibles en thème
  dark ET light. La couleur est appliquée à la bulle (**bordure gauche**
  colorée) et aux **badges projet** (rendu pastel : fond et bordure dilués,
  texte teinté via `color-mix`). La couleur est
  **identique** pour un même projet d'une session à l'autre.
- Les **bulles système** (messages d'info `appendSystemMessage`) ne portent
  **aucune couleur de projet** et sont désormais regroupées dans le **panneau
  des événements système** (tâche #139, voir plus haut) au lieu du centre de
  la discussion.

### Notifications natives
- **Options ⚙️ → onglet « Assistant » → « Notifier quand l'Assistant a
  terminé une tâche déléguée ou signale une anomalie »** : recevez une
  **notification native** (bannière OS) quand l'Assistant signale un événement
  **important** : une **tâche déléguée** à un agent du projet **est terminée**, ou
  une **anomalie** de suivi (ex: connexion au super-agent perdue).
- **Fin de run : avis garanti, succès OU échec** : à la fin d'une run d'agents
  délégués, la notification desktop est émise **en premier et une seule fois** —
  même si la consignation du compte rendu dans le suivi échoue (celle-ci est
  *fail-open* : son échec n'enlève jamais l'avis). Le **son « fin »** est **armé**
  au même instant mais n'est joué qu'à la **fin réelle de l'affichage** du
  compte rendu (cf. § Son de notification). Une run dont **un seul agent a
  échoué** est annoncée comme un **échec** (« ❌ Tâche terminée en ÉCHEC… »),
  jamais comme un succès.
- **Désactivé par défaut** pour éviter la sur-notification : les réponses
  banales de l'Assistant ne déclenchent **aucune** notification.

### Son de notification
- **Options ⚙️ → onglet « Assistant » → « Jouer un son de notification »** :
  l'Assistant joue un **son** (via le script `~/.pilot/assistant/notify.ps1`)
  aux moments où il notifie l'utilisateur : **fin de tâche d'agent** (son
  « fin »), **point important / anomalie** (son « point »), **question posée**
  (son « attention »).
- **Son « fin » joué à la fin réelle de l'affichage** : il n'est plus émis au
  moment où la tâche se termine, mais une fois que le texte a **entièrement fini
  de s'afficher** à l'écran (flux terminé, y compris le raisonnement lorsqu'il
  est affiché) — plus de son pendant que la réponse s'écrit encore.
- **Jamais de son au milieu d'un tour** : un tour d'agent comporte des **étapes
  silencieuses** (appel d'outil long : build, série de tests, recherche ;
  réflexion non streamée ; attente du premier mot). Un **silence n'est jamais
  une fin de tour** : le son attend que le tour ait **réellement** rendu son
  dernier élément, et une reprise (nouvelle tentative, compaction) ne sonne pas.
- **Un son pour le tour qui AFFICHE le sujet** : si le compte rendu d'une tâche
  déléguée ne peut pas être affiché tout de suite (l'Assistant est en train de
  vous répondre → remise différée), le son n'est pas joué à la fin de votre tour
  mais à la fin du tour qui affiche le compte rendu.
- **Un seul son par fin de mission** ; si la fin d'affichage n'est jamais
  signalée (agent interrompu), un délai de sécurité borné finit par le jouer —
  sauf tant qu'un rendu est encore en cours (aucun son pendant le travail).
- **Installation automatique** : le script est **créé tout seul** au premier
  usage (dossier `~/.pilot/assistant/` créé si besoin). Aucune intervention
  manuelle n'est requise : le bouton « Tester » fonctionne dès l'installation.
- **Personnalisable** : vous pouvez **modifier** `~/.pilot/assistant/notify.ps1`
  à votre goût (mélodies, sons). Pilot ne l'**écrase jamais** : un script
  existant est toujours utilisé tel quel.
- **Disponible sur Windows uniquement** : la lecture s'appuie sur PowerShell
  (absent sur macOS/Linux) ; sur ces plateformes, un message clair l'indique.
- **Volume réglable (0-100 %, défaut 100 %)** : appliqué à **tous** les types de
  sons. Un bouton **« Tester »** joue immédiatement le son « point » pour
  vérifier le réglage.
- **Désactivé par défaut** (opt-in).

### Réponses courtes
- **Options ⚙️ → onglet « Assistant » → « Réponses courtes (informer sans
  détailler, sauf demande explicite) »** : quand activé, l'Assistant répond de
  façon **concise** — il **informe et prend des décisions** sans détailler tout
  ce qui se fait, **sauf si vous lui demandez explicitement** de détailler.
- **Désactivé par défaut**.

### Mode user-friendly (langage simple)
- **Options ⚙️ → onglet « Assistant » → « Mode user-friendly (langage simple,
  non technique, sauf demande explicite) »** : quand activé, l'Assistant répond
  en **langage simple et non technique** — il évite le jargon et explique les
  concepts de façon accessible pour un non-spécialiste, **sauf si vous lui
  demandez explicitement** du technique.
- **Désactivé par défaut**.

### Mode « Assistant coordinateur pur »
- **Options ⚙️ → onglet « Assistant » → « Assistant coordinateur
  (déléguer quand il faut réfléchir) »** : quand activé (désactivé
  par défaut), l'Assistant passe en mode **coordinateur pur**. Il **ne modifie
  pas** le mécanisme d'échange assistant↔agents : c'est uniquement un bloc
  d'instructions injecté dans son prompt système.
- **Délégation IMPÉRATIVE** : tant que le mode est actif, l'Assistant **ne
  réfléchit pas lui-même**, il **délègue**. Tout travail intellectuel — analyse,
  recherche, rédaction, conception, diagnostic, plan, code, vérification — est
  confié à un agent.
- **Ce que l'Assistant fait lui-même, et rien d'autre** : (1) répondre avec une
  information **déjà** dans son suivi (base, projets et tâches connus) ;
  (2) prendre les décisions de **coordination** (choisir l'agent, découper,
  ordonner, arbitrer) ; (3) **reformuler** en langage clair le retour d'un agent.
- **DEUX familles d'agents** (la consigne les nomme explicitement) :
  1. **Agents d'un projet** (le projet est le contexte) :
     `run_agents(agent_ids, task, resume, project)` — travail DANS un projet (code,
     documentation, tests, état du dépôt) ; `project` omis = projet actif.
  2. **Agents hors projet** (créés pour l'Assistant, rattachés à aucun projet) :
     `run_assistant_agents(agent_ids, task, resume)` — travail qui ne dépend
     d'AUCUN projet (recherche, analyse, rédaction interne), l'agent tourne dans
     `~/.pilot/assistant/`. Si aucun agent ne convient : `create_agent` d'abord.
     `resume` (les deux outils, **facultatif**) : **phrase courte (≤ 120
     caractères)** qui dit ce que la tâche fait réellement — c'est le texte lu
     **en premier** dans le panneau des tâches ; à renseigner **toujours**, dans
     la langue de l'utilisateur, sans recopier la tâche technique.
- **Marche à suivre obligatoire** : choisir la famille ET les agents, annoncer
  en une ligne les étapes ET les agents, puis **lancer immédiatement** — sans
  mener le travail intellectuel soi-même.
- **Les appels Git liés aux issues** passent par un agent (github-tracker /
  git-point), pas par ses outils Git directs. La vérification de l'état d'un
  agent ne se fait pas soi-même.
- **Priorité au message utilisateur** : s'il tape pendant qu'il délègue,
  l'Assistant traite son message EN PRIORITÉ (réponse immédiate, signale que
  la délégation continue en arrière-plan, puis revient dessus à la fin).

### Une question de mode d'emploi
- Une question qui demande **comment faire** dans Pilot reçoit une **réponse
  directe** de l'Assistant : il y répond lui-même, il ne la **délègue jamais**
  à un agent.
- Une telle question **n'entre pas** dans la mémoire de suivi des projets :
  elle ne crée **ni tâche, ni décision, ni projet**.

<!-- HELP:super-agent-coordinator -->
### Mode « Assistant coordinateur pur »
Dans **Options → section Assistant**, l'option **« Assistant coordinateur
(déléguer quand il faut réfléchir) »** (désactivée par défaut) fait passer
l'Assistant en mode **coordinateur** plutôt qu'exécutant. Tant qu'il est actif,
il ne réfléchit pas lui-même : **tout travail intellectuel** (analyse,
recherche, rédaction, conception, diagnostic, plan, code, vérification) est
confié à un agent.
- Il fait lui-même **seulement** : répondre avec une information **déjà** dans
  son suivi, prendre les **décisions de coordination**, **reformuler** en
  langage clair le retour d'un agent.
- Il dispose de **deux familles d'agents** :
  - les **agents d'un projet** (le projet est le contexte) — pour tout travail
    dans un projet ;
  - les **agents hors projet** (créés pour lui, sans projet) — pour la
    recherche, l'analyse ou la rédaction interne.
- Il **annonce les étapes ET les agents** puis **lance immédiatement**.
- Les appels Git liés aux issues et la vérification de l'état des agents
  passent par des agents (pas par ses outils directs).
- Si vous tapez pendant une délégation, il vous répond **en priorité** puis
  revient sur la tâche en cours.
Ce mode ne change pas le mécanisme d'échange assistant↔agents : c'est
uniquement un bloc d'instructions dans le prompt système.
<!-- /HELP:super-agent-coordinator -->

### Purge de la conversation de l'agent (avant chaque demande de l'Assistant)
- **Purge automatique (défaut)** : à chaque nouvelle demande déléguée par
  l'Assistant (`delegate_to_coder`, y compris les demandes mises en file), la
  conversation de l'agent cible est **purgée avant l'envoi** SI elle n'est pas
  déjà vierge (mécanique bouton « + » : `new_session` + ré-application du
  modèle actif). Chaque demande repart donc d'un contexte vierge au lieu
  d'hériter de tout le fil précédent (délégations « hyper long »).
- **Réglage** : Options ⚙️ → onglet « Assistant » → « Purger la
  conversation de l'agent avant chaque demande de l'Assistant » (activé par
  défaut ; désactivable pour retrouver l'accumulation d'historique).
- **Purge uniquement si nécessaire** : si la conversation est déjà vierge
  (agent jamais sollicité, session fraîchement créée), rien n'est re-purgé —
  Pilot compare l'historique (pi `get_messages`) avant de décider.
- **EXCEPTION — messages directs** : vos messages **directs** dans l'onglet
  agent ne déclenchent **jamais** de purge : vos retouches gardent leur fil.
- **Périmètre** : aucune purge au démarrage de Pilot ni à la fermeture
  d'onglet ; la vue de l'onglet agent (s'il est ouvert) est vidée en
  synchronisation (discussion DOM + flags Context Engine réinjectés au
  prochain envoi), le modèle actif est préservé.
- **Purge à la demande (inchangée)** : l'Assistant peut aussi purger via
  l'outil `purge_agent_conversation` — équivalent au clic sur « + » de l'onglet
  agent. Les runs `run_agents` purgent déjà systématiquement les agents avant
  leur run (indépendant de ce réglage).

### Suivre les projets
- L'Assistant suit chaque projet **de la demande jusqu'à la livraison** :
  il enregistre les tâches, leur état, les décisions et l'historique.
- Il **n'effectue aucune action** sur les projets : il ne modifie, ne crée ni
  ne supprime aucun fichier. Il est **lecture seule**.
- Il construit **sa propre base de données locale** (SQLite) pour organiser
  clients, projets et tâches, et s'enrichit au fil du temps.

### Visualiser les tâches (vue Kanban)
- La barre d'outils de l'onglet 🧭 propose un bouton **« Vues »** qui **ouvre
  la vue Kanban dans un onglet dédié de Pilot** (mode `superagent-kanban`, onglet
  « 🗂 Kanban », même pattern que les onglets outil Review / Historique /
  Dashboard / Coffre). Cliquer sur « Vues » focalise l'onglet Kanban s'il est
  déjà ouvert, ou le crée sinon.
- La vue **liste** du suivi multi-projets **n'est plus dans l'onglet 🧭** : elle
  est devenue la carte « Suivi multi-projets » du **Tableau de bord 📊**
  (`spec_dashboard.md`), où elle est rangée **par client** et affiche **aussi**
  les projets suivis non ouverts. Le panneau inférieur de l'onglet 🧭 ne garde
  que le **bilan de période** : il n'y a plus de bouton « suivi multi-projets »
  (8 boutons dans la barre d'outils), plus de panneau `#super-tracking`, et le
  crochet de rechargement de `tabs.js` a disparu avec lui.
- **Sélecteur de projet** en haut de l'onglet : **« Tous les projets »** (défaut)
  ou **un projet précis**. Le choix est **conservé d'une ouverture à l'autre**
  (localStorage `pilot:kanban:project`) ; un projet mémorisé qui n'existe plus
  retombe sur « Tous les projets ». Le filtrage et la liste des projets sont des
  fonctions **pures** (`listKanbanProjects`, `filterKanbanTasks`), le choix ne
  provoque **aucun appel supplémentaire** (la réponse est gardée en mémoire).
- Dans l'onglet Kanban, les tâches sont affichées **dans une grille unique**, chacune
  classée dans l'une des **5 colonnes** « À faire / En cours / À valider /
  Terminé / À qualifier ». La colonne « À qualifier » recueille les statuts que
  la règle unique ne sait pas trancher : rien ne disparaît en silence, mais une
  tâche close en texte libre ne compte jamais comme ouverte.
- En mode **« Tous les projets »**, **chaque carte porte le nom de son projet**
  (et le **client** s'il est renseigné) ; un bandeau rappelle la **portée**
  affichée et le **nombre de tâches** visibles.
- **Idées en sous-catégorie des tâches à faire** : sous les cartes de la colonne
  « À faire » apparaît un sous-groupe titré **« Idées »**, alimenté par la table
  **existante** `idees_evolutions` de la base de suivi (lue en **lecture seule**
  par `get_super_agent_kanban`, champ `ideas` — **aucune table nouvelle**). Les
  idées sont **visuellement distinctes** des tâches (carte à liseré jaune, ampoule,
  statut et priorité affichés, **aucun bouton de tâche**) et **jamais mélangées**
  aux tâches : elles ne comptent pas dans le compteur de la colonne. Une idée
  **implémentée / réalisée / livrée / annulée / rejetée** n'est pas affichée (règle
  pure `isOpenIdeaStatus`). Si la table est absente (base neuve), le sous-groupe
  est simplement vide.
- **Tâches bloquées** : une tâche dont la colonne `blocker_reason` est renseignée
  (posée via `super_agent_flag_blocker`) affiche un **badge rouge « Bloquée :
  <motif> »** sur sa carte (règle pure `isBlockedTask`), et la carte est marquée
  visuellement — le blocage reste **distinct** et **lisible**.
- **Tâches en attente d'une dépendance (« attend la tâche X »)** : une tâche peut
  **attendre** une autre tâche (`depends_on_task_id`) — elle ne sera prête à
  démarrer qu'une fois la tâche attendue **terminée ou annulée**. Tant que ce
  n'est pas le cas, sa carte affiche un **badge bleu « En attente de : <titre> »**
  (règles pures `isWaitingDependency` / `dependencyLabel`), **distinct** du badge
  rouge de blocage : une **attente** (qui se lève **toute seule**) n'est pas une
  **panne** (qui demande une action). L'état est **calculé à la lecture** par le
  cœur (`dependency_state` : `waiting` / `ready` / `unknown`), **jamais stocké** :
  dès que la tâche attendue est close, la dépendance **cesse de bloquer sans
  aucune étape manuelle**. Les **chaînes** (A attend B qui attend C) sont permises ;
  un **lien circulaire** ou un **lien sur soi-même** est **refusé** à l'écriture ;
  une dépendance vers une tâche **supprimée** est **détachée** automatiquement.
  La colonne est ajoutée par **migration additive** (une base ancienne s'ouvre
  sans perte de données).
- **Règle unique « ouverte ou close »** (miroir JS `normalizeTaskStatus` /
  `isOpenTaskStatus` ↔ Rust `classify_task_status` / `is_task_open`) : elle
  **reconnaît les statuts clos en texte libre** (« terminee - verifie par les
  fichiers… », `fermee_github`, « livree - … », « decidee - … », `livre_a_tester`).
  Les compteurs du cœur (`super_agent_tracking`, `super_agent_project_overview`,
  timeline, santé projet) appliquent la même règle. À la création d'une tâche, le
  statut canonique `demande` est écrit explicitement (plus de texte libre implicite).
- Chaque carte de tâche rappelle le **titre**, le **projet** (et le **client**)
  concerné et un extrait de la **description**. Les tâches annulées ou abandonnées
  n'apparaissent pas dans le tableau.
- **Pilotage complet (création / édition / déplacement / suppression)** :
  - Un bouton **« + Nouvelle carte »** (barre d'outils) ouvre un formulaire
    (projet, titre, description, échéance) → `super_agent_create_task` ; en mode
    projet filtré, le **projet affiché est pré-rempli**
  - La **dépendance** « attend la tâche X » se pose via
    `super_agent_set_task_dependency` (créer = `depends_on_task_id` sur
    `super_agent_create_task`) : l'**Assistant** peut la poser depuis ses outils
    (`set_task_dependency`, `create_task` avec `dependsOnTaskId`), et le **cœur
    refuse** un cycle ou un lien sur soi-même avec un message clair.
  - Chaque carte a des boutons **éditer** (titre, description, projet,
    échéance, statut) et **supprimer** (confirmation en deux temps) →
    `super_agent_update_task` / `super_agent_delete_task`.
  - Une carte se **déplace** entre colonnes par glisser-déposer **ou** via le
    menu statut de la carte → `super_agent_update_task_status` avec le statut
    canonique (`super-agent-kanban.js` : `columnToStatus`) ; le statut est
    normalisé en colonne au prochain rechargement.
  - Après chaque écriture, la vue se **recharge** automatiquement.
- **Détection des tâches longues** (idée 1) : une fonction pure juge le
  **titre + la description** au moment où l'état Kanban est produit et pose
  `is_long_task` / `long_task_reason` ; le cœur seul décide (seuils et règles
  dans `super_agent.rs`, jamais recalculés par l'interface). Pilot **signale et
  propose** de confier la demande à un agent — il ne lance **jamais** d'agent
  tout seul. L'affichage est conditionné par `super_agent_long_tasks_enabled`
  (Options → Assistant, **activé** par défaut : une clé absente vaut activé).
- **Temps estimé / passé par tâche** (idée 2) : une tâche peut porter un
  **temps prévu** (valeur absolue, `super_agent_task_time_set_estimated`) et un
  **temps passé** (cumul, `super_agent_task_time_add_spent`), relus en base
  (`super_agent_task_time_get`) après chaque opération ; la carte affiche alors
  une pastille « prévu / passé » et la vue d'ensemble un total par projet.
  Tout cet affichage est **conditionné** par le réglage
  `super_agent_show_time` (Options → Suivi), **désactivé par défaut** : sans
  lui, aucun champ, aucune pastille et aucun total ne s'affichent (aucune
  donnée n'est écrite ni perdue).
- **Checklist de livraison par tâche** (idée 3) : chaque fiche peut porter des
  points à cocher (table `task_checks`, commandes `super_agent_task_check_*`),
  la carte affiche le compteur « 2/3 », et au passage en « Terminé » le cœur
  applique un contrôle selon `super_agent_checklist_mode` (`off` / `warn`
  défaut / `block`) ; l'écran ne fait que **lire le verdict**. Réglages : mode +
  modèle de points (`super_agent_checklist_template`).
- **Traçabilité livrable → demande** (idée 4) : à chaque **passage effectif**
  d'une tâche en état livré (une seule fois, jamais pour une tâche déjà livrée),
  une ligne est écrite dans `deliverables` — libellé = titre de la tâche, origine
  = décision liée la plus récente, sinon mention de repli « origine non
  précisée » — et la fiche affiche le bloc **« Livrable »** en lecture seule.
  L'écriture, **fail-open** (elle ne bloque jamais le changement de statut), est
  conditionnée par `super_agent_tracabilite_enabled` (défaut : activé).
- **Clôturer plusieurs tâches d'un coup** (clôture EN LOT, purement additive) :
  - chaque carte porte une **case à cocher** ; une **barre en haut** de la vue
    affiche le **nombre de tâches sélectionnées** et reste **visible au
    défilement** (liste longue : la mise en page n'est pas cassée) ;
  - le bouton **« Clôturer la sélection »** (et « Tout désélectionner ») n'est
    **visible qu'à partir d'une tâche cochée** ; la clôture ne porte que sur les
    cartes **visibles** (changer de projet **vide la sélection** : le filtre ne
    peut jamais faire clôturer une tâche masquée) ;
  - il demande une **confirmation** qui annonce le **nombre de tâches** et
    rappelle que l'opération est **réversible** ; une confirmation **refusée
    n'écrit rien** ;
  - la clôture passe par la **même route que la clôture unitaire**
    (`super_agent_update_task_status`, statut `terminee`) — **aucune commande
    nouvelle**, **aucune suppression** : seul le **statut** change ;
  - après la clôture, un bouton **« Annuler »** (confirmation de résultat)
    **rétablit le statut précédent** de chaque tâche concernée.
- **Toutes les écritures vont UNIQUEMENT dans la base de suivi de l'Assistant**
  (`~/.pilot/super-agent.db`) : l'Assistant reste **lecture seule** sur les
  fichiers projets. C'est l'utilisateur qui pilote ces cartes directement dans
  la vue.

### Onglet « Tâches » du panneau du suivi du travail (missions des agents)
- Le **panneau du suivi du travail** (#139, cercle en **haut à droite**, commun à
  toutes les vues) porte **trois onglets commutables** dans son en-tête, dans
  l'ordre définitif : **« Agents »** (liste des agents), **« Tâches »** (missions
  des agents) et **« Événements »** (historique en direct,
  inchangé). L'ancien panneau de la
  cloche de l'onglet 🧭 n'existe plus : ses **deux contenus** (événements et
  missions) vivent ici, avec le même comportement.
- **Source unique** : le **store d'activité partagé** de l'application
  (`agent-activity.js`, celui de l'indicateur d'activité des projets, du mode
  immersif et de l'onglet agent) — **aucune** commande Rust nouvelle, **aucun**
  appel supplémentaire au moteur. La surveillance de ce volet est posée **au
  démarrage de Pilot** (`startSuperMissionsWatch()`, appelée par `main.js`) et
  vit **tant que l'application tourne** : elle ne dépend **ni** de l'existence de
  l'onglet 🧭 Assistant **ni** de l'affichage du panneau. Elle est
  **idempotente** (un seul abonnement au store, un seul écouteur des onglets du
  panneau), donc la création de l'onglet 🧭 ne crée rien de plus. Seule la
  **peinture** est conditionnée par `isAgentPanelPaneVisible("tasks")` : la
  **donnée** est toujours à jour, le volet ne se repeint que lorsqu'il est à
  l'écran — et il est donc **juste du premier coup** à l'ouverture, jamais blanc,
  jamais une photo périmée. La commutation d'onglet reste purement visuelle.
  Couverture : `src/js/taches-visibles-sans-onglet.test.js` (rapport :
  `docs/rapports/RAPPORT-taches-invisibles.md`).
- **Contenu** : pour chaque agent **retenu** → `{ agent, projet, mission }`.
  Filtre, mise en forme et rendu sont des **fonctions pures**
  (`buildRunningMissions`, `shortMission`, `splitMissions`,
  `renderMissionsPanelHtml` dans `agent-activity.js`, testées) :
  - agent **retenu** si `busy` **ou** `toolInProgress` → un agent engagé dans un
    **outil long et silencieux** (compilation, tests) **ne disparaît jamais**
    (faux négatif interdit) ;
  - agent **au repos** (`idle`, `paused`, `stopped`) → **masqué** (une absence de
    travail n'est pas une mission) ;
  - **trois groupes EXPLICITES et NUMÉROTÉS, dans cet ordre** : « **En cours
    (n)** », « **Démarrage (n)** » puis « **En attente (n)** » — on voit d'un coup
    d'œil ce qui travaille, ce qui vient d'être **accepté sans avoir encore
    démarré**, et **dans quel ordre la file attend** (rang `1.`, `2.`, … dans
    l'ordre d'origine) ; un groupe vide n'est pas affiché. Aucune mission →
    message explicite « Aucune mission en cours » (jamais une liste vide
    trompeuse) ;
  - **affichage de chaque mission** (deux lignes, position **FIXÉE**) : **ligne 1
    = rang + l'identité « <agent> — <nom de projet> »** (nom de projet **court** :
    le nom du dossier) avec le statut **« en cours »** / **« démarrage »** /
    **« en attente »** ;
    **ligne 2 = le texte d'indication de la tâche** — le **résumé court** fourni
    avec la demande, sinon l'extrait de l'objectif — **EN DESSOUS**, à sa place
    historique ;
    pour une mission **en attente** (sans agent), c'est le **nom du projet**
    seul. Aucun préfixe redondant « Projet X · » ;
  - **RÉSUMÉ COURT FOURNI AVEC LA DEMANDE (`resume`)** — le remède au libellé
    déduit après coup du prompt : les outils `run_agents` et
    `run_assistant_agents` acceptent un champ **facultatif `resume`** (une phrase,
    **plafonnée à 120 caractères**, aucun caractère obligatoire) ; l'assistant est
    **invité à le renseigner systématiquement** (consigne de son prompt système +
    description de l'outil) :
    1. résumé **fourni** → **affiché tel quel** (seulement nettoyé : espaces et
    retours à la ligne réduits, coupe propre sur un mot à 120 caractères) ;
    2. **absent** → l'affichage **retombe** sur l'extraction de l'objectif de la
    demande (`shortMission`, règles ci-dessous) — comportement **identique** à
    avant ;
    3. rien d'utilisable → le **libellé honnête** existant (« mission non
    communiquée » / « (demande non précisée) ») : **aucun résumé n'est inventé** ;
    le résumé est **conservé avec la tâche**, **en cours ET en attente** (entrée de
    file), pour que la file affiche la même phrase que la mission lancée ;
    4. **cas de l'Assistant : son `prompt` n'est JAMAIS interprété.** Le message
    qu'il reçoit contient **tout son prompt système** (rôle + règles figées +
    contexte) **puis** la demande ; en extraire une mission revient à afficher ses
    **règles**. Tout prompt envoyé à sa session **joint donc systématiquement** le
    résumé court de la **demande** (`super_agent_mission_resume` : première ligne
    utile, détail markdown de tête retiré, plafond 120 car.), et **sans** demande
    exploitable l'affichage dit « **travail en cours** » (repli neutre et vrai).
    Défaut corrigé : le panneau affichait « Si une tâche déléguée ou une action
    échoue… » (règle de résilience) sous l'Assistant ; les agents de projet, dont
    le prompt porte de vrais titres de section, sont **inchangés** ;
  - **texte de la description** (repli, quand aucun résumé n'est fourni) : c'est
    la **tâche réellement confiée** (le
    dernier prompt réellement envoyé à la session) qui est lue —
    1) la ligne « **Tâche : <titre>** » reste **prioritaire** (prompts
    d'orchestration) ;
    2) sinon la phrase de l'**objectif** écrite en ligne (« Objectif : … »,
    « But : … ») — c'est la tâche réelle d'une demande de délégation ;
    3) sinon le **contenu de la section « Objectif »** (« ## Objectif »), son
    préambule technique sauté (« Contexte : version … ») ;
    4) sinon la **première ligne de contenu réel** : fences de code, préambule de
    **rôle** (« Tu es un … »), bloc de spécialité (« Rôle : … », « Capacités :
    … »), bandeaux `=== … ===` et en-têtes mécaniques de délégation
    (« ## Contexte », « ## Consignes », « ## Ce qu'il ne faut PAS faire », y
    compris en gras) sont **sautés** ;
    5) la phrase est **coupée à 120 caractères**, **proprement sur un mot**
    (jamais au milieu d'un mot), avec le suffixe « … » ;
  - **replis explicites** : si le texte enregistré n'est que le **rôle** de
    l'agent (« Tu es un … » — un rôle n'est jamais une tâche, cas d'un processus
    démarré sans tâche) → **« mission non communiquée »** (libellé honnête : plus
    jamais « en préparation », qui ne dit rien de la tâche) ; si le texte est
    introuvable → **« (demande non précisée) »** : jamais une ligne vide ni un
    texte inventé ;
  - **missions en attente** : les demandes mises en file (délégations
    inter-projets et files de `run_agents` / assistant) sont ajoutées dans le
    groupe « **En attente** » ; leur projet est affiché par son nom de dossier.
  - **mission ACCEPTÉE mais pas encore DÉMARRÉE → groupe « Démarrage »**
    (défaut corrigé, rapport `docs/rapports/RAPPORT-taches-demarrage-b1.md`) :
    entre l'envoi d'une mission et son premier événement de travail, l'état publié
    reste `idle` pendant le spawn de la session et la sonde du backend (jusqu'à
    2 × 5 s à froid) plus 2 s de poll ; la mission n'était donc dans **aucun**
    groupe et le volet restait **vide** alors qu'elle était partie. La famille est
    déduite de la **supervision déjà reçue** (aucun appel, aucune file nouvelle,
    une seule source de calcul : elle entre dans `collectQueuedMissions`, donc
    dans le calcul UNIQUE du bouton et du volet — `buildStartingMissions`,
    `trackMissionStarting`) :
    1. une session qui **porte une mission** (`prompt` / `resume` publiés dès
    l'envoi) et pour laquelle l'agent **ne travaille pas encore** est listée dans
    « Démarrage » — elle reste du côté « pas encore en cours » de
    `splitMissions`, donc **comptée dans le total** du bouton « Travail » et
    jamais dans les tâches en cours (cohérence compteur ↔ liste) ;
    2. **dédoublonnage strict** : dès que l'agent travaille (ou a travaillé) pour
    cette mission, la mémoire de suivi la marque démarrée et elle passe dans « En
    cours » — **jamais deux fois**, et **jamais de retour** en « Démarrage »
    quand le tour se termine (aucun clignotement). Un nouvel envoi change la
    signature (résumé + prompt) et repart donc en « Démarrage » ;
    3. **borne honnête** : `MISSION_START_MAX_MS` = **30 s** à partir du premier
    passage du front sur la mission (≤ 2 s après l'envoi, donc ≥ 28 s vus) —
    2,5 × la pire fenêtre du défaut (12 s) : elle ne disparaît pas avant d'avoir
    pu être vue, et un lancement qui n'aboutit **jamais** ne laisse **aucune
    ligne fantôme**. Couverture : `src/js/taches-demarrage.test.js`.
- **Alimentation du texte de mission (Rust)** : `AgentService` mémorise, **au
  passage obligé de l'envoi d'un prompt** (`send` / `send_sync` /
  `send_sync_timeout`, donc `rpc_manager`), le **dernier prompt réellement
  envoyé** à chaque session, **déjà tronqué** à 600 caractères
  (`prompt_snapshot`, `PROMPT_SNAPSHOT_MAX_CHARS`). La fenêtre de 600 caractères
  est **ancrée sur le premier marqueur de mission** du prompt (« ## Objectif »,
  « Objectif : », « === MISSION === », « Tâche : ») : le préambule de rôle qui
  précède ne consomme plus la fenêtre, donc **la mission est conservée même très
  loin après le rôle** (défaut corrigé : 80 caractères ne contenaient que le
  rôle). Un marqueur ne compte que s'il **commence une ligne** (indentation
  tolérée) : un titre **cité au milieu d'une phrase** — cas du prompt système de
  l'Assistant, qui parle de « ## Objectif » dans une règle — **n'ancre rien**
  (`find_anchor_at_line_start`). Un prompt plus court est conservé **tel quel**
  (aucune troncature inutile). Le **prompt entier n'est jamais stocké**. Une
  commande qui **n'est pas** un prompt (`get_state`, `set_model`, …) **n'écrase
  jamais** la mission en cours. L'information remonte par les champs **additifs**
  `prompt` (et `toolInProgress`) de `list_agent_sessions` puis
  `get_agent_supervision` : les consommateurs existants les ignorent.
- **Mission de l'Assistant (jamais déduite de son prompt système)** : les points
  d'envoi d'un prompt à sa session (`do_send_super_agent_prompt`, livraison et
  rejeu des résumés de sessions, initialisation d'un projet, question
  multi-projets) passent par `superagent_prompt_command(message, demande)`
  (`super_agent.rs`), qui joint la **mission courte** déduite de la **demande**
  seule. Le message envoyé au moteur est **rigoureusement inchangé** (prompt
  système + demande) : rien de son prompt n'est modifié.

<!-- HELP:super-agent-panneau-taches -->
- Le panneau du suivi (cercle en **haut à droite**, onglet « **Tâches** ») dit,
  sous chaque agent, **ce qu'il a à faire** en une phrase courte.
- Trois groupes, dans cet ordre : « **En cours** » (l'agent travaille),
  « **Démarrage** » (la mission vient d'être **acceptée** et n'a **pas encore**
  commencé) et « **En attente** » (la file). Une mission qui démarre **quitte**
  « Démarrage » pour « En cours » : elle n'apparaît **jamais deux fois**. Une
  mission qui ne démarre **jamais** (lancement en échec) sort de la liste au bout
  de **30 secondes** — aucune ligne fantôme ne s'installe.
- Pour l'**Assistant**, cette phrase est la **demande** qu'il traite (celle que
  vous lui avez adressée, ou une remise de compte rendu) ; s'il n'y a rien de
  précis à dire, la ligne affiche « **travail en cours** ». Elle ne reprend
  **jamais** un extrait de ses consignes internes.
- Les **agents de projet** sont inchangés : leur phrase reste l'**objectif** de la
  tâche qui leur a été confiée.
- La liste est **toujours à jour**, même si vous n'avez **jamais** ouvert
  l'onglet 🧭 Assistant : elle suit le travail en direct et, quand rien ne
  tourne, elle l'écrit noir sur blanc (« **Aucune mission en cours.** ») — jamais
  un volet vide.
<!-- /HELP:super-agent-panneau-taches -->
- **Alimentation du RÉSUMÉ COURT (Rust)** : le résumé fourni voyage avec la
  commande de prompt sous un champ **propre à Pilot** (`pilotResume`), que
  `AgentService` **extrait** puis **retire** avant l'écriture vers pi (aucun champ
  inconnu envoyé au moteur). Il est conservé **par session** (clé composite
  (projet, agent), plafond 120 caractères) et remonte par le champ **additif**
  `resume` (`list_agent_sessions` → `get_agent_supervision`). Un prompt **sans**
  résumé **efface** l'entrée (jamais un résumé périmé attribué à une autre
  mission) ; une commande qui **n'est pas** un prompt **n'y touche pas** ; un
  renvoi du **même** prompt (reprise après blocage) **reporte** le résumé.
- **Cliquer sur une mission** referme le panneau. Les **tâches** du suivi
  multi-projets (`get_super_agent_kanban`, statuts ouverts, filtre par projet,
  statut, échéance, case « À qualifier », idées) restent affichées **dans l'onglet Kanban
  dédié**, ouvert par le bouton Kanban de la barre latérale — ce volet ne les
  duplique plus.

### Espace d'écriture dédié (fichiers de suivi)
- L'Assistant dispose d'un **dossier de travail dédié** `~/.pilot/assistant/`
  pour ses **fichiers libres** (notes, analyses, exports), organisé par
  **client puis par projet** : `~/.pilot/assistant/<client>/<projet>/`.
- Il **crée lui-même** ses fichiers au fil de l'usage (pas de création
  systématique). Le dossier projet utilise le **nom du projet** (dernier
  segment du chemin), avec repli sur le chemin complet en cas de collision
  entre clients.
- **Garantie technique** : l'Assistant ne peut **jamais** écrire hors de
  `~/.pilot/assistant/` (une extension dédiée bloque toute écriture dans les
  projets). La base SQLite reste la **source de vérité** pour le suivi
  structuré (tâches, décisions, statuts).

### Poser des questions à l'utilisateur
- Quand des informations manquent (client inconnu, données de suivi
  incomplètes), l'Assistant peut **poser des questions** directement dans le
  chat : choix, confirmation Oui/Non, ou saisie libre, via des **boutons**
  inline. Répondez en cliquant ; l'Assistant reprend son raisonnement avec
  votre réponse.

### Ouvrir un projet discuté
- Quand vous **discutez d'un projet**, l'Assistant peut **l'ouvrir** pour le
  rendre **actif** (projet en cours de traitement), comme si vous l'aviez
  ouvert manuellement. S'il a un doute sur le projet, il vous **demande**
  d'abord.

### Suivre le projet en cours de discussion
- L'Assistant **sait quel projet est actuellement ouvert** dans Pilot et **sur
  quel projet il travaillait** (le dernier projet qu'il a ouvert).
- Si vous **changez de projet** en cours de discussion, il ne confond pas : il
  continue de suivre le projet dont vous parlez, et **vous demande de préciser**
  s'il a un doute.
- Il **apprend où se trouvent les projets** au fil des discussions et des
  sessions d'agents (liste des projets connus injectée à chaque tour).

### Obtenir un état structuré d'un projet (outil `project_snapshot`)
- L'Assistant peut obtenir une **vue d'ensemble structurée (lecture seule)**
  d'un projet via l'outil `project_snapshot(project)` : liste des
  fichiers/dossiers principaux, langages détectés, état Git (branche, derniers
  commits) et métriques de base (taille, lignes, fonctions, classes,
  TODO/FIXME).
- Il l'utilise pour **comprendre rapidement un projet** (structure, langages,
  santé Git) avant de répondre ou de planifier. **Ne modifie aucun fichier.**

### Déléguer le code à l'agent du projet
- Si vous demandez une **modification de code**, l'Assistant **ne modifie pas**
  lui-même : il **délègue la demande à un agent du projet**.
- **Méthode par défaut — agents spécifiques** : l'Assistant exécute le travail
  via des **agents spécifiques** (`run_agents` sur un agent du registre, ou
  `create_agent` pour un agent sur mesure), **pas** via l'agent standard du
  projet. Avant de déléguer, il **reformule/affine la demande** et, si elle est
  floue ou imprécise, **pose des questions** (`ask_input` / `ask_multi_choice`)
  pour obtenir le contexte nécessaire. Il construit une demande **claire et
  structurée** (contexte, objectif, contraintes, format de sortie attendu) et
  **affiche la demande finale** qu'il va envoyer avant de lancer l'agent.
- **`delegate_to_coder` est une EXCEPTION** : à n'utiliser que pour une tâche
  simple d'écriture directe sur le projet actif, quand aucun agent spécifique
  ne convient ET que la création d'un nouvel agent n'est pas justifiée. L'
  Assistant indique pourquoi il dérive dans ce cas.
- Il **démarre l'agent en arrière-plan** et lui **envoie la demande dans sa
  session de discussion**, en précisant qu'elle vient de l'Assistant projets.
  Vous **restez sur l'onglet Assistant** pour attendre son retour (la demande
  déléguée est visible dans la conversation de l'agent quand vous y basculez).
- **A13 — Assistant headless multi-projets** : l'Assistant peut déléguer à
  **n'importe quel projet**, même s'il n'est **pas actif** (outil
  `delegate_to_coder` avec le paramètre `project`). L'agent de ce projet est
  alors **démarré en arrière-plan (invisible)** automatiquement, **sans ouvrir
  le projet ni l'onglet**. Le suivi se traduit par une **détection de boucle**
  et une **notification de fin** (déposée dans le chat de l'Assistant) ; l'arrêt
  passe par l'outil `stop_agent` de l'Assistant. Le suivi de l'agent en
  arrière-plan (écoute des événements, détection de boucle, fin de tâche, arrêt
  ciblé) est **purement interne** : aucun bandeau visuel ne s'affiche au-dessus
  de la barre de saisie. L'arrêt et
  l'événementiel ciblent ce projet précis (canal d'événements et
  `stop_agent_session` routés par chemin de projet).
- **#28 — Fermeture de l'onglet** : quand l'Assistant **arrête l'agent standard
  du projet actif** (`stop_agent`), l'onglet de cet agent est **fermé
  automatiquement** s'il était ouvert (évite un onglet fantôme alors que
  l'agent n'est plus fonctionnel). Les onglets des agents
  secondaires/spécialisés et les onglets d'édition ne sont **pas** fermés.
- **#66 — Mise en file des délégations** : si vous déléguez une nouvelle
  demande pendant que l'agent travaille encore, elle n'est **plus perdue** :
  elle est **mise en file** et transmise automatiquement dès la fin de la
  tâche en cours. Un `stop_agent` **abandonne la file des DÉLÉGATIONS**
  (`abandonQueuedDelegations`) : chaque demande abandonnée est **nommée**,
  consignée au journal du projet et annoncée. La file des **MISSIONS**
  (`run_agents` / `run_assistant_agents`) suit une règle **différente** : un
  arrêt d'agent ne la détruit **jamais** (voir la règle 4 ci-dessous).
- **Rejeu de la file de missions, dans l'ordre d'arrivée (POINT G + P1)** : une
  mission (`run_agents` / `run_assistant_agents`) mise en file est rejouée
  automatiquement **dès que le projet est réellement libre**, y compris quand
  l'occupation vient d'une **commande manuelle** ou d'un **prompt distant** : la
  disponibilité est jugée sur les **sessions vivantes** (jamais sur un verrou),
  et le rejeu reste **armé** à chaque empilement, après chaque arrêt d'agent (P2)
  et tant qu'il reste des missions en file. Une demande qui arrive alors que
  d'autres attendent déjà **se place derrière elles** (motif
  `queue-order-respected` consigné). Deux **limites écrites** sont décrites plus
  loin, dans la section « Deux limites connues, écrites noir sur blanc » : une
  mission **déjà sortie de file** qui ne peut pas démarrer repart **derrière**
  les suivantes (aucune perte, aucun doublon, ordre d'attente susceptible de
  changer) ; une demande en file dont la **run propriétaire a disparu** est
  **conservée** et signalée (`queue-replay-no-owner`) plutôt qu'exécutée pour
  une autre mission.
- **Issue #87 — Accusé de lancement honnête (plus de faux « ok »)** : quand
  l'Assistant lance une mission (`run_agents`), l'accusé retourné à l'Assistant
  distingue désormais trois situations au lieu d'un « ok » fourre-tout :
  mission **réellement démarrée** (`launched: true`), mission **mise en file
  d'attente** parce qu'une run est déjà en cours (`queued: true` — l'accusé le
  dit explicitement au lieu d'un `launched/queued/preparing` tous faux), ou
  **refus avec raison explicite** (`ok: false` + `error`) au lieu d'un accusé
  `{ok:true}` sans aucune action. Le cas « abandon silencieux » (rien démarré,
  rien mis en file, aucune raison) devient impossible : la raison est forcée
  côté code. Techniquement : `computeRunLaunchVerdict` (super-agent.js) renvoie
  `ok = launched || queued || preparing`, et la branche de mise en file de
  `startRun` renvoie un objet `{queued:true,...}` au lieu du booléen `true`
  (qui était lu comme un objet → tous champs falsy).
- **RÈGLE 4 — une demande mise en file est TOUJOURS rejouée avec SA PROPRE
  demande, jamais perdue en silence** :
  - chaque demande mise en file porte une **identité de mission** (numéro
    monotone + agents visés) ; le compte rendu livré à l'Assistant est étiqueté
    avec cette identité (`[mission #7 · agents : codeur]`), donc un rapport de
    la mission A ne peut plus être attribué à la mission B ;
  - l'entrée de file retient la **run qui l'a mise en file** (`ownerRunKey`) ; si
    cette run n'existe plus, la demande est **CONSERVÉE** en file et le motif est
    **journalisé** (`queue-replay-no-owner`) + notifié — elle n'est jamais
    exécutée dans le contexte d'une autre mission ;
  - la file d'exclusivité vit au niveau du **projet** (et non de la run) : la fin
    d'une run ne détruit plus les demandes en attente ;
  - le watchdog ne vide **jamais** une file en silence : chaque mission
    abandonnée est **nommée**, le motif est écrit au journal des arrêts
    automatiques du projet (`queue-abandoned`) et l'abandon est notifié ;
  - **`/file vide`** abandonne les demandes en attente des **quatre** familles
    (commandes manuelles, missions, délégations, agents) : chaque famille écrit
    sa propre ligne `queue-abandoned` (`detected: "file-vide"`) avec les
    **libellés** des demandes abandonnées (`journalAbandonedFamily`,
    `project-queue-view.js`) — le vidage muet par `length = 0` n'existe plus ;
  - l'arrêt explicite d'un agent (`stop_agent`) abandonne la file de
    **délégations** (`abandonQueuedDelegations`) par le **chemin de production**
    unique : nommage + ligne de journal + message à l'écran ;
  - **P2 (D2) — une file de MISSIONS non vide n'est JAMAIS détruite par un arrêt
    d'agent** : un verrou de run n'est pas une preuve de disponibilité (verrou
    périmé, relance `stale-session-restart`, agent parqué). Les missions sont
    **CONSERVÉES** dans leur ordre par `keepQueuedRunAgentsMissions`
    (`super-agent.js`), **NOMMÉES** dans le journal des arrêts (`queue-kept`,
    `detected=stop-agent`) et à l'écran, et leur **rejeu est armé** : il ne démarre
    qu'une fois l'admission réellement libre, jugée sur les **sessions vivantes**
    (`isRunStillActive`) — jamais sur un verrou. Même règle pour la file
    `ASSISTANT_SPACE`. Défaut prouvé : trace du `2026-10-20T09:25:10.347Z`
    (`queue-abandoned`, mission #14 détruite alors que la session `codeur` n°13
    était encore vivante) ;
  Modules : `mission-identity.js` (identité pure), `agents-bus.js` (file par
  projet + garde de propriétaire), `super-agent.js` (estampille des 3 sites de
  mise en file, étiquetage du compte rendu, abandon tracé).
- **D3 — une seule identité de projet pour toutes les files et tous les
  verrous (corrigé)** : la clé d'un projet (index des files de missions, de
  délégations, d'exclusivité, verrou de run du bus, réservations de fichiers)
  venait du **chemin brut** à plusieurs endroits, alors qu'un autre module le
  normalisait déjà. Deux écritures du **même** dossier (« `G:\IA_PL\pilot` »,
  « `g:/ia_pl/pilot/` ») créaient donc deux files : l'une traitée, l'autre
  **invisible** (jamais relue, jamais rejouée, jamais abandonnée nommément).
  La normalisation vit désormais dans **un seul module pur**,
  `src/js/project-key.js` (`projectKey`, `sameProject`, `projectScopedKey`,
  `findProjectScopedKey`, `queueKeyMatchesProject`) : `super-agent.js`,
  `agents-bus.js`, `exclusivity-queue.js` et `reservations.js` s'y réfèrent au
  lieu de comparer des chaînes. Une **clé n'est jamais un chemin** : le chemin
  réel reste transmis tel quel au backend et aux agents, et il est mémorisé
  dans la file d'exclusivité (propriété **symbole**, invisible des itérations)
  pour que la trace d'un abandon vise le bon dossier. **Aucune migration** :
  les entrées posées avec une autre écriture du même chemin sont retrouvées
  (`findExclusivityKey`, `findProjectScopedKey`). Preuve de non-régression :
  `src/js/project-cle-unicite.test.js` (4 écritures d'un même dossier → **une**
  file, un ordre, une réservation ; échoue si une structure recomparait le
  chemin brut).

### Retrait CIBLÉ d'une mission en file (une seule, jamais la file entière)
- **Besoin** : la file ne savait oublier qu'**en entier**
  (`abandonProjectMissionQueue`, geste `/file vide`). Une demande devenue
  périmée gardait sa place et prenait le verrou du projet à son tour — trace
  `2026-10-22T11:02:54 reason=queue-order-respected detected=admission-fifo`
  (quatre missions périmées ont bloqué le travail utile).
- **Point unique** : `removeQueuedMission(projectPath, {id|index|label, reason,
  detected})` (`super-agent.js`) — **nouvelle fonction**, à côté de
  `abandonProjectMissionQueue` qui **reste inchangée** (le geste « tout
  abandonner » n'est pas réécrit). Retrait **atomique** (`splice` d'une seule
  entrée), ordre des autres **préservé** ; la clé de file est supprimée si elle
  devient vide. **Le verrou du projet n'est ni pris ni perdu** : le retrait ne
  pose aucune réservation (`pendingMissionClaims`) et ne touche pas au bus ;
  `armQueueReplay` est **ré-armé** si des demandes restent, donc la suivante
  démarre dès que le projet est réellement libre. Les agents **jetables** visés
  par la mission retirée sont purgés.
- **Refus explicites, non destructifs** (message « Rien n'a ete retire ») :
  `no-selector`, `empty`, `mission-running` (le projet a un run en vol ou une
  réservation vivante : retirer la mission en cours est un **autre** geste),
  `not-found`. Côté vue de file : `no-rank`, `running` (le rang affiché est celui
  de la tâche en cours), `not-a-mission` (le rang désigne une commande, une
  délégation ou un agent).
- **Rang affiché → mission** : la traduction vit **uniquement** dans
  `project-queue-view.js` (`removeProjectQueuedMission`), seule source de
  l'ordre affiché ; elle compte les entrées `kind === "mission"` de
  `view.waiting` (le rang 1 étant la tâche en cours) puis délègue le `splice` à
  `super-agent.js`.
- **Journal** : une ligne `reason=queue-mission-removed` au **même** point que
  les abandons (`traceQueueAbandon`) — **pas de second journal** — avec
  `detected` = `file-retire` (commande), `assistant-remove-one` (outil de
  l'Assistant) ou `remove-one` (appel direct), et le **nom** de la mission
  retirée (les autres ne sont pas nommées : elles n'ont pas bougé).
- **Accès** : commande **locale** `/file retire <rang>` (`agent-pi.js`, jamais
  envoyée au moteur) et outil assistant `remove_queued_mission`
  (`pilot-assistant-actions.ts`, sentinel
  `PILOT_ASSISTANT_QUEUE_REMOVE::`, intercepté dans
  `handleSuperAgentExtensionUiRequest`).
- **Hors périmètre (question ouverte)** : reconnaître **automatiquement**
  qu'une mission est **déjà livrée** (livrable déposé, résultat obsolète) et
  proposer son retrait — non tranché.
- Preuves : `src/js/file-attente-retrait-mission.test.js` (18 cas : ordre
  préservé, verrou ni pris ni perdu, journal, refus de la mission en cours,
  rang affiché, câblage `/file retire` + outil assistant).

<!-- HELP:file-attente-retrait-cible -->
### Retirer UNE seule demande de la file (sans tout vider)
- Une demande déjà en attente peut devenir **sans objet** (périmée, remplacée
  par une autre) : elle ne doit pas garder sa place et prendre le projet à son
  tour. Pilot sait donc la **retirer seule**.
- **`/file retire <rang>`** : retire **la mission de l'Assistant** du rang
  affiché par `/file`. Le rang de la **tâche en cours** est le **1er** : la
  première demande en attente est donc le **2e** rang. Les **autres** demandes
  **restent en file, dans leur ordre**, et la tâche en cours **continue**.
- L'**Assistant** peut faire ce retrait ciblé sur votre demande (il désigne la
  demande par son rang ou par son numéro de mission).
- Ce qui n'est **pas** fait : la **tâche en cours** n'est **jamais** retirée par
  ce geste (pour l'arrêter, c'est l'arrêt de l'agent), aucune **autre** demande
  n'est supprimée au passage, et `/file vide` (tout abandonner) reste un geste
  **distinct**.
- Le retrait est **annoncé** à l'écran et **consigné** dans le journal des
  arrêts du projet (`queue-mission-removed`) : on sait toujours **quelle**
  demande a été retirée et **pourquoi**.
<!-- /HELP:file-attente-retrait-cible -->

<!-- HELP:super-agent-agent-jetable -->
### Un agent jetable, juste pour une tâche
- Vous pouvez demander un travail « comme le ferait un auditeur de sécurité »
  sans créer d'agent : l'Assistant **décrit lui-même l'agent dans sa demande**
  (un nom et un rôle). Cet agent **jetable** existe **seulement le temps de la
  tâche**.
- Il **n'apparaît jamais** dans votre liste d'agents, ne s'ajoute **pas** au
  registre et **ne modifie aucun** agent existant : rien n'est enregistré, ni
  avant ni après.
- Son **travail reste visible** : sa session et son compte rendu sont lisibles
  comme pour n'importe quel agent ; seule sa **définition** disparaît à la fin
  de la tâche.
- Il peut être **mêlé** à des agents du registre dans une même mission : seuls
  les agents jetables disparaissent ensuite.
- Il **porte son nom à l'écran** : dans la **liste des agents** (en haut à
  droite), dans la **liste des tâches en cours** (en bas à droite) et dans
  l'**onglet** de l'agent, vous lisez le **nom significatif** que l'Assistant a
  donné à l'agent (rôle court, borné à 40 caractères), et non son identifiant
  interne (`eph-…`). Si aucun nom n'est fourni, l'identifiant s'affiche comme
  avant ; rien ne change pour les agents du registre ni pour l'Assistant.
- Un agent **réutilisable** (que vous voulez retrouver plus tard) se crée
  toujours normalement : c'est l'agent « sur mesure » du registre.
<!-- /HELP:super-agent-agent-jetable -->

<!-- HELP:super-agent-livrable -->
### Écrire un fichier : le bon agent, et une preuve à la fin
- Un agent marqué **lecture seule** n'écrit **jamais** de fichier : il analyse,
  planifie ou rend un avis. Si la demande lui demande **explicitement** d'écrire,
  de créer ou de modifier un fichier, Pilot **refuse de lancer** : rien ne
  démarre, et le message dit **quel agent** a été visé, **pourquoi** (il ne
  modifie aucun fichier) et **quoi faire** (désigner un agent qui écrit, par
  exemple le codeur).
- Le refus ne concerne **que** les demandes claires : une demande de **lecture**
  part normalement, une demande **ambiguë** aussi (dans le doute, l'agent est
  lancé comme avant). Une mission qui contient **au moins un agent qui écrit**
  n'est jamais refusée.
- **La preuve du livrable** : quand la demande **déclare les fichiers attendus**,
  Pilot vérifie **à la fin de la tâche** que chacun existe réellement sur le
  disque. Un fichier déclaré **absent** fait **échouer** la tâche, avec un
  message qui nomme le fichier manquant et le dossier où il était attendu — vous
  n'obtiendrez jamais « terminé » sur un fichier qui n'existe pas. Un fichier
  présent (même vide) donne le déroulement habituel, plus une confirmation.
- **Sans fichier déclaré, rien ne change** : les demandes existantes se
  comportent exactement comme avant.
- Cela vaut pour les **deux écrans de lancement** (agents du projet, agents
  d'assistant), pour la **délégation directe**, pour les **agents jetables** et
  pour les demandes **mises en file** (la vérification a lieu quand la tâche se
  termine réellement).
<!-- /HELP:super-agent-livrable -->

<!-- HELP:file-attente-identite-mission -->
### Une demande en attente garde son identité (jamais perdue en silence)
Quand l'Assistant met une demande en **file d'attente** (un agent travaille déjà
sur le projet), cette demande n'est plus une simple ligne anonyme :

- elle reçoit un **numéro de mission** et les **agents visés** ; le compte rendu
  qui vous revient est **étiqueté** avec cette identité
  (`[mission #7 · agents : codeur]`). Vous voyez donc toujours **quelle**
  demande a produit **quel** résultat ;
- **la file affiche ces agents** : chaque demande **en attente** dit, à côté de
  son rang et de son libellé, **quel agent va la traiter** (« en attente (2e) :
  mission « … » · agent : codeur »), dans le bloc de file de l'onglet comme dans
  `/file`. L'agent affiché est celui **enregistré avec la demande** ; l'agent
  **principal du projet** s'affiche « agent : principal du projet » (son
  identifiant technique `default` n'apparaît jamais) ; s'il n'est pas connu, la
  ligne l'écrit (« agent : agent non défini ») — **jamais un blanc** ;
- la demande appartient à la **file du projet** : la fin d'une tâche ne fait plus
  disparaître les demandes encore en attente ;
- une demande n'est **jamais** exécutée à la place d'une autre : si la tâche qui
  l'avait mise en attente a disparu, elle **reste en file** et le motif est
  **consigné** (journal des arrêts automatiques du projet) et signalé ;
- **arrêter un agent ne perd plus les demandes en attente** : la file d'un
  projet n'est **jamais vidée** par un arrêt d'agent. Les demandes sont
  **conservées**, **nommées** dans le journal du projet et à l'écran, puis
  **rejouées** dès que le projet est réellement libre — la disponibilité est
  jugée sur les **sessions vivantes**, jamais sur une marque d'occupation
  périmée ;
- si une file doit être **abandonnée** (tâche jugée bloquée), chaque demande
  abandonnée est **nommée** dans le message et le motif est **consigné** : plus
  d'abandon silencieux ;
- la commande **`/file vide`** qui vide la file nomme elle aussi **tout** ce
  qu'elle abandonne (commandes, missions, délégations), **famille par famille**,
  et consigne le motif dans le journal du projet : rien ne disparaît sans
  laisser de trace ;
- **une seule** demande peut être retirée sans toucher aux autres : la commande
  **`/file retire <rang>`** retire **la mission de l'Assistant** de ce rang
  (le rang est celui affiché par `/file` : la tâche **en cours** occupe le rang 1,
  donc la première demande en attente est le rang 2 — `/file` affiche ces rangs).
  Les **autres** demandes restent en file, **dans leur ordre**, et la tâche en
  cours **continue** : c'est le geste à utiliser quand une demande déjà en
  attente est devenue **sans objet** (périmée, remplacée par une autre) et ne
  doit pas prendre le projet à son tour. Le retrait est **consigné** dans le
  journal du projet et **annoncé** à l'écran ; le **rang de la tâche en cours**
  n'est **pas** retirable (arrêter un agent est un autre geste), et l'**Assistant**
  peut faire ce retrait ciblé à votre demande.
<!-- /HELP:file-attente-identite-mission -->

- **Un agent ne s'arrête plus tout seul juste après son lancement** : les
  arrêts automatiques (inactivité d'une tâche, garde-fou anti-boucle, plafond de
  tours) ne concernent plus que **la tâche qui les a déclenchés** — ils ne
  peuvent plus couper l'agent d'une autre mission ou d'un autre projet. Le
  bouton d'arrêt, lui, arrête toujours tout. Si un agent s'interrompt vraiment,
  la cause est désormais **écrite dans un journal**
  (`agent-ops.log`, dossier de données de Pilot).
- **Bug #81 — Délégation débloquée après arrêt auto de l'agent standard** :
  quand le moniteur d'anomalies **arrête automatiquement** l'agent standard
  (process pi standard figé vivant, `agent-auto-stopped` avec reason dédié
  « Agent standard »), super-agent.js **libère `delegationBusy` et flushe la
  file de délégation** (`flushDelegationQueue`) : la prochaine demande en
  attente est transmise à un agent **redémarré** (la session a été arrêtée
  côté Rust, la délégation suivante la recrée). L'ordre de la file est
  préservé. L'UI de l'onglet agent (agent-pi.js) passe à « Arrêté ».
  Contrairement à un `stop_agent` explicite, l'arrêt auto **ne vide pas** la
  file : les demandes en attente sont bien rejouées.
- **Purge automatique avant chaque demande** : par défaut, avant chaque
  nouvelle demande déléguée à un agent (délégation directe **ou** demande mise
  en file), la conversation de cet agent est **purgée** si elle n'est pas déjà
  vierge — départ d'une discussion neuve, **modèle actif préservé** (même
  mécanique que le bouton « + » de l'onglet agent). Chaque demande repart
  ainsi d'un contexte propre au lieu d'hériter de tout l'historique
  (délégations « hyper long »). Réglage **Options → Assistant → « Purger la
  conversation de l'agent avant chaque demande de l'Assistant »** (activé par
  défaut). Vos **messages directs** dans l'onglet agent ne déclenchent
  **jamais** de purge : vos retouches gardent leur fil.
- **`run_agents` non bloquant** : quand l'Assistant lance une run d'agents
  (`run_agents`), la run est lancée **en arrière-plan** et l'Assistant **finit
  son tour immédiatement** — vous pouvez **continuer à lui parler** pendant que
  les agents travaillent (la zone de saisie reste active, plus de blocage). Le
  **résultat agrégé** est injecté à l'Assistant à la fin de la run, qui vous en
  fait le compte-rendu.
- **Anti-boucle `run_agents`** : pour fiabiliser les relances, chaque
  délégation `run_agents` est **purifiée** comme le mode manuel :
  - **Brief structuré** : la tâche est enveloppée dans un prompt structuré
    (contexte, objectif, consignes, ce qu'il ne faut PAS faire) pour que
    l'agent réussisse du premier coup.
  - **Purge de la conversation** : la conversation de chaque agent est purgée
    avant la run (contexte vierge), indépendamment de `keep_context`.
  - **Processus neuf (restitution fiable)** : pour une relance, l'éventuelle
    session `agent_process` de la run précédente est **arrêtée** avant le
    lancement, de sorte qu'un **process pi neuf** démarre avec un contexte
    vierge — on ne reprend pas un processus réutilisé qui pourrait conserver
    l'ancienne conversation (« renvoie l'ancienne session ») ou ignorer la
    purge s'il est encore en streaming. Une session d'agent ouverte à la main
    (onglet agent, mode `main_session`) n'est jamais tuée.
  - **Détection de boucle** : les appels `run_agents` identiques répétés sont
    détectés (empreinte `agent_ids` + tâche) et arrêtent l'Assistant.
  - **Consigne système** : l'Assistant est invité à construire des prompts
    structurés et, en cas d'échec, à **relancer en changeant d'approche** (au
    moins une fois).
- **#65 — Reprise après arrêt** : après un `stop_agent`, l'agent du projet est
  **recréé automatiquement** à la prochaine délégation (ou purge) — plus
  besoin de redémarrer Pilot pour redéleguer.
- **#64 — Agent invisible joignable** : rédéléguer à un agent invisible déjà
  actif **reprend** sa session au lieu de bloquer (l'Assistant n'a plus besoin
  de l'arrêter entre deux demandes).
- **C2 — L'agent cible est OBLIGATOIRE (échec franc, aucun repli silencieux)** :
  la délégation (`delegate_to_coder`) exige l'`agent_id` de l'agent cible
  (paramètre **requis** du schéma de l'outil). **Sans agent désigné**, la
  délégation est **refusée** avec un message explicite (« Aucun agent n'a été
  désigné pour cette tâche. Précise quel agent doit la faire ») et **AUCUN
  agent n'est lancé** : plus aucun repli implicite sur le codeur du projet ni
  sur l'agent `default`. Si l'agent **désigné** n'existe **pas** dans le
  registre, même refus explicite citant l'id demandé. Décision portée par la
  fonction **pure** `resolveDelegationTargetDecision` (super-agent.js ;
  `resolveDelegationTarget` ne collecte que l'I/O), couverte par
  `src/js/super-agent-delegation-target.test.js` (agent résolu, introuvable,
  absent).
- **Restitution fiable du résultat (fin de run → Assistant)** : le résultat
  d'une délégation arrive **automatiquement** dans la conversation de
  l'Assistant à la fin de la tâche — même si pi a dû **se relancer** après une
  erreur transitoire (le résultat produit APRÈS la relance fait foi), même si
  vous avez posté une nouvelle demande entretemps (mise en file) et sans
  avoir à réouvrir l'onglet 🧭. Côté technique (détails § 3) : événement pi
  `agent_settled` traité comme filet de finalisation, erreurs fournisseur
  différées à la fin du tour, et rejeu automatique des résumés en attente dès
  la libération de la session Assistant. Le message versé est **borné** (plafond
  unique défini côté Rust, texte complet conservé — voir § 5 « Apprentissage en
  continu »). En cas de doute, l'Assistant relit
  un résultat via `get_delegation_result(project, sessionId?|agent_id?)`
  (`sessionId` exposé par `list_agent_sessions` ; à défaut le jsonl le plus
  récent de l'agent ou sa session vivante `get_messages`), lecture seule et
  sûre à retenter. La recherche du fichier de session couvre aussi les
  **sous-dossiers d'agents** (`<sessions>/<projet>/<agent_id>/`), pas seulement
  la racine du projet.
- **L'agent lancé est exactement l'agent demandé (mission 381)** : `run_agents`
  et `run_assistant_agents` démarrent **directement** les agents nommés. Aucune
  **estimation préalable automatique** n'est plus déclenchée : le texte d'une
  mission n'est **jamais** remis à un agent que vous n'avez pas demandé (plus
  de planificateur lancé en amont, plus de session intermédiaire qui occupe le
  créneau du projet). Un identifiant **inconnu** est **refusé** explicitement :
  le message nomme les identifiants inconnus, précise qu'**aucun agent n'a été
  lancé** et donne la **liste des agents disponibles** (fonction pure
  `unknownAgentsError`, super-agent.js). Aucun routage silencieux, aucune
  substitution : un agent demandé mais **impossible à démarrer** (modèle non
  réglé, etc.) produit une **erreur nommant cet agent**, jamais son
  remplacement. Preuves : `agent-demande-exact.test.js`,
  `agent-inconnu-refus.test.js` (preuve d'**exécution** : un identifiant
  inconnu ne démarre **rien** et ne se replie sur aucun agent du registre),
  `verrou-par-projet.test.js` (T6) et `reservations.test.js`.
- **Plan structuré sur demande explicite (plan-maker, facultatif)** : si vous
  demandez un plan, l'Assistant peut appeler l'agent **`plan-maker`** (via
  `run_agents`, en le **nommant**) pour obtenir un **plan structuré** (tâches,
  fichiers concernés, coût estimé en tokens, contraintes suggérées), puis
  **délègue au codeur** avec ce plan et les contraintes retenues. Le
  `plan-maker` est un agent lecture seule qui ne modifie aucun code ; il ne
  fait que produire le plan JSON. Cette étape est **toujours facultative et
  explicite** : elle n'est plus jamais automatique ni imposée avant un
  lancement. L'Assistant ne lance **jamais** cet agent de lui-même — il faut
  le demander.
- **Le plan-maker va au bout et livre un plan complet (mission 384)** : une
  mission qui le **nomme seul** produit un plan **exploitable** — au moins une
  tâche, chacune avec un intitulé et des fichiers — et la session **reste
  ouverte** tant que ce plan n'est pas arrivé (aucune clôture « au bout de
  quelques secondes »). Si le planificateur se termine **sans livrable**, la
  mission est rapportée en **ÉCHEC explicite** nommant l'agent (« la demande n'a
  donc PAS été exécutée ») : plus de faux succès ni de rapport vide qui laissait
  croire que le plan existait, et le projet est **immédiatement libre** pour
  relancer la planification. Technique : une mission de **LECTURE** ne prouve
  jamais son travail par le disque (`provesWorkOnDisk` renvoie `false` dès que
  `readonly` — un commit tombé pendant la run vient d'ailleurs), une part sans
  livrable et sans preuve disque est enregistrée `error` (au lieu de `done`
  vide agrégé en « (aucun texte) »), et `parallelMissionFailed` (pures, dans
  `agents-bus.js`) fait livrer la mission en échec dès qu'**aucune** part n'a
  livré. Couverture : `src/js/planificateur-plan-complet.test.js`.

### Contexte de suivi joint automatiquement à la demande déléguée
- Avant de **lancer un agent** — agent du projet (`run_agents`), agent hors
  projet (`run_assistant_agents`) ou délégation directe (`delegate_to_coder`) —
  l'Assistant **préfixe à la demande un bloc de contexte COURT**, construit à
  partir de **son propre suivi** : projet concerné, tâches suivies, décisions
  et sessions récentes, sujet et chantiers en cours (mémoire de session).
- **Le bloc est relu AU LANCEMENT, jamais figé à l'arrivée de la demande.** Une
  demande mise en file derrière une mission en cours ne peut donc pas emporter
  le contexte de la mission **précédente** : à sa sortie de file, le suivi est
  relu (`refreshAssignmentsBrief`) et c'est l'état du moment qui part. Même
  règle pour la file de délégations (`delegate_to_coder`), relue à la
  transmission.
- But : l'agent part **au courant** de ce qui a déjà été fait, décidé ou réglé —
  il ne refait pas et ne contredit pas l'existant (moins d'allers-retours).
- Le bloc est **bref et borné** (plafond **700 caractères**, troncature
  annoncée) et **clairement séparé** de la demande : il porte son propre titre
  (`## Contexte de suivi (assistant)`) et la demande complète le suit.
- **Rien d'inventé** : si l'Assistant ne sait rien du projet (projet non suivi,
  mémoire vide), **aucun bloc** n'est ajouté — la demande part inchangée.
- Il est **visible** dans la conversation : le message « 🧠 Contexte de suivi
  joint à la demande de l'agent. » signale l'ajout (au **lancement** de la
  mission, donc au démarrage réel et non à son arrivée).
- Les décisions récentes sont exposées par la base de suivi **par client** :
  quand le client suit **plusieurs projets**, le bloc le dit explicitement
  (« Décisions récentes (client X) ») au lieu de les faire passer pour celles
  du projet.
- Technique (module **pur** `src/js/super-agent-context.js`, I/O et branchement
  dans `super-agent.js` — `loadDelegationContext` / `attachDelegationContext` /
  `refreshAssignmentsBrief`) :
  lecture de `get_super_agent_tracking` + `super_agent_load_session_memory`,
  **fail-open** (toute erreur → aucun bloc, la délégation n'est jamais
  bloquée). Couverture : `src/js/super-agent-context.test.js` +
  `src/js/file-attente-contexte-au-lancement.test.js`.

<!-- HELP:super-agent-delegation-context -->
### Le contexte que l'assistant joint à la demande qu'il délègue
Quand l'**Assistant** confie une tâche à un agent, il **ajoute
automatiquement un court rappel de contexte** en tête de la demande : le
**projet** concerné, les **tâches** qu'il suit, les **décisions** et les
**sessions récentes**, ainsi que son **sujet** et ses **chantiers en cours**.
L'agent démarre donc **déjà au courant** de ce qui a été fait et décidé : il
évite de refaire ou de contredire l'existant.

Ce rappel est **volontairement bref** (quelques lignes, longueur plafonnée et
troncature annoncée) et **distinct de votre demande**, qui suit. L'Assistant
n'invente rien : s'il ne sait rien de ce projet, **il n'ajoute aucun rappel**.
Vous voyez, dans la conversation, le message « 🧠 Contexte de suivi joint à la
demande de l'agent. » lorsqu'un rappel a été ajouté — au moment où la mission
démarre réellement (une demande qui patiente en file est donc annoncée quand
son tour arrive, avec le contexte de **sa** tâche).
<!-- /HELP:super-agent-delegation-context -->

### L'Assistant, coordinateur de la redistribution des tâches
L'Assistant est le **coordinateur** de la redistribution des tâches entre les
agents du registre global (base SQLite). Il peut :

1. **Créer un agent sur mesure** (outil `create_agent`) s'il estime que les
   agents disponibles ne conviennent pas à la tâche : il définit lui-même le
   rôle (system prompt), le nom, l'icône, la description, les modèles (pi/plh),
   la lecture seule, le budget et la profondeur. L'agent est ajouté au registre
   global et devient aussitôt sélectionnable.
2. **Choisir quels agents utiliser** (outil `run_agents`) : il sélectionne les
   agents disponibles (par leur id) qui lui semblent les plus adaptés et leur
   confie une tâche. Pilot les lance et renvoie le résultat agrégé
   à l'Assistant, qui continue son raisonnement.
3. **Décrire un agent jetable à la volée** (même outil `run_agents`, paramètre
   `agents`) : pour un besoin **ponctuel**, l'Assistant fournit la définition de
   l'agent **dans la demande** (`name`, `role`, éventuellement `icon`,
   `description`, `readonly`, `keep_context`, `model`). Cet agent **n'existe
   qu'en mémoire**, le temps de la tâche : **aucune ligne n'est écrite** dans le
   registre, il **n'apparaît pas** dans la liste des agents et sa définition
   **disparaît** à la fin de la tâche — son travail (session, compte rendu)
   reste visible. Voir § « Agent jetable (mémoire seule) ».

Ainsi, au lieu de tout déléguer à l'agent standard, l'Assistant constitue
l'équipe la plus adaptée à chaque demande (codeur, testeur, reviewer, un agent
qu'il a lui-même créé, ou un agent jetable fourni pour la tâche).

### Agent jetable (mémoire seule)

Un **agent jetable** est une définition d'agent fournie **dans la demande**
de l'Assistant (`run_agents`, paramètre `agents` : objets
`{ name, role, icon?, description?, readonly?, keep_context?, model? }`).
Contrat de durée de vie et d'isolement :

- **Aucune écriture en base** : l'agent vit dans `ephemeral_agents`
  (`Mutex<HashMap<String, Agent>>`) de l'`AgentService`. Rien n'est écrit dans
  les tables `agents` / `agent_views` — ni à la création, ni à la fin. C'est un
  invariant de la mission : **le registre du propriétaire reste identique**.
- **Identifiant réservé `eph-…`** (`makeEphemeralAgentId`, module
  `src/js/ephemeral-agents.js`) : un agent jetable ne peut ni s'appeler comme un
  agent du registre ni l'écraser (`mergeAgentsWithEphemeral` : le persistant
  gagne toujours en cas de collision ; la purge ne vise **que** les `eph-…`).
- **Anti-seed** : `AgentService::start` ne crée une ligne que lorsque
  `get_agent` répond `None`. `get_agent` résout l'agent jetable **en mémoire**
  (repli `ephemeral_agent`), avec une résolution de portée **tolérante**
  (portée globale ⇄ n'importe quelle portée, pour qu'aucune variante de chemin
  ne fasse retomber sur `None`) ; un agent jetable d'un **autre projet nommé**
  reste refusé. `upsert_agent`, `set_visible`, `set_state` portent en outre un
  garde éphémère (mise à jour mémoire seule).
- **Visible comme session, invisible comme agent** : `visible = false` en
  permanence (pas d'onglet), mais la session est listée parmi les sessions
  actives tant qu'elle travaille — comme un agent en arrière-plan.
- **Nom affiché ≠ identité technique** : `get_agent_supervision`
  (`dashboard.rs`) publie un champ **ADDITIF** `name` — le nom lisible de
  l'agent jetable, lu **en mémoire seule**
  (`AgentService::ephemeral_agent_name`, borné à 40 caractères **marque de coupe
  « … » comprise** par `clip_agent_display_name` — `AGENT_DISPLAY_NAME_MAX_CHARS`
  est la seule source de vérité de cette limite, donc jamais 41 caractères) — et
  le champ `agent` conserve son sens :
  l'**identité** (`eph-…`). Le frontend (`flattenAgents`,
  `src/js/agent-activity.js`) affiche `label = a.name || a.agent`, tandis que
  `rawId` / `agentId` restent bâtis sur `a.agent` : l'**ouverture d'onglet
  ciblée**, l'**arrêt ciblé** et l'**horodatage d'activité** continuent
  d'utiliser l'identifiant. Aucun agent du registre (ni l'Assistant) ne reçoit
  ce champ : leur affichage est inchangé. Aucune migration (définition en
  mémoire, purgée en fin de tâche). Preuves :
  `src/js/agent-activity-nom-jetable.test.js` et les tests
  `nom_d_affichage_d_un_agent_jetable_est_expose_et_borne` /
  `nom_d_affichage_borne_a_40_caracteres` (`agent_service.rs`),
  `le_resume_de_supervision_porte_le_nom_sans_toucher_a_l_identite`
  (`dashboard.rs`).
- **Fin de tâche = disparition** : purge à la conclusion de la mission
  (`settleRun`), à l'abandon d'une mission jamais lancée
  (`abandonQueuedRunAgentsMissions`), à l'arrêt de la session (`stop_owned`),
  et sur `stop_all_agent_processes` / `shutdown_all`. L'arrêt de session passe
  par l'entonnoir `stopAgentWithTrace` (motif `ephemeral-task-ended`, tracé dans
  `.pilot/agent-stops.log`). Le **travail** (session, compte rendu) survit à la
  purge.
- **Échec fermé côté préparation, ouvert côté purge** : si l'enregistrement
  mémoire échoue, le lancement est **annulé** (jamais de repli silencieux vers
  un seed en base) ; la purge, elle, ne fait jamais échouer la fin de tâche.
- **Commandes Tauri** (`agents.rs`) : `register_ephemeral_agent`,
  `clear_ephemeral_agent`, `list_ephemeral_agents`.
- **Preuve d'exécution** : `src/js/agent-jetable.test.js` (lancement réel sans
  aucune commande d'écriture de registre, purge des deux étages + trace
  d'arrêt + travail visible, registre intact) et, côté Rust,
  `agent_jetable_vit_en_memoire_et_disparait_a_la_purge` /
  `etat_d_un_agent_jetable_reste_en_memoire` (`agent_service.rs`).

### Héritage du contexte projet pour les agents spécifiques (#21)
Quand le paramètre **« Héritage du contexte projet pour les agents
spécifiques »** est activé (Options → section Assistant, désactivé par
défaut), les agents spécifiques que l'Assistant utilise (outil `run_agents`)
héritent du contexte que reçoit l'agent standard du projet : le rôle/prompt ET
les activations de contexte (RAG / Context Engine, mémoire projet
`PROJECT_MEMORY.md`, Code Graph). L'héritage se fait **en plus** du rôle propre
de l'agent cible (concaténation). Désactivé, l'agent spécifique ne reçoit que
son rôle propre (comportement actuel).

<!-- HELP:super-agent-inherit-context -->
### Hériter du contexte projet pour les agents spécifiques
Dans **Options → section Assistant**, l'option **« Héritage du contexte
projet pour les agents spécifiques »** (désactivée par défaut) fait hériter
aux agents spécifiques que l'Assistant utilise (outil `run_agents`) du contexte
que reçoit l'agent standard du projet : le rôle/prompt, le RAG / Context
Engine, la mémoire projet (`PROJECT_MEMORY.md`) et le Code Graph. L'héritage
s'ajoute au rôle propre de l'agent cible (concaténation). Désactivée, l'agent
spécifique ne reçoit que son rôle propre.
<!-- /HELP:super-agent-inherit-context -->

<!-- HELP:super-agent-memory -->
### Transférer la mémoire de votre assistant entre deux postes
Dans **Options ⚙️ → section « Mémoire (transfert de suivi) »**, vous pouvez
**exporter** ou **importer** la mémoire de votre assistant (son suivi des
projets/tâches et sa configuration) pour la déplacer d'un ordinateur à l'autre.

- **Exporter** : cochez les contenus à embarquer (Suivi des projets/tâches,
  Réglages, Comportement, Apparence), puis cliquez **« Exporter la mémoire »**.
  Un **fichier unique** est sauvegardé, que vous pouvez transférer sur l'autre
  poste. Aucune donnée personnelle (coffre, conversations privées) ne part :
  uniquement ce que vous cochez.
- **Importer** : cliquez **« Importer la mémoire »**, choisissez le fichier, puis
  **confirmez**. L'import **remplace** sur ce poste la mémoire (et les sections
  cochées de la configuration) par celle du fichier.
- La mémoire est relisible même sur un autre poste (format unifié et versionné) :
  votre assistant retrouve aussitôt le suivi et les préférences que vous aviez
  définis.
<!-- /HELP:super-agent-memory -->

### Relayer les questions des agents du projet (tâche #22)
- Quand un **agent du projet** (ex: agent de contrôle) a besoin d'une décision
  de votre part pendant son travail (choix d'une approche, confirmation,
  saisie…), c'est **l'Assistant qui sert d'interface** : la question de l'agent
  est **affichée dans la conversation de l'Assistant**, avec les options
  proposées.
- Vous pouvez **annoter / modifier / valider** votre réponse avant qu'elle soit
  envoyée à l'agent (champ de précision optionnel + bouton de validation).
- La réponse est transmise au **bon agent** (chaque agent est identifié : ses
  réponses ne sont pas mélangées), qui poursuit son travail débloqué.
- **Agents lancés en arrière-plan** : la question remonte de la **même façon**,
  sans exiger que l'onglet 🧭 soit ouvert ou actif (auparavant, le bus d'agents
  répondait à leur place : `confirm` → approuvé, `select` → première option,
  `input` → annulé, si bien que la question n'était jamais visible). Aucune
  réponse n'est désormais décidée à votre place ; la demande reste **en attente**
  tant que vous ne répondez pas (limite de **45 minutes**, `anomaly.rs`
  `AWAITING_USER_MAX_SUSPEND_SECS`, qui empêche le gel de la file).

<!-- HELP:super-agent-relay-questions -->
- Quand un agent lancé par l'Assistant a besoin d'une décision de votre part
  (choix, confirmation, saisie), la question **remonte dans la conversation de
  l'Assistant** avec ses options — même si l'agent tourne en arrière-plan et même
  si vous n'êtes pas sur l'onglet 🧭. Aucune réponse n'est décidée à votre place ;
  sans réponse, la demande attend (plafond de 45 min).
<!-- /HELP:super-agent-relay-questions -->

### Apprendre en continu
- À chaque **fin de session d'un agent** (chat ou orchestration), un **résumé**
  est envoyé automatiquement à l'Assistant : il apprend ainsi ce qui a été fait,
  décidé et livré, sans que vous ayez à le lui demander.
- Les **échanges insignifiants** (salutation, accusé de réception, réponse trop
  courte ou vide) sont **ignorés** : seule la mémoire utile est alimentée.
- Pour un **projet déjà existant**, utilisez le bouton **« Initialiser »** :
  l'Assistant analyse le projet (structure, documentation, historique des
  sessions) puis pose les questions nécessaires à son fonctionnement.

### L'assistant gère son propre suivi
- L'Assistant est **responsable de son suivi des projets** : il met à jour
  lui-même sa base de données (SQLite `~/.pilot/super-agent.db`) et ses fichiers
  personnels (`~/.pilot/assistant/`) au fil des discussions.
- Il dispose d'outils **`db_query`** (lecture SELECT) et **`db_execute`**
  (écriture : CREATE TABLE, INSERT, UPDATE, DELETE…) sur **sa base uniquement**.
  Il **construit ses propres tables** de suivi selon ses besoins, et fait le
  maximum pour que ses données soient à jour (il vérifie dans les projets ou
  réfléchit sur vos demandes).
- Il ne touche **jamais** aux fichiers des projets (lecture seule stricte,
  garantie technique).
- Il **adapte son propre prompt** au fil des discussions : via l'outil
  `update_my_prompt`, il met à jour ses instructions durables (préférences,
  règles, contexte) pour prendre systématiquement en compte ce qu'il apprend.
  Le changement est persisté et pris en compte dès le message suivant.
- S'il a besoin d'**installer des outils** pour gérer au mieux certaines tâches,
  il vous **demande d'abord** (validation utilisateur requise).

### Programmer des relances (outil `schedule`)
- L'Assistant peut **programmer des rappels** qui reviennent dans sa conversation
  à l'échéance : relance différée (« me le rappeler demain matin ») ou périodique
  (« point chaque lundi sur l'avancement »).
- **Jamais pour surveiller un agent qu'il vient de lancer** : une tâche
  déléguée se termine par un **compte-rendu déposé automatiquement** dans sa
  conversation. Tant qu'il n'est pas arrivé, la mission est **en cours** — ni
  relance, ni arrêt, ni nouvelle délégation, même si l'agent est silencieux.
- Outils : **`schedule_create`** (créer une relance périodique, `everySeconds`
  ≥ 60), **`schedule_list`** (lister), **`schedule_delete`** (supprimer),
  **`schedule_set_enabled`** (désactiver/réactiver un rappel sans le supprimer).
- L'Assistant **désactive automatiquement** un rappel devenu inutile (ne détecte
  plus rien, chantier terminé, condition remplie) via `schedule_set_enabled` au
  lieu de le supprimer, et le **réactive** si le besoin revient.
- Garde-fous : `every` ≥ 60 s, **max 20** planifications **actives** (un rappel
  désactivé ne compte pas et libère sa place ; au-delà, la création est refusée
  par un message qui **nomme les rappels candidats à la suppression**, du plus
  ancien au plus récent — voir « Ménage des rappels inutiles »), **pas de tick**
  si l'onglet 🧭 est fermé (session morte — les rappels `every` accumulent un
  retard, repris à la reprise).
- **Règle d'envoi d'une passe (règle unique, corrigée le 2026-08-29)** :
  **UN SEUL ENVOI par passe** — donc **un seul tour** de l'assistant — et non
  « une relance par passe » comme le disait la version précédente de cette
  spec, qui se contredisait en posant à la fois « un déclenchement unique par
  tick » et un plafond de livraison sans dire lequel prime. L'unité
  limitée est le **nombre de tours**, pas le nombre de rappels traités :
  1. les rappels **simplement échus** restent livrés **un par passe** (les
     suivants restent dus et partent aux passes suivantes, 10 s plus tard) ;
  2. les rappels **retardataires** (échéance dépassée de **plus de deux
     intervalles** — cas type : arriéré accumulé pendant une fermeture de
     Pilot) partent **REGROUPÉS dans un seul message** (« N relances échues :
     1. … 2. … ») : un arriéré n'occupe donc plus l'assistant pendant des
     heures, un tour par relance ;
  3. **rotation en cas d'échec** : le premier éligible de `schedule_due`
     (`ORDER BY id`) ne peut plus affamer les autres. Un compteur d'échecs
     **consécutifs, en mémoire seulement** (jamais en base), fait passer un
     rappel qui vient d'échouer **après** ceux qui n'ont jamais échoué, et
     l'**écarte** au-delà de **3 échecs** consécutifs tant qu'un autre peut
     partir. Aucun rappel n'est jamais perdu : si tous sont écartés, ils sont
     retentés ensemble à la passe suivante.
  4. **lot borné (2ᵉ relecture, point 3)** : un envoi ne porte jamais plus de
     **8 relances** (`REMINDER_BATCH_MAX_ITEMS`), et le message est plafonné à
     **4000 caractères** (`REMINDER_BATCH_MAX_CHARS` — le **même plafond** que
     toute autre injection automatique dans la conversation,
     `MAX_INJECTED_MESSAGE_CHARS` côté Rust). Au-delà, la **troncature est
     annoncée** dans le message lui-même (nombre de caractères omis, et où lire
     le texte intégral) : jamais de coupe silencieuse. Les relances **en trop
     ne sont ni marquées ni perdues** : elles restent dues et partent à la passe
     suivante. Dans un lot, les lignes suivantes d'un rappel multi-lignes sont
     **indentées sous leur numéro** pour ne pas se confondre avec les items
     suivants.
  5. **chaque relance est bornée PAR RELANCE (3ᵉ audit, défaut sérieux ; étendu au 4ᵉ audit)** : le
     texte d'une relance est ramené à **450 caractères**
     (`REMINDER_ITEM_MAX_CHARS`, avis de troncature de **cette** relance
     compris) de sorte que le lot maximal (8 relances + en-tête) tienne
     **toujours** sous 4000 : la troncature du **message entier** est donc
     **structurellement impossible**. La borne s'applique **aussi à la relance
     livrée SEULE** (branche « un seul envoi », format historique
     `[⏰ Rappel programmé] …`) : sans cela, une relance seule de 20 000
     caractères était coupée par le plafond **global** puis marquée envoyée
     quand même. Le nombre de caractères **omis** annoncé dans l'avis est
     calculé sur le texte **réellement rendu** (la coupe se fait à la frontière
     du mot, donc avant la longueur visée) : il est exact, jamais approximé.
     Ce qui est réellement rendu est renvoyé
     par `buildReminderInjection` sous forme de `delivered` / `withheld`, et le
     ticker **ne marque comme envoyées que les relances de `delivered`** ; une
     relance retirée redevient **due** et repart à la passe suivante — elle
     n'est jamais marquée sans être lisible.
  Décision écrite à **un seul endroit** : `planDueReminderInjections`
  (`src/js/super-agent-schedule.js`) ; le ticker de `src/js/super-agent.js`
  n'exécute que le plan rendu. Verrous : `src/js/relances-relecture.test.js`.
- **Relances retenues : plus de silence** — quand des rappels sont retenus
  parce que **vous n'avez pas encore écrit** (réglage ci-dessous désactivé), un
  **signal système** apparaît dans la conversation : « N relances en attente —
  écrivez, ou activez ⚙️ → Assistant ». Il s'affiche **UNE seule fois par
  session de conversation** — c'est-à-dire **par ouverture de l'onglet 🧭**
  (portée réelle, dite ici sans ambiguïté) — et jamais quand la seule cause est
  un assistant momentanément occupé (cela se débloque tout seul). Pourquoi
  cette portée : le signal est écrit **dans la conversation**, laquelle est
  **recréée** à chaque ouverture de l'onglet ; l'annoncer une seule fois pour
  toute l'exécution de Pilot le rendrait invisible dans la nouvelle
  conversation alors que des relances restent retenues.
- **Échéance** : un rappel créé avec `everySeconds = N` se déclenche pour la
  première fois **N secondes après sa création** (référence `created_at` tant
  qu'il n'a jamais été livré, puis `last_run_at`). `schedule_create` renvoie
  `nextFireAt` (ISO 8601 UTC) : **aucun déclenchement avant l'échéance demandée**.
- **Issue #77 — pas de lancement automatique au démarrage** : par défaut,
  l'Assistant **ne lance pas automatiquement** un rappel dû à l'ouverture de sa
  session (démarrage de Pilot). Ce comportement est contrôlé par le réglage
  **Options → Assistant → « Vérifier les points à faire à l'ouverture de la
  session (relances programmées) »** (désactivé par défaut). Tant qu'il est
  désactivé, un rappel dû **reste dû** (jamais perdu, jamais marqué) et n'est
  injecté qu'à partir du moment où **vous avez vous-même écrit** dans la
  conversation de cette session — c'est vous qui ouvrez le sujet. Il faut
  valider ce réglage pour que l'Assistant vérifie les rappels dus **dès**
  l'ouverture de session, sans attendre votre premier message.
  **« Vous avez écrit » vaut pour TOUS les chemins d'écriture** : la saisie
  directe de l'onglet 🧭, le prompt envoyé depuis l'**accès web distant**, et le
  message reçu par **Telegram**. Un **signal unique** est émis par le backend
  dans `do_send_super_agent_prompt` (`src-tauri/src/super_agent.rs`), point de
  passage commun de la saisie directe et du web distant, et écouté une seule
  fois côté interface (évènement `pilot-superagent-owner-engaged`) ; le chemin
  Telegram marque le **même** drapeau, car son message n'entre pas par là. Il
  n'existe **qu'un seul drapeau** d'engagement (`ownerEngagedThisSession`),
  jamais deux.
  **Où l'écoute est installée (3ᵉ audit, défaut 3)** : au niveau de
  **l'application**, dès le démarrage de Pilot (`initOwnerEngagementWatch`,
  idempotente, appelée par `src/js/main.js` à côté de l'écoute Telegram), et
  **pas** dans la fabrique de l'onglet 🧭. Motif : l'émission Rust est
  inconditionnelle (elle ne sait pas si un onglet écoute). Tant que l'écoute
  vivait dans l'onglet, un prompt venant du **web distant onglet fermé** tombait
  dans le vide : l'engagement n'était pas posé, les relances restaient retenues
  et le signal disait « écrivez » alors que vous veniez d'écrire. L'écoute ne
  dépend donc plus d'un onglet ouvert (même modèle que Telegram), et elle n'est
  jamais « désabonnée » à la fermeture de l'onglet.
  **Portée du drapeau (2ᵉ relecture, point 1)** : une « session » =
  **une exécution de Pilot** (même unité que la mémoire de session côté Rust,
  qui repart de zéro au redémarrage), et **pas** « l'onglet 🧭 est ouvert ». La
  remise à zéro est donc la **valeur initiale** posée une seule fois par
  démarrage, et elle ne suit **jamais** l'ouverture (ni la recréation) de
  l'onglet. Motif : l'écoute **Telegram** tourne **sans l'onglet** ; un message
  reçu onglet fermé était bien traité puis **oublié** à la réouverture — les
  relances restaient retenues et le signal disait « écrivez » alors que vous
  veniez d'écrire. Parcours verrouillé par `src/js/relances-relecture.test.js`
  (« message Telegram reçu onglet fermé → ouverture de l'onglet → la relance
  part »), et par le parcours jumeau du **prompt par accès web onglet fermé**
  (3ᵉ audit, défaut 3).
  Décision écrite à **un seul endroit** : `planDueReminderInjections`
  (`src/js/super-agent-schedule.js`), appliquée par le ticker de
  `src/js/super-agent.js` ; verrou de branchement dans
  `src/js/super-agent-schedule.test.js`.
- Stockage : table `assistant_schedules` de la base `~/.pilot/super-agent.db`.
  Le rappel est injecté dans la conversation de l'assistant à l'échéance (pas de
  notification OS). Son **affichage ne passe pas par une bulle au milieu du
  fil** (issue #36) : le rappel apparaît comme un **événement du panneau 🔔**
  (en bas à droite de l'onglet 🧭), sur une **seule ligne courte** portant
  l'**heure de livraison** — c'est-à-dire l'instant où la relance a été
  **effectivement remise** à l'Assistant — au format local français (ex.
  « ⏰ relance — 29/08 à 14:30 »), et un **toast discret** reprend ce même
  libellé. Ce n'est donc PAS l'échéance théorique (`nextFireAt`) : quand le
  tick a du retard (onglet fermé, assistant occupé, rappel rejoué), l'heure
  affichée est celle de la livraison réelle, et c'est le fait utile à
  l'utilisateur. Le
  **prompt** du rappel (consigne technique pour l'assistant) **n'est pas
  affiché** : il reste consultable **au survol** de la ligne d'événement
  (info-bulle). Si la date est absente ou invalide, seul le marqueur
  « ⏰ relance » s'affiche (jamais « Invalid Date »/« NaN »).

### Ménage des rappels inutiles (automatique + bouton)
- **Pourquoi** : les rappels s'accumulaient (des centaines de rappels en base,
  beaucoup désactivés ou périmés) et le plafond de 20 finissait par bloquer
  toute nouvelle programmation sans dire quoi supprimer.
- **Décision écrite à UN SEUL endroit** : `classifyScheduleCleanup`
  (`src/js/super-agent-schedule-cleanup.js`, module pur). Le backend n'invente
  aucun motif : il applique le plan reçu et le journalise ; les **deux**
  déclencheurs (ménage automatique, bouton) passent par les mêmes règles.
- Règles appliquées :
  1. **désactivé et périmé** — dernière exécution (ou création si le rappel n'a
     jamais tourné) de plus de **30 jours** → **supprimé** ;
  2. **rappel unique déjà consommé** (il s'auto-désactive à la livraison) et dont
     l'échéance est dépassée de plus de **30 jours** → **supprimé** ;
  3. **périodique stérile** — **20 exécutions consécutives** sans rien détecter
     (le tour déclenché par le rappel n'appelle aucun outil) → **désactivé**,
     jamais supprimé ;
  4. **plafond de 20 rappels actifs** : au-delà, la création est refusée avec un
     message qui **liste les candidats à supprimer**, du plus ancien au plus
     récent (ce n'est qu'une proposition : rien n'est supprimé sans vous) ;
  5. **au plus un ménage automatique par jour** (date mémorisée en base), non
     bloquant, et **chaque rappel traité est journalisé** (date, nom, motif) dans
     le **journal existant** de l'assistant (`injection_logs`, statut
     `menage-rappel`) — jamais un second journal ;
  6. **garde-fous** : jamais un rappel **actif récent**, jamais un rappel **futur
     jamais exécuté**, jamais un rappel dont les données sont inexploitables
     (« en cas de doute : on garde »).
- **Bouton « Supprimer les rappels inutiles »** dans les Options → Assistant, sous
  le compteur « n sur 20 » : mêmes règles, mais geste **immédiat** (sans attendre
  les 24 h) ; le **nombre** de rappels concernés est **annoncé avant
  confirmation**, avec la liste et le motif, et rien n'est modifié sans votre
  accord.
- Un rappel **désactivé** par la règle 3 reste **réactivable** ; s'il reste
  désactivé plus de 30 jours, la règle 1 s'applique ensuite (suppression).
- Stockage (colonnes **additives**, aucune donnée existante modifiée) :
  `assistant_schedules.one_shot`, `assistant_schedules.sterile_runs`,
  `assistant_meta(key, value)` pour la date du dernier ménage. Tests :
  `src/js/super-agent-schedule-cleanup.test.js` (dont un verrou de branchement)
  et les tests `schedule_*` de `super_agent.rs`.

### Règle par défaut — fichier AGENTS.md des projets
- Quand l'Assistant travaille sur un projet qui **n'a pas de fichier AGENTS.md**
  (ou dont le contenu est **incomplet** pour guider un agent), il le **signale à
  l'utilisateur** et **programme un rappel** (`schedule_create`) pour revenir
  dessus.
- Il **ne laisse pas ce point tomber dans l'oubli** tant que le AGENTS.md n'est
  pas créé : il relance le rappel si nécessaire.
- Une fois le AGENTS.md **créé (ou complété)**, il **désactive le rappel**
  correspondant (`schedule_set_enabled`).

### Règle par défaut — anti-attente (ne pas surveiller un agent en temps réel)
- Après un **lancement d'agent** (`run_agents` / délégation), l'Assistant
  **rend immédiatement la main** à l'utilisateur avec un **statut court**
  (« travail lancé en arrière-plan »). Il **ne surveille jamais** un agent en
  temps réel et **ne bloque jamais** la conversation en attendant sa fin.
- **Pas de boucle d'attente** : ni `sleep`/attente active, ni vérifications
  répétées de `list_agent_sessions` / `get_delegation_result` / `git_status`
  juste après un lancement, et **aucun rappel** `schedule_create` pour suivre un
  agent : le **compte-rendu de fin** (succès ou échec explicite) est **déposé
  automatiquement** dans la conversation de l'Assistant.
- **Tant que ce compte-rendu n'est pas arrivé, la mission est EN COURS** :
  l'Assistant ne la **relance pas**, ne l'**arrête pas** et ne la **redélègue
  pas**, même si l'agent reste silencieux longtemps (build, tests, analyse
  longue). Un agent qui travaille n'a pas besoin d'un onglet ouvert ni d'une
  sortie visible pour être légitime.
- Il ne consulte un **résultat de délégation** (`get_delegation_result`) que si
  l'utilisateur le demande, ou quand il est déjà disponible.
- Si l'utilisateur écrit pendant qu'un travail tourne, l'Assistant **répond
  immédiatement** et **signale que le travail continue en arrière-plan**.
- Le bloc système « **Supervision des agents** » reste distinct : il sert à
  **décider si on ARRÊTE un agent** (ne pas couper un agent encore actif), pas à
  le surveiller en continu.

### Poser des questions
- Dans l'onglet 🧭, posez **n'importe quelle question sur tous les projets**
  (ex: « Où en est le projet X pour le client Y ? », « Quelles tâches sont en
  attente ? », « Qu'a-t-on décidé sur Z ? »).
- L'Assistant consulte sa base et les projets pour répondre.

### Dicter sa question
- Un bouton **micro 🎙️** est disponible dans la barre d'outils de l'onglet 🧭 :
  il vous permet de **dicter votre question** au lieu de la taper (Web Speech
  API, langue `fr-FR`, comme le chat de l'agent standard). La transcription est
  insérée dans la zone de saisie ; validez ensuite avec Entrée.

### Choisir le modèle
- Un **sélecteur de modèle** est disponible dans la barre d'outils de l'onglet
  🧭 (même liste que les agents de coding). Le changement s'applique à la
  session de l'Assistant.
- **Modèle par défaut dédié (issue #88)** : **Options ⚙️ → onglet « Modèles
  IA » → Modèle par défaut de l'Assistant**. Laisser « Modèle par défaut »
  (valeur vide) pour reprendre le **modèle par défaut global des agents**
  (comportement historique inchangé). Le réglage est prioritaire sur le défaut
  global pour l'Assistant uniquement et s'applique au démarrage suivant de sa
  session (le sélecteur de la barre d'outils reste le modèle **actif**). Le
  choix est **persisté immédiatement** (`set_super_agent_default_model`) et
  **préservé par l'enregistrement des Options**, qui réécrit pourtant toute
  la configuration (`settings.js:1242`).
- **Reprise du modèle choisi au redémarrage** : le **modèle choisi** dans le
  sélecteur est **réappliqué à l'ouverture** de la session de l'Assistant (il ne
  repart donc pas sur le défaut global). S'il n'est **plus installé** (modèle
  retiré du registre), repli propre sur le modèle par défaut **dédié**, puis sur
  le défaut **global** — sans erreur ni blocage du démarrage.

### Personnaliser le prompt
- **Options ⚙️ → onglet « Assistant » → Prompt système** : définissez le
  prompt qui cadre le comportement de l'Assistant à chaque tour (rôle,
  consignes, ton). Il est préfixé à chaque question.

### Position et persistance de l'onglet
- L'onglet 🧭 est **toujours le plus à gauche** de la barre d'onglets, avant
  même le bouton « + » d'ajout d'agents. Il ne peut pas être déplacé par
  glisser-déposer (et aucun onglet ne peut être placé avant lui).
- **Global (multi-projets)** : l'onglet Assistant existe **une seule fois pour
  Pilot**, pas par projet. Fermer ou basculer un projet **ne le ferme pas**.
- **Persistance** : si l'onglet Assistant est ouvert à la fermeture de Pilot,
  il est **rouvert automatiquement au démarrage** (état `super_agent_open`
  persisté dans la config globale, pas par projet).
- **Bascule automatique (issue #46)** : à l'ouverture d'un projet (et au
  démarrage de Pilot), une fois le projet entièrement chargé, Pilot bascule
  automatiquement sur l'onglet Assistant **si celui-ci est ouvert** (assistant
  activé). Si l'utilisateur n'utilise pas l'assistant, rien n'est forcé.

### Lecture seule — garantie
- L'Assistant est **strictement en lecture seule** sur vos projets : il ne
  peut pas écrire dedans. Seul son **espace dédié** `~/.pilot/assistant/` et
  sa base de données (dans `~/.pilot/`) sont modifiables par lui.
- Cette garantie est **technique** (extension qui bloque toute écriture hors
  de l'espace dédié), pas seulement une consigne système.

### Relance automatique (anti-blocage)
- L'Assistant **ne s'arrête pas au premier obstacle**. Si une tâche déléguée ou
  une action échoue, il **relance au moins une fois par lui-même** en changeant
  d'approche (autre agent, autre formulation, autre méthode, autre découpage),
  sans solliciter l'utilisateur.
- Après **2 tentatives consécutives** toujours sans avancée, il prévient l'
  utilisateur avec un **point clair** (ce qui a été tenté, pourquoi ça bloque,
  options proposées).
- Ce comportement est **volontaire et varié** : relancer en changeant
  d'approche n'est PAS une répétition en boucle.

### Détection de boucle (issue #55) — filet de sécurité technique
- La **détection de boucle** (issue #55) reste un **filet de sécurité
  technique** distinct de la relance automatique : elle cible les
  **répétitions exactes** (même texte ou mêmes appels d'outils répétés en
  boucle sans avancer), pas les relances variées.
- Si l'Assistant se met à **répéter en boucle** le même texte (réflexion ou
  réponse) **ou les mêmes appels d'outils** (ex: la même commande bash enchaînée
  sans avancer), Pilot **arrête la génération** et affiche un message :
  « ⚠️ L'assistant a tourné en boucle… Veuillez reformuler votre demande. »
- Il n'y a **pas de reprise automatique** pour ce cas-là : l'Assistant est un
  outil de suivi, pas un codeur. Reformulez simplement votre question pour
  relancer.

**Faux positif corrigé (écritures successives)** : trois modifications
DIFFÉRENTES du même fichier n'étaient pas distinguées (l'empreinte d'un `edit`
ne portait que le CHEMIN) → trois empreintes identiques → boucle « détectée » →
arrêt de la session en plein travail normal. L'empreinte porte désormais une
empreinte du **contenu écrit** (`tool::edit::<chemin>::content=<longueur>:<hash>`,
même principe que `offset`/`limit` pour `read` et `query` pour `search`) :
plusieurs écritures différentes ne sont plus une boucle, plusieurs écritures
identiques le restent. Correctif **strictement monotone** (il ne peut que retirer
des détections) ; aucun seuil changé, aucun outil codé en dur (tout champ de
contenu reconnu : `edits`, `content`, `newContent`, `newText`, `patch`, `diff`…).

**Faux positif corrigé (lectures et consultations)** : une répétition en
**LECTURE SEULE** n'est **jamais** un motif d'arrêt automatique. Deux runs de
codeur ont été tuées par un `abort_agent_process` ciblé alors qu'elles
relançaient la même consultation (`git status --short`, `git diff`, `sed -n`,
`rg`) entre deux corrections légitimes. Le bus route désormais les outils de
lecture **et** les commandes shell consultatives vers l'historique de lecture
(`ctx.readOnlyToolCallsByAgent`), qui reste alimenté pour l'**observabilité**
mais n'est **plus jamais examiné** par la détection de boucle. Classifieur pur
`isReadOnlyShellCommand(command)` (loop-detection.js) : il ne retire un arrêt que
si la commande est **prouvée** consultative — chaque segment d'un enchaînement
(`&&`, `||`, `;`, `|`) doit l'être, aucune redirection d'écriture (`>`, `>>`,
`tee`), pas de `sed -i`, pas de sous-commande `git` mutatrice
(`commit|push|checkout|restore|reset|add|rm|mv|stash push|apply`, `branch nom`…),
pas de `rm|mv|cp|mkdir|touch`, `npm install|run`, `cargo fmt|fix`. Cas par
défaut : **false** (prudence). Les empreintes **mutatrices** (`edit`/`write`,
`bash` mutateur, outil inconnu) gardent le comportement historique et les mêmes
seuils ; les autres filets restent inchangés (inactivité, plafond de tours pi,
moniteur d'anomalie Rust, boucle de texte).

**Motif journalisé sur disque** : chaque arrêt AUTOMATIQUE d'agent écrit une
ligne dans `<projet>/.pilot/agent-stops.log` (append logique via les commandes
IPC existantes, rotation 256 Ko, fail-open côté arrêt) :

```
2026-10-20T03:30:00.123Z  op=auto-stop  reason=loop-detection  detected=tool-calls  agent=codeur  project=<projet>  uid=none
```

`detected` distingue « boucle d'outils » (`tool-calls`) de « boucle de
réflexion » (`text`, `text-escalation-exhausted`, `turn-cap`) — la cause ne reste
plus en mémoire seulement. Une ligne peut porter en plus `detail=` (ce qui a été
abandonné, nommé) et `text=` (le travail que l'agent avait **déjà écrit** quand
il est mort — voir « Le travail écrit d'un agent mort n'est plus jeté »
ci-dessous ; sauts de ligne encodés `\n`, champ borné à 4 000 caractères, la
ligne du journal reste UNE ligne). Côté bus d'agents, l'arrêt automatique transmet aussi
l'uid de session quand il est connu : `stop_agent_process` + `expectedUid`
(garde de propriété : une session remplacée n'est pas tuée) ; uid inconnu →
`stop_agent_session` (chemin historique, seul à libérer l'activité du projet).
Modules : `loop-detection.js` (pures : `collectWriteContent`,
`hashLoopContent`, `buildAgentStopTraceLine`, `sanitizeAgentStopTraceText`,
`appendAgentStopTrace`, `buildAgentStopRequest`), `agent-stop-trace.js` (I/O du
journal), `agent-partial-text.js` (pures : restitution du texte d'un agent mort),
`super-agent.js` / `agents-bus.js` (points d'arrêt).

### Le travail écrit d'un agent mort n'est plus jeté

Quand un agent **meurt ou plante** (`process_exit`, `process_error`,
`extension_error`), Pilot ne jette plus ce qu'il avait déjà écrit :

1. le texte partiel est **lu avant toute remise à zéro** (mémoire de la session :
   `streamingTextByAgent` côté bus, `loop.lastText` côté Assistant — ce dernier
   est désormais **conservé de côté** au lieu d'être remis à zéro) ;
2. s'il est vide, la **récupération existante** est tentée telle quelle
   (`get_delegation_result` : session vivante, puis session de l'agent sur le
   disque) — aucun second mécanisme ;
3. il est écrit dans le **journal des arrêts existant** (`text=` de
   `<projet>/.pilot/agent-stops.log`) — **aucun second journal, aucun second
   emplacement** ;
4. il figure dans le **message d'échec** rendu à l'assistant, avec la phrase qui
   dit ce que l'agent avait écrit **et** que la mission n'est pas terminée ;
5. si vraiment rien n'a été produit, le message le dit explicitement
   (« aucun texte récupéré ») : jamais un silence, jamais un texte inventé.

**Aucune relance automatique** : on conserve et on rend visible, on ne rejoue
rien. La limite de 45 minutes des questions en attente et le comportement d'un
agent qui **finit bien** sont inchangés. Verrou anti-régression :
`agent-texte-agent-mort.test.js` (texte dans le message + sur le disque ; mention
 explicite quand il n'y a rien ; récupération disque quand la mémoire est vide).

### Règle 3 — aucun arrêt automatique sans trace écrite (tous les chemins)

**Principe** : une session d'agent ne peut pas disparaître sans une trace écrite
de sa raison d'arrêt. Tous les chemins d'arrêt **automatique** du bus écrivent
donc une ligne AVANT l'arrêt effectif (jamais après) :

| Chemin d'arrêt | `reason` | `detected` |
|---|---|---|
| Boucle d'outils / de réflexion | `loop-detection` | `tool-calls`, `text`, `text-escalation-exhausted` |
| Plafond de tours de la run | `loop-detection` | `turn-cap` |
| Timeout d'inactivité (`resetTimeout`) | `idle-timeout` | `no-event` |
| Plafond de tours pi par agent | `turn-cap` | `pi-turns` |
| Arrêt automatique émis par Rust (moniteur d'anomalie) | `auto-stop-rust` | `anomaly-monitor` |
| Session restée busy sans progression | `busy-stale-release` | `stale-busy` |
| Libération de verrou par le watchdog | `watchdog-release` | porte (`timeGuard`, …) |
| Run restée « stopping » (balayage) | `sweep-stopping-release` | `sweep` |
| Libération forcée du verrou du projet | `force-release` | `user-command` |
| Arrêt de run demandé par un appelant automatique (`stopAgentsRun({reason})`) | motif transmis | `stop-run` (défaut) |
| Session périmée redémarrée avec un contexte vierge | `stale-session-restart` | `fresh-context` |
| Nettoyage d'un processus orphelin après échec de lancement | `spawn-failure-cleanup` | `run-agent-turn-error` |
| Demandes en file qui ne peuvent plus être rejouées / abandonnées | `queue-abandoned` | `watchdog`, `clear-all-runs`, `user-abandon`, `stop-agent` (délégations uniquement), `file-vide` |
| Missions **conservées** en file par un arrêt d'agent (P2 : aucune destruction) | `queue-kept` | `stop-agent` |
| Boucle détectée dans l'onglet agent principal (`agent-pi.js`) | `loop-detection` | `text`, `actions` |
| Fin de SESSION par erreur dans le bus (chaque `failAgentTurn`) | `session-error`, `spawn-failed`, `run-exception` | erreur d'envoi de correction, sortie de processus (boucle : `loop-process-exit`), mort du processus (`process-exit`), message en erreur, modèle absent, exception du tour |
| Mort / plantage d'un agent lancé en arrière-plan (Assistant) | `session-error` | `process-exit`, `process-error` |
| Destruction de la session de l'onglet agent (`stop_agent_session`) | `session-restart` | `quality-gate-toggle`, `reconnect`, `settings-restart` |
| `/file vide` (familles commandes / missions / délégations) | `queue-abandoned` | `file-vide` |
| Retrait ciblé d'**une seule** mission en attente (`/file retire <rang>`, outil assistant `remove_queued_mission`) | `queue-mission-removed` | `file-retire`, `assistant-remove-one`, `remove-one` |

- **Arrêt manuel** (bouton « tout arrêter ») : pas de ligne — il est volontaire et
  ne doit pas être présenté comme un arrêt automatique.
- Le cas **`ctx` introuvable** (arrêt automatique reçu pour un agent qui n'est
  plus dans une run vivante) est journalisé aussi : l'information ne disparaît
  plus par un `return` muet.
- **Repli GLOBAL** : quand aucun chemin de projet n'est disponible (agent sans
  projet) ou que l'écriture dans le projet échoue, la ligne part dans
  `<app_data_dir>/agent-stops.log` (même forme de ligne, même rotation).
- **Non-silence** : si même le journal global est inaccessible, l'échec est
  **dit** (`console.warn` + notification branchée par le bus via
  `setAgentStopTraceFailureReporter`, à défaut événement global
  `pilot-agent-stop-trace-failed`) — jamais un fail-open muet.
- **Écritures SÉRIALISÉES** : le journal est lu puis réécrit ; les traces sont
  donc **chaînées** (`traceWriteChain`, `agent-stop-trace.js`) — sans cela, deux
  traces concurrentes (les trois familles abandonnées d'un `/file vide`, par
  exemple) lisaient la même version et la seconde écriture **écrasait** la ligne
  de la première. Un échec d'écriture ne casse pas la chaîne (les traces
  suivantes passent).
- **Verrou anti-régression** : `agent-stop-trace-paths.test.js` lit les **TROIS**
  fichiers porteurs d'arrêts automatiques (`agents-bus.js`, `agent-pi.js`,
  `super-agent.js`) et exige une trace à motif littéral avant chaque site
  terminal (`abort_agent_process`, `stop_agent_process`,
  `settleMission(..., "stop")`, `abort_agent` de session, `abort_super_agent`,
  `failAgentTurn`, `stop_agent_session`).
  La **cardinalité est épinglée** par fichier et par type de site (un site
  ajouté, muet ou non, fait échouer le test) et la **précédence est vérifiée à
  PORTÉE LEXICALE** : le test délimite la **fonction englobante** de chaque site
  (comptage d'accolades depuis son en-tête) et exige la trace DANS ce bloc, avant
  le site — une trace lointaine du même fichier ne compte plus. Les arrêts
  **MANUELS** (bouton Stop → `abort_super_agent`, `stop_agent_session` demandé
  explicitement par l'Assistant ou l'utilisateur) sont déclarés en **exception
  nommée** (marqueur `R3-EXCEPTION-MANUEL`), jamais en silence. Les arrêts de
  **TOUR** de l'onglet agent (orchestration : timeouts, subdivisions, reprise
  après compaction, erreur de connexion ; arrêt manuel ; test de modèle) ne sont
  pas tracés — ils n'interrompent pas la session, qui reprend immédiatement —
  mais **chacun d'eux porte son propre marqueur nommé** (`R3-EXCEPTION-MANUEL`,
  commentaire **accolé à l'appel**, disant de quel arrêt il s'agit) : onze sites
  à ce jour, au lieu d'un simple compteur. La règle est donc : **tout arrêt de
  ce fichier est soit tracé avec son motif, soit déclaré manuel par son
  marqueur** — un site muet fait échouer le contrôle, et un marqueur retiré
  aussi (le nombre de marqueurs est épinglé séparément du nombre de sites). Un
  **contrôle négatif** intégré injecte un site
  muet dans une copie de la source, à plusieurs positions, pour prouver que la
  détection le voit.
- **Entonnoir unique (`agent-stop-funnel.js`)** : côté bus, les arrêts
  automatiques ne choisissent plus « trace ou pas trace ». Ils passent par
  `stopAgentWithTrace({ reason, detected, agentId, projectPath, uid, stop })`,
  qui écrit le motif (même journal, repli global, même mécanique de
  `agent-stop-trace.js`) **PUIS** exécute l'action d'arrêt — la trace est
  **attendue** avant l'arrêt. Les gardes de propriété (`expectedUid`) et la
  portée de run (`runKey`) sont fournies telles quelles par le site : le
  comportement d'arrêt est inchangé. Conséquence : un **nouveau** site d'arrêt
  automatique ajouté dans le bus ne peut plus être muet par oubli — il n'a pas
  d'autre voie que l'entonnoir. Les traces historiques des sites concernés ont
  été **remplacées** par celle de l'entonnoir (jamais de double ligne) ; le
  mécanisme `stopAgentsRun` trace une ligne **par agent actif** (avec son uid),
  et une ligne `agent=none` seulement si la run n'a plus d'agent actif.
  **Fail-open côté arrêt** : si la journalisation échoue (ou si le motif est
  incomplet), l'arrêt a quand même lieu et l'échec reste **dit** par
  `traceAutomaticAgentStop` (rapporteur → notification). Le détecteur pur
  `scanAutomaticStopSites` (même module) recense les sites d'arrêt automatique
  d'une source et pointe ceux qui contournent l'entonnoir : un site n'est
  reconnu couvert que s'il est dans la **même instruction** qu'un appel
  d'entonnoir, dans sa **fonction englobante** (la simple proximité ne suffit
  pas, sinon un site muet ajouté quelques lignes après un arrêt tracé passerait
  pour couvert). Seul l'arrêt **volontaire** (bouton « tout arrêter ») reste hors
  entonnoir, avec le marqueur `R3-EXCEPTION-MANUEL`. Verrou :
  `agent-stop-funnel.test.js` (ordre trace→arrêt observé sur un faux `invoke`,
  liste des sites du bus épinglée, contrôle négatif par injection d'un site
  muet en mémoire).

<!-- HELP:loop-detection-writes -->
### Détection de boucle : une lecture n'est jamais une boucle
Pilot arrête automatiquement un agent qui **répète exactement** la même chose
sans avancer. Deux règles le limitent désormais pour ne plus couper un agent qui
travaille :
- **Consulter n'est jamais une boucle.** Relancer `git status`, `git diff`,
  `git log` (`git -C <dossier> …`, `git -c clé=valeur …`),
  `git --git-dir <dossier> …`, `ls`, `cat`, `grep`/`rg`, `sed -n`, `wc`,
  `npm ls`… entre deux corrections est un travail normal : ces lectures peuvent
  être répétées autant que nécessaire, elles **ne déclenchent aucun arrêt
  automatique** (elles restent enregistrées pour le diagnostic). Seules les
  actions qui **modifient** (écriture d'un fichier, commande qui écrit ou
  exécute) peuvent fonder un arrêt, ainsi qu'une répétition de **texte**.
- **Modifier plusieurs fois le même fichier n'est pas une boucle** : le
  **contenu** de chaque écriture est pris en compte ; seules des écritures
  **identiques** répétées comptent comme une boucle.
Les **autres filets de sécurité** restent actifs : inactivité prolongée, plafond
de tours, agent bloqué repéré par le moniteur, boucle de texte.
La règle vaut sur **tous** les chemins d'arrêt automatique : l'onglet agent
principal, le bus d'agents, l'Assistant **et l'agent lancé en arrière-plan**
utilisent le **même** classifieur (`isReadOnlyAgentToolCall`) — une consultation
du projet ne peut donc plus provoquer un arrêt, quel que soit l'écran d'où la
tâche a été lancée. Un agent en arrière-plan qui répète la même **modification**
sans écrire de texte est en revanche bien arrêté (la détection d'outils n'est
plus court-circuitée par l'absence de texte).
Chaque **arrêt automatique** laisse une ligne dans le fichier
**`.pilot/agent-stops.log`** du projet (cause de l'arrêt, type de détection,
agent, session) : utile pour comprendre après coup pourquoi un agent s'est
arrêté. **Tous** les arrêts automatiques sont concernés (boucle, inactivité,
plafond de tours, agent bloqué repéré par le moniteur, libération d'un verrou) —
plus aucun ne se produit sans laisser de trace. Si le projet n'est pas connu (ou
si le fichier du projet ne peut pas être écrit), la ligne est écrite dans le
journal global de l'application (`agent-stops.log` du répertoire de données) ;
et si même cela échoue, Pilot le **signale** au lieu de rester silencieux.
Le journal note aussi les **demandes de tâches abandonnées** (`queue-abandoned`) :
une demande mise en file qui ne peut plus être relancée est nommée dans le
journal et annoncée à l'écran — elle ne disparaît jamais en silence. La règle
vaut pour **toutes** les familles de la file : commandes manuelles, missions,
délégations (vidées par `/file vide`, qui écrit une ligne **par famille** avec
les libellés) et agents ; l'arrêt explicite d'un agent (`stop_agent`) nomme, lui
aussi, les délégations et les missions qu'il abandonne. Le journal est écrit de
façon **sérialisée** : deux abandons simultanés ne s'effacent plus l'un l'autre.
Côté bus d'agents, **tous** les arrêts automatiques passent par un **point de
passage unique** qui écrit le motif **avant** d'arrêter : un nouveau chemin
d'arrêt ne peut donc plus oublier de laisser une trace. Si la trace ne peut pas
être écrite, l'arrêt a quand même lieu — et l'échec est **signalé**, jamais tu.
**Un agent qui meurt ou plante ne perd plus son travail écrit** : ce qu'il avait
**déjà rédigé** vous revient dans le compte rendu de la tâche (avec la phrase qui
dit que la mission n'est **pas** terminée), et il est conservé dans le **même**
journal (`text=`) — jamais un second journal. Si la mémoire de la session est
vide, Pilot relit la session de l'agent **sur le disque** ; s'il n'y a vraiment
rien, c'est dit explicitement (« **aucun texte récupéré** ») : ni silence, ni
texte inventé. Rien n'est relancé automatiquement — conserver et montrer, pas
rejouer.
<!-- /HELP:loop-detection-writes -->

### Mode « Assistant seul » (A19, maquette ASS_Only_V4)
- **Une seule entree** : le bouton **UNIQUE des trois modes** — c'est le **logo
  Pilot** du bandeau du haut, en haut à gauche (ni mot, ni pastille : son
  infobulle nomme le mode courant et annonce le suivant) —, ou le
  **raccourci Ctrl+Shift+A** (Cmd+Shift+A sur macOS, onglet 🧭 ouvert). La barre
  d'outils de l'onglet 🧭 **n'a plus** de bouton ⛶ : il faisait double emploi.
  Le mode masque tout (sidebar, explorateur, éditeur, onglets, terminal) et
  seule la discussion de l'Assistant reste visible.
- **Barre du haut** (maquette V4) : à gauche le titre « **Pilot** » ; à droite le
  **résumé des agents**, l'entrée « **Travail** » et **UN SEUL bouton ⚙** qui
  ouvre les Options de l'Assistant (onglet « Assistant »). **Aucun bouton de mode
  dans cette barre** : le logo-bouton entre dans l'overlay et se pose **au même
  endroit** que dans « Détaillé » (en haut à gauche), par une seule règle CSS.
- **Aucun bouton de retour** dans cette barre : on en sort par le **logo** (le
  bouton des trois modes, en haut à gauche) ou par **Ctrl+Shift+A**. **Échap** ne
  sort pas de ce mode (elle n'en est jamais sortie ; rien n'a été ajouté).
- **Résumé des agents (point poignée)** : dans cette barre, juste à gauche
  du bouton ⚙, la liste des agents est **repliée par défaut en un petit point
  unique** : le point **respire** (pulsation douce) quand un agent ou l'
  Assistant travaille, il reste **statique et éteint** sinon. Le point reste
  **affiché en permanence** — y compris quand la liste est dépliée : il sert de
  **poignée d'ouverture/fermeture** (cohérent avec le point de la barre du
  mode standard). **Un clic** sur le point **déploie la liste des agents
  disponibles à côté de lui** : **exactement la même
  liste que le mode standard** (référence) — mêmes entrées et
  mêmes règles (agents avec onglet, agents
  délégués en arrière-plan tant que leur processus tourne — lancés par la
  délégation, sans onglet — et agents occupés ; l'assistant toujours
  visible), issues de la même source (stock partagé) et du **même rendu**
  (mêmes items : pastille + nom + projet, tooltip au survol). Elle se
  **met à jour automatiquement** : un agent qui démarre
  ou s'arrête apparaît/disparaît de la liste déployée sans aucun clic
  (même flux que l'indicateur du mode standard, actualisé toutes les 2 s
  + événements). **SEULE différence avec le mode standard** : un clic sur une
  entrée n'affiche **aucun détail** (aucune fiche, aucune action, aucune
  ouverture d'onglet) — la liste reste strictement **informative** ; un clic
  sur la zone replie simplement le résumé. **Un re-clic sur le point replie**
  (l'état n'est pas mémorisé : chaque entrée en mode assistant seul
  repart repliée).
- **Indicateur d'activité** sous les messages : point **vert « Prêt · lecture
  seule »** au repos, **violet pulsant « Réfléchit… »** quand l'Assistant
  travaille. Le **fond de la zone de saisie** respire (halo discret animé) dans
  les **deux modes** (standard et assistant seul) **uniquement pendant que
  l'Assistant lui-même travaille**, en complément de l'**anneau pulsant autour
  du logo** en mode immersif. Il ne respire **pas** pendant qu'une question
  d'agent attend votre réponse (la zone reste alors en mode normal, prête à
  recevoir votre précision) ; au repos, aucun effet, la zone reste utilisable.
  Le travail d'un **AUTRE agent** (agent d'un projet, agent délégué, agent sans
  onglet, file d'attente d'un projet) **n'allume jamais** cette zone : son
  signal est le **point qui respire de la liste des agents** et le compteur
  « Travail ». Une zone de saisie qui clignote ne dit donc qu'une chose :
  l'Assistant travaille, ici, maintenant.
- **Suggestions** : quatre chips (« Faire un point sur un projet », « Déléguer
  une demande à l'agent », « Préparer une livraison », « Lister les tâches en
  cours ») qui **préremplissent la zone de saisie** (elles n'envoient pas).
- La barre du haut ne contient aucun toggle voix : la **🎙️ dictée** reste dans
  la barre de saisie, et aucun bouton de **synthèse vocale** (🔊) n'y figure. Le
  **suivi du travail** y est en revanche **le même** que dans le mode normal :
  l'entrée « Travail » (point + mot + compteur « en cours / total » + son
  panneau à trois onglets) est **déplacée** dans la barre du mode, **côté
  droit**, entre le résumé des agents et le ⚙ — **même élément** (jamais une
  copie), **même libellé**, **même valeur**, alimentée par le **même calcul**.
  Le message d'accueil affiche le **nom réel
  de l'assistant** (config de l'onglet 🧭), avec repli « Pilot Assistant ».
- **Sortir du mode** : le **logo** (le bouton des trois modes, en haut à gauche) ou
  **Ctrl+Shift+A**. L'état de la conversation est **préservé** (les éléments du
  chat sont déplacés, jamais recréés). Le **dernier mode choisi est mémorisé**
  et restauré à la réouverture de l'onglet.
- **Identique sur l'accès distant web** : en mode « 🧭 Assistant », le bouton
  **⛶** en haut de l'interface web ouvre le même mode immersif.
<!-- HELP:super-agent-data-care -->
### Analyser et ranger vos données d'assistant (lecture seule)
- Dans la barre de boutons de l'onglet 🧭 Assistant, le bouton **🔍 (Analyser et
  ranger mes données)** lance une **analyse en lecture seule** des données de
  votre assistant : son **dossier de travail** (`~/.pilot/assistant/`) et sa
  **base de suivi** (clients, projets, tâches, décisions, jalons, résumés de
  session).
- **Vous voyez tout de suite que ça a démarré** : votre demande apparaît dans
  la conversation et le bouton se **désactive** (« Analyse en cours… ») tant
  que l'analyse tourne. Un second clic ne lance pas une seconde analyse en
  parallèle.
- **Rien n'est modifié** pendant cette analyse : l'assistant **observe et
  propose** — il ne supprime, ne déplace, ne renomme et ne modifie rien.
- Il rend un **rapport écrit** (contenu, organisation, doublons, incohérences,
  éléments orphelins, ce qui n'a pas pu être conclu) puis une **proposition de
  rangement** en trois parties : **ce qui est sûr**, **ce qui est discutable**,
  **ce qui reste à décider par vous**. Il signale honnêtement ce qu'il n'a pas
  pu examiner.
- **C'est vous qui décidez** ensuite : si vous voulez que le rangement proposé
  soit appliqué, demandez-le dans la conversation.
<!-- /HELP:super-agent-data-care -->

---

<!-- HELP-TOPIC:super-agent-session-memory -->
### Reprendre après un redémarrage de Pilot
L'assistant 🧭 garde une **mémoire de session** : à la fin d'un chantier ou
quand le sujet change, il enregistre un **résumé court** de la discussion en
cours et des chantiers en cours. Après un **redémarrage de Pilot**, ce résumé
est **réinjecté automatiquement** au début de la session : l'assistant (et vous)
retrouvez immédiatement où on en était, sans avoir à tout ré-expliquer. À
l'ouverture de l'onglet, un message « 🔁 Reprise de session — … » rappelle le
contexte. Vous pouvez aussi lui demander explicitement de « retenir » ou de
« reprendre » une discussion.

Vous pouvez aussi lui demander de **corriger** sa mémoire : si un fait mémorisé
est devenu faux ou périmé (un chantier terminé, un projet qui n'est plus le bon),
l'assistant peut **retirer ce fait précis** sans réécrire tout le résumé. Le fait
retiré n'est pas perdu : il est gardé dans une **corbeille limitée aux 20 derniers
retraits**, et l'assistant peut le **remettre en place** (le dernier retrait par
défaut, ou un retrait choisi) si vous vous êtes trompés ou s'il redevient
pertinent. L'assistant peut aussi **consulter la liste** des retraits encore
remisables (identifiant, date, aperçu du contenu) pour retrouver un retrait
ancien sans avoir à annuler les plus récents.

---

<!-- HELP-TOPIC:super-agent-mcp -->
### MCP piloté par l'Assistant

L'Assistant peut piloter les **serveurs MCP** (connectés à Pilot) pour déléguer
une tâche à un agent en lui donnant accès au serveur de son choix.

- **Découvrir** : l'outil `mcp_state` retourne `{ enabled, confirm, servers }`
  (actif, confirmation requise, serveurs configurés avec leur id).
- **Choisir un serveur** : passer le serveur id (`mcp_server`) à `run_agents` /
  `run_assistant_agents` → l'agent de CETTE run charge le serveur désigné à la
  volée. Sans `mcp_server`, un agent non-standard ne charge pas MCP.
- **Confirmation** : si `confirm` est activé (défaut), l'Assistant **demande à
  l'utilisateur** (`ask_confirm`) avant de lancer un agent sur un serveur MCP.
  Si désactivé, il choisit et lance seul.
- **Activer / désactiver un serveur depuis la conversation** : demandez-le
  simplement à l'Assistant (« active Presence », « désactive test »). Il
  utilise `mcp_enable_server` / `mcp_disable_server`, **sans vous renvoyer dans
  les Paramètres**, et applique le changement aussitôt. Comme Pilot ne branche
  **qu'un serveur à la fois**, en activer un **coupe les autres** — et
  l'Assistant vous **dit lesquels** (aucun changement silencieux). Désactiver
  n'active personne d'office. Rien d'autre n'est touché : ni le client MCP, ni la
  confirmation requise, ni le contenu des serveurs, ni les clés du coffre, et
  aucun serveur n'est supprimé. Le changement vaut à la **prochaine session
  d'agent** : une conversation déjà en cours garde son serveur. Un nom de
  serveur inconnu donne un message clair, sans rien modifier.
- L'agent standard du projet garde son comportement historique (1er serveur
  activé au démarrage, local ou distant).
- **Serveur distant** : dans **Options → Serveurs MCP**, choisissez le type
  *Distant (adresse)*, renseignez l'adresse réseau (`http`/`https`) et la
  **clé d'accès** : le champ propose **la liste des entrées de votre coffre 🔐**
  (par leur description) ; seule la **référence** de l'entrée choisie est
  enregistrée, jamais le mot de passe (qui n'est jamais affiché non plus).
  Cette référence s'affiche sous le login de l'entrée dans l'onglet 🔐 (clic =
  copie) et se saisit aussi à la main en cas de besoin. **Déverrouillez le coffre
  avant de lancer l'agent** : sinon la clé n'est pas lue et le serveur distant est
  appelé sans elle (authentification refusée possible), sans bloquer le
  démarrage. Le bouton **Tester la connexion** interroge le serveur distant pour
  vérifier l'adresse et la clé.
- **Nom des outils exposés** : chaque outil d'un serveur porte le nom
  `mcp_<identifiant du serveur>_<nom de l'outil>` (par ex. `mcp_mcp-1_echo`).
  Comme **un seul serveur est utilisé à la fois**, deux serveurs ne peuvent pas
  se disputer un nom. En revanche, si **deux serveurs enregistrés ont le même
  identifiant**, leurs outils porteraient exactement le même nom : Pilot refuse
  alors de charger MCP et **vous dit lequel des deux serveurs est en cause** —
  pour rétablir, désactivez l'un des deux ou donnez-leur des identifiants
  différents. Si un serveur annonce **deux fois le même outil**, seul le premier
  est proposé à l'agent (et c'est signalé), jamais un remplacement silencieux.

---

<!-- HELP-TOPIC:super-agent-checklist -->
### Checklist de livraison d'une tâche

Une tâche du tableau Kanban peut porter une **checklist de livraison** : la
liste des points à vérifier avant de la considérer comme finie (par exemple
« tests passés », « documentation à jour »). Elle sert de garde-fou : elle
rappelle ce qui reste à faire et peut empêcher de terminer une tâche trop tôt.

- **Ajouter un point** : ouvrez la fiche de la tâche (bouton **éditer** de sa
  carte), saisissez le point dans le champ **« Nouveau point »** puis cliquez
  sur **« Ajouter »** (la touche Entrée fonctionne aussi).
- **Cocher / décocher un point** : cliquez la case devant le point ; le point
  est conservé, seul son état change.
- **Retirer un point** : cliquez la croix à côté du point.
- **Compteur sur la carte** : la carte affiche **« 2/3 »** (points cochés /
  nombre total de points). Une tâche sans point n'affiche **aucun compteur**.
- **Modèle de points** : sur une tâche qui n'a encore **aucun** point, un bouton
  **« Ajouter les points du modèle »** propose d'un clic les points habituels
  (ceux réglés dans les Options). Rien n'est jamais ajouté tout seul.

#### Au passage en « Terminé »

Le contrôle dépend du mode choisi :

- **Désactivée** : aucun contrôle, la tâche se termine normalement.
- **Rappel simple** (mode par défaut) : si des points restent à cocher, un
  avertissement liste ceux qui manquent et une confirmation **« Terminer quand
  même »** permet de clôturer ; si vous annulez, la tâche reste dans sa colonne.
- **Bloquante** : la clôture est **refusée** tant que des points restent à
  cocher (le message est affiché, sans possibilité de passer outre).

Le même comportement s'applique quand vous **clôturez plusieurs tâches d'un
coup**.

#### Où régler cela

Dans **Options**, rubrique **« Assistant (suivi multi-projets) »** :
- **« Checklist de livraison obligatoire »** : le mode (Désactivée / Rappel
  simple / Bloquante) ;
- **« Modèle de checklist par défaut »** : les points proposés par le bouton
  « Ajouter les points du modèle », **un point par ligne**.

---

<!-- HELP-TOPIC:super-agent-tracabilite -->
### Retrouver ce qui a été livré (traçabilité)

La **traçabilité** relie chaque livraison à sa **demande d'origine** : vous voyez
d'un coup d'œil **qui a demandé quoi, quand**, sans fouiller les conversations.

- **Enregistrement automatique** : dès qu'une tâche du suivi passe à l'état
  **livré** (« Livré » / « Terminé »), Pilot enregistre **une ligne** avec le
  **titre** de la tâche, la **date** et, si elle existe, la **décision** à
  l'origine de la livraison. Une tâche déjà livrée que l'on repasse en livré
  n'ajoute **rien** ; c'est un passage **hors** état livré suivi d'un retour qui
  crée une **nouvelle** ligne (une livraison de plus).
- **Où la retrouver** : ouvrez la **fiche de la tâche** (bouton *éditer* sur sa
  carte) — le bloc **« Livrable »** liste ses livraisons avec leur **date** et
  leur **origine** (« Décision #12 : … »). Sans livraison, il indique simplement
  **« Aucune livraison enregistrée »**.
- **Origine inconnue** : si aucune décision n'est reliée à la tâche, la ligne
  porte la mention **« origine non précisée »** — la livraison reste tracée.
- **Désactiver** : dans **Options → Assistant (suivi multi-projets)**,
  décochez **« Enregistrer une ligne de traçabilité à chaque livraison »**
  (activé par défaut). Décocher **n'efface aucune** ligne déjà enregistrée.

---

<!-- HELP-TOPIC:super-agent-temps -->
### Noter le temps prévu et le temps passé d'une tâche

Comparer **ce qu'une tâche avait coûté en prévision** à **ce qu'elle a réellement
pris** aide à mieux estimer les fois suivantes. C'est exactement ce que permet
le suivi du temps — et il est **masqué par défaut**.

- **À activer d'abord** : tant que le réglage **« Afficher le suivi du temps
  estimé / passé »** n'est pas coché (**Options → Suivi**), rien n'apparaît :
  ni champ de saisie, ni pastille, ni total. C'est le réglage d'usine. Le cocher
  ne change aucune donnée, le décocher n'en fait perdre aucune.
- **Renseigner les temps** : ouvrez la **fiche d'une tâche** (bouton *éditer* sur
  sa carte), bloc **« Temps »** :
  - **« Temps prévu (min) »** puis **« Régler le prévu »** : la valeur saisie
    **remplace** l'ancienne (laisser le champ vide efface le prévu) ;
  - **« Temps passé à ajouter (min) »** puis **« Ajouter le passé »** : le passé
    **s'additionne** au total déjà noté (pratique en plusieurs séances) et le
    champ se vide après chaque ajout.
- **Ce qui s'affiche alors** : une pastille discrète sur la **carte**
  (**« 45 min prévues / 70 min passées »**) et un **total par projet** dans la
  **vue d'ensemble** du suivi (**« 2 h 15 passées · 4 h prévues »**).
- **Quand rien n'est renseigné** : la carte reste exactement comme avant (aucune
  pastille) et le projet n'affiche **aucune mention**. Si seul le temps passé est
  noté, la pastille indique **« pas d'estimation · 70 min passées »** : Pilot
  n'invente jamais un temps prévu à partir du temps passé.
- **Rien n'est calculé ni déduit à votre place** : seules vos saisies alimentent
  l'affichage.

---

<!-- HELP-TOPIC:super-agent-taches-longues -->
### Repérer les tâches longues

Certaines demandes sont **nettement plus lourdes** que les autres. Pour
celles-là, Pilot le **signale** et vous **propose** de les confier à un agent,
plutôt que de les laisser peser sur l'assistant de suivi.

- **Ce qui s'affiche** : une **pastille discrète « longue »** sur la carte de la
  tâche. Au survol, une **infobulle** explique **pourquoi** elle est jugée longue
  (par exemple « 3 étapes détectées » ou « 12 fichiers cités »).
- **Ce que Pilot ne fait pas** : il **signale** et **propose**, rien de plus. Il
  ne lance **jamais** un agent tout seul et ne change **jamais** votre modèle.
  La décision reste entièrement la vôtre.
- **Demande ordinaire** : **rien ne s'affiche** — la carte reste exactement
  comme avant, sans pastille ni infobulle.
- **Pour éteindre complètement le repérage** : **Options → Assistant
  (suivi multi-projets)**, décochez **« Détecter les tâches longues et proposer
  un agent »** (activé par défaut). Décocher n'efface aucune donnée et ne change
  rien d'autre.

---

<!-- HELP-TOPIC:super-agent-extensions-fiables -->
### Extensions d'agent : écriture fiable

Les extensions de Pilot (les outils qu'un agent reçoit) sont réécrites sur le
disque à chaque lancement de session.

- Un fichier resté **en lecture seule** (copie de sauvegarde, outil de
  synchronisation, antivirus) est **remplacé automatiquement** : l'attribut est
  retiré, puis le fichier réécrit et **relu pour vérification**.
- Un fichier **déjà à jour** n'est pas réécrit (aucune écriture inutile).
- Si le remplacement est **impossible**, l'échec est **affiché et journalisé** :
  un agent ne démarre **jamais** avec une version périmée de ses outils. Pour un
  agent de l'Assistant, le lancement est **refusé** avec un message qui nomme le
  fichier en cause ; les autres sessions démarrent sans l'outil concerné, avec
  l'échec journalisé.

---

<!-- HELP-TOPIC:file-attente-limites -->
### Deux limites connues, écrites noir sur blanc

Après les correctifs d'**ordre d'arrivée**, de **file conservée à l'arrêt d'un
agent** et d'**identité de projet**, **deux limites** subsistent. Aucune ne
perd ni ne duplique une demande, et aucune ne masque un échec : elles sont
écrites ici pour être **connues**, pas pour être cachées. Les correctifs
correspondants sont **identifiés** dans la spécification technique ci-dessous et
restent **non appliqués** (hors périmètre des correctifs déjà publiés).

- **L'ordre d'attente peut changer, jamais la demande** : une mission **déjà
  sortie de file** qui ne trouve pas le projet libre (mission de **lecture**,
  **commande manuelle**, prompt d'un autre agent en cours) est **remise en file
  DERRIÈRE** les suivantes — avec `[B, C]`, la file devient `[C, B]`. Même
  mission, même numéro, rejeu réarmé : rien n'est perdu, rien n'est dupliqué,
  l'attente supplémentaire est d'au plus un tour de rejeu (15 s).
- **La file des commandes manuelles reste rangée par le chemin tel qu'écrit** :
  si le **même dossier** est désigné avec deux écritures (« `G:\IA_PL\pilot` »
  et « `g:/ia_pl/pilot/` »), deux files de commandes manuelles coexistent, et
  `/file` peut ne pas voir — donc ne pas abandonner — les commandes posées sous
  l'autre écriture. Chaque commande démarre quand même à son tour, rien n'est
  perdu. Les **autres** files (missions, délégations, exclusivité, réservations)
  sont, elles, bien **unifiées**.

---

<!-- HELP-TOPIC:dashboard -->
## Aide utilisateur — Tableau de bord

L'onglet **📊 Tableau de bord** (bouton **📊** de la barre latérale) affiche une
vue d'ensemble du **projet actif** : stockage, Git, langages, activité de
l'agent IA, vélocité et documentation. Tout est **en lecture seule** : le
tableau de bord n'édite jamais vos fichiers.

Le tableau de bord a **deux volets** :
- **Volet Assistant** (toujours visible) : activité & métriques de l'agent IA.
- **Volet Projet** (visible seulement quand un projet est ouvert) : stockage,
  Git, langages, vélocité, contexte, alertes.

Quand **aucun projet n'est ouvert**, seul le volet Assistant est affiché (le
volet Projet est masqué) et l'onglet **📊** reste ouvert dans la barre
d'onglets.

### Ce que vous voyez
- **En-tête** : nom du projet, chemin local, client associé (si renseigné dans
  l'onglet 🧭 Assistant) et horodatage du dernier rafraîchissement.
- **Stockage & Poids** : taille totale du répertoire, nombre de fichiers et de
  dossiers, poids du **code source pur** (hors dépendances/caches comme
  `node_modules`, `target`, `.git`…) et les fichiers les plus lourds. Une **taille réelle sur disque** (tout compris, y compris `node_modules`/`target`/`.git`) est affichée à côté du donut, pour connaître la vraie empreinte du projet.
- **Purge des fichiers inutiles** : le tableau de bord détecte automatiquement les éléments purgeables selon le type de projet (dépendances, caches, sorties de build…). Cochez ce que vous voulez supprimer, confirmez, et l'espace est libéré. Le dossier `.git` n'est jamais supprimé (seule une compaction `git gc` est proposée, qui ne touche pas à l'historique).
- **État Git** : branche active, fichiers modifiés, non suivis (untracked) et
  prêts à être commités (staged).
- **Analyse du Code & Langages** : répartition des langages en % (camembert + barres),
  métriques globales (lignes, fonctions, classes), marqueurs TODO/FIXME et écosystème de
  dépendances détecté (Node.js, Rust/Cargo, Python…).
- **Activité & Métriques de l'Agent IA** : nombre de sessions, tokens consommés sur 7 jours,
  total de messages échangés, actions exécutées (Bash, éditions, écritures) et date de la
  dernière session. Graphiques : **barres** tokens/messages par jour et **camembert** de la
  répartition des actions.
- **Évolution & Vélocité (7 jours)** : commits, fichiers modifiés, lignes et taille modifiées
  sur la période, avec **barres** de l'évolution des commits et des fichiers modifiés par jour.
- **Contexte & Documentation** : extrait du README **rendu en Markdown**, fichiers de mémoire /
  décisions d'architecture, derniers fichiers modifiés avec horodatage relatif.
- **Bandeau d'Alertes & Suggestions** : badges des points d'attention (fichiers volumineux,
  éléments non commités, langage principal).

Chaque graphique (camemberts et barres) est dessiné en **SVG inline** (sans bibliothèque
externe), avec **tooltips** au survol, **légendes**, pourcentages et une **ligne d'insight**
(« lecture intelligente ») qui résume le point clé (ex : « Le projet est dominé par Rust
(45%) »).

### Actualiser
Le bouton **Actualiser** relance l'analyse du projet. L'analyse peut prendre
quelques secondes sur les gros projets (parcours du répertoire + Git).

Le tableau de bord se **rafraîchit automatiquement** tant que son onglet est
actif : par défaut toutes les **10 secondes**. Vous pouvez désactiver ce
comportement ou modifier l'intervalle dans **Options → Général** (« Activer
le rafraîchissement automatique du tableau de bord » + durée en secondes).

### Suivi multi-projets
La **première carte** du tableau de bord est le **suivi multi-projets** : le
tableau récapitulatif (projet, statut, tâches ouvertes/total, agent occupé ou
prêt, dernière session, décisions et sessions récentes). Le projet actif est
mis en évidence (📍).

Les projets y sont **rangés par client**, avec un **en-tête de groupe** au nom
du client au-dessus de ses projets (petites majuscules). Un projet **sans
client** apparaît sous l'en-tête « Sans client ».

**Tous les projets suivis sont affichés**, y compris ceux qui ne sont **pas
ouverts** dans Pilot : leur ligne porte la pastille **« non ouvert »** et leurs
tâches viennent du suivi de l'Assistant. On supervise ainsi d'un coup d'œil
tous les dossiers suivis, ouverts ou non, et l'activité de leurs agents.

Si le réglage **Options → Assistant → « Afficher le suivi du temps estimé /
passé »** est activé, une ligne discrète ⏱ rappelle le temps estimé et passé du
projet (aucun calcul n'est fait par l'interface : les totaux viennent du
suivi).

### Afficher le Tableau de bord systématiquement
Dans **Options → Général**, l'option **« Afficher le Tableau de bord
systématiquement »** (désactivée par défaut) permet d'ouvrir automatiquement
l'onglet **📊** au démarrage de Pilot, **uniquement si un projet est ouvert**
(le tableau de bord est lié au projet actif). Quand elle est activée, l'onglet
**📊** est **verrouillé en position** dans la barre d'onglets : juste après
l'onglet **🧭 Assistant** et avant le bouton **＋** d'ajout d'agents, et il n'est
plus déplaçable au glisser-déposer. Désactivez l'option pour retrouver le
comportement normal (onglet déplaçable, ouvert via le bouton **📊** de la barre
latérale).

L'onglet **📊** n'est **pas fermé** quand on ferme le projet actif : il reste
affiche dans la barre d'onglets (à côté de l'onglet **🧭 Assistant**) et bascule
automatiquement sur le volet Assistant seul. Il se rafraîchit au changement de
projet (ouverture, fermeture, bascule).

---

<!-- HELP-TOPIC:vault -->
## Aide utilisateur — Coffre fort

L'onglet **🔐 Coffre** (bouton **🔐** de la barre latérale) stocke vos mots de
passe de façon **chiffrée**, dans un fichier situé **hors de vos projets**
(`~/.pilot/vault.json`). Tout est protégé par un **mot de passe maître**.

### Première utilisation
- À la première ouverture, créez un **mot de passe maître** (min. 4 caractères).
  Il n'est **jamais stocké en clair** : une clé AES-256 est dérivée via Argon2id.
- ⚠️ **Si vous l'oubliez, vos données sont irrécupérables.** Il n'existe aucun
  moyen de réinitialiser le coffre sans perdre son contenu.

### Déverrouiller / verrouiller
- À chaque ouverture de l'onglet, le coffre est **verrouillé** : saisissez le
  mot de passe maître pour y accéder.
- Le bouton **Verrouiller** efface la clé en mémoire (le coffre se reverrouille).
- Le bouton **Mot de passe maître** permet de le changer (les entrées sont
  ré-chiffrées avec la nouvelle clé).

### Gérer les entrées
- Chaque entrée = **description** (ex: « Serveur OVH ») + **login** + **mot de passe**.
- **Portée** : choisissez à la création/édition si l'entrée est **🌐 globale**
  (visible dans tous les projets) ou **📁 spécifique au projet actif**.
- **Référence** : chaque entrée affiche sa référence technique (`vault:…`) sous
  son login — cliquer dessus la copie. C'est cette référence qu'attend le champ
  « Clé » des Options → Serveurs MCP (elle y est aussi proposée en liste).
- **Copier** : boutons de copie pour le **login** et pour le **mot de passe**
  (copie dans le presse-papiers).
- **Masqué par défaut** : les mots de passe sont affichés en `••••••••` ; le
  bouton **œil** les révèle temporairement.
- **Modifier / Supprimer** : boutons d'édition et de suppression sur chaque
  entrée, depuis la vue globale.

---

<!-- HELP-TOPIC:anomaly -->
## Aide utilisateur — Détection d'anomalies et arrêt auto des agents bloqués

Pilot surveille en arrière-plan l'activité de ses agents (codeur, agents du
registre, reviewer, assistant).

**Détection d'anomalies** : si un agent est **actif mais sans progression**
depuis un certain temps (seuil par défaut : **30 minutes**), Pilot vous en
avertit (bandeau + notification native). Le bandeau propose un bouton
**🔍 Diagnostiquer** qui lance un agent d'analyse **sans action automatique** :
il propose des évolutions que vous validez vous-même.

**Arrêt automatique des agents bloqués (T2)** : un agent **bloqué** — actif mais
**sans progression** depuis le seuil dédié (défaut : **10 minutes**) — est
**arrêté automatiquement**. Cela concerne les **agents délégués** (lancés via
run_agents, ex. par l'Assistant 🧭) **et l'agent standard** du projet (session
principale), pour qu'un process figé ne bloque plus Pilot. Le reviewer et
l'Assistant ne sont **jamais** arrêtés automatiquement.

**Opération longue en cours** (un outil démarré qui tourne encore : longue
construction, longue série de tests, longue analyse) : tant qu'un outil
s'exécute, l'agent est considéré comme en train de travailler — **un agent qui
travaille n'est jamais arrêté au bout de 25 minutes, ni même au bout d'une
heure**. L'alerte « agent bloqué » comme **l'arrêt automatique (T2)** sont
suspendus, et son créneau de run n'est ni libéré ni pris par une autre demande.
Les fenêtres de temps (25 minutes) ne concernent qu'un agent **sans aucun outil
en cours et sans nouvelle** : c'est celui-là, réellement figé, qui est signalé et
arrêté. Pendant ce temps, **l'écran le montre** : la commande en cours et sa
durée écoulée s'affichent dans l'onglet de l'agent, dans la liste des agents et
dans la liste des tâches — une compilation n'est jamais confondue avec un arrêt.

**Cas de l'outil qui ne se termine jamais** : si un outil reste ouvert plus de
**60 minutes** sans jamais rendre la main (fin d'outil perdue), Pilot considère
qu'il est **perdu** et libère seulement l'indicateur « occupé » — le cercle
d'activité s'éteint, les nouvelles missions sont de nouveau acceptées sur ce
projet et la mise à jour peut de nouveau être proposée. **Rien n'est
interrompu** : ni l'outil, ni l'agent. Le motif est journalisé.

Une **fin de tour partielle** de l'agent (reprise automatique après une erreur
passagère ou une compaction) n'est **pas** un repos : l'agent reste considéré
comme en train de travailler, son créneau comme sa place en file sont conservés.

**Une mission n'est jamais annoncée en échec sans vérification** : quand une run
est interrompue (inactivité, verrou libéré par le chien de garde) **ou qu'un
agent termine son tour sans texte de conclusion** (cas fréquent après une série
d'outils), Pilot vérifie
l'état du projet **sur le disque** (commit tombé pendant la run, ou fichiers
modifiés pour une mission d'écriture). Si du travail est présent, le rapport
indique « travail présent sur le disque, pas un échec » au lieu d'un échec — la
mission n'est donc pas relancée inutilement. Un échec n'est annoncé que lorsque
le disque ne montre aucun travail nouveau.

**Question posée à l'utilisateur** : quand un agent attend votre réponse (choix,
confirmation, saisie), cette attente n'est pas un blocage. L'arrêt automatique
(T2) est **mis en pause** tant que la réponse n'est pas donnée, même très
longtemps.

**Verrou de run fantôme (busy-stale)** : si un agent reste marqué actif (process
pi figé) **sans aucun outil en cours** et sans activité depuis **25 minutes**,
Pilot libère son créneau (notification 🧹 avec la raison) pour que les demandes
en file reprennent — sans réinitialiser son processus. Un agent dont un outil
tourne n'est jamais concerné, quelle que soit la durée de l'opération. Aucun
réglage utilisateur.

**État d'exécution fantôme (issue #87)** : si un agent a été enregistré
« en cours » alors que son processus n'existe plus (mort silencieuse), Pilot
**remet son état à zéro** au passage suivant du moniteur (≤ 30 s) : son
processus n'étant plus vivant, son créneau et son verrou d'exécution sont
**libérés automatiquement** et les lancements suivants sur ce projet
**repartent normalement** — sans redémarrer Pilot. C'est vrai aussi pour un
**agent global** (espace assistant, sans projet) resté « en cours » alors que
son processus est mort : il est relançable au lieu de rester bloqué en silence.
Une exécution réellement en cours n'est jamais touchée.

**Marque « occupé » toujours libérée à l'arrêt** : quelle que soit la façon
dont un agent est arrêté (arrêt manuel, fermeture du projet, arrêt de tous les
agents, fermeture de Pilot ou mise à jour de pi), sa marque « occupé » est
**systématiquement purgée**. Une nouvelle demande sur ce projet **redémarre
normalement** l'agent au lieu de rester en file derrière un couple
(projet, agent) marqué occupé à tort.

- **Notification** : un bandeau + une notification native indiquent que l'agent
  a été arrêté (agent + raison). Le créneau de ce spécialiste est libéré : un
  agent en file d'attente sur le même rôle peut prendre le relais.
- **Diagnostic automatique** : après l'arrêt, un **agent de diagnostic est lancé
  automatiquement** pour **proposer** des évolutions (lecture seule, validation
  utilisateur requise — aucune action automatique).
- **Scope restreint** : sont arrêtés automatiquement les agents **délégués** ET
  l'**agent standard** du projet (session principale) ; le reviewer et
  l'Assistant ne sont **jamais** arrêtés automatiquement. Le filet « occupé
  périmé » libère le créneau **sans tuer l'agent**.
- **Réglages** : dans **Options ⚙️ → Agent**, vous pouvez activer/désactiver
  la **Détection d'anomalies** (seuil 30 min) et l'**Arrêt auto des agents
  bloqués (délégués + standard)** (seuil 10 min). Activés par
  défaut.
- **Alerte sur Telegram** : **plus envoyée depuis la décision 2026-11** — le
  canal Telegram ne porte **que la conversation** avec l'Assistant. Les alertes
  (anomalie détectée, arrêt automatique, verrou de run libéré) restent visibles
  **dans Pilot** (panneau Activité, fiche de l'agent) et par les
  **notifications natives** si vous les avez activées. La passerelle Telegram
  n'en transporte plus aucune ; la section « Telegram » de cette aide dit ce qui
  y passe désormais (`spec_telegram.md` § 16).
- **Prise en compte immédiate (issue #89)** : ces réglages (seuils et
  activations) sont **relus en continu**, à chaque passage de la surveillance
  (toutes les **30 s**). Un changement dans les Options s'applique donc
  **sans redémarrer Pilot** — au plus tard au passage suivant du moniteur.
- **Aucune fausse alerte** : un agent qui progresse (événements RPC réguliers)
  n'est jamais signalé ni arrêté. Un agent actif **sans aucun événement** depuis
  le seuil déclenche l'alerte (une fois par blocage, réarmé à la prochaine
  exécution). Une **opération longue en cours** (build, série de tests,
  installation : aucune nouvelle de l'agent entre le début et la fin de
  l'outil) n'est **pas** un blocage : tant qu'un outil tourne, l'alerte
  « agent bloqué » **et** l'arrêt automatique sont suspendus. Seul un agent
  **réellement figé** (aucun outil en cours et plus aucune activité) est
  signalé.
- **Verdict vérifié sur le disque** : avant de conclure qu'un agent n'a rien
  fait, Pilot regarde le travail réellement écrit pendant l'exécution (commits et
  fichiers modifiés) : du travail présent n'est **jamais** annoncé comme un
  échec. Une mission de **lecture** (planificateur, architecte, reviewer) est un
  cas particulier : elle n'écrit rien, donc un changement survenu pendant qu'elle
  tourne vient d'ailleurs et ne compte pas. Une session de lecture qui se termine
  **sans livrable** (aucun plan produit) est signalée en **échec**, avec le nom
  de l'agent — jamais comme une réussite.

---

<!-- HELP-TOPIC:telegram -->
## Aide utilisateur — Telegram : la conversation, rien d'autre

Sur Telegram, vous retrouvez **exactement la conversation** que vous auriez avec
l'assistant — comme sur l'écran Vocal : vous **écrivez une demande**, il vous
**répond**. **Rien d'autre** ne vous y est envoyé : aucun message de **début** ou
de **fin de mission**, aucun **rapport automatique**, aucun **résumé de tâche**,
aucune **alerte technique**, aucun **message de service**. Ces informations
restent **dans Pilot** (et, si vous l'avez activé, dans les **notifications de
votre bureau**) : le canal Telegram ne les annonce plus du tout.

**Réglage** : dans **Options ⚙️ → onglet Assistant**, section
**« Notifications Telegram »** :

1. cochez **« Me prévenir sur Telegram »** ;
2. collez le **jeton du bot** (fourni par **@BotFather** dans Telegram) ;
3. indiquez l'**identifiant de discussion** qui recevra les messages (votre
   identifiant personnel, ou celui d'un groupe).

Pour obtenir ces deux valeurs : créez un bot auprès de **@BotFather**
(`/newbot`), puis envoyez un message à votre bot et récupérez votre identifiant
auprès de **@userinfobot** (ou de l'API `getUpdates`).

**Comportement quand c'est désactivé (par défaut)** : tant que l'interrupteur
est décoché **ou** qu'un des deux champs est vide, **rien n'est envoyé** sur
Telegram et **aucun message d'erreur** ne s'affiche. Décocher le réglage suffit
à tout arrêter ; les informations restent alors visibles **dans Pilot**.

**Un seul réglage, que l'Assistant peut changer lui-même** :

- c'est le **seul** interrupteur de la communication Telegram (il n'existe aucune
  seconde case ailleurs) ;
- demandez-le **en toutes lettres** à l'Assistant, dans Pilot **ou** sur
  Telegram — « préviens-moi sur Telegram », « arrête de me prévenir », « coupe
  les notifications » : il applique **tout de suite** et confirme en **une
  phrase**, sans vous redemander ;
- **si vous écrivez au bot sur Telegram**, le réglage se **réactive
  automatiquement** (vous écrivez là, donc vous voulez y être prévenu) : le geste
  est journalisé et l'interrupteur des Options apparaît coché. Un message venant
  d'**une autre personne** ne change jamais ce réglage.

**Ce qui passe par le canal est court et net** :

- **votre demande** et **la réponse de l'Assistant** — rien de plus ;
- **les questions** qu'il vous pose (choix, confirmation, saisie libre) et
  **vos réponses** — voir ci-dessous ;
- **pas de détails techniques** : ni chemin de fichier, ni nom de fonction, ni
  numéro de session, ni compte de tests, ni branche ni commit ;
- **aucune heure dans les messages** : un message dit **ce qui se passe**, pas
  quand ;
- **aucun récapitulatif** : pas de bilan du soir, pas de message à heure fixe,
  aucun rapport automatique ;
- **un seul envoi par réponse** : une même réponse ne vous parvient jamais deux
  fois.

**Détails utiles** :

- l'envoi se fait **en arrière-plan** : il ne ralentit ni ne bloque jamais
  Pilot ;
- si Telegram est injoignable (pas de réseau, jeton erroné), le message est
  simplement perdu — **cela n'interrompt jamais la conversation** et n'affiche
  aucune erreur ;
- ces messages sont **indépendants** des notifications natives (fenêtre
  Windows) : vous pouvez avoir l'un sans l'autre ;
- le jeton est conservé dans votre configuration locale et n'est utilisé que
  pour l'envoi ; il n'apparaît dans aucun journal.

⚠️ **Répondre aux questions depuis Telegram (lot 1)** : quand l'Assistant vous
**pose une question** (choix, confirmation, saisie libre), Pilot vous l'envoie
**aussi sur Telegram**.

Sur une question à **choix multiples** ou une **confirmation (Oui / Non)**, le
message comporte de **vrais boutons** : appuyez simplement sur l'option voulue,
**sans rien recopier**. Vous pouvez toujours répondre **en texte** si vous
préférez :

- **un numéro** (« 1 », « 2 »…) sélectionne l'option correspondante ;
- sur une **confirmation** (Oui/Non), un accord clair (« oui », « ok », « vas-y »…) confirme et un refus clair (« non », « annule », « stop »…) refuse ; un texte ambigu **ne décide rien** : la question reste posée et vous est reposée ;
- **tout autre texte** est pris comme réponse libre (valeur d'une saisie, ou
  précision d'un choix).

Sur une question à **choix multiple**, les boutons sont des **cases à cocher** :

- **un appui coche** l'option (la case passe de « ☐ » à « ✅ ») : vous pouvez en
  cocher **plusieurs**, et le message affiche au fur et à mesure la **sélection en
  cours** ;
- **un second appui décoche** l'option ;
- **rien n'est envoyé** tant que vous n'appuyez pas sur **« ✔️ Terminé »** : ce
  bouton valide et transmet **toutes** les options cochées, **dans l'ordre de la
  liste**. Sans « Terminé », la question reste ouverte ;
- la réponse **en texte** fonctionne comme avant (numéro ou texte libre).

Sur une question à **choix unique** ou une **confirmation (Oui / Non)**, un
**seul appui** répond immédiatement : rien ne change.

Dès que la question est répondue (**bouton**, **« Terminé »**, **texte sur
Telegram**, ou réponse **dans Pilot**), le message Telegram est **mis à jour** :
les boutons disparaissent et la mention **« ✅ Déjà répondu »** apparaît — vous
voyez d'un coup d'œil qu'il n'y a plus rien à faire. Sur une question à choix
multiple, la mention rappelle ce que vous avez coché.

La **première réponse gagne** : si vous répondez dans Pilot **ou** sur Telegram,
Pilot garde la première et ignore l'autre, sans erreur. Un message **tardif qui
ressemble à une réponse** reçoit alors « ✅ cette question a déjà été répondue » ;
un **texte libre** tardif reste, lui, un message normal de la discussion. Si vous
ne répondez pas, la question reste posée et Pilot vous envoie **un seul rappel
discret** après quelques minutes. Un message **ou un appui de bouton** venant
d'une **autre personne** que vous est **ignoré** (jamais de réponse).

📨 **L'Assistant vous parle sur Telegram** : dans l'onglet **🧭 Assistant**, un
petit bouton de discussion permet d'**activer** cette communication. Il
n'apparaît que si l'envoi Telegram est réellement **en état de fonctionner**
(case **« Me prévenir sur Telegram »** cochée, jeton et identifiant renseignés — ces réglages restent dans **Options ⚙️ → onglet Assistant**) :
s'il s'affiche, c'est que vos messages partiront vraiment. Une fois activé, ce que
l'Assistant écrit vous arrive **aussi sur Telegram**, **net et entier** — et
**seulement la conversation** : sa réponse, sa question, sa demande d'accord.
Rien n'est coupé en cours de phrase : la réponse garde les **deux phrases
courtes** du mode vocal. Les étapes de travail, les **rapports automatiques**,
les **résumés de tâche** et les **alertes techniques** ne vous sont **pas**
envoyés : ils restent dans Pilot. Quand cette communication est **coupée** (par
défaut), aucune réponse ne part sur Telegram. Le bouton indique son état et
votre choix est conservé après un redémarrage de Pilot.

🗣️ **Écrire à votre bot, c'est comme parler à l'écran Vocal** : que vous parliez
dans **Pilot** (écran Vocal) ou que vous **écriviez sur Telegram**, l'Assistant se
comporte **exactement de la même façon** :

- **même longueur de réponse** : il répond **court** selon le réglage choisi
  (Options ⚙️ → onglet Assistant → **Longueur des réponses**) — deux phrases
  courtes par défaut — et ne fait **ni liste, ni titre, ni bloc de code**, ni nom
  de fichier ; **si vous demandez explicitement le détail** (« détaille »,
  « explique », « pourquoi », « comment », « donne-moi le détail »), la brièveté
  **ne s'applique plus** : il développe **autant qu'il faut**, en phrases ;
- **même conversation** : votre message est un **tour de conversation** dans le
  fil en cours, pas un rapport à classer. Il garde le contexte, ne repart pas de
  zéro et ne vous redemande pas ce qu'il sait déjà ;
- **les cas graves se disent en entier** : une panne, un refus, une erreur ou une
  demande de confirmation ne sont **jamais** raccourcis — vous recevez la cause et
  ce qu'il attend de vous ;
- **rien n'est tronqué** : le texte part tel qu'il a été écrit. Il n'est découpé en
  plusieurs messages que s'il dépasse la limite d'un message Telegram.

---

<!-- HELP-TOPIC:laya -->
## Service Laya (classification locale)

Le **service Laya** est un classement automatique local qui tourne sur votre
ordinateur. Pilot ne classe aucun texte à votre place : il **utilise** ce service
pour une seule décision interne (savoir si un message de l'assistant mérite
d'être envoyé vers Telegram), et il met la classification à la disposition de ses
**agents** comme un outil bon marché. Dans tous les cas, le service est **lancé et
surveillé une seule fois** pour toute l'application (il garde un gros modèle en
mémoire : en lancer plusieurs épuiserait la machine), et chaque appel partage ce
même service.

- **Ce que Pilot classe lui-même** : quand le dialogue Telegram est ouvert,
c'est Laya qui décide si un message de l'assistant est une alerte à relayer ;
si le service ne répond pas (ou si la réponse est trop peu sûre), Pilot revient
à son ancien tri par mots-clés, sans rien bloquer ni afficher d'erreur.
- **Outil des agents** : les agents disposent d'un outil `laya_classify`
(choix parmi des libellés, note sur une échelle, oui/non) qui interroge ce même
service, sans charger de modèle et sans consommer de jetons. Service éteint ou
modèle non prêt : l'agent reçoit un message clair et continue.

**Rien à installer** : Pilot livre avec lui le service, son interpréteur et sa
bibliothèque de calcul. Au premier démarrage, il ne manque que le **modèle**
(plusieurs centaines de Mo) : Pilot le télécharge tout seul, puis lance le
service. Vous n'avez aucune commande à taper. Le modèle est enregistré dans le
dossier de **données** de Pilot, jamais dans le dossier du programme.

Réglages disponibles dans **Options → Service Laya** :

- **Lancer le service Laya au démarrage** : si activé, Pilot démarre le service
  à son ouverture, uniquement s'il ne répond pas déjà.
- **Programme du service** : le fichier `laya-service.mjs`. Laissez vide pour
  utiliser celui livré avec Pilot.
- **Programme interpréteur (Node.js)** : le programme qui exécute le service et
  le téléchargement du modèle. Laissez vide : Pilot prend celui qu'il livre, et
  à défaut celui installé sur l'ordinateur.
- **Dossier du modèle à charger** : le dossier contenant le modèle de
  classification. C'est le service qui le charge, pas Pilot. Laissez vide pour
  utiliser le dossier habituel (dans les données de Pilot si le service est
  livré, sinon `model-ml` à côté du service).

Ces champs sont **facultatifs** et rangés dans **« Réglages avancés »**,
replié par défaut en bas de la page (ouvrez-le pour les voir) : les remplir sert
uniquement à utiliser un service ou un interpréteur installé à la main, ailleurs.
Dans ce cas, c'est votre réglage qui l'emporte.

- **Démarrer le service maintenant** : lance le service tout de suite, sans
  fermer puis rouvrir Pilot. L'écran indique ensuite ce qui s'est **réellement**
  passé ; si le service tourne déjà, il n'est ni arrêté ni relancé. En cas
  d'échec, la raison exacte est notée dans le fichier `laya.log`, à côté des
  données de Pilot.

**Plusieurs fenêtres de Pilot ouvertes** : elles partagent le même service. Une
fenêtre ne referme jamais le service lancé par une autre : elle le réutilise
tant qu'il répond, et chaque fenêtre ne referme que le sien.

**Téléchargement du modèle** : Pilot peut récupérer le modèle lui-même, sans
que vous ayez de commande à taper.

- **Télécharger le modèle automatiquement s'il manque** : à l'ouverture de
  Pilot, si le modèle est incomplet, il est d'abord téléchargé, puis le service
  est lancé. Rien n'est téléchargé si le modèle est déjà complet.
- **Télécharger le modèle maintenant** : lance le téléchargement tout de suite,
  même hors démarrage. Une barre indique l'avancement.
- **Interrompre** : arrête le téléchargement en cours. La reprise continuera au
  même endroit plus tard (aucun octet déjà récupéré n'est perdu).
- **Adresse d'hébergement des fichiers du modèle** (avancé) : l'adresse où les
  fichiers sont publiés. Laissez vide : c'est le cas normal, Pilot utilise
  l'adresse livrée avec lui. La renseigner **force** une autre adresse
  (hébergement personnel, miroir).
- **Programme de téléchargement du modèle** (avancé) : le fichier
  `laya-fetch.mjs`. Laissez vide pour utiliser celui livré avec Pilot (sinon il
  est cherché à côté du service).

**Lancer un téléchargement** : le bouton **Télécharger le modèle maintenant**
lance la récupération, et la ligne d'état ci-dessous dit ensuite ce qui se passe
**réellement** — jamais un message de réussite lancé à l'aveugle. Si la demande
n'a pas pu démarrer, la cause exacte est annoncée tout de suite.

**Lire l'indicateur d'état** : sous ces champs, une ligne vous dit où en est le
service — « arrêté », « en cours de chargement du modèle… », « prêt », « modèle
pas encore téléchargé », ou « n'embarque pas le service Laya » (uniquement sur
les versions où le service n'a pas pu être livré, p. ex. macOS Intel : l'écran le
dit alors franchement). Un service lancé à la main n'est jamais arrêté par
Pilot ; seul le service que Pilot a démarré est refermé à la fermeture **et
avant une mise à jour** (sinon le service garderait `node.exe` et les fichiers
ONNX ouverts, et l'installateur ne pourrait pas les remplacer).

Sous les réglages du modèle, une autre ligne indique l'état du **modèle** :
« prêt », « absent », « téléchargement… n % », « interrompu », « adresse
inconnue »… Tous ces messages sont en langage courant (jamais de chemin ni de
nom de fichier technique). **Un échec dit toujours sa cause réelle** : le refus
du serveur d'hébergement (surcharge, quota) n'est jamais présenté comme une
absence de connexion Internet, et inversement ; et si le programme de
téléchargement n'est pas livré, c'est bien **cette** cause qui est annoncée, pas
une adresse manquante.

Enregistrez vos réglages avec le bouton **Enregistrer** du panneau des
Options. Les valeurs sont conservées d'une ouverture à l'autre.
