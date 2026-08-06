<!-- PILOT-HELP generated=2026-08-06 topics=overview,demarrage,raccourcis,theme-parametres,terminal,recherche-outline,edition-lint,aide,dev-mode,pi-update,commands,agent-pi,orchestration,web-remote,dictee-vocale,pdf,context-engine,diff-review,project-memory,review,orchestration,session-history,agents,agents-md,multiprojets,interprojets -->
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
   au projet courant.

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
- **Lancer** : cliquez sur une commande → elle se lance dans le dossier configuré,
  et la **sortie (temps réel)** s'affiche dans une modale. Cliquez sur **Fermer**
  pour arrêter la commande et fermer la modale.
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
- **Nouvelle conversation** : bouton ➕ (new session). **Reprendre une session** :
  commande `/resume` liste les sessions enregistrées pour le projet courant.
- **Prompt Builder** : clic-droit sur un fichier/dossier de l'explorateur →
  « Ajouter au prompt » pour l'envoyer comme contexte à l'agent.
- **Interrompre** : bouton ⏹️. **Stats tokens/coût** affichées en haut.
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
  contexte au besoin.

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

---

## Aide utilisateur — Mode Agents

L'onglet **🎭 Agents** permet de lancer une équipe d'agents spécialisés (coordinateur, architecte, codeur, reviewer, testeur, documenteur) sur une demande.

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
- Le bouton **Réinitialiser** recrée les 6 agents par défaut.

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
