# Pilot — IDE pour Agents IA

**Pilot** est un **environnement de développement intégré (IDE)** multiplateforme (Tauri v2, Rust + HTML/CSS/JS/Vite) dont le cœur est constitué des agents IA de codage **pi** et **plh**. Au-delà de l'édition temps réel, il intègre un **chat agent** (RPC), le **Mode Orchestration**, la **conversion PDF → Markdown**, la **dictée vocale** et l'**accès distant web**.

Les **fournisseurs et modèles LLM sont paramétrables** : vous pouvez configurer d'autres providers et modèles d'API pour les LLM. Certains de ces modèles peuvent ne pas être testés (manque de moyens financiers du développeur) — des évolutions peuvent donc être demandées.

Pilot porte la **vision particulière de son développeur (Patrick Leveneur)**, potentiellement différente des autres solutions existantes, avec une **intégration maximale de l'IA** — à la fois pour ses propres développements et pour des développements réalisés à la demande du développeur via l'outil.

Le but final de Pilot est d'être un **assistant de codage** mais aussi un **assistant de suivi de dossiers** : grâce à l'IA et aux agents, suivre une activité de façon très efficace et faire des propositions et ajustements très élaborés.

Pilot se comporte aussi comme un **gestionnaire de projets** : il ouvre plusieurs projets simultanément, chacun avec son propre agent dédié en arrière-plan, ses onglets et sa discussion — le tout complété par le multi-agents, la mémoire de projet, l'historique de sessions, le super-agent de suivi et un système de tests anti-régression.

---

## Fonctionnalités

### Prise en main à la première ouverture
- Sur une **installation neuve**, Pilot affiche **une seule fois** une petite fenêtre en **trois écrans courts** : **le moteur constaté** (quel agent répond, et quoi faire s'il ne répond pas), **le projet sur lequel on travaille** (avec le bouton pour en ouvrir un), puis **le modèle de l'assistant** (la liste des modèles réellement disponibles).
- Les sorties : **Terminer** règle en une seule fois ce qui fait que « Lancer l'agent » lance vraiment l'agent ; **Passer** (ou Échap, ou la croix) note seulement que la prise en main a été vue et ne change rien d'autre ; **Je découvre** affiche trois repères puis ouvre l'onglet 🧭 Assistant.
- Elle n'appelle **aucun modèle** (donc aucun coût), ne lance aucune session, ne supprime rien et ne modifie pas l'apparence. Quand quelque chose manque (aucun modèle, moteur introuvable), elle dit **pourquoi** et **quoi faire**, avec un bouton **Réessayer** — jamais de liste vide muette, et **Passer reste toujours actif**.
- Elle ne s'affiche **jamais** sur une installation existante (le fichier de configuration est déjà là), et jamais par-dessus la vérification de version du moteur : elle attend que celle-ci rende la main.

### Barre de fenêtre
- La **barre de titre système** (logo, nom du dossier, boutons Windows) n'est plus affichée, et **Pilot ne dessine plus de bande haute** : la fenêtre commence directement par la rangée d'onglets. L'application gagne ainsi **32 pixels de hauteur utile**.
- Les trois boutons système forment un groupe fixe **en haut à droite, au bout de la rangée d'onglets** : **Réduire**, **Agrandir / Restaurer** (l'icône suit l'état réel de la fenêtre) et **Fermer** — Fermer garde exactement le comportement habituel (confirmation ou mise en veille de la fenêtre). Leur place est réservée : aucun onglet ne passe dessous.
- **Déplacer la fenêtre** : glissez depuis le **bandeau du nom de projet** (en haut de la colonne de gauche) ou depuis **l'espace vide de la rangée d'onglets** ; un **double-clic** à ces endroits agrandit / restaure. Les onglets, boutons et menus ne déplacent jamais la fenêtre. Le nom donné au système (barre des tâches, Alt+Tab) est toujours `Pilot`.
- **Menu « Disposer »** : un **clic droit** sur le bouton **Agrandir** ouvre les trois placements — **Moitié gauche de l'écran**, **Moitié droite de l'écran**, **Plein écran**. Le clic gauche garde son effet habituel (agrandir / restaurer).
- **Toujours accessibles** : les trois boutons restent visibles quand la fenêtre est agrandie (mode immersif).

### Animations d'ouverture
- **Modales** : les modales (raccourcis, commandes projet, inter-projets, etc.) s'ouvrent avec une **animation de zoom** depuis le point de clic (bouton ou option de menu) jusqu'à leur taille finale. Les **modales et dialogues de l'agent** (Code Graph 📊, sélection des modèles d'orchestration 🧠, confirmations/choix/saisies demandés par l'agent) bénéficient de la même animation.
- **Nouveaux onglets** : l'ouverture d'un **nouvel onglet** (fichier dans l'explorateur, bouton du panneau bas, bascule vers un onglet jamais encore affiché) bénéficie du même **zoom depuis le point cliqué**, appliqué au contenu. La bascule vers un onglet déjà affiché reste instantanée.
- **Paramètre ⚙️ → Général → Apparence → « Animer l'ouverture des modales »** : force les animations même si la **réduction de mouvement** est active côté système. **Activé par défaut** (y compris après mise à jour d'une ancienne version, pour laquelle le paramètre n'existait pas encore). Le désactiver restore le respect strict de l'accessibilité.

### Explorateur de fichiers
- **Arborescence en temps réel** — mise à jour automatique dès qu'un fichier est créé, modifié ou supprimé (même par un processus externe).
- **Flèches ▶/▼** pour déplier/replier les dossiers. Les dossiers vides n'affichent pas de flèche.
- **Menu contextuel** (clic droit) : créer/supprimer des fichiers et dossiers, renommer, exporter.
- **Clic droit sur un ascenseur** : aucun menu natif ne s'affiche (le menu système WebView2 est désactivé).
- **Drag & drop** de fichiers externes dans l'arborescence → copie automatique dans le projet.
- **Persistance de l'expansion** : l'état déplié/replié survit aux rafraîchissements.

### Projets récents
- **Bouton "Projets"** avec logo Pilot — menu déroulant listant les 10 derniers projets (les projets déjà ouverts n'y sont pas dupliqués : ils sont listés dans la barre « Projets en cours » ci-dessous).
- **"📁 Nouveau projet"** : sélecteur de dossier natif.
- **Chargement automatique** du dernier projet au démarrage (paramétrable).
- **Titre de fenêtre** : `Pilot` — le nom donné au système (barre des tâches, Alt+Tab) ne contient jamais le chemin du projet.
- **Projets en cours** : les projets ouverts sont listés sous le bouton Projets
  (toujours visibles, projet actif en surbrillance). Cliquer sur un projet bascule
  dessus ; le bouton **✕** à droite le ferme proprement.
- **Indicateur d'activité** : une pastille à côté de chaque projet de la barre
  « Projets en cours » montre si **son agent travaille** (animée) ou **est en
  attente**, y compris quand un agent d'un projet inactif réfléchit en arrière-plan.
- **Discussion inter-projets** (bouton 🔗) : liez des projets entre eux pour
  déposer une analyse/tâche vers un projet lié — son agent est lancé pour la
  traiter (détails en appuyant sur ❓ → « Discussion inter-projets »).

### Édition Markdown
- **Coloration syntaxique** via CodeMirror 6 (Markdown, thème sombre/clair adaptatif).
- **Raccourcis clavier** : `Ctrl+B` (**gras**), `Ctrl+I` (*italique*), `Ctrl+K` ([lien](url)).
- **Multi-curseurs** : `Alt+clic` ajoute un curseur, `Ctrl+D` sélectionne l'occurrence suivante.
- **Lint intégré** : les diagnostics du linter du projet (eslint JS/TS) s'affichent en direct dans la gouttière de l'éditeur.
- **Recherche & remplacement** : `Ctrl+Shift+F` (recherche globale), `Ctrl+Shift+H` (remplacement global avec aperçu).
- **Insertion d'images** : glisser-déposer une image dans l'éditeur, ou `Ctrl+V` depuis le presse-papiers. L'image est copiée dans `images/` et la syntaxe `![]()` est insérée.

### Prévisualisations
- **Markdown** — rendu instantané via `markdown-it` (HTML, liens, tableaux, blocs de code) + **diagrammes Mermaid** (flowchart, sequence, class, ER, Gantt…) avec zoom/pan interactif. Les **liens** de la prévisualisation sont cliquables : un lien interne ouvre le fichier cible dans un onglet, un lien externe (http/https) s'ouvre dans le navigateur, une ancre (`#section`) fait défiler la prévisualisation.
- **Mode split** (`Ctrl+Shift+E`) : éditeur à gauche, prévisualisation à droite, avec **scroll synchronisé proportionnellement dans les deux sens** (défilement de l'éditeur → la prévisualisation suit, et inversement). La position de scroll est préservée pendant l'édition ; cliquer un titre dans la prévisualisation fait défiler l'éditeur jusqu'à la ligne correspondante.
- **PDF** — visualisation intégrée avec PDF.js : navigation par page, zoom, téléchargement.
- **Images** — affichage plein écran avec zoom et ajustement à la fenêtre.
- **CSV** — tableau aligné avec en-têtes, numéros de ligne, détection auto du séparateur.

### Système d'onglets
- Onglets distincts pour chaque mode : édition 📝, prévisualisation Markdown 👁️, PDF 📕, image 🖼️, CSV 📊, terminal 🖥️.
- **Onglet agent π** : chat IA intégré avec l'agent Pi (mode RPC), streaming Markdown, pensées, outils, sélecteur de modèle, **dictée vocale** 🎙️. **Mode Orchestration** disponible : orchestrateur cloud + codeur local, planification en micro-tâches, édition chirurgicale `SEARCH/REPLACE`, linting-in-the-loop et directive globale. À l'ouverture de l'onglet **et au lancement de Pilot**, Pilot **vérifie automatiquement** si une nouvelle version de Pi est disponible et propose de la mettre à jour (`pi update --self`).
- **Boutons de choix / confirmation** : quand l'agent a besoin d'un choix, d'une confirmation ou d'une saisie, il peut afficher des **boutons cliquables directement dans le chat** (choix unique, cases à cocher pour plusieurs choix, Oui/Non, champ texte) au lieu de vous faire taper la réponse. Un **champ de texte optionnel** permet d'ajouter une **précision** à votre réponse (choix unique, cases à cocher ou confirmation Oui/Non) : si vous la remplissez, elle est envoyée à l'agent avec votre choix ou votre confirmation. Vous pouvez aussi valider sans rien saisir. **Une question posée par un agent lancé en arrière-plan** (par l'Assistant) **vous revient toujours** : elle est relayée dans la conversation de l'Assistant, avec ses options, et **aucune réponse n'est décidée à votre place** ; sans réponse, la demande reste en attente (plafond de 45 minutes).
- **Code Graph (📊)** : Pilot construit localement un **graphe structurel** du projet (fichiers, fonctions, classes, imports, relations `calls`/`references`) **sans LLM ni clé API**, et l'injecte à l'agent pour répondre aux questions d'architecture **sans relire les fichiers** (économie de tokens). Relations honnêtes (`EXTRACTED`/`INFERRED`), wiki interrogeable (`.pilot/graph-wiki/`), mise à jour au fil de l'eau. Moteur d'extraction au choix : **heuristique** (rapide) ou **tree-sitter** (AST précis) — sélectionnable dans ⚙️ → Graphe. Le bouton **📊 Graphe** (panneau d'actions projet, en bas à gauche) ouvre un **onglet dédié** : état + (re)construction en haut, et en dessous une **visualisation 2D interactive** du graphe (pan/zoom, clic sur un nœud → ouvre le fichier, survol → surligne les connexions, coloration par type, filtres par relation/fichier/recherche, sous-graphe du fichier actif en option, légende des couleurs, centrage automatique, **vue par fichier** auto-activée pour les gros projets). Un **clic** sur un nœud recentre le graphe sur son voisinage (réaffiche sur le même onglet), un **double-clic** ouvre le fichier.
- Fermeture automatique des onglets à la fermeture/changement de projet.
- **Sauvegarde automatique** à la fermeture d'onglet (silencieuse).
- **Détection de conflits** : si un fichier ouvert est modifié de l'extérieur pendant une édition, l'onglet clignote en rouge.

### Kanban de suivi (🗂, onglet)
- Le suivi multi-projets s'affiche dans un **onglet Kanban dédié** : chaque tâche est rangée dans une colonne **À faire / En cours / À valider / Terminé / À qualifier**.
- **Sélecteur de projet** en haut : **« Tous les projets »** (défaut) ou **un projet précis** — votre choix est **conservé** d'une ouverture à l'autre. En mode « tous les projets », **chaque carte indique son projet** (et le client s'il est renseigné).
- **Idées** : vos **idées d'évolution** apparaissent en **sous-catégorie « Idées »** dans la colonne « À faire », visuellement séparées des tâches à faire (aucune confusion entre une idée et une tâche).
- **Tâches bloquées** : une tâche bloquée affiche en rouge le **motif du blocage** directement sur sa carte.
- **Tâches qui en attendent une autre** : une tâche peut **attendre** une autre tâche (« attend la tâche X ») et affiche un badge bleu **« En attente de : <titre> »**. Elle redevient disponible **toute seule** dès que la tâche attendue est terminée ou annulée — sans manipulation. Les chaînes (A attend B qui attend C) sont gérées ; un lien circulaire est refusé.
- **Pilotage direct** : créer, éditer, glisser une carte d'une colonne à l'autre, supprimer (confirmation en deux temps), et **clôturer plusieurs tâches d'un coup** (avec annulation possible). Tout reste dans la base de suivi locale de l'Assistant.

### Terminal intégré (xterm.js + PTY)
- Shell natif selon l'OS : `cmd.exe` (Windows), `zsh`/`bash` (macOS/Linux).
- **Streaming** des sorties PTY vers le frontend via événements Tauri.
- **Redimensionnement** automatique.
- **PATH complet (Windows)** : le terminal intégré reconstruit le PATH système +
  utilisateur depuis la registry, pour que les commandes installées après le
  lancement de Pilot (ex: `cargo`) soient trouvées.
- **Copier/Coller contextuel** :
  - `Ctrl+C` : copie la sélection si présente, sinon envoie SIGINT.
  - `Ctrl+V` : colle depuis le presse-papiers.
  - `Ctrl+Shift+C`/`Ctrl+Shift+V` en fallback.

### Commandes du projet (▶)
- Lancez vos commandes de compilation / tests / etc. via le bouton **▶** du panneau d'actions.
- Liste de commandes **paramétrables par projet** (ajout / modification / suppression), stockée dans `.pilot/commands.json`.
- Chaque commande : un **nom**, une **commande shell** et un **dossier de travail** optionnel (vide = racine du projet).
- Un clic lance la commande dans le dossier choisi dans un **onglet terminal** (titre = nom de la commande) ; la liste des commandes se ferme et vous pouvez continuer à travailler. Relancer la même commande bascule sur l'onglet déjà ouvert ; fermer l'onglet arrête le process.

### Trois modes d'écran : Détaillé · Assistant seul · Vocal
- **Le logo Pilot, en haut à gauche du bandeau, est le bouton** : un clic fait
  passer d'un mode à l'autre — **Détaillé** → **Assistant seul** → **Vocal** →
  **Détaillé** … Il ne bouge pas d'un mode à l'autre et il est **muet** (ni mot,
  ni pastille) : c'est son **infobulle** qui dit le mode **courant** et annonce
  le **suivant**. Un second clic réflexe (moins de 400 ms après le premier) est
  ignoré : il ne fait jamais sauter un mode. Le mode choisi est **mémorisé**
  d'une ouverture à l'autre.
- **Détaillé** est l'écran habituel : explorateur, onglets, agent, tout est là.
- **Assistant seul** ne garde que la conversation de l'Assistant (🧭), en plein
  écran.
- **Vocal** est un écran plein : au centre, un **objet lumineux** dont la couleur
  dit l'état (**repos**, **écoute**, **réflexion**, **parole**), un **trait de
  niveau** juste dessous et **une seule ligne de texte** (« Je vous écoute. »,
  « Je réfléchis. », « Je réponds. »). Rien de la conversation n'y est affiché.
  Ouvrir le micro ne suffit pas à passer en **écoute** : c'est **votre voix** qui
  l'allume, et le retour au **repos** se fait tout seul quand vous vous taisez.
- **La réponse s'y lit à voix haute** (même voix et même bouton « 🔊 Écouter »
  que dans les autres écrans). **Écrire ou valider pendant la lecture l'arrête**
  et envoie votre message.
- **Parler par-dessus Pilot le fait taire** : pendant qu'il lit, si vous prenez
  la parole, la lecture **s'arrête net** (jamais au milieu d'un mot : entre deux
  phrases), l'objet repasse en **écoute** et la zone de saisie **reprend la
  main**. Pilot **ne se coupe jamais lui-même** : il vérifie d'abord que votre
  micro n'entend pas ses propres haut-parleurs (annulation d'écho de l'ordinateur,
  mesure du son résiduel au début de chaque lecture, seuil posé au-dessus). Si
  cette vérification n'est pas concluante — hauts-parleurs puissants, micro qui
  reprend la voix de Pilot —, **il ne coupe pas** et lit sa réponse jusqu'au
  bout, comme avant : un silence vaut mieux qu'une réponse qui bégaie. Le
  **casque** est la situation où cela marche le mieux. Hors du mode Vocal, rien
  ne change : les réponses se lisent jusqu'au bout.
- La **zone de saisie** reste visible en bas et grandit quand vous écrivez
  (jusqu'à 120 px) ; elle garde son micro de dictée 🎙️.
- **On en sort par les trois mêmes chemins** : le **même bouton** (mode suivant),
  la touche **Échap**, ou la **fermeture de l'onglet**. Deux pleins écrans ne se
  superposent jamais : passer en « Assistant seul » ou en « Vocal » sort d'abord
  de l'autre.
- Le **trait de niveau suit votre voix** : il s'allonge quand vous parlez et
  retombe doucement au silence, sans sautillement.
- **Le micro et la dictée restent ouverts pendant tout le mode** — c'est ce qui
  vous permet de parler sans rien toucher — **sauf pendant que Pilot lit sa
  réponse et pendant qu'il travaille** : il ne se transcrirait pas lui-même, et
  le tour en cours prime. Les deux sont **refermés aux trois sorties** du mode
  (bouton, Échap, fermeture de l'onglet) : le témoin du système s'éteint, Pilot
  ne vous écoute pas en dehors de l'écran. Un repli de voix (voix choisie
  indisponible, voix du système en remplacement) compte comme **Pilot qui
  parle** : la dictée reste fermée et vous pouvez quand même l'interrompre.
- **Pilot demande le micro de mesure dès l'entrée** dans cet écran — jamais dans
  les autres écrans — **avant** d'ouvrir la dictée : la mesure passe la première,
  la dictée ensuite. Ainsi une panne ne se déguise jamais en autre chose : si le
  micro de mesure ne s'ouvre pas, l'écran le dit et la dictée ne s'arme pas ; si
  c'est la dictée qui échoue, le trait continue de suivre votre voix. Si vous
  refusez, si aucun micro n'est branché ou s'il est occupé, l'écran le **dit en
  une phrase** et propose **« Autoriser le micro »** : le mode Vocal reste
  entièrement utilisable (écrire, envoyer, écouter). Sur un projet marqué
  **sensible** (🔒), la dictée reste bloquée : Pilot attend de savoir si le
  projet est marqué avant de l'ouvrir, et repose la question à chaque changement
  de projet.
- **Parler suffit** : au repos, Pilot **dicte tout seul**. Vous parlez, le texte
  s'écrit, et **la demande part sans que vous touchiez à rien** — puis il répond,
  lit sa réponse, et **se remet à l'écoute** : la conversation continue à la voix.
  Pendant qu'il parle ou qu'il travaille, il **n'écoute pas** (il ne se
  transcrirait pas lui-même). Un appui sur 🎙️ arrête la dictée, et elle ne se
  rouvre pas contre votre volonté. Si Pilot ne peut pas dicter (micro refusé ou
  occupé, pas de réseau, dictée indisponible sur ce poste, projet **sensible**),
  la ligne d'état **le dit** et vous continuez au clavier.
- **Si la dictée ne transcrit rien trois fois de suite** (en moins de 30
  secondes), Pilot **cesse de rouvrir le micro tout seul** au lieu de boucler :
  la ligne d'état vous invite à écrire, et **un clic sur 🎙️** (ou un retour dans
  le mode) rétablit la dictée automatique.
- Ce qui **reste à venir** : la relance de l'agent avec ce que vous venez de dire
  (aujourd'hui, une coupure ou une réponse laisse la main à la parole, mais
  l'agent n'est jamais relancé tout seul).

### Écouter une réponse de l'assistant (🔊)
- Chaque réponse de l'agent (onglet **π**) et de l'Assistant (onglet **🧭**) porte un bouton
  **« 🔊 Écouter »** : un clic lit la réponse à voix haute, un second l'arrête. Rien ne se lit
  tout seul, **sauf en mode Vocal** où la réponse est lue automatiquement, et une seule lecture
  tourne à la fois.
- **Le réglage de la voix vit à un seul endroit** : ⚙️ **Options → onglet « Assistant »** →
  section **« Lecture des réponses »** (choix de la voix, état de la lecture, explication).
  Par défaut : **automatique** (la voix de la langue de l'interface) ; le choix est mémorisé, et
  si la voix choisie disparaît de l'ordinateur, Pilot revient proprement à la voix automatique.
- **On écoute chaque voix avant de la choisir** : sous la liste, un bouton **« Écouter »** par voix
  lit une **phrase d'exemple courte** (le même bouton devient **« Arrêter »**, une seule voix à la
  fois). Une voix dont le modèle n'est pas encore téléchargé n'est **pas** remplacée par la voix du
  système : la section le dit et propose le téléchargement.
- Aucune voix installée sur le poste : le réglage est inactif et le bouton reste visible mais
  inactif, avec une phrase qui explique quoi faire.
- **Vraies voix françaises, hors ligne** : la liste propose des **voix françaises locales** (une entrée
  par voix, avec son **genre** écrit en clair — voix de femme ou voix d'homme — et sa taille). Elles
  fonctionnent **sans Internet, sans clé et sans carte graphique**.
- **Un seul geste pour les rendre utilisables** : la section propose le bouton **« Installer la voix
  locale »**. Ce seul clic installe, **une seule fois** et **sur votre demande**, ce qui manque : le
  **moteur de lecture** (environ 22 Mo compressés) et **deux voix françaises** — une voix de femme et
  une voix d'homme, en qualité moyenne (environ 60 Mo chacune). L'**étape en cours, la taille et le
  pourcentage** s'affichent, un bouton **« × Arrêter l'installation »** interrompt le geste, et
  **rien n'est supprimé** : l'installation **reprend là où elle s'est arrêtée** au prochain clic. Un
  fichier déjà présent et complet n'est **jamais** retéléchargé, et un fichier incomplet n'est jamais
  déclaré installé. **Après l'installation, lire une réponse ne fait aucun appel au réseau.**
  Ce moteur n'est fourni que pour Windows : sur **macOS et Linux**, la section le dit clairement et la
  lecture garde la voix du système, sans erreur. Si le moteur manque ou échoue, la lecture **continue
  avec la voix du système** et le dit clairement (aucun blocage, rien ne plante).

### Suivre le travail (entrée « Travail » à droite de la barre d'onglets)
- L'entrée **« Travail »**, à droite de la barre d'onglets, est le **seul endroit** où se suit le travail :
  sa pastille s'anime quand des agents travaillent, et un clic ouvre le panneau. Un **second panneau**
  (l'ancienne « cloche ») n'existe plus : tout est réuni ici. Elle reste atteignable même quand la
  colonne de gauche est masquée, et ne recouvre plus le contenu.
- **Le compteur de travail** : à droite du mot « Travail », deux nombres **en cours / total**
  (par exemple **`2/5`**) disent d'un coup d'œil **combien de tâches tournent** et **combien sont
  prévues au total** (en cours **plus** en attente). Le total compte **tout ce qui attend vraiment** :
  les missions de l'assistant, les demandes qu'il a déléguées, les **commandes que vous tapez pendant
  qu'une tâche tourne** et les **agents qui attendent leur tour**. Rien ne s'affiche quand il n'y a
  aucun travail. Le détail exact (et les nombres réels quand ils deviennent grands, par exemple
  « 99+ ») est dans l'infobulle ; le chiffre s'allume quand au moins une tâche est **en cours**.
- Le panneau a **trois onglets**, dans cet ordre : **« Agents »** (qui travaille, sur quel projet),
  **« Tâches »** (les missions en cours et celles qui attendent leur tour, avec la mention « en attente »)
  et **« Événements »** (démarrages, fins de tâche, erreurs, connexions). Le compteur du bouton et le
  volet « Tâches » affichent **toujours les mêmes nombres** : ils sortent du même calcul.
- Les **événements que vous n'avez pas encore vus** sont signalés à **deux endroits** : le point du
  bouton « Travail » **s'allume**, et un **petit point** apparaît sur l'onglet « Événements » (son
  infobulle donne le nombre exact ; ouvrir l'onglet l'éteint). Le panneau s'ouvre sur **« Agents »**
  tant que vous n'avez pas choisi d'onglet, puis se rouvre sur l'onglet où vous l'avez laissé ; il se
  ferme par **Échap**, la **croix** ou un second clic sur l'entrée « Travail ».
- **Une demande en attente devenue inutile se retire seule** : la commande **`/file retire <rang>`**
  retire **une seule** demande de la file (le rang affiché par `/file` — la tâche en cours occupe le
  1er rang), les autres restent dans leur ordre et la tâche en cours continue. `/file vide` continue
  de tout abandonner, et l'Assistant peut faire ce retrait ciblé à votre demande.
- Sa taille s'adapte à la fenêtre : assez large pour les trois onglets **sur une seule ligne**
  (jamais plus de 40 % de la largeur) et jamais plus de **60 % de la hauteur de l'écran** — au-delà,
  seule la liste défile, et le panneau reste entièrement visible. Les trois listes ont exactement
  la même présentation, en thème clair comme en thème sombre.

### Options (onglet ⚙️)
- Les Options s'ouvrent dans un **onglet** (bouton ⚙️, palette de commandes ou événement externe), pas dans une fenêtre par-dessus votre travail. « Annuler » et « Enregistrer » agissent **sans fermer** l'onglet, donc vous voyez le résultat de ce que vous venez de changer. La **✕ de l'onglet équivaut à « Annuler »** (rien n'est enregistré, l'aperçu de thème est annulé). L'onglet est **transverse** : il reste ouvert quand vous changez de projet.
- **Thème** : sombre (défaut) ou clair.
- **Sous-thème** : 5 palettes par mode (dark : One Dark, Dracula, Nord, Tokyo Night ;
  light : GitHub Light, One Light, Solarized Light, Tokyo Night Day). **Aperçu en direct** :
  le style change immédiatement à la sélection, avant enregistrement (annulé si on
  ferme sans sauvegarder).
- **Commande par défaut** : exécutée automatiquement via le bouton π (ex : `python main.py`, `pi`).
- **Charger le dernier projet** au démarrage.
- **Démarrer l'agent au lancement de Pilot** : ouvre automatiquement l'onglet de
  l'agent au lancement de Pilot ET à l'ouverture d'un projet (les onglets agents
  mémorisés ne sont pas restaurés sinon) (désactivé par défaut ; l'onglet agent
  reste toujours ouvrable manuellement).
- **Lancer la commande au démarrage**.
- **Rappels de l'assistant** : sous le compteur « n sur 20 rappels de surveillance
  actifs », le bouton **« Supprimer les rappels inutiles »** fait le ménage
  (rappels désactivés et périmés, rappels uniques déjà consommés, rappels
  périodiques qui ne détectent plus rien). Le nombre de rappels concernés vous
  est annoncé **avant** confirmation et chaque suppression est journalisée
  (détails : ❓ → « Ménage des rappels inutiles »).
- **Intégrer le terminal** : terminal dans un onglet (xterm.js + PTY) ou fenêtre externe.

### Barre de statut
- Position du curseur (ligne, colonne).
- Type de fichier et raccourcis disponibles.
- **« ⬆ Mise à jour en attente (à la fin du travail en cours) »** quand une nouvelle version de Pilot attend qu'un agent termine sa tâche. Le rappel **dit qui bloque et depuis quand** : « ⬆ Mise à jour v0.4.44 en attente — codeur (Pilot) en cours depuis 2 h 13 min » (s'il y a plusieurs travaux, le plus ancien est nommé puis « + N autres »). Sans information disponible, la phrase d'origine reste affichée.

### Mise à jour de Pilot
- Pilot vérifie seul s'il existe une version plus récente (au démarrage, toutes les 6 heures, et à chaque retour sur Pilot), puis propose la version, sa date et le récapitulatif des changements.
- **Jamais pendant votre travail** : la fenêtre de mise à jour n'apparaît que si **aucun agent ne travaille**. Si une tâche est en cours, elle n'est pas interrompue : un message discret vous prévient et la fenêtre s'affiche **d'elle-même** dès la fin de la tâche.
- **Rien ne bloque pendant la mise à jour** : tant que la fenêtre est seulement **ouverte**, vous pouvez continuer à travailler (envoyer un message, l'assistant répond, les agents et les tâches en file continuent) — la décision peut attendre. **Seule l'installation** réserve la place : pendant elle, aucun agent ne démarre (le message de refus explique quoi faire) et le travail repart au redémarrage. **« Plus tard »** ferme la fenêtre sans rien bloquer ; le rappel de la barre de statut reste visible (« disponible — non installée ») et **un clic le rouvre**, comme la palette de commandes (« Vérifier les mises à jour ») ; une demande déjà en file d'attente n'est jamais perdue.

### Multiplateforme
- **Windows**, **macOS** et **Linux** via Tauri v2.

## Accès distant (mode remote, expérimental)

Pilot peut exposer une **interface web distante** pour consulter le travail, discuter
avec l'agent Pi, changer de projet et suivre l'activité en temps réel — depuis un
téléphone ou un autre poste, via le réseau privé **Tailscale**.

- Le serveur web embarqué (axum) tourne dans le même processus que Pilot et partage
  la session agent Pi.
- Authentification par **mot de passe** (hashé argon2) + token de session révocable.
- **Désactivé par défaut** ; bind `127.0.0.1` par défaut (élargir à l'IP Tailscale
  pour l'accès distant). Aucun port exposé sur Internet — tout passe par le mesh
  Tailscale (WireGuard chiffré).
- Côté web : arborescence en lecture, visionneuse, chat streaming (pensées/outils),
  sélecteur de modèle, changement de projet, **déclenchement des commandes projet**
  (▶, avec sortie en direct et état en cours/terminé), et **Prompt Builder** (🧩) :
  construire un prompt à partir de fichiers du projet (bouton ＋ dans l'arborescence),
  l'envoyer à l'agent ou le sauvegarder en `.md`. Le **projet courant** est affiché
  dans le titre en haut et dans un bandeau de l'onglet Chat. L'édition lourde reste
  sur le desktop.
- 🎙️ **Dictée vocale** : un bouton micro à côté du bouton envoyer permet de dicter
  l'instruction à l'agent (Web Speech API, langue `fr-FR`). Sur le **web distant**, le
  micro exige un accès **HTTPS** (Tailscale Serve — voir la procédure ci-dessous) ; sur
  **desktop**, disponible immédiatement. ⚠️ Sur Chrome/WebView2 la transcription
  transite par le cloud du moteur (pas 100% local). Le bouton est masqué si le
  navigateur ne supporte pas `SpeechRecognition` (Firefox, WebKit non supporté).

Voir `spec_web_remote.md` pour la configuration et le déploiement Tailscale.

### Mise en place sur un nouveau poste (HTTPS via Tailscale Serve)

Pour accéder à Pilot depuis un téléphone ou un autre appareil **en HTTPS**
(secure context requis notamment pour le micro 🎙️ de la dictée vocale),
procédure à reproduire sur chaque poste qui héberge Pilot :

1. **Installer Tailscale** sur le poste ([tailscale.com/download](https://tailscale.com/download)),
   le connecter au tailnet.

2. **Activer les fonctionnalités tailnet** (une fois, dans la console admin
   <https://login.tailscale.com/admin>) :
   - **MagicDNS** (DNS & Subdomains)
   - **HTTPS Certificates** (Settings → HTTPS certificates)
   - **Tailscale Serve** (Settings → Tailscale Serve / Funnel)

3. **Configurer Pilot** : ouvrir les **Options** ⚙️ → section **« Accès distant »** :
   - Activer l'accès web.
   - Définir un **mot de passe** distant (hashé argon2).
   - **Adresse d'écoute (`web_bind`) = `127.0.0.1`** ⚠️ — *impératif* :
     ne pas mettre l'IP Tailscale, sinon le proxy renvoie `502` (un nœud ne
     peut pas joindre sa propre IP Tailscale — effet de hairpin/anti-bouclage).
   - Choisir un port (ex. `8790`).
   - **Sauvegarder** → le serveur recharge automatiquement sur le nouveau bind.

4. **Activer le proxy HTTPS automatiquement** : dans la même section
   « Accès distant », cocher **« Exposer en HTTPS automatique (Tailscale
   Serve) »** puis **Enregistrer** :
   - Pilot détecte Tailscale, configure le proxy HTTPS 443 → `127.0.0.1:port`,
     affiche l'**adresse d'accès** (`https://<nom-magicdns>.ts.net/`) et un
     **QR code** à scanner avec le téléphone.
   - Au **changement de port** ultérieur, le proxy est **resynchronisé
     automatiquement** (plus aucune commande à taper).
   - La **première fois**, Tailscale peut afficher un lien d'activation par nœud
     (`https://login.tailscale.com/f/serve?node=...`) — l'ouvrir, autoriser,
     puis cliquer **« 🔄 Reconfigurer maintenant »** dans les Options.

5. **Se connecter depuis l'autre appareil** (téléphone/tablette/autre PC) :
   - Tailscale installé et actif sur cet appareil.
   - Scanner le **QR code** affiché dans les Options (ou ouvrir
     `https://<nom-magicdns>.ts.net/`) dans le navigateur.
   - Se logger avec le mot de passe défini à l'étape 3.

> ⚠️ **Tests / pièges** :
> - On **ne peut pas tester** l'URL HTTPS depuis le poste lui-même
>   (hairpin bloqué par Tailscale). Tester depuis un **autre appareil** du tailnet.
> - Si le serveur écoute encore sur l'IP Tailscale (ancien bind non libéré au
>   rechargement), le HTTP direct reste joignable sur le mesh. Pour libérer
>   proprement l'ancien socket, **relancer Pilot** (fermer/rouvrir l'app).
> - L'automatisation échoue si Tailscale n'est pas installé/dans le PATH ;
>   voir `spec_web_remote.md` §14 pour la procédure **manuelle** de repli
>   (`tailscale serve --bg <port>`, `tailscale status` pour le nom MagicDNS).
> - Pour arrêter le proxy : décocher la case (Enregistrer) ou
>   `tailscale serve reset`.

---

## Serveur GDS (gestionnaire de sources)

Le **GDS** (gestionnaire de sources) est un **serveur optionnel** qui centralise
les sources de tes projets — dépôts Git **et** suivi partagé — sur ta propre
machine ou ton réseau, au lieu d'un hébergement externe.

- **Installation simple** : un **seul service à démarrer** réunit la base de
  données, l'accès aux dépôts Git et le service. Le guide d'installation est
  fourni avec le projet (`gds-server/README.md`).
- **Trois rôles** pour les comptes : **administrateur** (gère les comptes et les
  dépôts) ; **développeur** (publie et force le suivi de **tous** les projets du
  serveur) ; **standard** (lecture seule).
- **Deux écrans dédiés** dans Pilot, accessibles sans projet ouvert :
  **« 🖥️ GDS Serveur — administration »** (connexion, comptes, dépôts/projets,
  espace et journal, contrôle du service) et **« ⚙️ GDS — paramétrage »**
  (serveurs, mon identité, mes clés, mes projets).
- **Activation projet par projet** : un projet qui n'utilise pas le GDS reste
  100 % local.
- **Un seul poste travaille sur un projet à la fois** : le projet est *tenu* par
  un poste ; les autres peuvent l'ouvrir et le consulter, mais **ne le modifient
  pas** et n'y lancent aucun agent (un bandeau dit qui le tient et jusqu'à quelle
  heure). Tu prends le projet avec **« Prendre le projet pour publier »** et tu le
  rends avec **« Rendre le projet »**, qui publie le code et l'avancement puis
  libère le projet pour le suivant. Un projet laissé à l'abandon se libère tout
  seul au bout de **15 minutes** sans activité ; un administrateur peut aussi le
  libérer, avec un motif. Le mode réseau complet est décrit dans
  **`spec_reseau.md`**.
- **Conflits** : deux postes n'écrivent plus en même temps sur un même projet. Si
  deux écritures se croisent malgré tout (hors portage), la plus récente
  s'applique et le conflit est **signalé** — jamais d'écrasement totalement
  silencieux.
- **Réponse sur la documentation** : l'Assistant (🧭) répond aussi aux questions
  sur le GDS (rôles, serveur, synchronisation).

---

## Mises à jour automatiques

Pilot vérifie automatiquement les mises à jour au démarrage. Si une nouvelle
version est disponible, elle est **téléchargée et installée** automatiquement,
puis l'application redémarre. Vous pouvez aussi lancer une vérification
manuelle via la **palette de commandes** (`Ctrl+Shift+P` → « Vérifier les mises
à jour »).

Les versions téléchargeables (Windows, macOS, Linux) sont publiées sur la
[page des releases GitHub](https://github.com/pleveneur/pilot/releases). Chaque
version est signée numériquement pour garantir son authenticité.

---

## Réponses sur la documentation

Demande-le à l'**Assistant** (onglet **🧭 Assistant**) : il sait répondre en
langage naturel sur l'utilisation ou le paramétrage de l'éditeur (raccourcis,
agent Pi, accès distant, dictée vocale, lecture à voix haute, PDF, GDS, etc.) à
partir de la **documentation embarquée** (handbook généré à partir des specs,
toujours à jour avec ta version de Pilot) — il te suffit de le lui demander, ou
il va chercher la réponse de lui-même quand ta question porte sur Pilot.

- **Isolé** de l'agent de coding : la réponse est construite uniquement à partir
  de la documentation, jamais à partir de tes fichiers ni de la conversation de
  l'onglet π.
- Il n'y a **plus d'onglet ni de bouton « Aide »** : la question sur Pilot se
  pose dans la conversation de l'Assistant, comme le reste du suivi.
- Voir `spec_help.md` pour le détail.

## Envoyer une remarque ou une idée (💬)

Une remarque, un bug, une idée d'évolution ? Bouton **💬** du panneau d'actions
(accessible sans projet ouvert). Tu peux :

- **Ouvrir sur GitHub** une issue pré-remplie dans ton navigateur (suivi public
  du retour, nécessite un compte GitHub) ;
- **Envoyer par email** (vers l'auteur, sans compte GitHub) ;
- **Consulter les retours déjà envoyés** pour éviter un doublon.

Le formulaire joint automatiquement ta version de Pilot et ton système
d'exploitation. Aucune donnée n'est transmise sans ton action.

## Captures d'écran

```
┌──────────────────────────┬──────────────────────────────────────────┐
│  🅿️ Projets ▼             │  [📝 README.md]  [👁️ Aperçu]  [π Agent]   │
│  ─────────────────────── │──────────────────────────────────────────┤
│  MonProjet               │                                          │
│                           │  # Pilot                                │
│  ▶ 📁 src                 │  IDE pour Agents IA                        │
│    ▶ 📁 js               │                                          │
│      📝 main.js          │  Fonctionnalités :                       │
│      📝 editor.js        │  - Explorateur en temps réel             │
│    📁 css                │  - Édition Markdown                      │
│  ▶ 📁 src-tauri           │  - Prévisualisations (MD, PDF, CSV)      │
│  📝 package.json         │  - Terminal intégré                      │
│  📝 README.md            │                                          │
│                           │                                          │
├──────────────────────────┤  Ln 12, Col 34    Markdown               │
│ ⚙️  📂  🖥️  π              │                                          │
└──────────────────────────┴──────────────────────────────────────────┘
```

---

## Installation

### Windows

Téléchargez l'installeur `Pilot_<version>-x64-setup.exe` depuis la [page des
releases](https://github.com/pleveneur/pilot/releases) et exécutez-le.
L'installeur installe automatiquement WebView2 si nécessaire.

### macOS

Téléchargez le `.dmg` depuis la [page des releases](https://github.com/pleveneur/pilot/releases),
ouvrez-le et glissez Pilot dans le dossier Applications.

### Linux

```bash
# .deb (remplacez <version> par la version téléchargée)
sudo dpkg -i pilot_<version>_amd64.deb

# .AppImage
chmod +x pilot_<version>_amd64.AppImage
./pilot_<version>_amd64.AppImage
```

---

## Utilisation

1. Lancez Pilot.
2. Cliquez sur **🅿️ Projets** → **📁 Nouveau projet** et sélectionnez le dossier de travail.
3. L'arborescence s'affiche à gauche. Les fichiers `.md` s'ouvrent en édition, tous les fichiers sont prévisualisables.
4. **Clic gauche** → ouvre en édition. **Double-clic** sur une image → prévisualisation directe.
5. **Clic droit** sur un `.md` → menu « 👁️ Prévisualiser », « 📕 Exporter en PDF », « 📄 Exporter en HTML », « 📊 Prévisualiser le CSV » (si `.csv`).
6. **Bouton 🖥️** → ouvre un terminal intégré dans le dossier du projet.
7. **Bouton π** → ouvre l'onglet Agent Pi pour dialoguer avec l'IA.
8. **Bouton 🎭 Agents** → lance une équipe d'agents spécialisés (coordinateur, architecte, codeur, reviewer, testeur, documenteur) qui collaborent séquentiellement sur une tâche. Chaque agent (y compris le coordinateur) se configure depuis l'onglet 🎭 lui-même (icône, rôle, modèle π/ℓ…).
9. Les modifications faites par l'agent sont reflétées en temps réel dans l'éditeur.

### Raccourcis clavier

| Raccourci | Contexte | Action |
|---|---|---|
| `Ctrl+Shift+F` | Global | Recherche globale dans les fichiers |
| `Ctrl+Shift+H` | Global | Remplacement global (avec aperçu) |
| `Ctrl+Alt+R` | Global | Fichiers récents (popover) |
| `Ctrl+S` | Éditeur | Sauvegarder le fichier actif |
| `Ctrl+W` | Éditeur | Fermer l'onglet actif (sauvegarde auto) |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Global | Onglet suivant / précédent (fonctionne aussi dans le terminal) |
| `Ctrl+1`…`Ctrl+9` | Global | Aller à l'onglet par position (ordre actuel) |
| `F11` | Global | Mode Zen (plein écran sans barre latérale) |
| `Ctrl+P` | Global | Focus sur le filtre de l'arborescence |
| `Ctrl+B` | Éditeur `.md` | **Gras** |
| `Ctrl+I` | Éditeur `.md` | *Italique* |
| `Ctrl+K` | Éditeur `.md` | [Lien](url) |
| `Ctrl+C` | Terminal (sélection) | Copier la sélection |
| `Ctrl+C` | Terminal (pas de sélection) | SIGINT (interrompre) |
| `Ctrl+V` | Terminal | Coller depuis le presse-papiers |
| `Ctrl+Shift+C` | Terminal | Copier (fallback) |
| `Ctrl+Shift+V` | Terminal | Coller (fallback) |

---

## Développement

### Prérequis

| Outil | Minimum | Installation |
|---|---|---|
| **Rust** | 1.70+ | [rustup.rs](https://rustup.rs) |
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org) |
| **npm** | 9+ | Inclus avec Node.js |

#### Dépendances système

**Windows :**
- [Microsoft Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)
- [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (présent par défaut sur Windows 10+)

**macOS :**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian) :**
```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libsoup-3.0-dev \
  javascriptcoregtk-4.1 \
  patchelf \
  libfuse2
```

### Lancement en développement

```bash
git clone <url-du-repo>
cd pilot
npm install
npm run tauri dev
```

> **Développer Pilot avec Pilot** : `npm run tauri dev` lance une version dev
> **séparée** de la version installée (identifiant d'application distinct
> `com.pilot.editor.dev`). Les deux peuvent tourner en parallèle : config,
> sessions et verrou single-instance sont indépendants, et le port web distant
> est décalé de +1 (ex: configuré 8787 → dev écoute sur 8788).

### Build production

```bash
npm run tauri build
```

Les installeurs sont générés dans `src-tauri/target/release/bundle/` :

| Plateforme | Format |
|---|---|
| Windows | `.exe` (NSIS) / `.msi` |
| macOS | `.dmg` |
| Linux | `.deb` / `.AppImage` |

---

## Structure du projet

Vue simplifiée — la référence à jour est `AGENTS.md`.

```
pilot/
├── index.html                # Point d'entrée HTML
├── package.json              # Dépendances npm
├── vite.config.js            # Configuration Vite
├── AGENTS.md                 # Instructions assistant (source de vérité)
├── spec_*.md                 # Spécifications par feature
├── spec_cinq_regles_chaine_agents.md # Les 5 règles de la chaîne d'agents et leurs tests
├── plan_dev.md               # Plan de développement
├── README.md                 # Ce fichier
├── help/                     # Documentation embarquée (handbook généré)
├── scripts/                  # Build handbook, release, latest.json
├── src/                      # Frontend (HTML/CSS/JS)
│   ├── css/style.css
│   └── js/ (~45 modules)
├── src-tauri/                # Backend (Rust)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/
│   ├── icons/
│   ├── extensions/           # Extensions pi embarquées
│   └── src/                  # lib.rs + modules par domaine
└── dist/                     # Build frontend (généré par Vite)
```

---

## Stack technique

| Couche | Technologie |
|---|---|
| **Runtime** | [Tauri v2](https://v2.tauri.app) (Rust) |
| **Backend** | Rust — poller custom (file watching), `portable-pty` (terminal), `pulldown-cmark` (Markdown), `serde`/`serde_json` (config) |
| **Frontend** | HTML5, CSS3, JavaScript ES Modules |
| **Bundler** | [Vite](https://vitejs.dev) |
| **Éditeur** | [CodeMirror 6](https://codemirror.net) |
| **Rendu Markdown** | [markdown-it](https://github.com/markdown-it/markdown-it) |
| **Diagrammes** | [Mermaid.js](https://mermaid.js.org/) |
| **PDF** | [PDF.js](https://mozilla.github.io/pdf.js/) |
| **Terminal** | [xterm.js](https://xtermjs.org) + `@xterm/addon-fit` |
| **Dialogues** | `tauri-plugin-dialog` |

### Backend — Commandes Tauri

| Commande | Description |
|---|---|
| `open_project_path` | Ouvre un dossier, scanne récursivement, démarre le watcher |
| `read_file_content` | Lit le contenu d'un fichier |
| `write_file_content` | Écrit le contenu dans un fichier |
| `read_file_binary` | Lit un fichier en binaire |
| `write_file_binary` | Écrit un fichier en binaire |
| `create_file` | Crée un fichier vide (et ses dossiers parents) |
| `create_folder` | Crée un dossier vide |
| `delete_file_or_dir` | Supprime un fichier ou dossier (récursif) |
| `rename_file_or_dir` | Renomme un fichier ou dossier |
| `copy_image_to_project` | Copie une image dans le projet |
| `file_exists` | Vérifie si un fichier existe |
| `refresh_tree` | Reconstruit l'arborescence |
| `get_config` / `save_config` | Persistance JSON de la configuration |
| `get_recent_projects` | Récupère les 10 derniers projets |
| `open_terminal` | Ouvre un terminal système externe |
| `open_explorer` | Ouvre le dossier du projet dans l'explorateur |
| `spawn_terminal` | Lance un PTY intégré |
| `write_to_terminal` | Écrit des données dans le PTY |
| `resize_terminal` | Redimensionne le PTY |
| `kill_terminal` | Tue le processus PTY |
| `stop_watcher` | Arrête le file watcher |
| `set_window_title` | Pose le nom de la fenêtre (toujours `Pilot`) |
| `export_pdf` | Génère un HTML pour export PDF |
| `start_agent_session` | Lance le processus pi --mode rpc |
| `stop_agent_session` | Tue le processus pi |
| `send_agent_prompt` | Envoie un message à l'agent avec images optionnelles |
| `abort_agent` | Annule l'opération en cours |
| `new_agent_session` | Démarre une nouvelle session |
| `get_agent_state` | Récupère l'état actuel (modèle, streaming, messages) |
| `get_session_stats` | Récupère les stats tokens/coûts |
| `get_agent_messages` | Récupère l'historique de conversation |
| `set_agent_model` | Change le modèle (provider + modelId) |
| `list_agent_models` | Liste les modèles disponibles |
| `execute_agent_bash` | Exécute une commande shell dans le contexte de l'agent |
| `compact_agent_context` | Compacte le contexte pour réduire les tokens |
| `list_agent_commands` | Liste les commandes slash disponibles |
| `list_sessions` | Liste les sessions enregistrées pour le projet |
| `resume_agent_session` | Charge/reprend une session |
| `send_rpc_command` | Envoie une commande JSON brute (debug) |
| `model_supports_images` | Vérifie si le modèle courant supporte les images |
| `check_syntax` | Vérifie la syntaxe des fichiers modifiés (eslint, py_compile, cargo check) — Mode Orchestration V2 |

---

## Compatibilité

| OS | Shell terminal intégré | File watcher |
|---|---|---|
| **Windows** | `cmd.exe` (ConPTY) | Poll custom (walk filtré) |
| **macOS** | `$SHELL` ou `/bin/zsh` | Poll custom (walk filtré) |
| **Linux** | `$SHELL` ou `/bin/bash` | Poll custom (walk filtré) |

---

## Licence

MIT — voir le fichier [`LICENSE`](LICENSE) pour le texte complet (© 2026 pleveneur).

## Modèles et Multi-comptes Ollama

### Modèles

Les modèles accessibles via API (Ollama local, Ollama Cloud, etc.) sont configurés dans le fichier `models.json` de pi.

- **Windows** : `%USERPROFILE%\.pi\agent\models.json`
- **macOS/Linux** : `~/.pi/agent/models.json`

Ce fichier se recharge automatiquement à chaque ouverture de `/model` dans pi — pas besoin de redémarrer.

Exemple avec un compte Ollama local et deux comptes Ollama Cloud :

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "gemini-3-flash-preview:latest", "input": ["text", "image"] },
        { "id": "deepseek-v4-pro:cloud" },
        { "id": "gemma4:latest" },
        { "id": "kimi-k2.6:cloud" }
      ]
    },
    "ollama-kl": {
      "baseUrl": "https://ollama.com/v1",
      "api": "openai-completions",
      "apiKey": "$OLLAMA_CLOUD_API_KEY_KL",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "glm-5.1:cloud",
          "contextWindow": 202752,
          "reasoning": true,
          "input": ["text"],
          "cost": { "input": 0, "output": 0 }
        }
      ]
    },
    "ollama-dj": {
      "baseUrl": "https://ollama.com/v1",
      "api": "openai-completions",
      "apiKey": "$OLLAMA_CLOUD_API_KEY_DJ",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "deepseek-v4-pro",
          "contextWindow": 1048576,
          "reasoning": true,
          "input": ["text"],
          "cost": { "input": 0, "output": 0 }
        }
      ]
    }
  }
}
```

> **Ollama Cloud** : certains modèles rejettent le rôle `developer`. Ajoutez `"compat": { "supportsDeveloperRole": false }` au provider pour éviter l'erreur `400 developer is not one of [...]`.

> **Coût** : Ollama Cloud fonctionne en forfait, donc `cost` est toujours à `{ "input": 0, "output": 0 }`.

### Clés API

La clé API de chaque provider se configure via le champ `apiKey` dans `models.json`. Plusieurs méthodes :

| Méthode | Syntaxe dans `models.json` | Exemple |
|---|---|---|
| **Variable d'environnement** | `"$NOM_DE_LA_VARIABLE"` | `"$OLLAMA_CLOUD_API_KEY_KL"` |
| **Clé en dur** (déconseillé) | `"valeur"` | `"sk-abc123..."` |
| **Commande shell** | `"!commande"` | `"!op read 'op://vault/item/key'"` |

#### Déclarer une variable d'environnement

**Windows** (persistent, une seule fois) :
```cmd
setx OLLAMA_CLOUD_API_KEY_KL "votre-clé-api"
```

**macOS/Linux** (persistent, ajouter au fichier `~/.bashrc` ou `~/.zshrc`) :
```bash
export OLLAMA_CLOUD_API_KEY_KL="votre-clé-api"
```

> ⚠️ **Important** : `setx` sur Windows modifie le registre mais ne met à jour que les **futurs** terminaux. Après `setx`, **fermez complètement votre terminal et rouvrez-le** avant de lancer `pi`. Les terminaux déjà ouverts ne verront jamais la nouvelle variable.

> ⚠️ Si la variable d'environnement n'est pas trouvée au démarrage, pi ignore le provider concerné et ses modèles n'apparaîtront pas dans `/model`. Vérifiez avec `echo %NOM_DE_LA_VARIABLE%` (Windows) ou `echo $NOM_DE_LA_VARIABLE` (macOS/Linux) que la variable est bien visible dans votre session.


