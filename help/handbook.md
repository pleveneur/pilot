<!-- PILOT-HELP generated=2026-08-29 topics=overview,demarrage,raccourcis,theme-parametres,terminal,recherche-outline,edition-lint,aide,dev-mode,pi-update,multi-agents,gds,commands,agent-pi,orchestration,web-remote,dictee-vocale,pdf,context-engine,code-graph,diff-review,project-memory,review,orchestration,session-history,agents,agents-md,multiprojets,interprojets,super-agent,super-agent-session-memory,dashboard,vault,anomaly -->
<!-- FICHIER GÉNÉRÉ — ne pas éditer. Source : help/overview.md + spec_*.md (blocs HELP). -->

# Aide Pilot

Tu es l'assistant d'aide de l'éditeur Pilot. Réponds aux questions de
l'utilisateur en te basant sur le contenu de ce handbook.

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

---

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

---

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

## Thème et paramètres

- **Thème** : bascule dark/light depuis les **Paramètres ⚙️** (bouton du panneau
  d'actions) → section « Apparence ». Le thème est mémorisé.
- **Paramètres ⚙️** : onglet de configuration modale (thème, éditeur, agent Pi,
  accès distant, etc.). Toute la configuration est persistée dans un fichier
  JSON (`app_data_dir/com.pilot.editor/config.json`).
- **Palette de commandes** (`Ctrl+Shift+P`) : accès rapide à toutes les
  commandes (sauvegarder, ouvrir, fermer, basculer split/outline/recherche, etc.).

---

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

---

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

---

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

---

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

---

## GDS (gestionnaire de sources) — principe

Le **GDS** (Gestionnaire De Sources) est la solution prévue dans Pilot pour
**centraliser les sources des projets** (dépôts git + suivi partagé dans une
base de données PostgreSQL unique), en remplacement d'un hébergement externe
type GitHub.

- **Activé projet par projet** : le GDS n'est jamais activé globalement.
  Chaque projet choisit explicitement **son propre serveur** au moment de
  l'activation (activation on/off, URL du serveur, identité), via un fichier
  de configuration **dans le projet**. Il n'y a **aucun serveur par défaut**
  et **aucune configuration globale** pour le GDS.
- **Sans activation** : le projet reste 100 % local, exactement comme
  aujourd'hui.
- **Fonctionnalité en préparation** : le GDS n'est pas encore implémenté dans
  cette version de Pilot. L'aide ci-dessus est **générale à Pilot** ; il
  n'existe pas d'aide spécifique par projet.

---

## Commandes du projet (▶)

Lancez vos commandes de compilation / tests / etc. depuis un bouton du panneau
d'actions (icône **▶ square-terminal**).

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

## Agent Pi (onglet π)

L'onglet **π** intègre l'agent de codage **Pi** (pi.dev) directement dans Pilot :
dialogue avec l'IA, écriture/modification de code, sans quitter l'éditeur.

- **Démarrer** : bouton **Agent Pi** du panneau d'actions, ou onglet π. Pilot
  lance un processus `pi --mode rpc` en arrière-plan. Si vous changez le
  chemin du backend (ex: `plh` → `pi`) ou le répertoire de session dans les
  **Paramètres**, l'agent est automatiquement redémarré à chaud (si l'onglet
  est ouvert) — un message « 🔄 Agent redémarré » confirme le basculement.
- **Poser une question / une tâche** : zone de saisie, `Entrée` pour envoyer
  (`Shift+Entrée` = saut de ligne).
- **Modèle** : sélecteur en haut de l'onglet (provider + modèle). Au
  démarrage, Pilot teste la reachabilité du modèle actif : s'il s'agit d'un
  serveur local éteint (ex: llama-cpp/ollama non lancé), un avertissement
  s'affiche pour éviter qu'un prompt échoue en silence. À l'envoi d'un prompt,
  Pilot vérifie que le modèle actif correspond bien au modèle sélectionné et
  le resynchronise (avec un message) si nécessaire.
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
- **Notification de fin** : réglable dans **Paramètres ⚙️ → onglet « Agent »**
  via « Notifier quand l'agent a terminé (tâche locale) » — envoie une
  **notification native Windows/OS** à la fin d'une tâche, y compris pour un chat
  local (pas seulement à distance).
- **Quality-gate** (bouton 🛡️) : active un protocole anti-régression embarqué
  (vérifie que les modifications ne cassent aucune fonctionnalité existante).

L'agent a accès aux fichiers du projet courant (lecture/écriture).

---

## Mode Orchestration

Le **Mode Orchestration** (onglet π, activable dans les Paramètres ⚙️) fait
travailler ensemble deux IA :
- un **orchestrateur** (cloud) qui découpe la demande en micro-tâches et valide
  chaque étape,
- un **codeur** (local, agent Pi) qui exécute chaque micro-tâche sur le projet.

- Activer dans **Paramètres ⚙️ → Agent Pi → Mode Orchestration**, choisir les
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
  Paramètres → Mode Orchestration. Si activée, après chaque tâche du codeur,
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

## Accès distant (mode remote)

Pilot peut exposer une **interface web distante** pour consulter le travail,
discuter avec l'agent et dicter du texte depuis un téléphone ou un autre poste,
via le réseau privé **Tailscale** (WireGuard chiffré).

- **Activer** : Paramètres ⚙️ → « Accès distant » → activer l'accès web, définir
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

---

## Dictée vocale 🎙️

Pilot intègre la dictée vocale (Web Speech API, langue `fr-FR`) pour saisir du
texte à la voix.

- **Dans l'éditeur / l'agent Pi (desktop)** : bouton 🎙️. Fonctionne en contexte
  sécurisé (HTTPS ou `localhost`).
- **Sur le web distant** : le micro exige **HTTPS** (Secure Context). Cocher
  « Exposer en HTTPS automatique (Tailscale Serve) » dans les Paramètres →
  Accès distant, puis utiliser le bouton 🎙️ depuis le téléphone/autre poste.
- La transcription alimente directement la zone de saisie active (éditeur ou
  saisie de l'agent).

---

## PDF : conversion en Markdown et export

- **Conversion PDF → Markdown** : dans l'explorateur (barre latérale),
  **clic-droit sur un fichier `.pdf`** → « 📝 Créer un fichier Markdown ».
  Pilot extrait le texte du PDF puis le fait restructurer en Markdown propre par
  l'IA (agent Pi). Le fichier `.md` est créé à côté du PDF et s'ouvre dans un
  onglet. Modèle utilisé : Paramètres ⚙️ → « Modèle de conversion PDF → MD ».
- **Export PDF** : dans l'explorateur, **clic-droit sur un fichier `.md`** →
  « 📕 Exporter en PDF ». Génère un PDF rendu de la prévisualisation Markdown.

---

## Context Engine (auto-contexte agent)

Pilot injecte **automatiquement** un contexte projet avant le 1er prompt de chaque
session agent (chat standard) : `.pilot/context.md`, fichier actif, imports, manifestes,
specs référencées dans AGENTS.md, fichiers récemment édités — dans un budget de tokens configurable.

> `AGENTS.md` lui-même n'est pas réinjecté par Pilot : pi et plh le découvrent
> nativement. Le Context Engine l'utilise seulement comme index pour charger les
> specs qu'il référence.

- **Activation** : Paramètres → section « Context Engine ». Désactivable.
- **Budget** : par défaut 8000 tokens (réglable 1000–32000).
- **Bouton 📑 Contexte** (toolbar agent) : force la ré-injection au prochain
  envoi (utile après avoir changé de fichier actif ou édité `AGENTS.md`).
- **Une fois par session** : le contexte est réinjecté automatiquement après un
  nouveau chat (➕), une compaction (📦), une reconnexion (🔄) ou un changement
  de projet.
- **`.pilot/context.md`** : déposez un fichier contextuel à la racine du projet
  pour ajouter vos propres instructions permanentes (conventions, pièges à
  éviter) — il est injecté en priorité juste après `.pilot/context.md`.
- **RAG local (V2, optionnel)** : section **Paramètres → RAG (Context Engine V2)**
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
- **Paramètres → Code Graph** :
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

## Porte pré-écriture (confirmer les modifications de l'agent)

Par défaut, l'agent Pi modifie les fichiers librement. Activez **Paramètres →
« Porte pré-écriture : confirmer les modifications de fichiers »** pour qu'avant
chaque `write`/`edit`, Pilot affiche un **diff (avant/après)** et vous demande :

- **✓ Accepter** : l'outil s'exécute, le fichier est modifié.
- **✗ Refuser** : l'outil est bloqué, le fichier **n'est pas touché**.

Le diff est calculé avant l'écriture (le fichier est intact pendant la décision).
En **Mode Orchestration**, la confirmation est automatique (le codeur est
autonome). Le changement du paramètre relance l'agent à chaud (session préservée).

---

### 📝 Mémoire de projet (H3)

Pilot maintient un fichier `PROJECT_MEMORY.md` à la racine du projet, enrichi
par l'agent (conventions, pièges, décisions) et injecté automatiquement dans le
contexte de l'agent.

- **Bouton 📝** (toolbar agent) : ouvre/édite `PROJECT_MEMORY.md` (créé avec un
  template s'il n'existe pas). Éditable manuellement.
- **Paramètres → Agent Pi ou PLh** :
  - *Mémoire de projet* : active l'injection du fichier avant chaque tâche
    (orchestration) et avant le 1er prompt d'une session (chat).
  - *Extraction auto* : après chaque tâche d'orchestration réussie, l'agent
    extrait 1–3 faits appris et les ajoute au fichier (1 tour LLM
    supplémentaire ; opt-in).
- Le fichier est git-committable : la mémoire devient partagée entre
  collaborateurs et machines.

---

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

### Reviewer indépendant (H2 V1)

- **Opt-in** (Paramètres → Orchestration → Reviewer). Un second agent relit le diff
  de chaque tâche (ou seulement les fichiers sensibles en mode « critical ») avec
  un contexte vierge et répond `APPROVED` ou `CHANGES_REQUESTED`.
- Désactivé par défaut (coûte un tour cloud par tâche). Modèle reviewer configurable
  (défaut = modèle orchestrateur).
- Les corrections demandées par le reviewer sont renvoyées au codeur et partagent le
  même budget que lint/tests (`maxCorrections`).
- En cas d'indisponibilité du reviewer (crash/timeout), la tâche est validée sans
  relecture (non-bloquant).

---

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
  arrière-plan. Réglez ce délai dans **Paramètres ⚙️ → Agent Pi → Rétention
des sessions (jours)** (0 = désactivé).

---

## Aide utilisateur — Mode Agents

L'onglet **🎭 Agents** permet de lancer une équipe d'agents spécialisés (coordinateur, architecte, codeur, reviewer, testeur, documenteur, plan-maker) sur une demande.

### Comment ça marche
1. Cliquez sur **🎭 Agents** dans le panneau d'actions (bouton visible dès qu'un projet est ouvert).
2. Saisissez votre demande dans le chat ; le **coordinateur** la reçoit.
3. Le coordinateur délègue chaque sous-tâche à l'agent adapté via `[[CALL:agent_id]]`.
4. Pilot orchestre les appels : un seul agent travaille à la fois, les résultats sont renvoyés à l'appelant.
5. Le coordinateur synthétise la réponse finale.

### Mode parallèle
- Cliquez sur le bouton **⚡ Mode parallèle** (icône `layers`) à côté du champ de saisie.
- Sélectionnez plusieurs agents, puis envoyez votre tâche : elle est lancée **simultanément** sur tous les agents sélectionnés (sans coordinateur).
- Chaque agent travaille dans sa propre bulle de réflexion ; les résultats sont affichés agrégés à la fin.
- Le coordinateur peut aussi lancer des sous-tâches indépendantes en parallèle via `[[PARALLEL]]` (blocs `agent:`/`task:` séparés par `---`).

### Suivre une run
- Le panneau **Activité** (à droite) affiche un tableau de bord de l'équipe :
  **ce que fait chaque agent** en temps réel (réfléchit, utilise un outil,
  appelle un collègue, a terminé), avec le rappel de son rôle.
- **L'agent actif est mis en avant** (carte surlignée en vert) pour savoir
  qui travaille en ce moment.
- Au centre, une **bulle « réflexion »** affiche en direct la pensée de l'agent
  courant (son texte qui se construit) et les outils qu'il utilise.
- La **chaîne des appels** (« qui appelle qui »), le **budget restant** et la
  **profondeur** atteinte sont affichés.
- Le bilan reste visible après la fin de la run pour relire qui a fait quoi.
- **Timeout d'inactivité** : si un agent reste silencieux plus de 5 minutes, la run s'arrête
  et un message le signale clairement (sans le « Run arrêtée par l'utilisateur »). Vous pouvez
  ajuster la durée dans **Paramètres → Agents → Timeout d'inactivité (ms)**.

### Gérer les agents
- Les agents sont stockés dans `~/.pilot/agents.json` (partagés entre tous les projets).
- Vous pouvez modifier leurs noms, icônes, descriptions, rôles et modèles (`pi` et `plh` séparément).
- Le bouton **Réinitialiser** recrée les 7 agents par défaut.

### Garde-fous
- Profondeur max d'appel, budget total et par agent, détection de cycle, timeout d'inactivité, bouton **⏹ Arrêter**.
- Les agents marqués **lecture seule** ont une consigne stricte dans leur rôle ; ils ne doivent pas modifier de fichiers.

### Conseils
- Le modèle du coordinateur doit être puissant (cloud) pour bien router les tâches.
- Le codeur et le testeur peuvent utiliser un modèle local plus léger.
- Si une run dérape, cliquez sur **Arrêter** : tous les processus agents seront stoppés.

---

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
- **Fermer** : bouton ✕ à droite d'un projet → son agent est arrêté proprement.
- **Agent par projet** : chaque projet a **sa propre session d'agent** (processus
pi/plh dédié, vivant en arrière-plan). En revenant sur un projet, l'agent reprend
exactement là où il en était (contexte et historique préservés).
- **Indicateur d'activité** : une pastille à côté de chaque projet de la barre
« Projets en cours » indique si **son agent travaille** (animée) ou **est en
attente**. Un projet inactif dont l'agent réfléchit en arrière-plan est donc visible.
- **Accès distant** : depuis le mode remote, la liste des projets ouverts est
visible et on peut basculer de projet (route `/api/project/select`).

---

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

---

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
- **Restitution fiable du résultat (fin de run → Assistant)** : le résultat
  d'une délégation arrive **automatiquement** dans la conversation de
  l'Assistant à la fin de la tâche — même si pi a dû **se relancer** après une
  erreur transitoire (le résultat produit APRÈS la relance fait foi), même si
  vous avez posté une nouvelle demande entretemps (mise en file) et sans
  avoir à réouvrir l'onglet 🧭. Côté technique (détails § 3) : événement pi
  `agent_settled` traité comme filet de finalisation, erreurs fournisseur
  différées à la fin du tour, et rejeu automatique des résumés en attente dès
  la libération de la session Assistant. En cas de doute, l'Assistant relit
  un résultat via `get_delegation_result(project, sessionId?|agent_id?)`
  (`sessionId` exposé par `list_agent_sessions` ; à défaut le jsonl le plus
  récent de l'agent ou sa session vivante `get_messages`), lecture seule et
  sûre à retenter.
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
  notification OS). Une **bulle discrète** s'affiche alors dans le chat : une
  seule ligne courte avec la **date et heure de déclenchement** au format local
  français (ex. « ⏰ relance — 29/08 à 14:30 »). Le **prompt** du rappel (consigne
  technique pour l'assistant) **n'est pas affiché** — il reste consultable au
  survol de la bulle. Si la date est absente ou invalide, seul le marqueur
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
- **Résumé des agents (point repliable)** : dans cette barre, juste à gauche
  du bouton ⚙, la liste des agents est **repliée par défaut en un petit point
  unique** : le point **respire** (pulsation douce) quand un agent ou l'
  Assistant travaille, il reste **statique et éteint** sinon. **Un clic** sur
  le point **déploie la liste des agents disponibles** : mêmes entrées et
  mêmes règles que la liste du mode standard (agents avec onglet ou occupés,
  assistant toujours visible) — une **pastille pulsante** quand un agent
  travaille, sinon un anneau discret ; nom + projet. Strictement
  **informative** : les éléments de la liste restent non cliquables (pas de
  menu, pas de fiche, pas d'ouverture d'onglet, pas de tooltip) — un simple
  aperçu de qui travaille en arrière-plan. **Un second clic replie** sur le
  point (l'état n'est pas mémorisé : chaque entrée en mode assistant seul
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

---

### Reprendre après un redémarrage de Pilot
L'assistant 🧭 garde une **mémoire de session** : à la fin d'un chantier ou
quand le sujet change, il enregistre un **résumé court** de la discussion en
cours et des chantiers en cours. Après un **redémarrage de Pilot**, ce résumé
est **réinjecté automatiquement** au début de la session : l'assistant (et vous)
retrouvez immédiatement où on en était, sans avoir à tout ré-expliquer. À
l'ouverture de l'onglet, un message « 🔁 Reprise de session — … » rappelle le
contexte. Vous pouvez aussi lui demander explicitement de « retenir » ou de
« reprendre » une discussion.

---

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
comportement ou modifier l'intervalle dans **Paramètres → Général** (« Activer
le rafraîchissement automatique du tableau de bord » + durée en secondes).

### Suivi multi-projets
Quand plusieurs projets sont ouverts, une section **Suivi multi-projets**
apparaît en tête du tableau de bord : un tableau récapitulatif (projet, client,
statut, tâches ouvertes/total, agent occupé ou prêt, dernière session). Le
projet actif est mis en évidence (📍). Cela permet de superviser d'un coup
 d'œil tous les projets en cours et l'activité de leurs agents respectifs.

### Afficher le Tableau de bord systématiquement
Dans **Paramètres → Général**, l'option **« Afficher le Tableau de bord
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
- **Copier** : boutons de copie pour le **login** et pour le **mot de passe**
  (copie dans le presse-papiers).
- **Masqué par défaut** : les mots de passe sont affichés en `••••••••` ; le
  bouton **œil** les révèle temporairement.
- **Modifier / Supprimer** : boutons d'édition et de suppression sur chaque
  entrée, depuis la vue globale.

---

## Aide utilisateur — Détection d'anomalies et arrêt auto des agents bloqués

Pilot surveille en arrière-plan l'activité de ses agents (codeur, agents du
registre, reviewer, assistant).

**Détection d'anomalies** : si un agent est **actif mais sans progression**
depuis un certain temps (seuil par défaut : **30 minutes**), Pilot vous en
avertit (bandeau + notification native). Le bandeau propose un bouton
**🔍 Diagnostiquer** qui lance un agent d'analyse **sans action automatique** :
il propose des évolutions que vous validez vous-même.

**Arrêt automatique des agents délégués (T2)** : un agent **délégué** (lancé via
run_agents, ex. par l'Assistant 🧭) **bloqué** — actif mais **sans progression**
depuis le seuil dédié (défaut : **10 minutes**) — est **arrêté automatiquement**.
Un outil qui démarre sans se terminer au-delà du seuil est considéré bloqué.

- **Notification** : un bandeau + une notification native indiquent que l'agent
  a été arrêté (agent + raison). Le créneau de ce spécialiste est libéré : un
  agent en file d'attente sur le même rôle peut prendre le relais.
- **Diagnostic automatique** : après l'arrêt, un **agent de diagnostic est lancé
  automatiquement** pour **proposer** des évolutions (lecture seule, validation
  utilisateur requise — aucune action automatique).
- **Scope restreint** : seuls les agents délégués sont arrêtés ; le chat
  principal, le reviewer et l'Assistant ne sont jamais arrêtés automatiquement.
- **Réglages** : dans **Paramètres ⚙️ → Agent**, vous pouvez activer/désactiver
  la **Détection d'anomalies** (seuil 30 min) et l'**Arrêt auto des agents
  délégués bloqués** (seuil 10 min). Activés par défaut.
- **Aucune fausse alerte** : un agent qui progresse (événements RPC réguliers)
  n'est jamais signalé ni arrêté. Un agent actif **sans aucun événement** depuis
  le seuil déclenche l'alerte (une fois par blocage, réarmé à la prochaine
  exécution).
