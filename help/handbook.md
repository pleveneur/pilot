<!-- PILOT-HELP generated=2026-07-18 topics=overview,demarrage,raccourcis,theme-parametres,terminal,recherche-outline,aide,agent-pi,orchestration,web-remote,dictee-vocale,pdf -->
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
   fichiers avec `Ctrl+P`.
3. **Ouvrir un fichier** : double-clic dans l'arborescence → un onglet s'ouvre
   (détection automatique du mode : édition pour le code, prévisualisation pour
   `.md`, `.pdf`, images, `.csv`).
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
- `Ctrl+Shift+E` — Basculer en mode split (éditeur + prévisualisation)
- `Ctrl+Shift+B` — Ajouter/retirer le fichier courant des favoris
- `Ctrl+Shift+N` — Ouvrir le brouillon (scratchpad)

### Navigation et recherche
- `Ctrl+P` — Filtrer les fichiers (barre latérale)
- `Ctrl+G` — Aller à la ligne…
- `Ctrl+Shift+F` — Recherche globale (full-text dans tous les fichiers du projet)
- `Ctrl+Shift+O` — Table des matières Markdown (outline cliquable)
- `Ctrl+Shift+P` — Palette de commandes

### Édition Markdown
- `Ctrl+B` — Gras · `Ctrl+I` — Italique · `Ctrl+K` — Lien

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
- Le terminal reste indépendant de l'éditeur ; on peut l'ouvrir et le fermer
  comme un onglet normal.

---

## Recherche et outline

- **Recherche globale** (`Ctrl+Shift+F`) : panneau de recherche full-text dans
  tous les fichiers du projet, avec support des expressions régulières et un
  filtre par extension. Cliquer un résultat ouvre le fichier à la ligne.
- **Table des matières** (`Ctrl+Shift+O`) : bascule l'outline Markdown (titres
  cliquables, mise à jour en temps réel). Pratique pour naviguer dans un long
  fichier `.md`.

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
  bulle vide sans réponse.
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
- **Nudge après réflexion** : si le codeur local s'arrête après la Phase 1
  (Réflexion) sans modifier de fichiers, il est relancé automatiquement dans la
  même session vers la Phase 2 (max 2 relances par tâche), pour éviter une
  escalade cloud systématique.

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
