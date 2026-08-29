# Spécifications — Pilot

> Spécifications fonctionnelles et techniques de l'éditeur Pilot.
> Pour l'architecture et la stack, voir `AGENTS.md`.

**Pilot** est un **environnement de développement intégré (IDE)** multiplateforme (Tauri v2, Rust + HTML/CSS/JS/Vite) dont le cœur est constitué des agents IA de codage **pi** et **plh**. Les **fournisseurs et modèles LLM sont paramétrables** (d'autres providers et modèles d'API peuvent être configurés ; certains modèles peuvent ne pas être testés — des évolutions peuvent être demandées). Pilot porte la **vision particulière de son développeur (Patrick Leveneur)**, potentiellement différente des autres solutions existantes, avec une **intégration maximale de l'IA**. Le but final : un **assistant de codage** mais aussi un **assistant de suivi de dossiers** — grâce à l'IA et aux agents, suivre une activité de façon très efficace et faire des propositions et ajustements très élaborés.

---

## 1. Interface

L'interface se divise en trois zones : **Barre Latérale** (gauche), **Zone de Travail** (droite), **Panneau d'Actions** (bas gauche).

### A. Barre Latérale

- **Sélecteur de projet** : bouton "Projets" avec dropdown (📁 Nouveau + 10 récents). Dossier = "Projet de l'Agent IA".
- **Arborescence** : tree view sans dossier racine, flèches ▶/▼, mise à jour temps réel (poller custom). Les dossiers lourds/non pertinents (`node_modules`, `.git`, `target`, `dist`, `build`, `vendor`, `bundle`, caches IDE/CI…) sont ignorés à la lecture **et** par le watcher (source unique `IGNORED_DIRS` dans `lib.rs`) pour éviter l'explosion mémoire sur les gros projets. Drag & drop externe.
- **Filtre** : champ texte pour filtrer par nom, `Ctrl+P` pour focus.
- **Favoris** : section « ⭐ Favoris » en haut de l'arborescence, collapsible. Clic droit → Ajouter/Retirer des favoris. `Ctrl+Shift+B` pour le fichier actif. Persistance dans la config.
- **Menu contextuel** :
  - Fichier `.md` : Prévisualiser, Exporter PDF, Supprimer, Envoyer à l'agent Pi
  - Fichier `.pdf` : Prévisualiser, **Créer un fichier Markdown** (heuristiques + IA configurable), Supprimer
  - Fichier `.csv` : Prévisualiser CSV, Supprimer
  - Autre fichier : Supprimer, Envoyer à l'agent Pi
  - Dossier : Créer fichier, Créer dossier, Supprimer, Analyser ce dossier
  - Zone vide : Créer fichier, Créer dossier
- **Menus natifs WebView2 désactivés** (issue #23) : le clic droit sur un ascenseur
  (scrollbar) n'affiche plus de menu système. Un menu custom (Copier/Couper/Coller)
  remplace le menu natif dans l'éditeur CodeMirror et les champs de saisie.
- Suppression avec confirmation native, fermeture auto des onglets concernés.
- Persistance de l'expansion des dossiers après rafraîchissement.

### B. Zone de Travail

| Mode | Fichiers | Icône | Technologie |
|---|---|---|---|
| Édition | `.md`, `.js`, `.ts`, `.py`, `.rs`, `.json`, `.yaml`, `.html`, `.css`, `.sql`, `.java`, `.cpp`, `.xml`, `.php`… | 📝 | CodeMirror 6 (multi-langages via `languages.js`) |
| Split (éditeur + prévisualisation) | `.md` | 📝👁️ | CodeMirror 6 + markdown-it, `Ctrl+Shift+E` pour basculer — scroll synchronisé proportionnellement dans les deux sens, position préservée pendant l'édition |
| Prévisualisation Markdown | `.md` | 👁️ | markdown-it + Mermaid.js — liens cliquables (interne → onglet, externe → navigateur, ancre → scroll) |
| Prévisualisation PDF | `.pdf` | 📕 | PDF.js |
| Prévisualisation image | `.png`, `.jpg`, `.gif`, `.webp`, `.svg` | 🖼️ | `<img>` + zoom/fit |
| Prévisualisation CSV | `.csv` | 📊 | Parseur JS + tableau HTML |
| Terminal intégré | — | 🖥️ | xterm.js + PTY |
| Agent Pi | — | π | RPC (voir `spec_rpc.md`) |
| Multi-onglets agents | — | π + | Plusieurs onglets agent indépendants (bouton « + ») ; nombre + noms configurés par projet dans `.pilot/agents.json`, rechargés au démarrage (voir [`spec_project_agents.md`](spec_project_agents.md)) |
| Prompt Builder | — | 🧩 | Clic-droit → Ajouter + templates + envoi à Agent Pi |
| Agents multi-rôles | — | 🎭 | Coordinateur + agents spécialisés, protocole `[[CALL:…]]` séquentiel (voir [`spec_gestion_agents.md`](spec_gestion_agents.md)) |

- **Raccourcis Markdown** : `Ctrl+B` gras, `Ctrl+I` italique, `Ctrl+K` lien, `Ctrl+Shift+E` split view.
- **Recherche globale** : `Ctrl+Shift+F` ouvre un panneau de recherche full-text dans tous les fichiers du projet (regex + filtre par extension).
- **Outline** : `Ctrl+Shift+O` bascule la table des matières Markdown (headings cliquables, mise à jour en temps réel).
- **Palette de commandes** : `Ctrl+Shift+P` fuzzy search sur toutes les actions avec navigation clavier.
- **Navigation** : `Ctrl+G` aller à la ligne, `Ctrl+Tab`/`Ctrl+Shift+Tab` onglet suivant/précédent (fonctionne aussi dans le terminal), `Ctrl+1`…`Ctrl+9` aller à l'onglet par position, `Ctrl+P` filtre fichiers, `Ctrl+Shift+S` enregistrer sous.
- **Coloration multi-langages** : 14 langages supportés (JS/TS, Python, Rust, Java, C++, CSS, HTML, JSON, YAML, SQL, XML, PHP) avec chargement lazy et folding du code. Les blocs de code Markdown sont aussi colorés.
- **Notifications (Toasts)** : retours visuels non-bloquants en bas à droite pour les opérations réussies (sauvegarde, création, suppression) et les erreurs (lecture, écriture, export).
- **Statistiques barre de statut** : mots / caractères / lignes + temps de lecture estimé (~200 mots/min) pour Markdown ; encodage (UTF-8/UTF-8 BOM/UTF-16) ; fin de ligne (LF/CRLF).
- **Auto-save configurable** : option activable dans les paramètres avec délai personnalisable (défaut 3s), indicateur visuel dans la barre de statut, sauvegarde tous les onglets dirty.
- **Auto-complétion IA inline** : `Ctrl+Space` déclenche une suggestion en gris (ghost text). `Tab` accepte, `Escape` rejette. Toute saisie rejette aussi.
- **Images** : drag & drop / Ctrl+V → copie dans `images/` + `![]()`.
- **Export PDF** : génération HTML + `window.print()`.
- **Onglets** : ouverture/fermeture, sauvegarde auto, détection conflits (flash rouge), fermeture auto au changement de projet, confirmation avant fermeture de l'onglet Agent, `Ctrl+Shift+S` enregistrer sous avec mise à jour du chemin.
- **KaTeX/LaTeX** : formules `$...$` et `$$...$$` rendues dans la prévisualisation (plugin `@traptitech/markdown-it-katex`), adaptées au thème dark/light, incluses dans l'export PDF.
- **Sidebar** : redimensionnement par séparateur draggable, largeur persistée dans la config, double-clic = largeur par défaut (280px).
- **Mode Zen** : `F11` → plein écran sans barre latérale.

### C. Panneau d'Actions

- ⚙️ **Paramètres** : modale en onglets verticaux (Général / Agent Pi / Modèles IA / Accès distant). Thème dark/light + **sous-thèmes** (5 par mode, aperçu en direct avant enregistrement), commande défaut, auto-load projet, terminal intégré, params RPC (5 champs), renvoi à la ligne automatique (word wrap).
- 📂 **Explorateur** : ouvre le dossier projet dans l'explorateur OS.
- 🖥️ **Terminal** : intégré (xterm.js) ou externe selon paramètre.
- π **Agent Pi** : ouvre l'onglet agent (si RPC activé).
- 🎭 **Agents** : équipe d'agents multi-rôles (coordinateur, architecte, codeur, reviewer, testeur, documenteur) si le mode est activé dans les paramètres. Voir [`spec_gestion_agents.md`](spec_gestion_agents.md).
- 💬 **Feedback** : ouvre l'onglet de remarques/évolutions (formulaire GitHub/email + lecture des issues, voir [`spec_feedback.md`](spec_feedback.md)). Accessible sans projet ouvert.

### D. Titre de fenêtre

- `Pilot` par défaut, `Pilot <chemin>` si projet ouvert.

### E. Design system & icônes

- **Design tokens CSS** : échelles partagées (`--space-*`, `--radius-*`, `--shadow-*`, `--ring`, `--transition*`) + ombres/anneaux de focus par thème (dark/light). Utilisés par tous les composants (modales, boutons, inputs, onglets, menu contextuel) pour un rendu cohérent et « pro ».
- **Icônes Lucide** (SVG inline, package `lucide`) : remplacent les emojis des boutons, titres, menu contextuel, arbre explorateur (fichiers/dossiers) et onglet agent (toolbar + mode Orchestration + micro/send). Tailles uniformes `.icon` (16px) / `.icon-sm` (14px) / `.icon-lg` (20px). Couleur = `currentColor` (suit le thème). Helpers dans `src/js/icons.js` : `refreshIcons(root?)` (rend toutes les `<i data-lucide>` d'un sous-arbre, après injection HTML), `setIcon(el, name)` (bouton à état, ex: abort/reconnect, dossier ouvert/fermé), `setIconText(el, name, text)` (item de menu = icône + libellé). **Icônes par type de fichier** (`sidebar.js`) : `FILE_ICONS` (map extension→icône, ex: `.md`→`file-text`, `.html`→`globe`, `.css`→`palette`, `.ts`→`file-code-2`, `.sh`→`file-terminal`, `.json`→`file-json`, `.yaml`→`braces`, `.env`→`file-key`, `.mp3`→`file-audio`, `.mp4`→`file-video`, `.exe`→`binary`, `.db`→`database`, `.log`→`file-clock`, `.diff`→`file-diff`…) + `FILE_NAMES` (noms complets sans extension ou multi-points, ex: `Dockerfile`→`box`, `Makefile`→`wrench`, `LICENSE`→`scroll-text`, `.env.local`→`file-key`). Résolution : nom complet → extension → défaut `file`. Lucide étant monochrome et sans logos de marque, les langages de programmation génériques partagent `file-code` ; seules les **familles fonctionnelles** sont distinguées. **Coloration par catégorie** : `ICON_CATEGORY` (map icône→catégorie) + helper `iconCategory()` posent une classe `icon-cat-<cat>` sur le wrapper `<span class='icon'>` de l'explorateur (dossiers, fichiers, favoris, projets récents uniquement — pas les boutons de l'agent qui restent neutres). CSS : tokens `--cat-*` par thème (palette Catppuccin Mocha/Latte, désaturée) + règles `.icon-cat-* { color: var(--cat-*) }`. Catégories : folder (ambré), doc (bleu), web (orange), style (violet), code (bleu-ciel), terminal (vert), data (jaune), config (gris), build (orange), secret (rouge), image (turquoise), media (rose), archive (orange foncé), binary (gris foncé), database (cyan), diag (gris), default (neutre). Le SVG Lucide utilisant `currentColor` pour son trait, la couleur posée sur le wrapper se propage à l'icône.

---

## 2. Spécifications Techniques

### Mode dev vs installé (issue #25)

`npm run tauri dev` (via le wrapper `scripts/tauri.js`) fusionne
`src-tauri/tauri.dev.conf.json` qui remplace l'identifiant par
`com.pilot.editor.dev`. Conséquences : verrou single-instance distinct,
`app_data_dir` distinct (config, sessions, audit, extensions, skills) → la
version dev tourne en parallèle de la version installée. Le port web distant
effectif est décalé de +1 en build dev (`effective_web_port` dans `lib.rs`,
utilisé par `web_server.rs`, `tailscale.rs` et `web_commands.rs`).

### File Watching
- File watcher : poller custom (`std::fs::read_dir` récursif, filtrage `IGNORED_DIRS` pendant le walk, polling 2 s) → événements Tauri `file-change`. Remplace l'ancien `notify::PollWatcher` qui re-scanne récursivement tout le projet (y compris `target/`, `node_modules/`) à chaque poll et figeait l'UI sur les gros projets Rust.
- Debounce 500ms + déduplication côté backend et frontend.

### PTY (Terminal intégré)
- `portable-pty` : ConPTY (Windows), PTY natif (macOS/Linux).
- Shell : `cmd.exe` / `$SHELL` ou `zsh` / `$SHELL` ou `bash`.
- **Windows** : le PATH complet (système + utilisateur) est reconstruit depuis la
  registry (HKLM + HKCU) et injecté dans le PTY, car le processus Pilot peut ne
  pas avoir le PATH utilisateur à jour (ex: `.cargo\bin` ajouté après son
  lancement). Les commandes comme `cargo` sont donc trouvées dans le terminal
  intégré.
- Streaming via `terminal-output`, ResizeObserver, thème adaptatif.
- Copier/Coller contextuel : `Ctrl+C` copie si sélection, sinon SIGINT.

### Agent Pi (RPC)
- Processus `pi --mode rpc` lancé par `rpc_manager.rs`.
- Dialogue JSON/JSONL sur stdin/stdout, 15+ commandes Tauri.
- **Démarrage auto de l'agent** : réglage « Démarrer l'agent au lancement de Pilot » (`agent_start_on_launch`, défaut **false**, case dans Paramètres → Démarrage). Couvre TOUT démarrage automatique de l'agent : au lancement de Pilot (activé + agent RPC activé + un projet chargé ⇒ ouverture de l'onglet agent) ET à l'ouverture/bascule d'un projet (les onglets agents persistés ne sont pas restaurés). Aucun effet sur l'ouverture manuelle ni sur le cycle de vie des sessions ; les vues mémorisées (`agent_views`) restent sauvegardées — réouverture manuelle possible et restauration retrouvée si le réglage est réactivé.
- **Assistant 🧭 au lancement** : réglage « Démarrer l'assistant au lancement de Pilot » (`super_agent_start_on_launch`, défaut **true**, case dans Paramètres → Démarrage). Rouvre l'onglet 🧭 Assistant au démarrage de Pilot ; cumulé (OU) avec le drapeau historique `super_agent_open` (reprise de l'état d'ouverture à la fermeture, conservé pour compat). Voir [`spec_super_agent.md`](spec_super_agent.md).
- **Mode Orchestration** (voir [`spec_orchestration.md`](spec_orchestration.md)) : orchestrateur cloud + codeur local, planification en micro-tâches, édition chirurgicale `SEARCH/REPLACE`, linting-in-the-loop et directive globale.
- **Quality-gate interne** (voir [`spec_quality_gate.md`](spec_quality_gate.md)) : bouton 🛡️ dans la toolbar de l'agent → active un protocole anti-régression embarqué par Pilot (`--skill`), persistant (`quality_gate_enabled`), relance l'agent au clic.
- **Health check au démarrage** (E4) : Pilot sonde `<rpc_pi_path> --version` au lancement ; si l'exécutable est absent/injoignable, toast d'avertissement + gate dans l'onglet agent (écran « π indisponible » avec bouton « Ouvrir les paramètres » au lieu d'une session RPC qui planterait). Re-sonde automatique sur changement de chemin pi.
- **Mise à jour de Pi** (issue #26) : à l'ouverture de l'onglet agent, si le backend est `pi` (pas `plh`) et que `pi_skip_update_check` est `false`, `pi_update::check_pi_update` compare la version installée (`pi --version`) à la dernière (`https://pi.dev/api/latest-version`). Si une mise à jour existe, modale [Mettre à jour] [Plus tard] [Ne plus demander] ; « Mettre à jour » lance `pi update --self` (`pi_update::update_pi`). « Ne plus demander » persiste `pi_skip_update_check=true` dans la config.
- Voir [`spec_rpc.md`](spec_rpc.md) pour le détail complet.

### Accès distant web (mode remote)
- Serveur HTTP (axum) + UI web (`web/`) : consultation, chat agent, dictée vocale (Web Speech API), en lecture seule ou non.
- Auth : mot de passe distant (hash argon2) + token opaque + sessions, rate limiting, audit (ring buffer 500).
- **Automatisation Tailscale Serve** (opt-in, voir [`spec_web_remote.md`](spec_web_remote.md) §14) : expose automatiquement `https://<nom-magicdns>.ts.net/` (HTTPS 443 → `127.0.0.1:port`), resync au changement de port, URL + QR code affichés dans les Paramètres. Exige `web_bind = 127.0.0.1`.

### Aide intégrée (❓)
- Onglet « ❓ Aide » : chat LLM sur le **handbook** (doc condensée embarquée, générée à la compilation depuis les blocs `<!-- HELP:* -->` des specs). Voir [`spec_help.md`](spec_help.md).
- Backend Option A : process pi temporaire `--no-session` cadré (pas d'outils, pas de fichiers). Isolé de l'agent de coding.

### Context Engine (auto-contexte agent)
- Avant le 1er prompt de chaque session agent (chat standard), Pilot construit et injecte automatiquement un **contexte projet** (AGENTS.md, `.pilot/context.md`, fichier actif, imports, manifestes, specs référencées, fichiers récents) dans un budget de tokens configurable. Bouton 📑 dans la toolbar pour forcer la ré-injection. Voir [`spec_context_engine.md`](spec_context_engine.md). V1 heuristique.

### Diff Review agent (porte pré-écriture)
- Paramètre **« Porte pré-écriture »** (`confirm_file_edits`, désactivé par défaut). Activé : avant chaque `write`/`edit` de l'agent, un **diff (avant/après)** s'affiche avec **✓ Accepter** (l'outil s'exécute) / **✗ Refuser** (l'outil est bloqué, fichier **intact**). Implémenté via une extension pi (`pilot-edit-gate`) qui bloque `tool_call` + `ctx.ui.confirm` (RPC bloquant). Auto-approve en Mode Orchestration. Voir [`spec_diff_review.md`](spec_diff_review.md).

### Mémoire de projet auto-maintenue
- `PROJECT_MEMORY.md` à la racine du projet, **tenu par l'agent** (conventions, pièges, décisions d'architecture, dépendances clés). Injecté avant chaque tâche (Mode Orchestration) et avant le 1er prompt d'une session (chat). Extraction automatique opt-in : après chaque tâche d'orchestration réussie, l'agent extrait 1–3 faits appris et les ajoute au fichier. Bouton 📝 (toolbar agent) pour ouvrir/éditer le fichier. Git-committable. Voir [`spec_project_memory.md`](spec_project_memory.md).

### Git intégré (C1)
- Badges de statut Git dans l'explorateur : `M` (orange = modifié working tree), `M`/`A` (vert = staged/add), `D` (rouge = supprimé), `?` (gris = non suivi) ; dossiers contenant un fichier modifié marqués `•`. Via CLI `git status --porcelain` (zéro dep Cargo). Rafraîchi sur watcher, en parallèle de `refresh_tree`.
- **Diff visuel** : clic droit → « 🔖 Voir le diff Git » → modale plein écran read-only réutilisant le moteur de diff d'A4 (`diff-view.js`), `before` = `git show HEAD:<path>`, `after` = contenu disque. Désactivé gracieusement si le projet n'est pas un repo Git (ou `git` absent).

### Revue de code assistée (H5)
- Onglet **🔍 Review** (bouton 🔍) : l'agent joue le rôle de **second reviewer** sur le diff Git. Portée : modifs non commitées (`git diff HEAD`) ou dernier commit (`git diff HEAD~1 HEAD`). Process pi temporaire cadré (`ask_pi_caged`, réutilise l'aide intégrée) — **lecture seule**, aucune modification du projet. Revue structurée (bugs, sécurité, perfs, style, cohérence specs) + questions de suivi. Voir [`spec_review.md`](spec_review.md).

### Historique de sessions searchable (H9)
- Onglet **📜** (bouton 📜) : index local de **toutes les sessions agent** (passées et nouvelles) dans `.pilot/sessions.jsonl` (append-only) + tags dans `.pilot/sessions-tags.json`. Recherche full-text (regex si la requête commence par `/`) + filtres tag / fichier (chemin relatif) / type (chat/orchestration/review). Détail d'une session : relecture du JSONL pi (messages + tool calls, lecture seule). Tags éditables (chips + autocomplétion). **Rétro-indexation automatique** à la 1re ouverture (lecture du dossier de sessions pi du projet) + bouton « Réindexer ». **Capture live** à l'`agent_end` (chat standard, hors orchestration). Ne dépend pas de pi (consultable hors-ligne). Confidentialité : index local au projet, jamais envoyé au cloud ni au web distant. Voir [`spec_session_history.md`](spec_session_history.md).

### Feedback utilisateurs (💬)
- Onglet **💬** (bouton `message-square-plus`) : permet à l'utilisateur d'envoyer un retour (bug / évolution / remarque) via deux canaux sans backend ni secret embarqué : **Ouvrir sur GitHub** (`issues/new` pré-rempli, navigateur système) ou **Envoyer par email** (`mailto:` vers l'adresse de feedback). Le corps est pré-construit (type, titre, description, version Pilot auto, OS auto, email optionnel). **Lecture des issues existantes** via l'API publique GitHub (dépôt public `pleveneur/pilot`, anonyme, CORS `*`) pour éviter les doublons. Accessible sans projet ouvert. Voir [`spec_feedback.md`](spec_feedback.md).

### Palette de commandes du projet (#17)
- Bouton **▶** (panneau d'actions, `square-terminal`) : modale listant les **commandes paramétrées du projet courant**, stockées **par projet** dans `.pilot/commands.json`. Actions **Ajouter / Modifier / Supprimer** (suppression confirmée).
- Chaque commande = **nom** + **commande shell** (ex: `npm run build`, `cargo build`) + **dossier de travail** (relatif au projet, vide = racine).
- **Clic sur une commande** → le système se place dans le dossier configuré puis lance la commande dans un **onglet terminal dédié** (#29) : titre = nom de la commande, liste des commandes fermée. Relancer une commande déjà ouverte **bascule** sur son onglet (sans relancer le process). Fermer l'onglet arrête le PTY (comportement identique au terminal intégré).
- Backend : `files::read_project_commands` / `files::save_project_commands` (`.pilot/commands.json`), `terminal::spawn_terminal_command` (PTY avec `cwd` + commande explicites). Frontend : `project-commands.js`.

<!-- HELP:commands -->
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
<!-- /HELP:commands -->

### Persistance
- Config JSON dans `app_data_dir` : thème, commande, projets récents, params RPC.

### Permissions Tauri
- `core:default` + `dialog:default` + `updater:default` + `process:default`.

### Mises à jour automatiques
- Plugin `tauri-plugin-updater` : au démarrage, Pilot interroge l'endpoint configuré (`plugins.updater.endpoints` dans `tauri.conf.json`, GitHub Releases par défaut). Si une MAJ est disponible, une modale affiche la nouvelle version, sa date et le **changelog** (champ `notes` de `latest.json`, rendu en Markdown) avec deux boutons : « Installer maintenant » (téléchargement + barre de progression + redémarrage) et « Plus tard ». Vérification manuelle via la palette de commandes (« Vérifier les mises à jour »). `dialog:false` dans `tauri.conf.json` (l'UI est gérée par `updater.js`, pas la boîte native Tauri).
- Signature des artefacts via clé asymétrique (clé publique dans `tauri.conf.json`, clé privée en secret GitHub `TAURI_SIGNING_PRIVATE_KEY`).
- Publication : workflow GitHub Actions `.github/workflows/release.yml` (tag `v*`) → `create-release` (crée la release de façon idempotente pour éviter la condition de course entre builds parallèles) → build multi-plateforme (Windows NSIS/MSI, macOS DMG x86_64/aarch64, Linux AppImage) → `latest.json` (`scripts/gen-latest-json.js`) qui génère le changelog, met à jour le body de la release GitHub, et injecte ce changelog dans le champ `notes` de `latest.json` (affiché par l'updater dans la modale de mise à jour). `tauri-action` a `updaterJson:false` (sinon il génère son propre latest.json sans changelog qui écraserait le nôtre).
  - Notes orientées utilisateur : si `release-notes/vX.Y.Z.md` existe (rédigé à la main, en français), son contenu est utilisé comme `notes`. Sinon, fallback automatique catégorisé depuis `git log` (✨ Nouveautés / 🐛 Corrections / ⚡ Performances / 🔧 Maintenance), préfixe technique retiré, `bump version` filtré. Recommandé : rédiger `release-notes/vX.Y.Z.md` avant chaque release visible par les utilisateurs.

---

## 3. Compatibilité

| OS | Shell PTY | Watcher |
|---|---|---|
| Windows | `cmd.exe` (ConPTY) | Poll custom (walk filtré) |
| macOS | `$SHELL` ou `/bin/zsh` | Poll custom (walk filtré) |
| Linux | `$SHELL` ou `/bin/bash` | Poll custom (walk filtré) |
