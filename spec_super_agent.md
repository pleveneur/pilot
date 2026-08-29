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

### Donner un nom à votre assistant
- **Paramètres ⚙️ → onglet « Assistant »** : donnez un nom à votre assistant
  (ex: « Aria », « Chef de projet »). Ce nom s'affiche dans le titre de l'onglet
  🧭 et dans ses réponses.
- Le nom est **injecté dans le prompt système** envoyé à chaque tour :
  l'assistant sait toujours qui il est et qu'il est l'assistant de suivi
  multi-projets (pas l'agent d'un projet). Même sans prompt personnalisé, il
  reçoit un prompt système par défaut qui rappelle son rôle (suivi de plusieurs
  projets par client, lecture seule).

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
- **#31 — Pas de bulle vide** : un message d'info **vide** ou qui ne contient
  **qu'un chemin de projet** (sans libellé/contexte) n'est **pas affiché** —
  chaque bulle porte toujours un libellé utile (ex: « Projet ouvert : X »).
- **Badges projet par bulle (snapshot à l'envoi)** : chaque demande et sa
  réponse portent les badges des projets dont elles parlent, **étiquetés au
  moment où vous envoyez la demande** = projet actif à cet instant + chaque
  projet explicitement nommé dans le texte. La détection est **sans IA** :
  correspondance insensible à la casse sur le **nom affiché** du projet (ex:
  « PLh ») ou la **fin de son chemin** (ex: « ia_pl/plh »), avec **frontières
  de mots** (une demande qui parle de « pilotage » n'étiquette pas le projet
  « pilot »). Plusieurs badges compacts possibles sur une même bulle ; la
  réponse hérite des badges de la demande qui l'a déclenchée. Les badges sont
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
- **Désactivé par défaut** pour éviter la sur-notification : les réponses
  banales de l'Assistant ne déclenchent **aucune** notification.

### Son de notification
- **Paramètres ⚙️ → onglet « Assistant » → « Jouer un son de notification »** :
  l'Assistant joue un **son** (via le script `~/.pilot/assistant/notify.ps1`)
  aux moments où il notifie l'utilisateur : **fin de tâche d'agent** (son
  « fin »), **point important / anomalie** (son « point »), **question posée**
  (son « attention »).
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
- **Paramètres ⚙️ → onglet « Assistant » → « Assistant coordinateur (proposer +
  validation, déléguer quand il faut réfléchir) »** : quand activé (désactivé
  par défaut), l'Assistant passe en mode **coordinateur pur**. Il **ne modifie
  pas** le mécanisme d'échange assistant↔agents : c'est uniquement un bloc
  d'instructions injecté dans son prompt système.
- **Règles injectées** (les 6 points) :
  1. **PROPOSE, l'utilisateur VALIDE** : pour tout travail substantiel lié à un
     projet (réfléchir, analyser, modifier, vérifier), il présente d'abord les
     étapes ET l'équipe d'agents qu'il compte utiliser, puis fait valider
     (`ask_confirm` / `ask_multi_choice`) avant de lancer. Il ne lance pas de
     `run_agents` ni de délégation sans cette validation, sauf demande explicite.
  2. **RÉPONDS TOI-MÊME aux questions simples** : état d'une tâche, information
     déjà connue de son suivi (base), question de compréhension. Il ne délègue
     pas pour répondre à une question dont il a déjà la réponse.
  3. **DÉLÈGUE dès qu'il faut RÉFLÉCHIR** sur une demande liée à un projet
     (analyse, recherche, rédaction, modification) : il confie le raisonnement
     à l'agent le plus adapté.
  4. **Les appels Git liés aux issues** passent par un agent (github-tracker /
     git-point), pas par ses outils Git directs. La vérification de l'état d'un
     agent passe par un agent, pas par `list_agent_sessions`.
  5. **Priorité au message utilisateur** : s'il tape pendant qu'il délègue,
     l'Assistant traite son message EN PRIORITÉ (réponse immédiate, signale que
     la délégation continue en arrière-plan, puis revient dessus à la fin).
  6. **L'utilisateur garde le contrôle** : ne lance jamais un agent sans
     validation ; il propose, l'utilisateur décide (ou lance lui-même).

<!-- HELP:super-agent-coordinator -->
### Mode « Assistant coordinateur pur »
Dans **Paramètres → section Assistant**, l'option **« Assistant coordinateur
(proposer + validation, déléguer quand il faut réfléchir) »** (désactivée par
défaut) fait passer l'Assistant en mode **coordinateur** plutôt qu'exécutant :
- Il **propose d'abord les étapes ET les agents**, et vous **validez avant
  lancement** (pour tout travail substantiel lié à un projet).
- Il **répond lui-même aux questions simples** (état d'une tâche, information
  déjà connue de son suivi).
- Il **délègue dès qu'il faut réfléchir** sur un projet (analyse, recherche,
  rédaction, modification) à l'agent le plus adapté.
- Les appels Git liés aux issues et la vérification de l'état des agents
  passent par des agents (pas par ses outils directs).
- Si vous tapez pendant une délégation, il vous répond **en priorité** puis
  revient sur la tâche en cours.
- Vous gardez le contrôle : rien ne se lance sans votre validation.
Ce mode ne change pas le mécanisme d'échange assistant↔agents : c'est
uniquement un bloc d'instructions dans le prompt système.
<!-- /HELP:super-agent-coordinator -->

### Purge de la conversation de l'agent (à la demande)
- La conversation de l'agent d'un projet est **conservée** entre les demandes
  déléguées par l'Assistant : chaque délégation s'appuie sur l'historique
  existant de l'agent.
- L'Assistant peut **purger à la demande** la conversation de l'agent (outil
  `purge_agent_conversation`) — équivalent au clic sur « + » de l'onglet agent
  (départ d'une conversation vierge). Il l'utilise **au début d'une
  conversation** ou **quand il faut arrêter l'agent**, pas avant chaque
  demande.
- Le modèle actif de l'agent est **préservé** lors de la purge (le mécanisme
  `new_session` réinitialise le modèle par défaut de pi ; Pilot le ré-applique).

### Suivre les projets
- L'Assistant suit chaque projet **de la demande jusqu'à la livraison** :
  il enregistre les tâches, leur état, les décisions et l'historique.
- Il **n'effectue aucune action** sur les projets : il ne modifie, ne crée ni
  ne supprime aucun fichier. Il est **lecture seule**.
- Il construit **sa propre base de données locale** (SQLite) pour organiser
  clients, projets et tâches, et s'enrichit au fil du temps.

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
  le projet ni l'onglet**. Le suivi (bouton Arrêter, détection de boucle,
  notification de fin) et l'arrêt ciblent ce projet précis (canal d'événements
  et `stop_agent_session` routés par chemin de projet).
- **#28 — Fermeture de l'onglet** : quand l'Assistant **arrête l'agent standard
  du projet actif** (`stop_agent`), l'onglet de cet agent est **fermé
  automatiquement** s'il était ouvert (évite un onglet fantôme alors que
  l'agent n'est plus fonctionnel). Les onglets des agents
  secondaires/spécialisés et les onglets d'édition ne sont **pas** fermés.
- **#66 — Mise en file des délégations** : si vous déléguez une nouvelle
  demande pendant que l'agent travaille encore, elle n'est **plus perdue** :
  elle est **mise en file** et transmise automatiquement dès la fin de la
  tâche en cours. Un `stop_agent` **annule** la file d'attente.
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
  - **Détection de boucle** : les appels `run_agents` identiques répétés sont
    détectés (empreinte `agent_ids` + tâche) et arrêtent l'Assistant.
  - **Consigne système** : l'Assistant est invité à construire des prompts
    structurés et à **ne jamais relancer la même tâche à l'identique** — en
    cas d'échec, il change d'approche ou interroge l'utilisateur.
- **#65 — Reprise après arrêt** : après un `stop_agent`, l'agent du projet est
  **recréé automatiquement** à la prochaine délégation (ou purge) — plus
  besoin de redémarrer Pilot pour redéleguer.
- **#64 — Agent invisible joignable** : rédéléguer à un agent invisible déjà
  actif **reprend** sa session au lieu de bloquer (l'Assistant n'a plus besoin
  de l'arrêter entre deux demandes).
- **Plan structuré avant délégation (plan-maker)** : pour les demandes
  importantes, l'Assistant peut d'abord appeler l'agent **`plan-maker`** (via
  `run_agents`) pour obtenir un **plan structuré** (tâches, fichiers concernés,
  coût estimé en tokens, contraintes suggérées). Il **présente ce plan à
  l'utilisateur** (via `ask_multi_choice` pour cocher les tâches à exécuter, puis
  `ask_confirm` pour valider), puis **délègue au codeur** avec le plan approuvé
  et les contraintes retenues. Le `plan-maker` est un agent lecture seule qui ne
  modifie aucun code ; il ne fait que produire le plan JSON.

### L'Assistant, coordinateur de la redistribution des tâches
L'Assistant est le **coordinateur** de la redistribution des tâches entre les
agents du registre (`~/.pilot/agents.json`). Il peut :

1. **Créer un agent sur mesure** (outil `create_agent`) s'il estime que les
   agents disponibles ne conviennent pas à la tâche : il définit lui-même le
   rôle (system prompt), le nom, l'icône, la description, les modèles (pi/plh),
   la lecture seule, le budget et la profondeur. L'agent est ajouté au registre
   global et devient aussitôt sélectionnable.
2. **Choisir quels agents utiliser** (outil `run_agents`) : il sélectionne les
   agents disponibles (par leur id) qui lui semblent les plus adaptés et leur
   confie une tâche. Pilot les lance (en parallèle si plusieurs) et renvoie le
   résultat agrégé à l'Assistant, qui continue son raisonnement.

Ainsi, au lieu de tout déléguer à l'agent standard, l'Assistant constitue
l'équipe la plus adaptée à chaque demande (codeur, testeur, reviewer, ou un
agent qu'il a lui-même créé).

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
  à l'échéance : relance différée (« recheck dans 10 min ») ou périodique
  (« point toutes les 5 min tant que le codeur tourne »).
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
  notification OS). Une **bulle visible** s'affiche alors dans le chat : elle
  reprend le libellé du rappel avec sa **date et heure de déclenchement** au
  format local français (ex. « ⏰ Rappel programmé — 29/08 à 14:30 »). Si la
  date est absente ou invalide, la bulle reste inchangée (jamais « Invalid
  Date »/« NaN »).

### Règle par défaut — fichier AGENTS.md des projets
- Quand l'Assistant travaille sur un projet qui **n'a pas de fichier AGENTS.md**
  (ou dont le contenu est **incomplet** pour guider un agent), il le **signale à
  l'utilisateur** et **programme un rappel** (`schedule_create`) pour revenir
  dessus.
- Il **ne laisse pas ce point tomber dans l'oubli** tant que le AGENTS.md n'est
  pas créé : il relance le rappel si nécessaire.
- Une fois le AGENTS.md **créé (ou complété)**, il **désactive le rappel**
  correspondant (`schedule_set_enabled`).

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

### Mode « Assistant seul » (A19, maquette ASS_Only_V4)
- Le bouton **⛶ (maximize-2)** de la barre d'outils de l'onglet 🧭 — ou le
  **raccourci Ctrl+Shift+A** (Cmd+Shift+A sur macOS, onglet 🧭 ouvert) — bascule
  en mode **assistant seul** : tout est masqué (sidebar, explorateur, éditeur,
  onglets, terminal) et seule la discussion de l'Assistant reste visible.
- **Barre du haut** (maquette V4) : à gauche le bouton **← (retour)** + le titre
  « **Pilot** » ; à droite **UN SEUL bouton ⚙** qui ouvre les paramètres
  existants de l'Assistant (modale Paramètres, onglet « Assistant »).
- **Liste des agents (affichage seul)** : dans cette barre, juste à gauche du
  bouton ⚙, la **liste des agents disponibles** est affichée : mêmes entrées et
  mêmes règles que la liste du mode standard (agents avec onglet ou occupés,
  assistant toujours visible) — une **pastille pulsante** quand un agent
  travaille, sinon un anneau discret ; nom + projet. Strictement **informative** : rien n'est cliquable (pas de menu, pas de fiche, pas
  d'ouverture d'onglet, pas de tooltip) — c'est un simple aperçu de qui
  travaille en arrière-plan.
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
<!-- /HELP:super-agent -->

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
  (créer un agent sur mesure dans le registre global `~/.pilot/agents.json`
  quand les agents disponibles ne conviennent pas) et `run_agents` (choisir
  quels agents disponibles utiliser et lancer une tâche sur eux, en parallèle,
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
  L'arrêt explicite (`stop_agent`) annule la file. **Reprise après arrêt
  (issue #65)** : après un `stop_agent`, la session de l'agent du projet est
  recréée automatiquement à la prochaine délégation (et `purge_agent_conversation`
  se répare seul en recréant la session si nécessaire) — plus besoin de
  redémarrer Pilot. **Agent invisible joignable (issue #64)** : une nouvelle
  délégation à un agent invisible déjà vivant reprend sa session au lieu
  d'errer « déjà active ».
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
  (`~/.pilot/agents.json` / base SQLite), sous forme d'un résumé compact
  (`id`, icône, description courte) — l'Assistant sait ainsi quels agents il
  peut piloter via `run_agents`. Il documente aussi les outils à sa disposition :
  `run_agents`, `create_agent`, `delegate_to_coder`, `ask_multi_choice`,
  `ask_confirm`, `ask_input`.
- **Flux « plan-maker »** : le prompt système décrit la procédure de
  planification avant délégation au codeur — pour les demandes importantes,
  appeler `run_agents(["plan-maker"], …)` pour obtenir un plan JSON (tâches,
  fichiers, coût estimé, contraintes), le présenter à l'utilisateur
  (`ask_multi_choice` pour cocher les tâches + `ask_confirm` pour valider),
  puis déléguer au codeur via `delegate_to_coder` avec le plan approuvé. Les
  demandes simples peuvent être déléguées directement sans plan-maker. Voir
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
- **Nom** de l'assistant.
- **Prompt système** personnalisé (préfixé à chaque tour).
- **Liste des clients** (ajout / suppression / renommage).
- Association **projet → client**.

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
  d'anomalie (`agent_anomaly`, tâche 8). L'assistant l'utilise pour superviser
  quels agents tournent et pour juger si un agent progresse réellement (dernière
  activité récente) avant de déléguer ou d'arrêter.
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

## 9. Perspective — lien futur avec un serveur de sources

- L'Assistant est conçu pour s'appuyer plus tard sur le **gestionnaire de
  source** (pilier V2, dev multi-utilisateurs via git ou gestionnaire intégré).
- La base interne (clients, projets, tâches) est le socle de données qui
  alimentera ce lien : suivi de livraison, jalons, statuts synchronisables avec
  le serveur de sources.
- L'architecture (session dédiée + base SQLite + API de suivi) est pensée pour
  être étendue sans refonte.

## 10. Backend Rust (esquisse)

- `super_agent.rs` : session dédiée, injection de résumés, commandes de base.
- Extensions pi : `pilot-assistant-files.ts` (espace d'écriture restreint
  `~/.pilot/assistant/`), `pilot-choices.ts` (questions),
  `pilot-assistant-actions.ts` (open_project / delegate_to_coder /
  purge_agent_conversation / create_agent / run_agents),
  `pilot-assistant-db.ts` (db_query / db_execute sur la base de suivi),
  `pilot-assistant-prompt.ts` (update_my_prompt) et
  `pilot-assistant-sessions.ts` (list_agent_sessions), chargées dans la session
  super-agent dès que le backend supporte `--extension`.
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
| `src/js/super-agent.js` | Onglet 🧭 : chat (session persistante + streaming), questions (boutons pilot-choices), actions (open_project / delegate_to_coder), initialisation, panneau Projets & clients (association projet→client). |
| `src/js/super-agent-config.js` | Paramètres ⚙️ : nom, clients, association projet→client. |

## 12. Anti-régression

- Session et canal dédiés (`rpc-event-superagent`).
- Lecture seule garantie techniquement (extension `pilot-assistant-files`).
- Base interne isolée dans `~/.pilot/` + espace d'écriture `~/.pilot/assistant/`.
- Ne pas modifier les modules existants d'agents ni `ask_pi_caged_timed`.

---

*Voir aussi : `plan_dev.md` (roadmap), `spec_multiprojects.md` (gestionnaire de
projets), `spec_session_history.md` (historique H9), `spec_gestion_agents.md`
(agents multi-rôles).*
