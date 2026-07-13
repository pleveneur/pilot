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
| Conversion PDF → MD | `spec_pdf2md.md` |
| Mode Orchestration | `spec_orchestration.md` |
| Accès distant web | `spec_web_remote.md` |
| Dictée vocale | `spec_voice_input.md` |
| Aide intégrée (LLM sur la doc) | `spec_help.md` |
| Quality-gate interne | `spec_quality_gate.md` |
| Roadmap restante | `plan_dev.md` + `idees_evolutions.md` |
| Protocole anti-régression | `.pi/skills/quality-gate/SKILL.md` |

---

## Stack technique

| Couche | Technologie |
|---|---|
| Backend | Rust (Tauri v2) |
| Frontend | HTML5, CSS3, JavaScript (modules ES), Vite |
| Éditeur | CodeMirror 6 |
| Rendu Markdown | markdown-it |
| File Watching | crate `notify` (PollWatcher) |
| Terminal intégré | `portable-pty` (Rust) + `xterm.js` |
| Prévisualisation PDF | PDF.js |
| Dialogue natif | `tauri-plugin-dialog` |

---

## Structure du projet

```
pilot/
├── AGENTS.md                  # Instructions assistant (ce fichier)
├── spec_pilot.md              # Spécifications fonctionnelles & techniques
├── spec_rpc.md                # Spécifications intégration agent Pi (RPC)
├── spec_pdf2md.md             # Spécifications conversion PDF → Markdown
├── spec_orchestration.md      # Spécifications Mode Orchestration
├── spec_web_remote.md         # Spécifications accès distant web (planifié)
├── spec_voice_input.md        # Spécifications dictée vocale (implémenté)
├── spec_quality_gate.md       # Spécifications quality-gate interne (planifié)
├── spec_help.md               # Spécifications aide intégrée (LLM sur la doc)
├── plan_dev.md                # Plan de développement (résumé, ce qui reste)
├── idees_evolutions.md        # Idées d'évolutions futures
├── README.md                  # Documentation utilisateur
├── help/                      # Aide intégrée (handbook)
│   ├── overview.md           # Source des généralités (rédigé, orienté utilisateur)
│   └── handbook.md           # GÉNÉRÉ (ne pas éditer) — embarqué via include_str!
├── scripts/
│   └── build-handbook.js      # Agrège les blocs HELP des specs → help/handbook.md
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
│       ├── languages.js       # Multi-langages CodeMirror 6 (lazy loading, folding)
│       ├── file-list.js       # Liste fichiers pour auto-complétion CodeMirror
│       ├── settings.js        # Modale des paramètres
│       ├── help.js           # Onglet « ❓ Aide » : chat LLM sur le handbook
│       └── terminal.js        # Terminal intégré xterm.js
├── web/                       # UI web distante (planifié, servie par axum)
│   ├── index.html
│   ├── css/web.css
│   └── js/ (app, chat, files, projects)
└── src-tauri/
    ├── Cargo.toml             # Dépendances Rust
    ├── tauri.conf.json        # Configuration Tauri
    ├── capabilities/
    │   └── default.json       # Permissions Tauri
    ├── icons/                 # Icônes de l'application
    └── src/
        ├── main.rs            # Point d'entrée Rust
        ├── lib.rs             # Commandes Tauri, watcher, config, PTY, RPC
        ├── help.rs           # Aide intégrée : handbook (include_str) + ask_help (pi temporaire cadré)
        ├── rpc_manager.rs     # Gestion processus pi --mode rpc
        ├── tailscale.rs      # Automatisation Tailscale Serve (HTTPS auto, resync port, QR code)
        ├── web_server.rs      # Serveur axum (mode remote) : routes REST + WS
        ├── web_auth.rs        # Auth distante : argon2, token opaque, sessions
        ├── web_rate.rs        # Rate limiting login/prompt/WS (garde-fous distants)
        └── web_audit.rs       # Journal d'audit distant (ring buffer 500, actions sensibles)
```

---

## Commandes importantes

Toujours indiquer les commandes à taper après une modification de code.

```bash
# Lancer en mode développement
npm run tauri dev

# Builder pour la production
npm run tauri build
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
