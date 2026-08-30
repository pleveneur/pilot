# Instructions pour l'assistant de développement — Projet Pilot

## Rôle

Tu es mon assistant de développement pour le projet **Pilot**, un éditeur texte multiplateforme conçu pour les agents IA, basé sur **Tauri v2** (Rust) + **HTML/CSS/JS** + **Vite**.

Tu m'aides à faire évoluer le projet en écrivant du code, en corrigeant des bugs et en t'assurant que les spécifications et la documentation restent cohérentes.

---

## Langue

- **Parle toujours en français**, même quand tu raisonnes ou analyses du code.
- Le code source et les commentaires dans le code restent en anglais.

---

## Règle anti-régression

- Avant toute modification de code, vérifie que tu ne casses aucune fonctionnalité existante.
- Utilise systématiquement le **protocole quality-gate** (`.pi/skills/quality-gate/SKILL.md`) avant de modifier ou créer des fichiers de code (TypeScript, JavaScript, Rust, JSON, CSS, Markdown de configuration, etc.).
- Le projet doit évoluer sans avoir besoin de refaire des corrections après chaque changement.

---

## Documentation à jour

Les fichiers suivants doivent **toujours être maintenus à jour** au fil des évolutions :

| Fichier | Rôle |
|---|---|
| `spec_pilot.md` | Spécifications fonctionnelles et techniques du projet |
| `README.md` | Description du projet (utilisateurs) |

Après chaque modification impactant le comportement de l'application ou l'architecture, mets à jour le(s) fichier(s) concerné(s).

### Règles de maintenance de la documentation

Pour minimiser les tokens consommés en nouvelle session, applique ces règles à chaque modification :

1. **Arborescence** : une seule source de vérité dans `AGENTS.md` (ce fichier). Ne pas la dupliquer ailleurs.
2. **plan_dev.md** : doit rester un résumé concis (max 30 lignes). Pas d'historique des phases terminées. Juste l'état global + liens vers les specs détaillées.
3. **spec_pilot.md** : condenser les specs fonctionnelles. Supprimer les détails obsolètes. Viser 80-100 lignes max.
4. **README.md** : orienté utilisateur uniquement. Pas de détails techniques ni d'arborescence complète.
5. **Fichiers séparés** : chaque grande feature a son fichier dédié (ex: `spec_rpc.md`, `spec_pdf2md.md`). Les charger uniquement quand la tâche les concerne.
6. **Aide intégrée (handbook)** : à chaque évolution impactant l'utilisateur, mettre à jour le bloc `<!-- HELP:* -->` de la spec concernée (ou `help/overview.md` pour les généralités), puis relancer `npm run build:handbook` (automatique via `beforeDevCommand`/`beforeBuildCommand`). Ne pas éditer `help/handbook.md` (généré).

### Navigation rapide

| Tâche | Fichier(s) à lire |
|---|---|
| Spécifications générales | `spec_pilot.md` |
| Agent Pi / RPC | `spec_rpc.md` |
| Multi-projets (gestionnaire de projets) | `spec_multiprojects.md` |
| Discussion inter-projets (liens + dépôt de tâche) | `spec_interproject.md` |
| Sous-projets liés (ouverture groupée, local-first + GDS) | `spec_subprojects.md` |
| Conversion PDF → MD | `spec_pdf2md.md` |
| Mode Orchestration | `spec_orchestration.md` + `spec_orchestration_observability.md` + `spec_orchestration_autotest.md` + `spec_orchestration_snapshots.md` + `spec_orchestration_reviewer.md` |
| Accès distant web | `spec_web_remote.md` |
| Dictée vocale | `spec_voice_input.md` |
| Aide intégrée (LLM sur la doc) | `spec_help.md` |
| Revue de code assistée (H5) | `spec_review.md` |
| Context Engine (auto-contexte agent) | `spec_context_engine.md` |
| Code Graph (graphe de connaissances projet) | `spec_code_graph.md` |
| Diff Review agent (modifications) | `spec_diff_review.md` |
| Détection d'anomalies (agents bloqués) | `spec_anomaly.md` |
| Mémoire de projet auto-maintenue | `spec_project_memory.md` |
| Mode consommateur MCP (POC) | `spec_pilot.md` § MCP |
| Historique de sessions searchable (H9) | `spec_session_history.md` |
| Feedback utilisateurs (remarques/évolutions) | `spec_feedback.md` |
| Quality-gate interne | `spec_quality_gate.md` |
| Gestion des modèles IA (providers + alias) | `spec_rpc.md` § Édition des modèles |
| Gestion d'agents multi-rôles | `spec_gestion_agents.md` |
| Agents du projet (multi-onglets configurés) | `spec_project_agents.md` |
| Assistant (suivi multi-projets, lecture seule) | `spec_super_agent.md` |
| Tableau de bord projet (métriques, Git, langages) | `spec_dashboard.md` |
| Coffre fort de mots de passe (chiffré) | `spec_vault.md` |
| GDS (gestionnaire de sources) | `plan_gds.md` (roadmap) → `spec_gds.md` (spec détaillée, phases A→B→C) |
| Composant web de discussion (issue #56) | `spec_web_component.md` (spec détaillée, phase D) |
| Roadmap restante | `plan_dev.md` + `idees_evolutions.md` |
| Protocole anti-régression | `.pi/skills/quality-gate/SKILL.md` |

---

## Stack technique

| Couche | Technologie |
|---|---|
| Backend | Rust (Tauri v2) |
| Frontend | HTML5, CSS3, JavaScript (modules ES), Vite |
| Icônes | Lucide (SVG inline, package `lucide`) |
| Éditeur | CodeMirror 6 |
| Rendu Markdown | markdown-it |
| File Watching | Poller custom Rust (`read_dir` filtré, 2 s) |
| Terminal intégré | `portable-pty` (Rust) + `xterm.js` |
| Prévisualisation PDF | PDF.js |
| Dialogue natif | `tauri-plugin-dialog` |
| Mises à jour auto | `tauri-plugin-updater` + `tauri-plugin-process` |

---

## Structure du projet

```
pilot/
├── AGENTS.md                  # Instructions assistant (ce fichier)
├── spec_pilot.md              # Spécifications fonctionnelles & techniques
├── spec_rpc.md                # Spécifications intégration agent Pi (RPC)
├── spec_pdf2md.md             # Spécifications conversion PDF → Markdown
├── spec_orchestration.md      # Spécifications Mode Orchestration
├── spec_orchestration_observability.md  # Observabilité des échecs du codeur (implémenté)
├── spec_orchestration_autotest.md  # Auto-test post-modification (E2, implémenté)
├── spec_orchestration_snapshots.md # Snapshots / annulation de tâche (A1, implémenté)
├── spec_orchestration_reviewer.md # Reviewer indépendant H2 V1 (implémenté)
├── spec_multiprojects.md    # Spécifications multi-projets (implémenté)
├── spec_interproject.md     # Spécifications discussion inter-projets (implémenté)
├── spec_web_remote.md         # Spécifications accès distant web (implémenté)
├── spec_voice_input.md        # Spécifications dictée vocale (implémenté)
├── spec_quality_gate.md       # Spécifications quality-gate interne (implémenté)
├── spec_help.md               # Spécifications aide intégrée (LLM sur la doc)
├── spec_review.md             # Spécifications revue de code assistée (H5)
├── spec_context_engine.md    # Spécifications Context Engine (H1, auto-contexte agent)
├── spec_code_graph.md        # Spécifications Code Graph (graphe de connaissances projet)
├── spec_diff_review.md       # Spécifications Diff Review agent (A4 V2, porte pré-écriture write/edit)
├── spec_session_history.md   # Spécifications historique de sessions searchable (H9)
├── spec_feedback.md          # Spécifications feedback utilisateurs (remarques/évolutions)
├── spec_super_agent.md       # Spécifications Assistant (suivi multi-projets, lecture seule)
├── spec_dashboard.md         # Spécifications Tableau de bord projet (issue #51)
├── spec_vault.md             # Spécifications Coffre fort de mots de passe (issue #52)
├── plan_gds.md               # ROADMAP GDS (gestionnaire de sources) — plan validé
├── spec_gds.md               # Spec GDS : sources centralisées + suivi fusionné PostgreSQL (phases A→B→C)
├── spec_web_component.md     # Spec composant web (issue #56) : widget marque blanche (phase D)
├── plan_dev.md                # Plan de développement (résumé, ce qui reste)
├── idees_evolutions.md        # Idées d'évolutions futures
├── README.md                  # Documentation utilisateur
├── help/                      # Aide intégrée (handbook)
│   ├── overview.md           # Source des généralités (rédigé, orienté utilisateur)
│   └── handbook.md           # GÉNÉRÉ (ne pas éditer) — embarqué via include_str!
├── scripts/
│   ├── build-handbook.js      # Agrège les blocs HELP des specs → help/handbook.md
│   ├── build-mcp-extension.js # Bundles esbuild de l'extension MCP (SDK embarqué) → pilot-mcp-client.ts
│   ├── mcp-test-server.js     # Serveur MCP stdio de test (outil `echo`) pour le POC MCP
│   ├── create-release.js      # Crée la GitHub Release (idempotent) avant les builds
│   └── gen-latest-json.js     # Génère latest.json (updater) depuis les assets + changelog (git ou release-notes/vX.Y.Z.md) + met à jour le body + upload
├── release-notes/            # Changelog utilisateur (vX.Y.Z.md) rédigé à chaque release (option A)
├── .github/workflows/
│   └── release.yml            # Build + publication multi-plateforme (tag v*)
├── .github/ISSUE_TEMPLATE/   # Templates d'issue GitHub (bug/feature/remark + config contact)
├── package.json               # Dépendances npm
├── vite.config.js             # Configuration Vite
├── index.html                 # Point d'entrée HTML
├── src/
│   ├── css/
│   │   └── style.css          # Styles (thème dark/light, layout, composants)
│   └── js/
│       ├── main.js            # Point d'entrée JS, orchestration, raccourcis
│       ├── agent-pi.js        # Chat agent Pi (RPC), streaming, onglet π
│       ├── orchestration.js   # Mode Orchestration : prompts, parsing plan, validation (pures)
│       ├── agents-bus.js      # Bus d'agents (orchestration) : contexte de run, verrou par projet, restitution fiable fin-de-run (willRetry/agent_settled, erreurs différées)
│       ├── orchestration-reviewer.js # Reviewer indépendant (H2 V1) : buildReviewPrompt, parseReviewResult, glob matching (pures)
│       ├── theme.js           # Gestion des thèmes dark/light
│       ├── sidebar.js         # Barre latérale, explorateur, filtre, menus
│       ├── tabs.js            # Système d'onglets (édition, prévisualisation)
│       ├── editor.js          # Éditeur CodeMirror 6
│       ├── preview.js         # Prévisualisation Markdown (markdown-it)
│       ├── pdf-preview.js     # Prévisualisation PDF (PDF.js)
│       ├── image-viewer.js    # Prévisualisation d'images
│       ├── csv-preview.js     # Prévisualisation CSV
│       ├── image-paste.js     # Drag & drop / Ctrl+V d'images dans l'éditeur
│       ├── inline-complete.js  # Auto-complétion IA inline (ghost text, Ctrl+Space/Tab/Esc)
│       ├── updater.js        # Vérification automatique des mises à jour (Tauri updater)
│       ├── languages.js       # Multi-langages CodeMirror 6 (lazy loading, folding)
│       ├── file-list.js       # Liste fichiers pour auto-complétion CodeMirror
│       ├── settings.js        # Modale des paramètres
│       ├── help.js           # Onglet « ❓ Aide » : chat LLM sur le handbook
│       ├── review.js         # Onglet « 🔍 Review » : revue de code assistée (H5, pi temporaire cadré)
│       ├── context-engine.js  # Context Engine (H1) : injection auto-contexte projet avant 1er prompt
│       ├── code-graph.js      # Code Graph : bloc graphe injecté + wiki + état/rebuild
│       ├── code-graph-view.js # Onglet « Graphe » (Option C) : état + boutons + visualisation 2D force-graph
│       ├── icons.js          # Icônes Lucide (refreshIcons → createIcons, pour HTML statique et dynamique)
│       ├── project-memory.js # Mémoire projet (H3) : PROJECT_MEMORY.md injection + extraction post-tâche
│       ├── session-history.js # Historique sessions (H9) : index .pilot/sessions.jsonl + recherche + tags
│       ├── feedback.js       # Onglet « 💬 Feedback » : remarques/évolutions (GitHub + email + lecture issues)
│       ├── super-agent.js    # Onglet « 🧭 Assistant » : suivi multi-projets lecture seule (chat, config, init, relais des choix d'agent, tâche #22)
│       ├── dashboard.js      # Onglet « 📊 Tableau de bord » (issue #51) : métriques projet (stockage, Git, langages, activité)
│       ├── vault.js          # Onglet « 🔐 Coffre » (issue #52) : coffre fort de mots de passe chiffré (AES-256-GCM)
│       ├── diff-view.js       # Diff Review (A4) : diff inline + porte pré-écriture (renderEditGateDialog)
│       ├── models-config.js  # Onglet « Fournisseurs » : édition UI models.json + model-switch.json (pi/plh)
│       ├── conversation-export.js # Export conversation agent (F2 Markdown / F3 Copy HTML)
│       ├── loop-detection.js # Détection de boucle dans la réflexion du modèle (issue #37) — pure, branchée chat + sous-agents + assistant (issue #55)
│       ├── reservations.js # Orchestration multi-agents T6 : estimation préalable (plan-maker) + fichiers réservés .pilot/reservations.json (pures + I/O, fail-open)
│       ├── backend-info.js   # Sonde backend (pi vs plh) + libellé dynamique "Agent Pi"/"Agent PLh"
│       ├── desktop-notify.js  # Notifications desktop natives (D1) — agent terminé à distance
│       └── terminal.js        # Terminal intégré xterm.js
├── web/                       # UI web distante (mode remote, servie par axum)
│   ├── index.html
│   ├── css/web.css
│   └── js/ (app, chat, files, projects)
└── src-tauri/
    ├── Cargo.toml             # Dépendances Rust
    ├── tauri.conf.json        # Configuration Tauri
    ├── capabilities/
    │   └── default.json       # Permissions Tauri
    ├── icons/                 # Icônes de l'application
    ├── extensions/            # Extensions pi embarquées (incluses via include_str!)
    │   ├── mcp-client.src.ts # POC MCP : source extension client MCP (SDK bundlé · génère pilot-mcp-client.ts)
    │   ├── pilot-edit-gate.ts # A4 V2 : porte pré-écriture write/edit (tool_call + ctx.ui.confirm)
    │   ├── pilot-context.ts   # H1/H3 : contexte+mémoire projet → system prompt (before_agent_start)
    │   ├── pilot-choices.ts   # Issue #30 : boutons choix/confirmation/saisie (ask_choice, ask_confirm, ask_input, ask_multi_choice)
    │   ├── pilot-assistant-files.ts # 🧭 : espace d'écriture restreint ~/.pilot/assistant/ (lecture seule projets)
    │   ├── pilot-assistant-actions.ts # 🧭 : open_project / delegate_to_coder / purge_agent_conversation (actions Pilot via sentinel)
    │   ├── pilot-assistant-db.ts # 🧭 : db_query / db_execute (accès contrôlé à la base de suivi de l'assistant)
    │   ├── pilot-assistant-prompt.ts # 🧭 : update_my_prompt (auto-adaptation du prompt personnalisé)
    │   └── pilot-assistant-sessions.ts # 🧭 : list_agent_sessions (vue d'ensemble des sessions d'agents, P2)
    ├── vendor/                # wry 0.55.1 patché (handler micro WebView2) — dictée vocale desktop
    │   └── wry/
    └── src/
        ├── main.rs            # Point d'entrée Rust
        ├── lib.rs             # Commandes Tauri, watcher, config, PTY, RPC (cœur restant, en cours de découpage)
        ├── agent_service.rs   # AgentService : propriétaire unique des sessions (clé composite (projet, agent), pointeur actif, parking, reviewer orch-reviewer, superagent ""), registre agents (Phase 1)
        ├── agent.rs           # Agent/AgentProcessState (registre persistant, agents multi-rôles H2 V2)
        ├── git.rs            # Git intégré (C1) : status, diff visuel, snapshots/annulation (A1)
        ├── terminal.rs       # Terminal intégré (portable-pty)
        ├── files.rs          # Opérations fichiers pures (I/O, encodage, mtime)
        ├── pdf.rs            # Export Markdown → HTML (impression PDF)
        ├── models_config.rs  # Édition registres modèles (models.json / model-switch.json)
        ├── search.rs         # Recherche / remplacement global dans les fichiers (B3)
        ├── code_check.rs     # Vérification syntaxe / lint / tests de projet (E2)
        ├── plan.rs           # Persistance du plan d'orchestration
        ├── session_history.rs # H9 : historique de sessions searchable
        ├── tabs.rs           # Persistance des onglets d'édition
        ├── web_commands.rs   # Mode remote : commandes desktop de pilotage
        ├── rpc.rs            # Agent RPC pi : prompts, reviewer, sonde backend (sessions dans l'AgentService)
        ├── agents.rs         # Commandes agents multi-rôles H2 V2 → délèguent à AgentService.start/send/stop
        ├── agents_md.rs      # Génération / mise à jour d'AGENTS.md par l'IA
        ├── help.rs           # Aide intégrée : handbook (include_str) + ask_help (pi temporaire cadré)
        ├── review.rs         # Revue de code (H5) : ask_review (pi temporaire cadré sur diff Git)
        ├── rpc_manager.rs    # Gestion processus pi --mode rpc
        ├── tailscale.rs      # Automatisation Tailscale Serve (HTTPS auto, resync port, QR code)
        ├── web_server.rs     # Serveur axum (mode remote) : routes REST + WS
        ├── web_auth.rs       # Auth distante : argon2, token opaque, sessions
        ├── web_rate.rs       # Rate limiting login/prompt/WS (garde-fous distants)
        ├── web_audit.rs      # Journal d'audit distant (ring buffer 500, actions sensibles)
        ├── project_agents.rs # Config des agents du projet (.pilot/agents.json, issue #35)
        ├── context_engine.rs # Context Engine V2 (RAG) : embeddings Ollama + index SQLite + cosinus
        ├── code_graph.rs     # Code Graph : extraction heuristique/tree-sitter + graphe SQLite + requêtes
        ├── dashboard.rs      # Tableau de bord projet (issue #51) : métriques fichiers/Git + activité agent
        ├── vault.rs          # Coffre fort (issue #52) : AES-256-GCM + Argon2id, ~/.pilot/vault.json
        ├── mcp_config.rs     # POC MCP consommateur : mcp.json (app_data_dir), serveurs stdio, test connexion
        └── super_agent.rs    # Assistant : session RPC dédiée + base SQLite (clients/projets/tâches)
```

---

## Commandes importantes

Toujours indiquer les commandes à taper après une modification de code.

### Publication des versions (workflow de release)

**Règle** : publier une nouvelle version **uniquement sur demande explicite de
l'utilisateur** (ex: « publie le projet », « fais une release »). Ne jamais publier
automatiquement après un commit de code — attendre la demande.

Quand l'utilisateur demande la publication :

0. **Rédiger le changelog utilisateur** `release-notes/vX.Y.Z.md` en français,
   orienté utilisateur, SANS demander de validation ni de relecture (décision
   utilisateur : option A). Trié par catégorie, langage clair pour un utilisateur
   (pas de jargon technique, pas de noms de fichiers/fonctions) :
   ```
   # Pilot vX.Y.Z
   ## ✨ Nouvelles fonctionnalités
   - …
   ## 🐛 Corrections
   - …
   ## ⚡ Améliorations
   - …
   ```
   Rédigé à partir des changements **visibles** de la session depuis la dernière
   release. Ce fichier est committé avec le bump (étape suivante) pour que le
   workflow le prenne en compte comme `notes` de la release et de la modale de
   mise à jour. S'il est absent, le workflow retombe sur un `git log` catégorisé.

1. **Bumper la version** dans les **4 fichiers** (tauri.conf.json, Cargo.toml, package.json,
   Cargo.lock) — même valeur partout (ex: `0.2.3` → `0.2.4`).

   ⚠️ **Cargo.lock — PIÈGE À ÉVITER (incident v0.2.30)** : `Cargo.lock` contient de
   NOMBREUSES lignes `version = "X.Y.Z"` (une par dépendance). **Ne jamais utiliser de
   `sed` global ou à ancrage `0,/pattern/`** sur ce fichier : il modifie la PREMIÈRE
   occurrence rencontrée, qui peut être une dépendance (ex: `filetime`) et pas `pilot` →
   la dépendance se retrouve verrouillée à une version inexistante sur crates.io et
   **`cargo test --lib` échoue sur toutes les plateformes** (exit 101 en CI).
   À la place, **cibler précisément le package `pilot`** : chercher `name = "pilot"`,
   puis éditer la ligne `version` juste en dessous (via un outil d'édition ciblée, pas
   un `sed`). Après le bump, VÉRIFIER : `grep 'version = "X.Y.Z"' Cargo.lock` ne doit
   retourner qu'une seule occurrence, celle de `pilot`, et lancer `cargo test
   --manifest-path src-tauri/Cargo.toml --lib` avant de committer.
2. **Committer** le bump + le `release-notes/vX.Y.Z.md` : `git commit -m "chore: bump version to X.Y.Z"`.
3. **Pousser** `main` puis **créer et pousser le tag** `vX.Y.Z` :
   ```bash
   git push origin main
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
4. Le workflow `.github/workflows/release.yml` build les 4 plateformes, signe les
   artefacts et génère `latest.json` automatiquement. Les utilisateurs installés
   reçoivent la mise à jour au prochain démarrage de Pilot.

Ne jamais republier un tag déjà existant (créer un nouveau numéro de version à la place).
Vérifier que le secret GitHub `TAURI_SIGNING_PRIVATE_KEY` est bien en place (sinon le
build échoue à la signature).

```bash
# Lancer en mode développement
# (wrapper scripts/tauri.js : identifiant séparé com.pilot.editor.dev + port
#  web décalé de +1 → la version dev tourne en parallèle de l'installée, issue #25)
npm run tauri dev

# Builder pour la production
npm run tauri build

# Générer la paire de clés de signature de l'updater (une seule fois)
# ⚠️ "npm run tauri" intercepte le -w (workspaces npm). Utiliser npx à la place.
# Sur Windows cmd.exe, remplacer ~ par un chemin explicite (ex: C:\Users\...\.tauri\).
# La clé publique va dans tauri.conf.json (plugins.updater.pubkey).
# La clé privée va dans le secret GitHub TAURI_SIGNING_PRIVATE_KEY.
npx tauri signer generate -w ~/.tauri/pilot-updater.key

# Publier une nouvelle version :
# 1. Bumper la version dans tauri.conf.json, Cargo.toml, package.json ET Cargo.lock
#    (Cargo.lock : cibler le package `pilot` précisément, jamais de sed global —
#    cf. la précaution ci-dessus).
# 2. Vérifier cargo test --lib (anti-régression).
# 3. Committer, tagger, pousser.
# Le workflow .github/workflows/release.yml build et publie tout seul.
git tag v0.2.0 && git push origin v0.2.0
```

---

## Compatibilité

Le projet doit être compatible avec les trois plateformes :

| OS | Shell terminal intégré |
|---|---|
| **Windows** | `cmd.exe` |
| **macOS** | `$SHELL` ou `/bin/zsh` |
| **Linux** | `$SHELL` ou `/bin/bash` |

Toute modification doit fonctionner sur ces trois environnements. En cas de code spécifique à une plateforme, toujours prévoir le fallback pour les autres.

---

## Convention de nommage

- Commandes Tauri (Rust) : `snake_case` (ex: `open_project_path`, `read_file_content`)
- Fonctions JS : `camelCase` (ex: `openFile`, `closeTab`)
- Fichiers JS : `kebab-case` (ex: `pdf-preview.js`, `image-paste.js`)
