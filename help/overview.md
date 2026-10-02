# Pilot — Aide utilisateur (source pour le handbook)

> Ce fichier est la **source** des blocs d'aide « généralités » de Pilot. Il est
> orienté utilisateur (langage simple). Le script `scripts/build-handbook.js`
> agrège les blocs `<!-- HELP:* -->` de ce fichier **et** des `spec_*.md` pour
> générer `help/handbook.md` (embarqué dans l'app).
>
> **Ne pas éditer `help/handbook.md` directement** : éditer ce fichier
> (`help/overview.md`) ou les blocs HELP des specs, puis relancer
> `npm run build:handbook`.

---

<!-- HELP:overview -->
## Pilot en bref

Pilot est un éditeur de texte multiplateforme pensé pour les agents IA. Il
combine un éditeur de code (CodeMirror 6), une prévisualisation Markdown, un
terminal intégré, un agent de codage IA (« Agent Pi », onglet π) et un mode
orchestration. Tout se fait dans une seule fenêtre, sans passer par un terminal
externe.

- **Onglets** : édition (📝), prévisualisation (👁️), mode split (📝👁️),
  terminal (🖥️), agent Pi (π).
- **Barre latérale** : explorateur de fichiers du projet, filtre, favoris,
  brouillon (scratchpad).
- **Panneau d'actions** (bas de la barre latérale) : boutons Terminal, Agent Pi,
  Prévisualisation, Paramètres ⚙️, badge Accès distant.
<!-- /HELP:overview -->

<!-- HELP:demarrage -->
## Démarrer un projet

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
   Paramètres). Enregistrer sous : `Ctrl+Shift+S`.
5. **Fermer un onglet** : `Ctrl+W` ou clic sur la croix de l'onglet. On peut
   **réordonner** les onglets par glisser-déposer, et **renommer** un onglet par
   double-clic sur son titre.
6. **Brouillon** : `Ctrl+Shift+N` ouvre un brouillon rapide (scratchpad) non lié
   au projet courant. Vous pouvez y avoir **plusieurs pages** (mini-onglets en
   haut : « + » pour ajouter, clic sur le nom pour renommer, ✕ pour supprimer),
   sauvegardées localement par projet.
<!-- /HELP:demarrage -->

<!-- HELP:raccourcis -->
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
<!-- /HELP:raccourcis -->

<!-- HELP:theme-parametres -->
## Thème et paramètres

- **Thème** : bascule dark/light depuis les **Paramètres ⚙️** (bouton du panneau
  d'actions) → section « Apparence ». Le thème est mémorisé.
- **Paramètres ⚙️** : onglet de configuration modale (thème, éditeur, agent Pi,
  accès distant, etc.). Toute la configuration est persistée dans un fichier
  JSON (`app_data_dir/com.pilot.editor/config.json`).
- **Avatar (PLface)** : dans **Paramètres ⚙️ → Avatar**, cochez « Lancer mon
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
<!-- /HELP:theme-parametres -->

<!-- HELP:terminal -->
## Terminal intégré

- Bouton **Terminal** dans le panneau d'actions (ou palette de commandes).
- Si le terminal intégré est activé (Paramètres ⚙️ → « Terminal intégré »),
  il s'ouvre dans un onglet 🖥️. Sinon, un terminal externe est lancé.
- Shell par défaut : `cmd.exe` (Windows), `$SHELL`/`/bin/zsh` (macOS),
  `$SHELL`/`/bin/bash` (Linux).
- **Windows** : le terminal intégré reconstruit le PATH système + utilisateur
  depuis la registry, pour que les commandes installées après le lancement de
  Pilot (ex: `cargo`) soient trouvées.
- Le terminal reste indépendant de l'éditeur ; on peut l'ouvrir et le fermer
  comme un onglet normal.
<!-- /HELP:terminal -->

<!-- HELP:recherche-outline -->
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
<!-- /HELP:recherche-outline -->

<!-- HELP:edition-lint -->
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
<!-- /HELP:edition-lint -->
<!-- HELP:aide -->
## Aide intégrée (❓)

Le bouton **❓** du panneau d'actions ouvre l'onglet **Aide** : un assistant
conversationnel qui répond à tes questions sur l'utilisation et le paramétrage de
Pilot, **à partir de la documentation embarquée** (handbook généré à la
compilation depuis les specs).

- **Liste déroulante de modèle** en haut de l'onglet : choisis le modèle
  d'inférence utilisé pour l'aide (persisté dans les Paramètres, champ
  `help_model`). Le 1er modèle disponible est auto-sélectionné au 1er usage.
- L'aide est **isolée** de l'agent de coding : elle n'a accès ni à tes fichiers, ni
  à la conversation de l'onglet π — uniquement à la documentation.
- L'historique de la conversation d'aide est conservé tant que l'onglet est
  ouvert (réinjecté à chaque question, le process pi étant sans mémoire).
- Si la réponse est vide ou en erreur, vérifie qu'un **modèle valide** est
  sélectionné dans la liste déroulante.
<!-- /HELP:aide -->

<!-- HELP:dev-mode -->
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
<!-- /HELP:dev-mode -->

<!-- HELP:pi-update -->
## Mise à jour de l'agent Pi

À l'ouverture de l'onglet agent, Pilot **vérifie automatiquement** si une
nouvelle version de Pi est disponible (backend `pi` uniquement). Si c'est le
cas, une modale te propose de la mettre à jour via la commande intégrée de Pi
(`pi update --self`).

- **Mettre à jour maintenant** : lance la mise à jour puis te confirme le
  résultat.
- **Plus tard** : ferme la modale (la vérification se refait à la prochaine
  ouverture de l'onglet agent).
- **Ne plus demander** : désactive la vérification automatique (réactivable en
  remettant `pi_skip_update_check` à `false` dans la config).

La vérification ne concerne que l'agent **Pi** (pas PLh) et n'est proposée que
si une version plus récente existe réellement.
<!-- /HELP:pi-update -->

<!-- HELP:multi-agents -->
## Plusieurs agents sur un même projet (multi-onglets)

Tu peux ouvrir **plusieurs onglets agent indépendants** sur le même projet,
chacun avec sa propre conversation (bouton **« + »** dans la barre d'onglets).

- **Activer** : Paramètres ⚙️ → onglet « Agent Pi » → cocher « Multi-onglets
  agents ».
- **Ouvrir un agent** : bouton « + » de la barre d'onglets (toujours en
  première position, avant les autres onglets).
- **Renommer un onglet** : double-clic sur son nom.
- **Configurer le nombre et les noms au démarrage** : Paramètres ⚙️ → onglet
  « Agent Pi » → section « Agents du projet ». Définis les agents rechargés
  automatiquement à l'ouverture du projet, chacun avec son nom. La
  configuration est enregistrée dans `.pilot/agents.json` du projet (versionnée
  et partagée entre utilisateurs).
- Le **renommage manuel** d'un onglet (double-clic) **prime** sur le nom
  configuré.
- Le bouton « + » reste disponible pour ajouter des agents au-delà de ceux
  configurés.
<!-- /HELP:multi-agents -->

<!-- HELP:gds -->
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
- **Interrupteur global (Paramètres → GDS)** : un paramètre global **actif par
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
- **Deux écrans transverses** (ouverts **sans projet**) — **icônes du haut de la
  barre latérale gauche**, voisines de Brouillon, Paramètres, Coffre, Remarque et
  Aide : la **petite tour** 🖥️ ouvre l'administration (infobulle *« GDS Serveur —
  administration (onglet transverse, hors projet) »*), les **curseurs** ⚙️ le
  paramétrage (infobulle *« GDS — paramétrage utilisateur (onglet transverse,
  hors projet) »*) ; l'onglet **« 🌐 GDS »**, lui, reste **dans le projet**
  (panneau **Vues**) :
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
- **Synchronisation — sans verrou** : une fois connecté, **Synchroniser**
  rapatrie le projet depuis le remote `gds` (clone si absent, sinon fetch/pull).
  Il n'y a **plus de verrou de projet** ni de mode urgent : deux postes peuvent
  travailler en même temps, la concurrence est assumée en « **dernier qui écrit
  gagne** » et les conflits détectés du suivi sont **journalisés** (jamais
  silencieux).
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
- **Documentation technique** : installation du serveur en conteneur dans
  `gds-server/README.md` et `docs/gds-server-setup.md` du dépôt Pilot (dont
  **§9 : modifier le serveur — ce qui change pour le conteneur**, preuves
  fichier par fichier, et **§10 : transmettre le serveur à un tiers — image
  seule**) ; **parcours de retest complet** (serveur puis usage à
  plusieurs) dans `docs/gds-guide-mise-en-place.md`.
<!-- /HELP:gds -->
