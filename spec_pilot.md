# Spécifications — Pilot

> Spécifications fonctionnelles et techniques de l'éditeur Pilot.
> Architecture, stack et arborescence : `AGENTS.md`.
> Chaque feature a sa spec dédiée (table de navigation rapide dans `AGENTS.md`).

**Pilot** est un **environnement de développement intégré (IDE)** multiplateforme (Tauri v2, Rust + HTML/CSS/JS/Vite) dont le cœur est constitué des agents IA de codage **pi** et **plh**. Les **fournisseurs et modèles LLM sont paramétrables** (certains modèles peuvent ne pas être testés). Pilot porte la **vision particulière de son développeur (Patrick Leveneur)** avec une **intégration maximale de l'IA** : un **assistant de codage** mais aussi un **assistant de suivi de dossiers** — suivre une activité efficacement et faire des propositions et ajustements élaborés.

---

## 1. Interface

Trois zones : **Barre Latérale** (gauche), **Zone de Travail** (droite), **Panneau d'Actions** (bas gauche). Titre de fenêtre : `Pilot` par défaut, `Pilot <chemin>` si un projet est ouvert.

### A. Barre Latérale
- **Sélecteur de projet** : bouton "Projets" (📁 Nouveau + 10 récents). Un dossier = un "Projet de l'Agent IA".
- **Arborescence** : tree view sans racine, flèches ▶/▼, temps réel (poller custom), drag & drop externe, expansion persistée. Les dossiers lourds/non pertinents (`node_modules`, `.git`, `target`, `dist`, `build`, `vendor`, environnements virtuels Python, caches IDE/CI…) sont ignorés à la lecture **et** par le watcher (liste unique `IGNORED_DIRS`, `lib.rs`) pour éviter l'explosion mémoire sur les gros projets.
- **Filtre** : champ texte, `Ctrl+P`. **Favoris** : section « ⭐ Favoris » collapsible, clic droit (ajouter/retirer), `Ctrl+Shift+B` pour le fichier actif, persistés en config.
- **Menu contextuel** : `.md` → prévisualiser / exporter PDF / supprimer / envoyer à l'agent Pi ; `.pdf` → prévisualiser / **créer un fichier Markdown** (heuristiques + IA configurable) / supprimer ; `.csv` → prévisualiser ; autre fichier → envoyer à l'agent Pi / supprimer ; dossier → créer fichier/dossier, supprimer, analyser ; zone vide → créer. Suppression avec confirmation native (onglets concernés fermés automatiquement) ; menus natifs WebView2 désactivés (issue #23) au profit d'un menu custom Copier/Couper/Coller dans l'éditeur et les champs.

### B. Zone de Travail
- **Édition** : CodeMirror 6 multi-langages (14 langages, chargement lazy + folding ; blocs de code Markdown colorés) — `.md`, `.js`, `.ts`, `.py`, `.rs`, `.json`, `.yaml`, `.html`, `.css`, `.sql`, `.java`, `.cpp`, `.xml`, `.php`…
- **Prévisualisations** : Markdown (markdown-it + Mermaid + KaTeX `$...$`/`$$...$$`, liens internes/externes/ancres) avec **split** éditeur+aperçu (`Ctrl+Shift+E`, scroll synchronisé dans les deux sens) ; PDF (PDF.js) ; images (zoom/fit) ; CSV (tableau HTML).
- **Terminal intégré** : xterm.js + PTY. **Agent Pi** : RPC → [`spec_rpc.md`](spec_rpc.md). **Multi-onglets agents** : onglets π indépendants, configurés par projet dans `.pilot/agents.json` → [`spec_project_agents.md`](spec_project_agents.md).
- **Agents multi-rôles** (coordinateur + agents spécialisés, protocole `[[CALL:…]]` séquentiel) → [`spec_gestion_agents.md`](spec_gestion_agents.md). **Prompt Builder** : clic droit → ajouter + templates + envoi à l'agent Pi.
- **Raccourcis** : `Ctrl+B`/`Ctrl+I`/`Ctrl+K` (Markdown), `Ctrl+Shift+E` (split), `Ctrl+Shift+F` (recherche globale full-text, regex + filtre par extension), `Ctrl+Shift+O` (outline), `Ctrl+Shift+P` (palette de commandes fuzzy), `Ctrl+G` (aller à la ligne), `Ctrl+Tab`/`Ctrl+Shift+Tab` et `Ctrl+1…9` (onglets), `Ctrl+Shift+S` (enregistrer sous), `Ctrl+Space` (complétion IA inline : ghost text, `Tab` accepte, `Échap` rejette), `F11` (mode Zen).
- **Barre de statut** : mots / caractères / lignes + temps de lecture (~200 mots/min), encodage (UTF-8 / BOM / UTF-16), fin de ligne (LF/CRLF), indicateur d'auto-save configurable (défaut 3 s, sauvegarde tous les onglets dirty). **Divers** : images (drag & drop / `Ctrl+V` → copie dans `images/` + `![]()`), export PDF (HTML + `window.print()`, KaTeX inclus), notifications toast non bloquantes, sidebar redimensionnable (largeur persistée, double-clic = 280 px), onglets (sauvegarde auto, conflit → flash rouge, fermeture auto au changement de projet, confirmation avant de fermer l'onglet Agent).

### C. Panneau d'Actions
- ⚙️ **Paramètres** : modale à onglets verticaux (Général / Agent Pi / Modèles IA / Accès distant / Avatar / Serveurs MCP + écrans transverses GDS et service Laya). Thème dark/light + sous-thèmes (5 par mode, aperçu en direct), commande défaut, auto-load projet, terminal (intégré/externe), params RPC, word wrap.
- 📂 **Explorateur** (dossier projet dans l'OS) · 🖥️ **Terminal** · π **Agent Pi** · ▶ **Commandes du projet** (voir plus bas) · 🎭 **Agents** · 🔍 **Review** · 📜 **Sessions** · 📊 **Tableau de bord** · 🔐 **Coffre** · 💬 **Feedback** (accessible sans projet) · écrans GDS (« GDS Serveur », « GDS paramétrage »).

### E. Design system & icônes
- **Design tokens CSS** partagés (`--space-*`, `--radius-*`, `--shadow-*`, `--ring`, `--transition*`) + ombres / anneau de focus par thème, utilisés par tous les composants (modales, boutons, inputs, onglets, menu contextuel).
- **Icônes Lucide** (SVG inline ; `src/js/icons.js` : `refreshIcons`, `setIcon`, `setIconText`) à la place des emojis, tailles `.icon`/`.icon-sm`/`.icon-lg`, couleur `currentColor`. Icône par type de fichier (`FILE_ICONS` / `FILE_NAMES`, `sidebar.js`) et coloration par catégorie (`ICON_CATEGORY` → classe `icon-cat-*`, tokens `--cat-*` par thème).

---

## 2. Spécifications Techniques

- **Mode dev vs installé (issue #25)** : `npm run tauri dev` (wrapper `scripts/tauri.js` + `tauri.dev.conf.json`) prend l'identifiant `com.pilot.editor.dev` et un port web décalé de +1 → la version dev tourne en parallèle de l'installée (verrou single-instance et `app_data_dir` distincts).
- **File watching** : poller custom (`read_dir` récursif filtré par `IGNORED_DIRS`, 2 s) → événements `file-change`, debounce 500 ms + déduplication. Remplace `notify::PollWatcher` (re-scan complet qui figeait l'UI sur les gros projets Rust).
- **PTY (terminal intégré)** : `portable-pty` (ConPTY Windows, PTY natif macOS/Linux), shell `cmd.exe` / `$SHELL` (zsh/bash) ; sous Windows le PATH complet (registry HKLM + HKCU) est injecté dans le PTY. Streaming `terminal-output`, `Ctrl+C` = copie si sélection sinon SIGINT.
- **Persistance** : config JSON dans `app_data_dir` (thème, commande, projets récents, params RPC, options). **Permissions Tauri** : `core:default` + `dialog:default` + `updater:default` + `process:default`.

### Agent Pi (RPC)
- Processus `pi --mode rpc` (ou programme 100 % compatible pi, ex. plh) piloté en JSON/JSONL ; sessions gérées par l'`AgentService` (clé composite (projet, agent), parking, pointeur actif). Détail complet : [`spec_rpc.md`](spec_rpc.md).
- **Démarrage auto** : `agent_start_on_launch` (défaut **false**) règle **tout** démarrage automatique de l'agent (au lancement de Pilot et à l'ouverture/bascule d'un projet) ; `super_agent_start_on_launch` (défaut **true**) rouvre l'onglet 🧭 Assistant → [`spec_multiprojects.md`](spec_multiprojects.md), [`spec_super_agent.md`](spec_super_agent.md).
- **Santé et mise à jour du backend** : health check `--version` au lancement → gate « π indisponible » dans l'onglet agent, re-sonde au changement de chemin pi (E4) ; si backend `pi` et `pi_skip_update_check` false, comparaison avec la dernière version → modale [Mettre à jour] (`pi update --self`) / [Plus tard] / [Ne plus demander] (issue #26). Détail : [`spec_rpc.md`](spec_rpc.md) §4bis.
- **Extensions pi embarquées** : Mode Orchestration → [`spec_orchestration.md`](spec_orchestration.md) ; quality-gate 🛡️ (protocole anti-régression, persistant, relance l'agent) → [`spec_quality_gate.md`](spec_quality_gate.md) ; porte pré-écriture (diff avant/après des `write`/`edit`) → [`spec_diff_review.md`](spec_diff_review.md) ; boutons de choix/confirmation/saisie → [`spec_rpc.md`](spec_rpc.md) §8bis ; MCP (voir ci-dessous).
- **Avatar (PLface)** : Paramètres → Avatar — `plface_autostart_enabled` (défaut false), `plface_exe_path`, `plface_avatar_path` ; programme et modèle livrés avec Pilot (`assets/plface.exe`, `assets/PilotBase.vrm`, résolus dynamiquement, sinon aucun lancement en silence). Pilot sonde l'API locale du visage et le lance détaché si elle ne répond pas ; un avatar lancé par Pilot est **tracé** (`plface.pid`) et refermé à la fermeture (arrêt propre `GET /close`, garde sur le nom du processus), un avatar lancé à la main n'est jamais refermé ; lancement toujours `--no-taskbar`. Boutons « Tester maintenant » / « Arrêter mon avatar ». Fail-open, non bloquant (`plface.rs`, `plface-utils.js`). Doc utilisateur : `help/overview.md`.

### Features transverses (une spec dédiée par sujet)
- **Accès distant web** : serveur axum + UI `web/` (consultation, chat, dictée vocale), auth argon2 + token opaque + sessions, rate limiting, audit ; automatisation Tailscale Serve opt-in (HTTPS 443, URL + QR code) → [`spec_web_remote.md`](spec_web_remote.md).
- **Aide intégrée ❓** : chat LLM sur le handbook embarqué (doc condensée générée à la compilation depuis les blocs HELP des specs) via un process pi temporaire cadré, isolé de l'agent de coding → [`spec_help.md`](spec_help.md).
- **Context Engine 📑** : injection automatique du contexte projet avant le 1er prompt (budget de tokens configurable, bouton de ré-injection) → [`spec_context_engine.md`](spec_context_engine.md).
- **Mémoire de projet 📝** : `PROJECT_MEMORY.md` tenu par l'agent (conventions, pièges, décisions, dépendances), injecté avant chaque tâche, extraction opt-in après une tâche réussie → [`spec_project_memory.md`](spec_project_memory.md).
- **Git intégré** : badges de statut dans l'explorateur (`M`/`A`/`D`/`?`, dossiers contenant une modification marqués `•`) + diff visuel read-only (CLI `git`, zéro dépendance Cargo).
- **GDS** : serveur conteneurisé unique (`gds-server/` : PostgreSQL + sshd + HTTP), socle partagé sans Tauri (`gds-core/`), sources Git + suivi fusionné, activation par projet (`.pilot/gds.json`), rôles `admin` (comptes + dépôts), `dev` (publier / forcer le suivi — tous les projets du serveur), `standard` (lecture seule), **sans verrou** (« dernier qui écrit gagne », conflits journalisés). Écrans transverses « GDS Serveur » et « GDS paramétrage » + onglet 🌐 GDS par projet → [`spec_gds.md`](spec_gds.md), [`spec_assistant_sync.md`](spec_assistant_sync.md).
- **Autres onglets et features** : Review 🔍, Sessions 📜, Feedback 💬, Tableau de bord 📊, Coffre 🔐, Dictée vocale, Service Laya, Passerelle Telegram, Code Graph, sous-projets liés → specs dédiées (`spec_review.md`, `spec_session_history.md`, `spec_feedback.md`, `spec_dashboard.md`, `spec_vault.md`, `spec_voice_input.md`, `spec_laya.md`, `spec_telegram.md`, `spec_code_graph.md`, `spec_subprojects.md`).
- **Mises à jour de Pilot** : `tauri-plugin-updater` (endpoint `plugins.updater.endpoints`, modale version + date + changelog `notes` de `latest.json`, boutons « Installer maintenant » / « Plus tard », vérification manuelle par la palette, `dialog:false` — l'UI est gérée par `updater.js`), artefacts signés (clé publique dans `tauri.conf.json`, clé privée en secret GitHub `TAURI_SIGNING_PRIVATE_KEY`), workflow `.github/workflows/release.yml` (tag `v*` : release idempotente → builds Windows NSIS/MSI, macOS DMG x86_64/aarch64, Linux AppImage → `latest.json` généré par `scripts/gen-latest-json.js`), changelog utilisateur `release-notes/vX.Y.Z.md` (fallback catégorisé depuis `git log`).

### Mode consommateur MCP
- **Deux transports** : **local** (`stdio`) et **distant** (`http`/`https`) via une extension pi qui embarque le SDK MCP (source `mcp-client.src.ts` → `npm run build:mcp` → `pilot-mcp-client.ts`, **généré, jamais édité à la main**). Config `mcp.json` (dans `app_data_dir`, pas dans AppConfig) : `McpServer { id, name, transport, enabled, command, args, url, secret_ref }` ; l'extension découvre `tools/list` et enregistre chaque outil en `mcp_<serverId>_<name>` (fail-open), serveur cible `PILOT_MCP_SERVER` sinon le 1er serveur activé. Un échec d'outil MCP remonte à l'agent comme **erreur** (`isError` transmis tel quel) : un refus du serveur n'est jamais présenté comme une réussite.
- **Sécurité** : la clé d'accès n'est **jamais** dans `mcp.json`, seulement la **référence** de l'entrée du coffre (`secret_ref`, forme `vault:<id>`, le préfixe étant facultatif) ; la valeur est résolue côté Rust (coffre déverrouillé) et transmise en **en-tête** `Authorization` (`PILOT_MCP_SECRET`), masquée dans les erreurs et jamais renvoyée à l'UI. La référence est un identifiant technique : elle se choisit dans la **liste déroulante des entrées du coffre** du champ « Clé » (ou se saisit à la main), est **affichée dans l'onglet 🔐** (cliquer pour copier), et est lue par `vault_list_refs` (jamais les mots de passe). Coffre verrouillé au lancement de l'agent → aucune clé lue : l'agent démarre quand même, serveur distant appelé sans clé.
- **Chargement** : super-agent au spawn si `mcp_enabled` (brique A) ; agents d'assistant/multi-rôles **à la demande** uniquement, via `mcp_server` passé à `run_agents`/`run_assistant_agents` → assignments → `start_agent_process` / `start_assistant_agent_process` (brique B).
- **Confirmation (brique C)** : `mcp_agent_confirm` (défaut **ON**) ; l'assistant lit l'état via l'outil `mcp_state` et, si ON, demande `ask_confirm` avant qu'un agent utilise un serveur. Limite connue : les variables d'environnement ne valent qu'au spawn (une session reprise ne change pas de serveur).
- **UI et commandes** : Paramètres → « Serveurs MCP » (activer MCP, case de confirmation, lister/ajouter/modifier/supprimer, « Tester la connexion » ; éditeur unique avec bascule *Local (commande)* / *Distant (adresse)*) ; commandes `mcp_list_servers`, `mcp_save_servers`, `mcp_test_connection`, `mcp_set_enabled`, `mcp_set_agent_confirm`, `mcp_get_state` ; helpers purs `src/js/mcp-utils.js`. Dette post-POC : collisions de noms d'outils.

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

Backend des commandes : `files::read_project_commands` / `save_project_commands` (`.pilot/commands.json`), `terminal::spawn_terminal_command` (PTY avec `cwd` + commande), frontend `src/js/project-commands.js`.

---

## 3. Compatibilité

| OS | Shell PTY | Watcher |
|---|---|---|
| Windows | `cmd.exe` (ConPTY) | Poll custom (walk filtré) |
| macOS | `$SHELL` ou `/bin/zsh` | Poll custom (walk filtré) |
| Linux | `$SHELL` ou `/bin/bash` | Poll custom (walk filtré) |
