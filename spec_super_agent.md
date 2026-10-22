# Spécification — Assistant (assistant de suivi multi-projets)

> Onglet **🧭 Assistant** : un assistant nommé, **lecture seule**, qui suit
> l'ensemble des projets (par client) de la demande jusqu'à la livraison, apprend
> en continu des sessions d'agents, et répond à toute question sur les projets.

<!-- HELP:super-agent -->
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
  l'assistant au lancement de Pilot »** (**activé par défaut** — Paramètres
  ⚙️ → onglet Démarrage). S'ajoute (mécanisme historique conservé) à la
  **reprise de l'état** : si l'onglet était **ouvert à la fermeture** de Pilot,
  il est rouvert aussi (état global persisté dans la config, pas par projet).
  Décochez le réglage si vous préférez ne rouvrir que l'onglet au moment de la
  fermeture.
- **Niveau de réflexion de l'Assistant** : Paramètres ⚙️ → onglet Assistant →
  « Niveau de réflexion de l'Assistant ». Par défaut **« Non réglé (suit le
  réglage général) »**, c'est-à-dire le niveau par défaut de Pilot, puis celui du
  modèle, puis celui du moteur. Seuls les paliers réellement supportés par le
  modèle de l'Assistant sont proposés ; un modèle incapable de raisonner affiche
  un sélecteur désactivé. Le niveau est **ajusté** au modèle au démarrage de la
  session (jamais un palier supérieur).

### Donner un nom à votre assistant
- **Paramètres ⚙️ → onglet « Assistant »** : donnez un nom à votre assistant
  (ex: « Aria », « Chef de projet »). Ce nom s'affiche dans le titre de l'onglet
  🧭 et dans ses réponses.
- Le nom est **injecté dans le prompt système** envoyé à chaque tour :
  l'assistant sait toujours qui il est et qu'il est l'assistant de suivi
  multi-projets (pas l'agent d'un projet). Même sans prompt personnalisé, il
  reçoit un prompt système par défaut qui rappelle son rôle (suivi de plusieurs
  projets par client, lecture seule).

### Si l'assistant affiche « Connexion au super-agent perdue »
- Le processus de l'assistant n'a pas survécu à son lancement (ou s'est arrêté).
  Les **causes les plus fréquentes** : le chemin de l'agent (Réglages → Agent)
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
- **Paramètres ⚙️ → onglet « Assistant » → Clients** : saisissez la liste de
  vos clients.
- **Créer un client à la volée** : dans l'onglet 🧭 Assistant, le bouton **🏢
  (Projets & clients)** permet aussi de **créer un nouveau client** directement
  (champ « Nom du nouveau client » + bouton **+ Ajouter un client**), sans
  passer par les Paramètres. Le nouveau client est aussitôt disponible dans les
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
- **Paramétrer** : **Paramètres ⚙️ → onglet « Assistant »** → cochez/décochez
  « Afficher la réflexion de l'Assistant » et « Afficher les outils de
  l'Assistant » pour masquer (ou montrer) ces blocs.
- **Ordre chronologique** : les **messages d'info** de l'Assistant (ex: « ✅
  Tâche terminée… », « ⚠️ Connexion perdue… ») sont affichés **dans l'ordre
  de leur émission** grâce à un buffer d'ordonnancement + compteur de
  séquence (#20), même s'ils arrivent hors ordre (sources asynchrones).
- **#139 — Panneau des événements système** : les **événements système**
  (délégations, démarrage/arrêt d'agents, erreurs, connexion perdue,
  notifications) ne s'affichent **plus au centre** de la discussion : ils sont
  regroupés dans un **petit panneau en bas à droite** de l'onglet 🧭, ouvert
  par un **bouton « cloche » 🔔** compact tout à droite de la barre de saisie.
  - Un **badge compteur** indique le nombre d'événements **non lus** depuis la
    dernière ouverture (il **pulse** quand le panneau est fermé et qu'un
    nouvel événement arrive).
  - Le panneau **reste ouvert** tant qu'on ne le ferme pas (bouton **×** ou
    cloche) ; l'état ouvert/fermé est **mémorisé** et restauré à la réouverture
    de l'onglet. Pendant l'ouverture, les nouveaux événements s'ajoutent en
    direct en haut de la liste (compteur à 0).
  - Liste **chronologique** (plus récent en haut), pastille colorée par
    sévérité (succès / avertissement / erreur / info), horodatage discret.
  - Bouton **« tout effacer »** 🗑️ pour vider la liste. Tampon mémoire borné
    (~150 items) pour garder le panneau lisible.
  - Les **éléments interactifs** (boutons de choix, confirmations, saisies)
    restent **au centre** de la discussion : ce sont des questions qui
    nécessitent votre action, pas des événements système.
  - **#160 — Événements en plein écran (optionnel)** : **Paramètres ⚙️ → onglet
    « Assistant »** → « Événements en plein écran (bandeau central temporaire) »
    affiche **en plus**, au **centre de l'écran** (au-dessus de tout), chaque
    événement dans un **bandeau temporaire discret** — pratique quand l'onglet
    🧭 est en arrière-plan. **Désactivé par défaut** ; **durée réglable**
    (1-120 s, **5 s par défaut**). Le **dernier événement remplace** le
    précédent (jamais d'empilement) et le bandeau s'efface en douceur. Les
    **questions interactives** (choix, confirmations) ne sont **pas** concernées.
- **Volet « En cours » dans le panneau cloche** : en plus des **Événements**, le
  panneau cloche propose un **second onglet « En cours »** (**Paramètres ⚙️ →
  onglet « Assistant » → « Onglet « En cours » dans le panneau de la cloche »**,
  **activé par défaut**). Il liste les **missions réellement en cours** de vos
  agents : pour chacune, une **phrase courte** qui dit la **tâche réelle**,
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
- **Badges projet par bulle (snapshot à l'envoi)** : chaque demande et sa
  réponse portent les badges des projets **réellement concernés par la
  discussion**, étiquetés au moment où vous envoyez la demande = **uniquement
  les projets explicitement nommés dans le texte**, dans leur **ordre
  d'apparition**, sans doublon. **Aucun projet cité = aucune étiquette** : le
  projet simplement **ouvert dans Pilot** n'est **jamais** affiché par défaut
  (un nom faux fait croire à un travail sur le mauvais projet, ce qui est pire
  que pas de nom). Plusieurs projets cités → plusieurs badges compacts sur la
  même bulle. La détection est **sans IA** :
  correspondance insensible à la casse sur le **nom affiché** du projet (ex:
  « PLh ») ou la **fin de son chemin** (ex: « ia_pl/plh »), avec **frontières
  de mots** (une demande qui parle de « pilotage » n'étiquette pas le projet
  « pilot »). La réponse hérite des badges de la demande qui l'a déclenchée et
  peut y **ajouter** les projets réellement cités dans le texte de la réponse
  (jamais en retirer un correct, jamais en inventer un). Les badges sont
  **figés pour toujours** : changer de projet actif (même via `open_project`
  pendant le tour) ne modifie **jamais** les badges déjà affichés, et aucune
  bulle n'est re-étiquetée rétrospectivement. La **bulle de continuation**
  après une question posée à l'utilisateur hérite des badges de la demande
  initiale (la paire question/réponse porte les mêmes étiquettes).
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
- **Paramètres ⚙️ → onglet « Assistant » → « Notifier quand l'Assistant a
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
- **Paramètres ⚙️ → onglet « Assistant » → « Jouer un son de notification »** :
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
- **Paramètres ⚙️ → onglet « Assistant » → « Réponses courtes (informer sans
  détailler, sauf demande explicite) »** : quand activé, l'Assistant répond de
  façon **concise** — il **informe et prend des décisions** sans détailler tout
  ce qui se fait, **sauf si vous lui demandez explicitement** de détailler.
- **Désactivé par défaut**.

### Mode user-friendly (langage simple)
- **Paramètres ⚙️ → onglet « Assistant » → « Mode user-friendly (langage simple,
  non technique, sauf demande explicite) »** : quand activé, l'Assistant répond
  en **langage simple et non technique** — il évite le jargon et explique les
  concepts de façon accessible pour un non-spécialiste, **sauf si vous lui
  demandez explicitement** du technique.
- **Désactivé par défaut**.

### Mode « Assistant coordinateur pur »
- **Paramètres ⚙️ → onglet « Assistant » → « Assistant coordinateur
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

<!-- HELP:super-agent-coordinator -->
### Mode « Assistant coordinateur pur »
Dans **Paramètres → section Assistant**, l'option **« Assistant coordinateur
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
- **Réglage** : Paramètres ⚙️ → onglet « Assistant » → « Purger la
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
- La vue **liste** du suivi multi-projets reste dans le **panneau inférieur** de
  l'onglet 🧭 (bouton « suivi multi-projets »), strictement inchangée : le
  bouton « Vues » ne bascule plus cette liste, il ouvre l'onglet Kanban dédié.
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
  (Paramètres → Assistant, **activé** par défaut : une clé absente vaut activé).
- **Temps estimé / passé par tâche** (idée 2) : une tâche peut porter un
  **temps prévu** (valeur absolue, `super_agent_task_time_set_estimated`) et un
  **temps passé** (cumul, `super_agent_task_time_add_spent`), relus en base
  (`super_agent_task_time_get`) après chaque opération ; la carte affiche alors
  une pastille « prévu / passé » et la vue d'ensemble un total par projet.
  Tout cet affichage est **conditionné** par le réglage
  `super_agent_show_time` (Paramètres → Suivi), **désactivé par défaut** : sans
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

### Volet « En cours » du panneau cloche (missions des agents)
- Le **panneau cloche** (#139, en bas à droite de l'onglet 🧭) porte désormais
  **deux onglets commutables** dans son en-tête : **« Événements »** (historique
  en direct, inchangé) et **« En cours »** (missions des agents).
- **Source unique** : le **store d'activité partagé** de l'application
  (`agent-activity.js`, celui de l'indicateur d'activité des projets, du mode
  immersif et de l'onglet agent) — **aucune** commande Rust nouvelle, **aucun**
  appel supplémentaire au moteur. Le volet **s'abonne** à ce store tant qu'il est
  affiché (et se **désabonne** à la fermeture du panneau ou au retour sur
  Événements), donc il se **met à jour en direct** avec le rafraîchissement léger
  existant. La commutation d'onglet reste purement visuelle.
- **Contenu** : pour chaque agent **retenu** → `{ agent, projet, mission }`.
  Filtre, mise en forme et rendu sont des **fonctions pures**
  (`buildRunningMissions`, `shortMission`, `splitMissions`,
  `renderMissionsPanelHtml` dans `agent-activity.js`, testées) :
  - agent **retenu** si `busy` **ou** `toolInProgress` → un agent engagé dans un
    **outil long et silencieux** (compilation, tests) **ne disparaît jamais**
    (faux négatif interdit) ;
  - agent **au repos** (`idle`, `paused`, `stopped`) → **masqué** (une absence de
    travail n'est pas une mission) ;
  - **deux groupes EXPLICITES et NUMÉROTÉS** : « **En cours (n)** » puis
    « **En attente (n)** » — on voit d'un coup d'œil ce qui travaille et **dans
    quel ordre la file attend** (rang `1.`, `2.`, … dans l'ordre d'origine) ; un
    groupe vide n'est pas affiché. Aucune mission → message explicite
    « Aucune mission en cours » (jamais une liste vide trompeuse) ;
  - **affichage de chaque mission** (deux lignes, position **FIXÉE**) : **ligne 1
    = rang + l'identité « <agent> — <nom de projet> »** (nom de projet **court** :
    le nom du dossier) avec le statut **« en cours »** / **« en attente »** ;
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
- **Alimentation du texte de mission (Rust)** : `AgentService` mémorise, **au
  passage obligé de l'envoi d'un prompt** (`send` / `send_sync` /
  `send_sync_timeout`, donc `rpc_manager`), le **dernier prompt réellement
  envoyé** à chaque session, **déjà tronqué** à 600 caractères
  (`prompt_snapshot`, `PROMPT_SNAPSHOT_MAX_CHARS`). La fenêtre de 600 caractères
  est **ancrée sur le premier marqueur de mission** du prompt (« ## Objectif »,
  « Objectif : », « === MISSION === », « Tâche : ») : le préambule de rôle qui
  précède ne consomme plus la fenêtre, donc **la mission est conservée même très
  loin après le rôle** (défaut corrigé : 80 caractères ne contenaient que le
  rôle). Un prompt plus court est conservé **tel quel** (aucune troncature
  inutile). Le **prompt entier n'est jamais stocké**. Une commande qui **n'est
  pas** un prompt (`get_state`, `set_model`, …) **n'écrase jamais** la mission en
  cours. L'information remonte par les champs **additifs** `prompt` (et
  `toolInProgress`) de `list_agent_sessions` puis `get_agent_supervision` : les
  consommateurs existants les ignorent.
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
  laisser de trace.
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
  (délégations « hyper long »). Réglage **Paramètres → Assistant → « Purger la
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
- But : l'agent part **au courant** de ce qui a déjà été fait, décidé ou réglé —
  il ne refait pas et ne contredit pas l'existant (moins d'allers-retours).
- Le bloc est **bref et borné** (plafond **700 caractères**, troncature
  annoncée) et **clairement séparé** de la demande : il porte son propre titre
  (`## Contexte de suivi (assistant)`) et la demande complète le suit.
- **Rien d'inventé** : si l'Assistant ne sait rien du projet (projet non suivi,
  mémoire vide), **aucun bloc** n'est ajouté — la demande part inchangée.
- Il est **visible** dans la conversation : le message « 🧠 Contexte de suivi
  joint à la demande de l'agent. » signale l'ajout.
- Les décisions récentes sont exposées par la base de suivi **par client** :
  quand le client suit **plusieurs projets**, le bloc le dit explicitement
  (« Décisions récentes (client X) ») au lieu de les faire passer pour celles
  du projet.
- Technique (module **pur** `src/js/super-agent-context.js`, I/O et branchement
  dans `super-agent.js` — `loadDelegationContext` / `attachDelegationContext`) :
  lecture de `get_super_agent_tracking` + `super_agent_load_session_memory`,
  **fail-open** (toute erreur → aucun bloc, la délégation n'est jamais
  bloquée). Couverture : `src/js/super-agent-context.test.js`.

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
demande de l'agent. » lorsqu'un rappel a été ajouté.
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
  (`AgentService::ephemeral_agent_name`, borné à 40 caractères par
  `clip_agent_display_name`) — et le champ `agent` conserve son sens :
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
spécifiques »** est activé (Paramètres → section Assistant, désactivé par
défaut), les agents spécifiques que l'Assistant utilise (outil `run_agents`)
héritent du contexte que reçoit l'agent standard du projet : le rôle/prompt ET
les activations de contexte (RAG / Context Engine, mémoire projet
`PROJECT_MEMORY.md`, Code Graph). L'héritage se fait **en plus** du rôle propre
de l'agent cible (concaténation). Désactivé, l'agent spécifique ne reçoit que
son rôle propre (comportement actuel).

<!-- HELP:super-agent-inherit-context -->
### Hériter du contexte projet pour les agents spécifiques
Dans **Paramètres → section Assistant**, l'option **« Héritage du contexte
projet pour les agents spécifiques »** (désactivée par défaut) fait hériter
aux agents spécifiques que l'Assistant utilise (outil `run_agents`) du contexte
que reçoit l'agent standard du projet : le rôle/prompt, le RAG / Context
Engine, la mémoire projet (`PROJECT_MEMORY.md`) et le Code Graph. L'héritage
s'ajoute au rôle propre de l'agent cible (concaténation). Désactivée, l'agent
spécifique ne reçoit que son rôle propre.
<!-- /HELP:super-agent-inherit-context -->

<!-- HELP:super-agent-memory -->
### Transférer la mémoire de votre assistant entre deux postes
Dans **Paramètres ⚙️ → section « Mémoire (transfert de suivi) »**, vous pouvez
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
  saisie…), c'est **l'Assistant qui sert d'interface** : tant que vous êtes sur
  l'onglet 🧭, la question de l'agent est **affichée dans la conversation de
  l'Assistant**, avec les options proposées.
- Vous pouvez **annoter / modifier / valider** votre réponse avant qu'elle soit
  envoyée à l'agent (champ de précision optionnel + bouton de validation).
- La réponse est transmise au **bon agent** (chaque agent est identifié : ses
  réponses ne sont pas mélangées), qui poursuit son travail débloqué.

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
  désactivé ne compte pas et libère sa place), **1 fire** par
  planification et par tick, **pas de tick** si l'onglet 🧭 est fermé (session
  morte — les rappels `every` accumulent un retard, repris à la reprise).
- **Échéance** : un rappel créé avec `everySeconds = N` se déclenche pour la
  première fois **N secondes après sa création** (référence `created_at` tant
  qu'il n'a jamais été livré, puis `last_run_at`). `schedule_create` renvoie
  `nextFireAt` (ISO 8601 UTC) : **aucun déclenchement avant l'échéance demandée**.
- **Issue #77 — pas de lancement automatique au démarrage** : par défaut,
  l'Assistant **ne lance pas automatiquement** un rappel dû à l'ouverture de sa
  session (démarrage de Pilot). Ce comportement est contrôlé par le réglage
  **Paramètres → Assistant → « Vérifier les points à faire à l'ouverture de la
  session (relances programmées) »** (désactivé par défaut). Tant qu'il est
  désactivé, les rappels dus ne sont injectés que si l'utilisateur les demande
  explicitement ; il faut valider ce réglage pour que l'Assistant les vérifie
  automatiquement à chaque ouverture de session.
- Stockage : table `assistant_schedules` de la base `~/.pilot/super-agent.db`.
  Le rappel est injecté dans la conversation de l'assistant à l'échéance (pas de
  notification OS). Son **affichage ne passe pas par une bulle au milieu du
  fil** (issue #36) : le rappel apparaît comme un **événement du panneau 🔔**
  (en bas à droite de l'onglet 🧭), sur une **seule ligne courte** portant la
  **date et heure de déclenchement** au format local français (ex. « ⏰ relance —
  29/08 à 14:30 »), et un **toast discret** reprend ce même libellé. Le
  **prompt** du rappel (consigne technique pour l'assistant) **n'est pas
  affiché** : il reste consultable **au survol** de la ligne d'événement
  (info-bulle). Si la date est absente ou invalide, seul le marqueur
  « ⏰ relance » s'affiche (jamais « Invalid Date »/« NaN »).

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
- **Modèle par défaut dédié (issue #88)** : **Paramètres ⚙️ → onglet « Modèles
  IA » → Modèle par défaut de l'Assistant**. Laisser « Modèle par défaut »
  (valeur vide) pour reprendre le **modèle par défaut global des agents**
  (comportement historique inchangé). Le réglage est prioritaire sur le défaut
  global pour l'Assistant uniquement et s'applique au démarrage suivant de sa
  session (le sélecteur de la barre d'outils reste le modèle **actif**). Le
  choix est **persisté immédiatement** (`set_super_agent_default_model`) et
  **préservé par l'enregistrement des Paramètres**, qui réécrit pourtant toute
  la configuration (`settings.js:1242`).
- **Reprise du modèle choisi au redémarrage** : le **modèle choisi** dans le
  sélecteur est **réappliqué à l'ouverture** de la session de l'Assistant (il ne
  repart donc pas sur le défaut global). S'il n'est **plus installé** (modèle
  retiré du registre), repli propre sur le modèle par défaut **dédié**, puis sur
  le défaut **global** — sans erreur ni blocage du démarrage.

### Personnaliser le prompt
- **Paramètres ⚙️ → onglet « Assistant » → Prompt système** : définissez le
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
plus en mémoire seulement. Côté bus d'agents, l'arrêt automatique transmet aussi
l'uid de session quand il est connu : `stop_agent_process` + `expectedUid`
(garde de propriété : une session remplacée n'est pas tuée) ; uid inconnu →
`stop_agent_session` (chemin historique, seul à libérer l'activité du projet).
Modules : `loop-detection.js` (pures : `collectWriteContent`,
`hashLoopContent`, `buildAgentStopTraceLine`, `appendAgentStopTrace`,
`buildAgentStopRequest`), `agent-stop-trace.js` (I/O du journal),
`super-agent.js` / `agents-bus.js` (points d'arrêt).

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
| Fin de SESSION par erreur dans le bus (chaque `failAgentTurn`) | `session-error`, `spawn-failed`, `run-exception` | erreur d'envoi de correction, sortie de processus (boucle / mort), message en erreur, modèle absent, exception du tour |
| Destruction de la session de l'onglet agent (`stop_agent_session`) | `session-restart` | `quality-gate-toggle`, `reconnect`, `settings-restart` |
| `/file vide` (familles commandes / missions / délégations) | `queue-abandoned` | `file-vide` |

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
<!-- /HELP:loop-detection-writes -->

### Mode « Assistant seul » (A19, maquette ASS_Only_V4)
- Le bouton **⛶ (maximize-2)** de la barre d'outils de l'onglet 🧭 — ou le
  **raccourci Ctrl+Shift+A** (Cmd+Shift+A sur macOS, onglet 🧭 ouvert) — bascule
  en mode **assistant seul** : tout est masqué (sidebar, explorateur, éditeur,
  onglets, terminal) et seule la discussion de l'Assistant reste visible.
- **Barre du haut** (maquette V4) : à gauche le bouton **← (retour)** + le titre
  « **Pilot** » ; à droite **UN SEUL bouton ⚙** qui ouvre les paramètres
  existants de l'Assistant (modale Paramètres, onglet « Assistant »).
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
  travaille. Pendant la réflexion, le **fond de la zone de saisie** respire
  (halo discret animé) dans les **deux modes** (standard et assistant seul) —
  en complément de l'**anneau pulsant autour du logo** en mode immersif ; au
  repos, aucun effet, la zone reste utilisable.
- **Suggestions** : quatre chips (« Faire un point sur un projet », « Déléguer
  une demande à l'agent », « Préparer une livraison », « Lister les tâches en
  cours ») qui **préremplissent la zone de saisie** (elles n'envoient pas).
- La barre du haut ne contient aucun toggle voix : la **🎙️ dictée** reste dans
  la barre de saisie. Ni bouton de **synthèse vocale** (🔊), ni bouton
  d'**événements** (cloche / panneau) en mode assistant seul — ces contrôles
  restent propres au mode standard. Le message d'accueil affiche le **nom réel
  de l'assistant** (config de l'onglet 🧭), avec repli « Pilot Assistant ».
- Le bouton **← (retour)** revient à l'interface complète. L'état de la
  conversation est **préservé** lors des allers-retours (les éléments du chat
  sont déplacés, jamais recréés). Le **dernier mode choisi est mémorisé** et
  restauré à la réouverture de l'onglet.
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

<!-- /HELP:super-agent -->

---

## Technique — arrêts d'agents CIBLÉS et propriété de session

Correctif du symptôme « l'agent commence et s'arrête aussitôt » (un agent lancé
par l'Assistant était avorté quelques secondes après son démarrage).

- **Portée des arrêts** : `stopAgentsRun({ runKey })` (agents-bus.js) limite un
  arrêt automatique à **sa propre run** (timeout d'inactivité, plafond de tours
  par agent, plafond de tours de run, détection de boucle). Auparavant l'appel
  était global : la fin ou l'expiration d'une run abortait **tous** les
  `activeAgents` de **toutes** les runs du processus. Les réservations de
  fichiers (`.pilot/reservations.json`) ne sont purgées que pour les projets
  réellement arrêtés ; la purge totale (`clearAllReservations`) reste le
  propre du bouton « tout arrêter » (portée globale conservée).
- **Propriété de session (uid)** : `AgentService` attribue un uid monotone à
  chaque `start` (map `session_uids`, clé composite (projet, agent)) ;
  `start_agent_process` le renvoie. Les abandons/arrêts automatiques passent
  `expectedUid` (`abort_agent_process`, `stop_agent_process`) ; Rust refuse la
  commande si la session en place porte un autre uid (`stop_owned`,
  `check_session_ownership`, décision pure `session_ownership_allows`). Sans
  uid, comportement historique inchangé (UI, fermeture de projet, arrêt).
  Côté JS : `expectedSessionUid(ctx, agentId)` (agents-bus.js).
- **Traçabilité** : chaque spawn/abandon/refus est ajouté à
  `<app_data_dir>/agent-ops.log` (rotation à 512 Ko, fail-open) — une
  interruption d'agent n'est plus invisible, avec l'uid attendu et l'uid réel.
- **Outils de l'Assistant (vérité sur l'asynchronisme)** : `run_agents` et
  `run_assistant_agents` ne disent plus « bloque jusqu'à la fin » (faux : ils
  rendent la main immédiatement) et joignent `LAUNCH_FOLLOW_UP` (ne pas
  attendre, ne pas surveiller, ne pas relancer, ne pas arrêter). `stop_agent`
  ne renvoie plus vers `list_agent_sessions` (outil banni des lois de travail) ;
  `list_agent_sessions` est documenté comme **exceptionnel**, jamais pour
  surveiller, et `state: "parked"` n'y vaut pas « arrêté ».
- **Tests** : `src/js/agents-bus-stop-scope.test.js` (portée ciblée vs globale,
  uid transmis, réservations) ; `agent_service.rs` (`session_ownership_allows`,
  monotonie des uid).

---

## 1. Objectifs

- Fournir un **assistant de suivi** nommé, distinct des agents de coding.
- Suivre **tous les projets** (organisés par **client**) de la demande à la
  livraison, **sans aucune action** sur les projets (lecture seule stricte).
- **Apprendre en continu** : à chaque fin de session d'agent, un résumé est
  injecté automatiquement à l'Assistant.
- Répondre à **toute question** sur l'ensemble des projets.
- Construire **sa propre organisation interne** (base SQLite locale) pour suivre
  l'évolution de chaque tâche.
- Être conçu en vue d'un **futur lien avec un serveur de sources** (gestionnaire
  de source, pilier V2).

## 2. Concepts

| Concept | Description |
|---|---|
| **Assistant** | Assistant nommé, lecture seule, qui suit tous les projets. |
| **Client** | Entité commerciale à laquelle sont rattachés des projets. Liste saisissable. |
| **Projet** | Projet ouvert dans Pilot, attaché à un client (optionnel). |
| **Projet de travail** | Projet sur lequel l'assistant travaille (dernier projet ouvert via `open_project`). Distinct du projet actif : quand l'utilisateur change de projet, le projet de travail reste celui de la discussion en cours. |
| **Tâche** | Unité de suivi (demande → livraison) extraite des sessions d'agents. |
| **Base interne** | Base SQLite locale (`~/.pilot/super-agent.db`) gérée par l'Assistant, source de vérité du suivi structuré. |
| **Espace d'écriture** | Dossier dédié `~/.pilot/assistant/<client>/<projet>/` pour les fichiers libres (notes, analyses, exports). |

## 3. Architecture

```
Sessions d'agents (chat / orchestration)
        │  résumé à la fin de session
        ▼
   Assistant (session pi/plh dédiée, lecture seule)
        │  lit / écrit
        ▼
   Base SQLite locale  ~/.pilot/super-agent.db   (source de vérité structurée)
   (clients, projets, tâches, décisions, historique)
        │
        ▼
   Espace d'écriture dédié  ~/.pilot/assistant/<client>/<projet>/  (fichiers libres)
        ▲
        │  lit
   Projets ouverts (fichiers, docs, historique sessions)
```

- **Session dédiée** : un processus `pi --mode rpc` (ou `plh`) séparé, canal
  d'événements propre `rpc-event-superagent` (ne pollue pas les canaux existants).
- **Lecture seule stricte (technique)** : l'extension `pilot-assistant-files`
  intercepte les outils `write`/`edit` et **bloque toute écriture hors de
  `~/.pilot/assistant/`** (création automatique de l'arborescence client/projet
  au besoin). L'extension `pilot-choices` fournit les outils de question
  (ask_choice, ask_confirm, ask_input, ask_multi_choice). L'extension
  `pilot-assistant-actions` fournit les outils `open_project` (ouvrir un projet
  pour le rendre actif), `delegate_to_coder` (déléguer une demande de code à
  l'agent standard du projet), `purge_agent_conversation` (purger à la demande
  la conversation de l'agent, en préservant le modèle actif), `stop_agent`
  (arrêter immédiatement un agent — coupe la session en cours, visible ou en
  arrière-plan / « agent invisible » ; accepte un `agentId` cible pour arrêter
  précisément un agent secondaire/spécialisé/spécifique créé à la volée et
  lancé via `run_agents`, sinon arrête l'agent standard du projet actif),
  `create_agent`
  (créer un agent sur mesure dans le registre global (base SQLite de
  l'application, tables `agents` / `agent_views`) quand les agents
  disponibles ne conviennent pas) et `run_agents` (choisir
  quels agents disponibles utiliser et lancer une tâche sur eux,
  en renvoyant le résultat agrégé à l'Assistant). La demande déléguée est affichée dans la
  discussion de l'agent du projet (à droite, comme un message utilisateur, mais
  en violet pour montrer qu'elle provient de l'Assistant — issue #45). La
  délégation ne bascule PAS sur l'onglet de l'agent (issue #49) : l'utilisateur
  reste sur l'onglet Assistant pour attendre le retour de l'agent (la session
  agent est démarrée en arrière-plan). Quand
  l'agent a terminé la tâche déléguée, un feedback est renvoyé à l'Assistant
  (issue #47) : à l'`agent_end`, le résumé injecté au super-agent est marqué
  `[Tâche déléguée terminée]` avec la demande transmise, pour que l'Assistant
  mette à jour son suivi (tâches, décisions) et décide des prochaines étapes
  (boucle de feedback agent → assistant).
  **File d'attente des délégations (issue #66)** : une délégation envoyée
  pendant que l'agent travaille n'est plus perdue — elle est mise en file et
  transmise automatiquement à la fin de la tâche en cours (à l'`agent_end`).
  L'arrêt explicite (`stop_agent`) **abandonne la file des délégations**
  (`abandonQueuedDelegations` : chaque demande est nommée, consignée au journal
  des arrêts et annoncée) ; la file des **MISSIONS** suit la règle inverse —
  conservée puis rejouée (P2). **Rejeu de la file de missions, dans l'ordre
  d'arrivée (POINT G + P1)** : une mission (`run_agents` /
  `run_assistant_agents`) mise en file est rejouée automatiquement **dès que le
  projet est réellement libre**, y compris quand l'occupation vient d'une
  **commande manuelle** ou d'un **prompt distant** — l'admission est décidée par
  `decideMissionAdmission` (file consultée AVANT tout lancement), le rejeu est
  réarmé à chaque empilement, après chaque arrêt d'agent et tant qu'il reste des
  missions, et la disponibilité est jugée sur les **sessions vivantes**, jamais
  sur un verrou. Deux limites connues sont écrites au **§ 13** (« Limites
  connues ») : remise **en queue** d'une mission défilée qui ne peut pas démarrer
  (inversion d'ordre possible, sans perte), et entrée en file dont la run
  propriétaire a disparu (conservée, signalée, jamais exécutée pour une autre
  mission). **Reprise après arrêt
  (issue #65)** : après un `stop_agent`, la session de l'agent du projet est
  recréée automatiquement à la prochaine délégation (et `purge_agent_conversation`
  se répare seul en recréant la session si nécessaire) — plus besoin de
  redémarrer Pilot. **Agent invisible joignable (issue #64)** : une nouvelle
  délégation à un agent invisible déjà vivant reprend sa session au lieu
  d'errer « déjà active ».
  **Purge automatique avant délégation (chantier 5/5, v0.3.8)** : quand le
  réglage `super_agent_purge_before_delegate` est activé (défaut),
  `transmitDelegationToAgent` purge la conversation de l'agent cible AVANT
  l'envoi, mais UNIQUEMENT si elle n'est pas déjà vierge : commande Tauri
  `purge_agent_conversation_to(project_path, agent_id)` → pi `get_messages`
  (via `AgentService.send_sync_timeout`, clé (projet, agent), formats
  défensifs via `count_rpc_messages`) ; si des messages existent, capture du
  modèle actif (`get_state`) puis `new_session` + `set_model` (helper
  `purge_target_agent_session`) — mécanique bouton « + » (modèle préservé).
  Fail-open : échec de purge → la demande est transmise quand même (comportement
  d'avant). Si purgée, la vue de l'onglet agent (projet actif uniquement) est
  vidée via `purgeAgentTabView(agentId, projectPath)` (agent-pi.js : registre
  `agentTabStates` des states multi-onglets, reset des 4 flags Context Engine,
  suppression du handoff `.pilot/context-inject.md` via
  `deleteContextHandoffFile`, vidage DOM) + message 🧹 dans le chat de
  l'Assistant ; la demande déléguée (chemin visible) est affichée APRÈS la
  purge. Les prompts directs de l'utilisateur (sendPrompt) ne passent pas par
  ce chemin : aucune purge sur ses retouches. Aucune purge au démarrage de
  Pilot ni à la fermeture d'onglet.
  **Restitution automatique du résultat des délégations (chantier fin-de-run,
  v0.3.8)** — la chaîne « l'agent finit → l'Assistant est informé » est rendue
  fiable de bout en bout (cinq pertes identifiées et corrigées) :
  1. **`willRetry` (agents-bus.js)** : le `agent_end` prématuré portant
     `willRetry: true` (relance automatique pi après erreur transitoire) ne
     finalise plus le tour : buffers reset (streaming/toolCalls/readOnly/
     compteur de tours pi), agent laissé actif, notification ⏳ ; le résultat
     produit APRÈS la relance est celui qui est agrégé. Les erreurs
     fournisseur (`message` `stopReason:"error"`) sont mémorisées
     (`pendingErrorByAgent`), **annulées** si `auto_retry_start` suit,
     prononcées à l'agent_end final sinon (plus d'échec immédiat prématuré).
  2. **`agent_settled` = filet zéro perte (agents-bus.js)** : l'événement pi
     de settle finalise désormais aussi le tour (`settleAgentTurn`, idempotent
     avec `agent_end`). Garde anti cross-talk : un événement terminal périmé
     (run précédente, session processus réutilisée) est ignoré grâce au
     marqueur `startedByAgent` posé uniquement sur l'événement `agent_start`
     de CETTE run. `handleAgentEvent` est exporté pour les tests vitest.
  3. **Rejeu des résumés à la libération de l'Assistant (super_agent.rs)** :
     l'observateur de session du super-agent devient composite
     (`make_superagent_session_observer` = surveillance d'anomalie inchangée +
     `schedule_replay_on_superagent_release`) : sur `agent_settled`/`agent_end`
     un thread détaché (JAMAIS le thread de lecture stdout) attend 400 ms
     (`REPLAY_TRIGGER_DELAY_MS`) puis rejoue les résumés en attente
     (`delivered=0`) via `replay_pending_superagent_summaries` — garde
     d'unicité `REPLAY_IN_FLIGHT` (AtomicBool), boucle auto-drainante (chaque
     injection provoque un tour qui, à son settle, re-déclenche le rejeu).
     Plus besoin de réouvrir l'onglet 🧭 ni de poster un prompt pour recevoir
     le résultat d'une fin de tâche.
  4. **`list_agent_sessions` expose `sessionId`** (agent_service.rs) : pour
     chaque session VIVANTE, probe `get_state` (timeout 2 s, défensif
     `data.sessionId` puis racine, échec toléré — champ simplement absent) —
     l'Assistant peut cibler précisément une session.
  5. **`get_delegation_result` robuste (session_history.rs)** : signature
     `(project, session_id?, agent_id?)` — résolution en cascade :
     fichier de session exact (jsonl suffixé `_<session_id>`), cherché dans le
     dossier du projet **puis dans chacun de ses sous-dossiers d'agents**
     (`load_session_jsonl_messages_in`, session_history.rs:843 — les agents non
     `default` rangent leur session dans leur propre sous-dossier) → session
     vivante (`get_messages` via `send_sync_timeout`, couvre les agents
     `--no-session` en cours de streaming) → jsonl le plus récent du dossier
     de l'agent (`<sessions>/<projet>/<agent_id[_sanitized]>/`, sinon le
     dossier projet). Erreur claire si les deux identifiants sont vides ; le
     champ `source` (`session_file` | `live` | `session_file_agent` |
     `none`) permet le diagnostic. L'extension
     `pilot-assistant-delegation.ts` passe `agent_id` optionnel et
     documente la stratégie de repli ; `super-agent.js` transmet `agentId`.
  **Garde anti-compaction (issue #54)** : pendant une compaction de fond, pi
  peut émettre un `agent_end` parasite (le tour réel n'est pas fini). Ce
  `agent_end` ne consomme PAS la délégation en attente (`pendingDelegation`) :
  l'injection du résumé au super-agent est ignorée tant que `isCompacting` est
  vrai. Le vrai `agent_end` post-compaction (repris par
  `orchestrationCompactionResumePending`) consommera correctement la délégation,
  évitant que l'Assistant croie la tâche terminée et renvoie des instructions
  alors que l'agent travaille encore. L'extension `pilot-assistant-db` fournit les
  outils `db_query` / `db_execute` (accès contrôlé à la base de suivi de
  l'assistant). L'extension `pilot-assistant-prompt` fournit l'outil
  `update_my_prompt` (auto-adaptation du prompt personnalisé). Les cinq sont
  chargées dès que le backend supporte `--extension`.
- **Détection de boucle (issue #55)** : le flux de l'Assistant (text_delta +
  thinking_delta) est accumulé dans un buffer et analysé par
  `detectRepeatedBlock` (loop-detection.js, issue #37), comme pour l'agent
  standard. Les **appels d'outils** (ex: commandes bash) sont aussi accumulés
  (empreinte `tool::nom::args`) et détectés par `detectRepeatedToolCalls` : un
  agent qui enchaîne le même outil en boucle sans streamer de texte est donc
  arrêté. Contrairement à l'agent (qui se relance avec une correction),
  l'Assistant **s'arrête** sur boucle : `abort_super_agent` est appelé et un
  message clair est affiché (« ⚠️ L'assistant a tourné en boucle… Veuillez
  reformuler votre demande. »). Pas de reprise automatique : l'Assistant est un
  outil de suivi, pas un codeur.
- **Relais des choix d'agent (tâche de suivi #22)** : quand un agent du projet
  émet une demande pilot-choices (`extension_ui_request` select/confirm/input via
  pilot-choices), et que l'onglet 🧭 est **ouvert et actif** (hors Mode
  Orchestration, hors demandes internes edit-gate / actions assistant), la
  demande n'est plus rendue dans l'onglet agent mais **relayée dans le chat de
  l'Assistant** : agent-pi.js détecte la demande (`isRelayableAgentChoice`),
  l'identifie (agentId + projet courant) et déclenche l'événement
  `pilot-agent-relay-request` ; super-agent.js la rend (`relayAgentChoiceRequest`)
  avec un en-tête « 🤖 L'agent « X » du projet attend une réponse » + les options.
  L'utilisateur peut **annoter / modifier / valider** sa réponse (champ de
  précision + bouton de validation, validation utilisateur avant transmission).
  La réponse est routée vers **LA bonne session agent** via la commande Rust
  `send_agent_command_to(project_path, agent_id, command)`, effondrée en une
  **consultation unique** du registre de l'AgentService (`AgentService.send`,
  clé composite `(projet, agent)`) → chaque agent est identifié, les réponses ne
  sont jamais mélangées (multi-agents).
- **Chat sur session persistante** : le chat de l'onglet 🧭 utilise la session
  du super-agent, stockée dans le **registre unique de l'AgentService** sous
  l'id dédié `superagent` avec un **projet pseudo-global `""`** (globale
  multi-projets, insensible à la fermeture de projet). Streaming + mémoire de
  conversation, canal isolé `rpc-event-superagent`, ce qui permet de charger les
  extensions et de poser des questions.

## 4. Données

### Base SQLite locale `~/.pilot/super-agent.db`

Tables (V1) :

| Table | Rôle |
|---|---|
| `clients` | `id`, `name`, `notes`, `created_at`, `updated_at` |
| `projects` | `id`, `path`, `name`, `client_id` (nullable), `status`, `created_at`, `updated_at` |
| `tasks` | `id`, `project_id`, `title`, `description`, `status` (demande/en cours/livré), `created_at`, `updated_at` |
| `decisions` | `id`, `project_id`, `task_id` (nullable), `summary`, `source_session`, `created_at` |
| `session_summaries` | `id`, `project_id`, `session_id`, `summary`, `created_at` |

- La base est **gérée par l'Assistant** via des commandes Tauri dédiées
  (pas par les outils d'écriture de l'agent, pour garantir la lecture seule).
- L'Assistant peut **créer ses propres tables** au fil de ses besoins
  (organisation interne auto-construite), dans la limite de la base dédiée.

### Espace d'écriture dédié `~/.pilot/assistant/`

- Arborescence par **client puis par projet** :
  `~/.pilot/assistant/<client>/<projet>/…` (fichiers libres : notes, analyses,
  exports). `~/.pilot/assistant/` est la racine pour les fichiers propres à
  l'assistant.
- Le dossier projet utilise le **nom du projet** (dernier segment du chemin),
  avec repli sur le chemin complet en cas de collision entre clients.
- **Création à la demande** : l'Assistant crée ses fichiers lui-même au fil de
  l'usage (pas de création systématique). L'extension `pilot-assistant-files`
  crée les dossiers parents au besoin et **bloque toute écriture hors de cette
  racine** (garantie technique de lecture seule sur les projets).

### Registre de configuration `~/.pilot/super-agent.json`

```json
{
  "name": "Aria",
  "clients": ["Client A", "Client B"],
  "project_client_map": { "/path/proj1": "Client A" }
}
```

## 5. Apprentissage en continu

- À chaque **fin de session d'agent** (chat standard `agent_end`, ou fin de
  tâche d'orchestration), Pilot génère un **résumé** (réutilise la logique de
  capture H9 / synthèse d'orchestration) et l'**injecte** à l'Assistant via un
  prompt système ou un message dédié.
- **Plafond de ce qui est versé** : le message réellement injecté dans la
  conversation est **borné à 4 000 caractères**. Le plafond porte sur le
  **message entier** (préfixe + résumé + avis de troncature), pas sur le seul
  résumé : plusieurs versements successifs ne peuvent pas le contourner. Au-delà,
  un **avis de troncature** indique le **nombre de caractères omis** et où lire
  la suite. Le **texte complet n'est jamais détruit** : il reste conservé tel
  quel dans le **suivi de l'assistant** (table `session_summaries`) et dans la
  **session de l'agent**. Ce plafond a une **seule source de vérité** côté cœur
  Rust (`super_agent.rs`, `MAX_INJECTED_MESSAGE_CHARS`) ; l'interface ne le
  recopie pas et envoie le texte complet.
- **Filtre d'insignifiance** (chat standard) : avant l'injection, la fonction
  pure `shouldRememberExchange` (`src/js/super-agent-exchange-filter.js`,
  branchée dans `agent-pi.js` à l'`agent_end`) refuse un échange vide, trop
  court (seuils `MIN_TOTAL_CHARS` / `MIN_RESPONSE_CHARS`), purement protocolaire
  ou sans contenu réel. Seuls les échanges porteurs d'information alimentent la
  mémoire de suivi.
- **Filtre des comptes rendus d'agents** (mêmes règles, deuxième garde du même
  module : `shouldRememberAgentReport`) : les deux autres chemins qui écrivaient
  sans filtre sont désormais couverts — fin d'un **agent lancé en arrière-plan**
  (`super-agent.js`, `finalizeInvisibleAgent`, un compte rendu générique sans
  résultat n'est plus mémorisé) et **points d'avancement d'une run d'agents**
  (`[Info run_agents]` : mise en file, démarrage ▶️, arrêt auto ⏱️). Aucune
  perte possible d'un compte rendu de fin de tâche : une **fin de run** force la
  mémorisation (`{ remember: true }`) et un **feedback de délégation en attente**
  est toujours remis (`shouldDeliverAgentReport`, exception absolue au filtre,
  le marqueur « [Tâche déléguée terminée] » n'est jamais perdu). En cas de doute,
  le filtre conserve (fail-open).
- L'Assistant met à jour sa base : tâches, décisions, état d'avancement.
- **Ne pas bloquer** : l'injection est asynchrone et ne ralentit pas la session
  d'origine.
- **Contexte projet à chaque tour** : le prompt système injecte le **projet
  actif** (ouvert dans Pilot), le **projet de travail** (dernier projet ouvert
  via `open_project`) et la **liste des projets connus** de la base. L'Assistant
  sait ainsi quel projet est en cours de discussion, ne confond pas les projets
  quand l'utilisateur en change, et apprend où se trouvent les projets au fil
  des discussions.
- **Agents du registre + outils d'agents** : le prompt système injecte
  dynamiquement la **liste des agents disponibles** dans le registre global
  (base SQLite de l'application, tables `agents` / `agent_views`), sous forme d'un résumé compact
  (`id`, icône, description courte) — l'Assistant sait ainsi quels agents il
  peut piloter via `run_agents`. Il documente aussi les outils à sa disposition :
  `run_agents` (dont le paramètre `agents` pour un **agent jetable** : rôle
  fourni dans la demande, aucune écriture en base, disparition en fin de
  tâche), `create_agent` (rôle **réutilisable**), `delegate_to_coder`,
  `ask_multi_choice`, `ask_confirm`, `ask_input`.
- **Flux « plan-maker » (facultatif, mission 381)** : le prompt système décrit
  la procédure de planification **à la demande** — `run_agents(["plan-maker"], …)`
  (en **nommant** l'agent) pour obtenir un plan JSON (tâches, fichiers, coût
  estimé, contraintes), puis délégation au codeur via `delegate_to_coder` avec
  ce plan. Le prompt **interdit explicitement** de lancer un agent de
  planification « de sa propre initiative » : `plan-maker` n'est employé que si
  l'utilisateur demande explicitement un plan, sinon la demande part
  directement à l'agent nommé. Aucune estimation préalable automatique n'existe
  plus : le lancement démarre **exactement** les agents demandés, et un agent
  inconnu est refusé avec la liste des agents disponibles (preuve Rust :
  `super_agent_tools_prompt_ne_previent_plus_par_un_plan_automatique`). Voir
  aussi la section « Déléguer le code à l'agent du projet » (plan-maker).

### Mémoire de session (reprise)

Après un **redémarrage de Pilot**, la session RPC du super-agent repart de zéro
(`--no-session`) : l'assistant n'a plus aucune idée d'où on en était. Une
**mémoire de session** compacte et versionnée est donc persistée sur disque
(`app_data_dir()/session-memory.json`) et réinjectée au **début du premier
message** après redémarrage, pour que l'assistant (et l'utilisateur) reprennent
naturellement là où on en était.

- **Outil `update_session_memory`** (extension `pilot-assistant-session-memory`) :
  l'assistant enregistre un résumé structuré de la session en cours (sujet,
  projet actif, chantiers en cours avec leur avancement, notes) à la fin d'un
  chantier, à un changement de sujet, avant de reprendre une discussion
  importante, ou sur demande explicite. Envoi via sentinel
  `PILOT_ASSISTANT_MEMORY_SAVE::` (commande Rust `super_agent_save_session_memory`).
- **Outil `remove_session_memory`** (même extension) : retire **un fait précis** du
  résumé sans le réécrire entièrement — une entrée de `work_in_progress` désignée
  par son rang 1-based ou par un fragment de texte de son `project` / `title`, ou
  le contenu d'un champ texte simple (`notes`, `current_topic`, `active_project`)
  via `field`. À utiliser dès qu'un fait mémorisé est devenu faux, périmé ou
  obsolète. Envoi via sentinel `PILOT_ASSISTANT_MEMORY_REMOVE::` + charge utile
  JSON `{ target, field? }` (commande Rust `super_agent_remove_session_memory`).
  Le résultat renvoie la mémoire mise à jour **et** l'identifiant du retrait
  rangé en corbeille (`trash_id`), qui permet de le remettre en place précisément.
- **Outil `restore_session_memory`** (même extension) : remet en place un fait
  précédemment retiré, par son `id`, ou **le retrait le plus récent** quand aucun
  `id` n'est fourni. Envoi via sentinel `PILOT_ASSISTANT_MEMORY_RESTORE::` +
  charge utile JSON `{ id? }` (commande Rust `super_agent_restore_session_memory`).
- **Outil `list_session_memory_trash`** (même extension) : parcourt la corbeille —
  les retraits en attente, **du plus récent au plus ancien**, chacun avec son
  identifiant, son type, sa date et un **aperçu court** du contenu retiré. Évite
  d'annuler un par un les retraits plus récents quand on veut restaurer un retrait
  ancien. Envoi via sentinel `PILOT_ASSISTANT_MEMORY_TRASH_LIST::` (commande Rust
  `super_agent_list_session_memory_trash`, lecture seule).
- **Corbeille bornée** : chaque retrait est conservé dans une corbeille
  (`app_data_dir()/session-memory-trash.json`), limitée aux **20 derniers
  retraits** (au-delà, les plus anciens sont évincés). Rien n'est perdu
  immédiatement : une remise en place (`restore_session_memory`) reste possible
  tant que le retrait n'a pas été évincé. Une entrée restaurée reprend sa
  **position d'origine** dans `work_in_progress`.
- **Format compact versionné** :
  `{ "format": "pilot-assistant-session-memory", "version": 1, "updated_at": ISO-8601,
  "resume": { "current_topic", "active_project", "work_in_progress":[{project,title,status}], "notes" } }`.
- **Borne de taille** : le résumé est tronqué (≈4000 chars) — on ne stocke
  **jamais** la conversation complète, seulement un résumé borné. **Fail-open** :
  une lecture/écriture qui échoue ne bloque ni la session ni l'UI.
- **Injecté dans le prompt système** : à `do_send_super_agent_prompt`, si un
  résumé existe, un bloc `## Mémoire de session (reprise)` est ajouté à
  `full_system` (guide l'assistant pour reprendre sans redemander).
- **Affichage UI** : à l'ouverture de l'onglet 🧭, un message système
  « 🔁 Reprise de session — … » résume la reprise (sujet, projet actif,
  nombre de chantiers en cours).

<!-- HELP:super-agent-session-memory -->
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
<!-- /HELP:super-agent-session-memory -->

## 6. Initialisation d'un projet existant

- Bouton **« Initialiser »** dans l'onglet 🧭 (ou par projet).
- L'Assistant **analyse le projet** : structure, documentation, historique
  des sessions (H9), puis **pose les questions nécessaires** à son fonctionnement
  (contexte, objectifs, client, jalons).
- Il apprend ensuite de l'analyse des discussions avec les agents individuels.

## 7. Interface

### Onglet 🧭 Assistant
- Chat avec l'Assistant (nom affiché dans le titre).
- **Sélecteur de modèle** dans la barre d'outils (même liste que les agents de
  coding, via `list_agent_models` / `get_available_models_list`).
- Bouton **« Initialiser »**.
- Bouton **« Analyser et ranger mes données »** (barre d'outils, icône
  `folder-search`) : envoie dans la conversation la consigne préparée
  `buildDataAnalysisPrompt()` (fonction pure, `src/js/super-agent.js`) qui
  impose une analyse **en lecture seule** du dossier de travail
  `~/.pilot/assistant/` et de la base de suivi `~/.pilot/super-agent.db`, puis
  un **rapport écrit** et une **proposition de rangement** en trois parties
  (sûr / discutable / à décider par l'utilisateur), avec aveu honnête de ce qui
  n'a pas pu être examiné. **Aucune commande cœur nouvelle** : l'Assistant a
  déjà ses outils de lecture (fichiers + `db_query`). Effet visible immédiat :
  la demande apparaît dans le chat et le bouton est **désactivé** pendant la
  réflexion (même signal `setReflecting` que la teinte de la zone de saisie) →
  deux clics ne lancent jamais deux analyses en parallèle.
- Vue des **clients** et des **projets** suivis (avec leur état).

### Position et persistance de l'onglet
- L'onglet 🧭 est **toujours le plus à gauche** de la barre d'onglets, avant
  même le bouton « + » d'ajout d'agents. Il ne peut pas être déplacé par
  glisser-déposer (et aucun onglet ne peut être placé avant lui).
- **Global (multi-projets)** : l'onglet Assistant existe **une seule fois pour
  Pilot**, pas par projet. Fermer ou basculer un projet **ne le ferme pas**.
- **Persistance** : si l'onglet Assistant est ouvert à la fermeture de Pilot,
  il est **rouvert automatiquement au démarrage** (état `super_agent_open`
  persisté dans la config globale, pas par projet).

### Paramètres ⚙️ → onglet « Assistant »
- **Nom** de l'assistant. Ce nom est **injecté partout** (titre d'onglet, prompt
  système, supervision des agents, panneau d'activité, tableau de bord) : aucun
  libellé n'est codé en dur, renommer l'Assistant le renomme réellement.
- **Prompt système** personnalisé (préfixé à chaque tour).
- **Liste des clients** (ajout / suppression / renommage) : lue depuis la **base
  de suivi** (source de vérité), donc identique au Suivi et au Kanban.
- Association **projet → client**.
- **Notifications Telegram** (interrupteur « Envoyer les avis sur Telegram » +
  jeton du bot + identifiant de discussion) : le canal d'avis du propriétaire
  appartient à l'Assistant, son réglage est donc rangé dans cet onglet
  (déplacé depuis l'onglet « Agent Pi »). Identifiants DOM et clés de
  configuration **inchangés** — voir `spec_telegram.md`.
- **Fréquence des rappels de surveillance** (Lot A idée 6) : fréquence par défaut
  des **nouveaux** rappels créés par l'Assistant **sans** fréquence explicite
  (`schedule_create` sans `everySeconds`). Choix : 5 / 15 / 30 minutes,
  **1 heure (défaut)**, 1 jour. Clé de configuration :
  `super_agent_schedule_interval_secs` (secondes, défaut `3600`).
  Les rappels **déjà** programmés conservent leur propre `every` : changer le
  réglage ne les touche pas (aucune action « appliquer à tous »). Bornes
  inchangées : `every` ≥ 60 s, 20 rappels **actifs** au maximum. Le nombre de
  rappels actifs (« n sur 20 ») est affiché à côté du réglage (lecture seule).

### Transfert de mémoire (issue #69)

La **mémoire** de l'assistant (son suivi multi-projets + sa configuration) peut
être **exportée puis importée** via des boutons dans **Paramètres ⚙️ → section
« Mémoire (transfert de suivi) »**, pour la transférer entre deux postes.

- **Exporter** : cases à cocher pour choisir les sections à embarquer, puis un
  **fichier JSON unifié unique** est produit (`pilot-assistant-memoire.json`).
  Format versionné : `{ format: "pilot-assistant-memory", version: 1,
  exported_at, sections: {...} }`.
- **Sections disponibles** (une par case, indépendantes) :
  - **Suivi** (`tracking`) — clients, projets, tâches, décisions, jalons,
    résumés de session (tables de suivi de `~/.pilot/super-agent.db`).
  - **Réglages** (`settings`) — nom, liste des clients, association
    projet → client.
  - **Comportement** (`behavior`) — prompt personnalisé, mémoire utilisateur,
    personnalité, options (concis, convivial, quality-gate).
  - **Apparence** (`ui` / `appearance`) — thème et sous-thème.
- **Importer** : choix du fichier, **validation du format + version**
  (`validate_export_json`), puis **confirmation avant** remplacement.
- **Comportement de remplacement** : l'import **REMPlACE** la mémoire locale
  (les sections cochées seulement). Le suivi est remplacé **transactionnellement**
  (`replace_tracking` : purge puis réinsertion, réécriture des ids
  parents → enfants, `PRAGMA foreign_keys` activé) ; la config (settings /
  behavior / appearance) est persistée via `save_config_disk`. L'apparence
  importée est appliquée immédiatement et la config de l'Assistant rechargée.
- **Données personnelles exclues** : rien de personnel n'est exporté par défaut —
  coffre (`vault`), conversations privées, tables `etat_reprise` / `magnus_*` /
  `mes_*` ne sont **jamais** incluses. Seul ce que l'utilisateur coche part.
- **Commandes Rust** : `export_super_agent_memory` / `import_super_agent_memory`
  (`src-tauri/src/super_agent.rs`, registrées dans `lib.rs`) ; fonctions pures
  testables (`validate_export_json`, `serialize_tracking`, `replace_tracking`).
- **Handlers front** : `settings.js` (lecture des cases, dialogues fichier
  natifs, confirmation), section « Mémoire » de `index.html`.

## 8. Garde-fous

- **Lecture seule stricte (technique)** : l'extension `pilot-assistant-files`
  bloque toute écriture hors de `~/.pilot/assistant/` (les projets sont
  inaccessibles en écriture, indépendamment de la consigne système).
- **Espace d'écriture dédié** : `~/.pilot/assistant/<client>/<projet>/` pour
  les fichiers libres ; la base SQLite reste la source de vérité structurée.
- **Questions** : l'Assistant peut poser des questions (choix/confirmation/
  saisie) via `pilot-choices`, rendues en boutons inline dans le chat.
- **Actions sur les projets (TÂCHE 2)** : l'extension `pilot-assistant-actions`
  fournit `open_project` (ouvrir un projet → le rendre actif via
  `openProjectByPath`), `delegate_to_coder` (déléguer une demande de code à
  l'agent standard du projet → ouvrir son onglet via `tabs.openFile("", "agent")`
  puis envoyer la demande via `send_agent_prompt`), `purge_agent_conversation`
  (purger à la demande la conversation de l'agent via la commande Rust
  `purge_agent_conversation`, en préservant le modèle actif) et `stop_agent`
  (arrêter un agent via `stop_agent_session` + nettoyage du suivi de l'agent
  invisible ; si un `agentId` cible est fourni, il est arrêté précisément —
  standard, spécialisé, secondaire ou spécifique lancé via `run_agents` —
  sinon l'agent standard du projet actif). Ces actions sont exécutées
  par Pilot (pas par l'agent), donc compatibles avec la lecture seule stricte.
- **Accès à la base de suivi (responsabilité de l'assistant)** : l'extension
  `pilot-assistant-db` fournit `db_query` (SELECT) et `db_execute` (CREATE/INSERT/
  UPDATE/DELETE/ALTER/DROP/PRAGMA) sur **la base de l'assistant uniquement**
  (`~/.pilot/super-agent.db`), via des commandes Rust (`super_agent_db_query` /
  `super_agent_db_execute`). L'assistant construit et met à jour ses propres
  tables de suivi ; il ne touche jamais aux fichiers des projets.
- **Supervision des sessions d'agents (P2)** : l'extension
  `pilot-assistant-sessions` fournit l'outil `list_agent_sessions` qui retourne
  la vue d'ensemble de toutes les sessions d'agents (projet, agent, mode
  main/agent_process, état active/parked, vivacité du processus, visibilité et
  pointeur actif), via la commande Rust `list_agent_sessions` (AgentService).
  Quand une activité a été enregistrée, chaque session expose aussi sa dernière
  activité : `lastActivity` (timestamp ISO), `lastActivityRelative` (« il y a X
  min ») et `lastEvent` (type du dernier événement RPC), dérivés de la map
  d'anomalie (`agent_anomaly`, tâche 8). Pour les sessions VIVANTES, chaque
  entrée expose aussi `sessionId` (session pi, probe `get_state` 2 s, échec
  toléré) : c'est la clé cible de `get_delegation_result` (résultat d'une
  délégation). L'assistant l'utilise pour superviser
  quels agents tournent et pour juger si un agent progresse réellement (dernière
  activité récente) avant de déléguer ou d'arrêter.
- **`isWorking` — anti-intoxication sémantique (chantier « l'assistant relance
  des agents qui travaillent »)** : `state` (`active`/`parked`) et `active`
  décrivent l'**ONGLET** (session au premier plan ou conservée en arrière-plan),
  jamais le travail. Un LLM les lisait comme « arrêté » et relançait un agent
  occupé. Chaque entrée expose donc `isWorking` (booléen ADDITIF, calculé dans
  `list_agent_sessions` par `session_is_working` : processus vivant ET
  [`busy` OU `toolInProgress` OU activité < 2 min] — même règle que
  `isSessionWorking` du frontend). C'est la **seule** réponse à « travaille-t-il
  maintenant ? » ; les descriptions de l'outil (description + guidelines)
  l'imposent explicitement au modèle.
- **Auto-adaptation du prompt** : l'extension `pilot-assistant-prompt` fournit
  l'outil `update_my_prompt` qui remplace le prompt personnalisé de l'assistant
  (commande Rust `set_super_agent_prompt`, persistée dans la config + historique
  `prompt-history.md`). L'assistant l'utilise pour prendre systématiquement en
  compte ce qu'il apprend des discussions et des choix de l'utilisateur.
- **Installation d'outils (validation utilisateur)** : si l'assistant a besoin
  d'installer des outils pour gérer certaines tâches, il **demande d'abord** à
  l'utilisateur, qui doit valider (via `ask_confirm` / `ask_choice`).
- **Isolation** : canal d'événements séparé (`rpc-event-superagent`), session
  dédiée `superagent` dans le registre de l'AgentService (projet pseudo-global
  `""`), arrêt propre à la fermeture de l'onglet / du projet / de l'application.
- **Anti-régression** : ne pas toucher à `agent-pi.js`, `orchestration.js`,
  `agents.js`. `ask_pi_caged_timed` (partagé par help/review/agents_md) n'est
  pas modifié. Toutes les sessions passent par l'AgentService (le champ
  `rpc_superagent` d'`AppState` a été retiré en phase 2).
- **Anti-faux-« lancé » (garde de run)** : une demande de run n'est annoncée
  comme lancée que si elle démarre réellement. Les gardes d'occupation
  exigent le **travail réel** (`isSessionWorking` : busy non périmé ou activité
  récente), pas la simple **vivacité** du processus. Un agent vivant mais au
  repos (session settled, busy périmé) ne bloque plus le créneau : le verrou
  périmé est libéré et la demande démarre. Quand une demande est réellement
  mise en file, le retour de `run_agents` / `run_assistant_agents` l'indique
  honnêtement (`launched: false, queued: true`).
- **Plancher de lancement (jamais de kill d'une run récente)** : les 3 chemins de
  lancement de l'assistant — et `startAgentsRun` / `startParallelRun` du bus —
  passent `requireIdleMs: RUN_LAUNCH_MIN_STUCK_IDLE_MS` (2 min) à
  `releaseStuckRunLock`. Un verrou de run RÉCENT n'est donc **jamais** libéré par
  un lancement : la demande est mise **en file**. Ce plancher survit à la
  **revérification automatique** du watchdog (mémorisé sur la run), sinon
  celle-ci repartait sans plancher et coupait la run protégée. Seuls le watchdog
  (sa propre mesure) et les chemins d'**arrêt explicite** appellent sans plancher.
- **Watchdog de run à 15 min (et non 5)** : le watchdog de `run_agents` ne
  relance ni n'arrête rien — il ne réinitialise le flag de run et ne vide la file
  du projet que si la run est jugée **morte**. Sur un travail légitime long et
  **silencieux** (build, tests, installation, analyse), 5 min de silence
  n'étaient pas une preuve suffisante : la file d'attente du projet pouvait être
  vidée alors que l'agent produisait encore. Il revérifie à chaque tour et
  repousse l'échéance tant que la run progresse ; le message affiché calcule son
  délai depuis `RUN_AGENTS_WATCHDOG_MS`.
- **Prompt allégé et plafonné (anti-regonflement)** : le prompt système est
  assemblé par la fonction pure `assemble_super_agent_system_prompt` (rôle,
  contexte projet, listes, règles figées, mémoire, guidelines). Les règles
  dupliquées sont fusionnées (résilience + anti-boucle ; supervision +
  anti-attente). La liste des agents conserve **tous les identifiants** mais
  tronque les descriptions longues à 100 caractères (fin de mot + `…`). Un test
  garde-fou (`super_agent_fixed_prompt_stays_under_budget`) échoue si le total
  des textes fixes dépasse le plafond `SUPER_AGENT_FIXED_PROMPT_BUDGET`
  (5 550 caractères, mesuré à 5 497).
- **Garde-fou du livrable (défaut « l'agent rend un plan »)** : deux verrous
  ferment le trou où une demande d'écriture rendait un texte et Pilot annonçait
  « terminé » sans fichier.
  1. **Refus au lancement** : si **tous** les agents visés sont en **lecture
     seule** (`readonly`) ET que la demande demande **explicitement** d'écrire
     (`expected_files` fourni, ou verbe d'écriture **et** cible de fichier
     identifiable), `run_agents`, `run_assistant_agents` et `delegate_to_coder`
     renvoient une **erreur d'outil nommant l'agent, la raison et la sortie** —
     aucun processus n'est démarré, aucun agent jetable ne subsiste. Détection
     **conservatrice** (module pur `src/js/deliverable-guard.js` :
     `detectExplicitWriteRequest`, négations neutralisées) : pas de cible de
     fichier ⇒ aucune décision, la demande part comme avant.
  2. **Preuve du livrable** : `run_agents` / `run_assistant_agents` acceptent un
     champ **facultatif `expected_files`** (chemins relatifs au projet, ou à
     l'espace `~/.pilot/assistant`, exposé par `get_assistant_workspace`). Le bus
     (`agents-bus.js`, `verifyExpectedFiles`) vérifie **l'existence** de chaque
     fichier en fin de mission : **absent ⇒ mission en ÉCHEC** (`settleMission`
     `error`) avec un message factuel nommant le fichier et le dossier de
     référence ; **présent ⇒ comportement inchangé + confirmation**. L'existence
     seule compte (un fichier vide est conforme) et une sonde indisponible
     n'échoue **jamais** la tâche. **Sans `expected_files`, rien ne change**
     (rétrocompatibilité totale). Couverture : `garde-fou-livrable.test.js`
     + `garde-fou-refus-lecture-seule.test.js` (formulations réelles acceptées,
     vraies écritures refusées).

<!-- HELP:super-agent-mcp -->
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
- L'agent standard du projet garde son comportement historique (1er serveur
  activé au démarrage, local ou distant).
- **Serveur distant** : dans **Paramètres → Serveurs MCP**, choisissez le type
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
<!-- /HELP:super-agent-mcp -->

<!-- HELP:super-agent-checklist -->
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
  (ceux réglés dans les Paramètres). Rien n'est jamais ajouté tout seul.

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

Dans **Paramètres**, rubrique **« Assistant (suivi multi-projets) »** :
- **« Checklist de livraison obligatoire »** : le mode (Désactivée / Rappel
  simple / Bloquante) ;
- **« Modèle de checklist par défaut »** : les points proposés par le bouton
  « Ajouter les points du modèle », **un point par ligne**.
<!-- /HELP:super-agent-checklist -->

<!-- HELP:super-agent-tracabilite -->
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
- **Désactiver** : dans **Paramètres → Assistant (suivi multi-projets)**,
  décochez **« Enregistrer une ligne de traçabilité à chaque livraison »**
  (activé par défaut). Décocher **n'efface aucune** ligne déjà enregistrée.
<!-- /HELP:super-agent-tracabilite -->

<!-- HELP:super-agent-temps -->
### Noter le temps prévu et le temps passé d'une tâche

Comparer **ce qu'une tâche avait coûté en prévision** à **ce qu'elle a réellement
pris** aide à mieux estimer les fois suivantes. C'est exactement ce que permet
le suivi du temps — et il est **masqué par défaut**.

- **À activer d'abord** : tant que le réglage **« Afficher le suivi du temps
  estimé / passé »** n'est pas coché (**Paramètres → Suivi**), rien n'apparaît :
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
<!-- /HELP:super-agent-temps -->

<!-- HELP:super-agent-taches-longues -->
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
- **Pour éteindre complètement le repérage** : **Paramètres → Assistant
  (suivi multi-projets)**, décochez **« Détecter les tâches longues et proposer
  un agent »** (activé par défaut). Décocher n'efface aucune donnée et ne change
  rien d'autre.
<!-- /HELP:super-agent-taches-longues -->

## 9. Perspective — lien futur avec un serveur de sources

- L'Assistant est conçu pour s'appuyer plus tard sur le **gestionnaire de
  source** (pilier V2, dev multi-utilisateurs via git ou gestionnaire intégré).
- La base interne (clients, projets, tâches) est le socle de données qui
  alimentera ce lien : suivi de livraison, jalons, statuts synchronisables avec
  le serveur de sources.
- L'architecture (session dédiée + base SQLite + API de suivi) est pensée pour
  être étendue sans refonte.

## 10. Backend Rust (esquisse)

- `super_agent.rs` : session dédiée, injection bornée des résumés (plafond unique
  `MAX_INJECTED_MESSAGE_CHARS`, seule source de la règle), commandes de base.
- Extensions pi : `pilot-assistant-files.ts` (espace d'écriture restreint
  `~/.pilot/assistant/`), `pilot-choices.ts` (questions),
  `pilot-assistant-actions.ts` (open_project / delegate_to_coder /
  purge_agent_conversation / create_agent / run_agents (option `mcp_server`) /
  run_assistant_agents / mcp_state),
  `pilot-assistant-db.ts` (db_query / db_execute sur la base de suivi),
  `pilot-assistant-prompt.ts` (update_my_prompt) et
  `pilot-assistant-sessions.ts` (list_agent_sessions), chargées dans la session
  super-agent dès que le backend supporte `--extension`.

<!-- HELP:super-agent-extensions-fiables -->
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

<!-- /HELP:super-agent-extensions-fiables -->
- Commandes Tauri (esquisse) :
  - `get_super_agent_config()` / `set_super_agent_config(config)`
  - `start_super_agent_session()` / `stop_super_agent_session()`
  - `send_super_agent_prompt(message)` (chat sur session persistante)
  - `send_super_agent_command(command)` (réponses aux questions, ex:
    `extension_ui_response`)
  - `inject_session_summary(project_id, summary)`
  - `initialize_super_agent(project_path)`
  - `list_clients()` / `add_client(name)` / `remove_client(id)` / `rename_client(id, name)`
  - `set_project_client(project_path, client_id)`
  - `list_super_agent_projects()` (liste les projets suivis + leur client)
  - `set_super_agent_working_project(path)` (projet de travail de la discussion)
  - `super_agent_db_query(sql)` / `super_agent_db_execute(sql)` (accès contrôlé à
    la base de suivi de l'assistant)
  - `set_super_agent_prompt(prompt)` (auto-adaptation du prompt personnalisé,
    avec historique `prompt-history.md`)
  - `query_super_agent(question)` (recherche dans la base + projets)
  - `list_agent_sessions()` (vue d'ensemble des sessions d'agents, P2 —
    AgentService)

## 11. Frontend (esquisse)

| Fichier | Rôle |
|---|---|
| `src/js/super-agent.js` | Onglet 🧭 : chat (session persistante + streaming), questions (boutons pilot-choices), actions (open_project / delegate_to_coder), initialisation, panneau Projets & clients (association projet→client). Résolution de la cible de délégation (`resolveDelegationTargetDecision`, pure) : repli codeur→défaut **uniquement** si aucun agent n'est demandé ; id demandé inconnu → erreur explicite, aucune cible. |
| `src/js/super-agent-config.js` | Paramètres ⚙️ : nom, clients, association projet→client. |

## 12. Anti-régression

- Session et canal dédiés (`rpc-event-superagent`).
- Lecture seule garantie techniquement (extension `pilot-assistant-files`).
- Base interne isolée dans `~/.pilot/` + espace d'écriture `~/.pilot/assistant/`.
- Ne pas modifier les modules existants d'agents ni `ask_pi_caged_timed`.

---

## 13. Limites connues (file d'attente et identité de projet)

<!-- HELP:file-attente-limites -->
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
<!-- /HELP:file-attente-limites -->

**Vérifié sur le disque le 2026-10-21** (lecture seule ; relecture indépendante :
`rapport-relecture-finale.md` § 4.4 et § 9). Les deux limites sont **constatées**
après les correctifs P1 (`4cf5356`, ordre d'arrivée respecté à l'admission),
P2 (`13f7552`, un arrêt d'agent ne détruit plus une file de missions) et
P3 (`275eb04`, une seule identité de projet).

### L1 — Une mission déjà sortie de file repart **derrière** les suivantes

- **Ce qui se passe** : le rejeu sort la **tête** de file (`queue.shift()`,
  `super-agent.js:1003`), puis le lanceur décide de l'admission. Si le projet
  est **encore occupé** à cet instant par autre chose que le bus (mission de
  **lecture**, **commande manuelle**, prompt distant), la mission ne démarre
  pas et est **remise en file** par `enqueueMissionForProject`, c'est-à-dire
  **en queue** (`:4741` → `:554`), et non en tête. Avec une file `[B, C]`, elle
  devient `[C, B]`.
- **Effet pour vous** : l'**ordre d'attente** peut changer (C démarre avant B).
  Rien n'est perdu, rien n'est dupliqué : même mission, même numéro, rejeu
  réarmé (`:4747`), attente supplémentaire d'au plus un tour de rejeu (15 s,
  `RUN_AGENTS_QUEUE_REPLAY_MS`, `:928`).
- **Cause** : le rejeu juge la liberté sur les **sessions vivantes**
  (`isRunStillActive`, `:959`) alors que l'admission juge sur le **bus**
  (`isRunInProgress`, `agents-bus.js:3159`, appelée `:4722`) : deux juges
  différents.
- **Ce qui n'est pas couvert** : aucun test ne reproduit ce cas aujourd'hui. Le
  chemin est prouvé par **lecture** : `launchQueuedMission` (`:1053`) →
  `isRunInProgress` (`:4722`) → `decideMissionAdmission` (`:4732`) →
  `enqueueMissionForProject` (`:4741`) → `queue.push` (`:554`). Le lancement qui
  **échoue** techniquement, lui, remet bien la mission **en tête** (`:1066`).
- **Correctif connu, non appliqué** : remettre **en tête** quand le lancement
  est issu du rejeu (`atHead` / `unshift` dans `launchQueuedMission`), + un test
  dédié « mission défilée qui ne peut pas démarrer revient en tête ».

### L2 — La file des **commandes manuelles** reste indexée par chemin brut

- **Ce qui se passe** : `src/js/project-task-queue.js` range ses files par la
  chaîne de projet **telle quelle** (`queueOf`, `:262-266` ; lecture `:315`,
  abandon `:333`, sonde `:443-448`). La normalisation d'identité de projet (P3,
  `src/js/project-key.js`) n'a pas été appliquée à cette famille.
- **Effet pour vous** : si le **même dossier** est désigné avec deux écritures
  (« `G:\IA_PL\pilot` » et « `g:/ia_pl/pilot/` »), deux files de commandes
  manuelles coexistent ; `/file` peut ne pas voir — donc ne pas abandonner — les
  commandes posées sous l'autre écriture. **Aucune perte de code** : chaque
  commande attend dans sa file et démarre à son tour.
- **Portée** : les **autres** familles (missions, délégations, exclusivité,
  réservations) sont bien normalisées — preuve : `project-cle-unicite.test.js`.
- **Correctif connu, non appliqué** : faire passer `project-task-queue.js` par
  `projectKey` (comme les autres familles), avec le test d'unicité de file
  correspondant.

---

*Voir aussi : `plan_dev.md` (roadmap), `spec_multiprojects.md` (gestionnaire de
projets), `spec_session_history.md` (historique H9), `spec_gestion_agents.md`
(agents multi-rôles).*
