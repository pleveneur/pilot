# Pilot — Éditeur de texte pour Agents IA

**Pilot** est un éditeur de texte et prévisualiseur multiplateforme conçu pour accompagner l'agent IA en ligne de commande (CLI) nommé **pi**. Pendant que l'agent travaille en arrière-plan dans le terminal, Pilot permet de **visualiser, suivre et éditer** les fichiers du projet en temps réel, avec une interface native rapide et épurée.

---

## Fonctionnalités

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
- **Titre de fenêtre dynamique** : `Pilot` → `Pilot <chemin_du_projet>`.
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
- **Onglet agent π** : chat IA intégré avec l'agent Pi (mode RPC), streaming Markdown, pensées, outils, sélecteur de modèle, **dictée vocale** 🎙️. **Mode Orchestration** disponible : orchestrateur cloud + codeur local, planification en micro-tâches, édition chirurgicale `SEARCH/REPLACE`, linting-in-the-loop et directive globale. À l'ouverture de l'onglet, Pilot **vérifie automatiquement** si une nouvelle version de Pi est disponible et propose de la mettre à jour (`pi update --self`).
- Fermeture automatique des onglets à la fermeture/changement de projet.
- **Sauvegarde automatique** à la fermeture d'onglet (silencieuse).
- **Détection de conflits** : si un fichier ouvert est modifié de l'extérieur pendant une édition, l'onglet clignote en rouge.

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

### Paramètres (modale ⚙️)
- **Thème** : sombre (défaut) ou clair.
- **Commande par défaut** : exécutée automatiquement via le bouton π (ex : `python main.py`, `pi`).
- **Charger le dernier projet** au démarrage.
- **Lancer la commande au démarrage**.
- **Intégrer le terminal** : terminal dans un onglet (xterm.js + PTY) ou fenêtre externe.

### Barre de statut
- Position du curseur (ligne, colonne).
- Type de fichier et raccourcis disponibles.

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

3. **Configurer Pilot** : ouvrir les **Paramètres** ⚙️ → section **« Accès distant »** :
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
     puis cliquer **« 🔄 Reconfigurer maintenant »** dans les Paramètres.

5. **Se connecter depuis l'autre appareil** (téléphone/tablette/autre PC) :
   - Tailscale installé et actif sur cet appareil.
   - Scanner le **QR code** affiché dans les Paramètres (ou ouvrir
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

## Aide intégrée (❓)

Pilot intègre un **assistant d'aide** : bouton **❓** du panneau d'actions
(bas de la barre latérale). Pose ta question en langage naturel sur
 l'utilisation ou le paramétrage de l'éditeur (raccourcis, agent Pi, accès
distant, dictée vocale, PDF, etc.) — l'IA répond à partir de la
**documentation embarquée** (handbook généré à partir des specs, toujours à jour
avec ta version de Pilot).

- **Isolée** de l'agent de coding : l'aide n'a accès ni à tes fichiers, ni à la
  conversation de l'onglet π — uniquement à la documentation.
- L'historique de la conversation d'aide est conservé tant que l'onglet est ouvert.
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
│  ▶ 📁 src                 │  Éditeur de texte pour Agents IA         │
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
├── plan_dev.md               # Plan de développement
├── README.md                 # Ce fichier
├── help/                     # Aide intégrée (handbook)
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
| `set_window_title` | Modifie le titre de la fenêtre |
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

MIT

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


