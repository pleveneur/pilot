# Spécifications — Pilot

> Spécifications fonctionnelles et techniques de l'éditeur Pilot.
> Pour l'architecture et la stack, voir `AGENTS.md`.

---

## 1. Interface

L'interface se divise en trois zones : **Barre Latérale** (gauche), **Zone de Travail** (droite), **Panneau d'Actions** (bas gauche).

### A. Barre Latérale

- **Sélecteur de projet** : bouton "Projets" avec dropdown (📁 Nouveau + 10 récents). Dossier = "Projet de l'Agent IA".
- **Arborescence** : tree view sans dossier racine, flèches ▶/▼, mise à jour temps réel (notify), drag & drop externe.
- **Filtre** : champ texte pour filtrer par nom, `Ctrl+P` pour focus.
- **Favoris** : section « ⭐ Favoris » en haut de l'arborescence, collapsible. Clic droit → Ajouter/Retirer des favoris. `Ctrl+Shift+B` pour le fichier actif. Persistance dans la config.
- **Menu contextuel** :
  - Fichier `.md` : Prévisualiser, Exporter PDF, Supprimer, Envoyer à l'agent Pi
  - Fichier `.pdf` : Prévisualiser, **Créer un fichier Markdown** (heuristiques + IA configurable), Supprimer
  - Fichier `.csv` : Prévisualiser CSV, Supprimer
  - Autre fichier : Supprimer, Envoyer à l'agent Pi
  - Dossier : Créer fichier, Créer dossier, Supprimer, Analyser ce dossier
  - Zone vide : Créer fichier, Créer dossier
- Suppression avec confirmation native, fermeture auto des onglets concernés.
- Persistance de l'expansion des dossiers après rafraîchissement.

### B. Zone de Travail

| Mode | Fichiers | Icône | Technologie |
|---|---|---|---|
| Édition | `.md`, `.js`, `.ts`, `.py`, `.rs`, `.json`, `.yaml`, `.html`, `.css`, `.sql`, `.java`, `.cpp`, `.xml`, `.php`… | 📝 | CodeMirror 6 (multi-langages via `languages.js`) |
| Split (éditeur + prévisualisation) | `.md` | 📝👁️ | CodeMirror 6 + markdown-it, `Ctrl+Shift+E` pour basculer |
| Prévisualisation Markdown | `.md` | 👁️ | markdown-it + Mermaid.js |
| Prévisualisation PDF | `.pdf` | 📕 | PDF.js |
| Prévisualisation image | `.png`, `.jpg`, `.gif`, `.webp`, `.svg` | 🖼️ | `<img>` + zoom/fit |
| Prévisualisation CSV | `.csv` | 📊 | Parseur JS + tableau HTML |
| Terminal intégré | — | 🖥️ | xterm.js + PTY |
| Agent Pi | — | π | RPC (voir `spec_rpc.md`) |
| Prompt Builder | — | 🧩 | Clic-droit → Ajouter + templates + envoi à Agent Pi |

- **Raccourcis Markdown** : `Ctrl+B` gras, `Ctrl+I` italique, `Ctrl+K` lien, `Ctrl+Shift+E` split view.
- **Recherche globale** : `Ctrl+Shift+F` ouvre un panneau de recherche full-text dans tous les fichiers du projet (regex + filtre par extension).
- **Outline** : `Ctrl+Shift+O` bascule la table des matières Markdown (headings cliquables, mise à jour en temps réel).
- **Palette de commandes** : `Ctrl+Shift+P` fuzzy search sur toutes les actions avec navigation clavier.
- **Navigation** : `Ctrl+G` aller à la ligne, `Ctrl+Tab`/`Ctrl+Shift+Tab` onglet suivant/précédent, `Ctrl+P` filtre fichiers, `Ctrl+Shift+S` enregistrer sous.
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

- ⚙️ **Paramètres** : modale en onglets verticaux (Général / Agent Pi / Modèles IA / Accès distant). Thème dark/light, commande défaut, auto-load projet, terminal intégré, params RPC (5 champs), renvoi à la ligne automatique (word wrap).
- 📂 **Explorateur** : ouvre le dossier projet dans l'explorateur OS.
- 🖥️ **Terminal** : intégré (xterm.js) ou externe selon paramètre.
- π **Agent Pi** : ouvre l'onglet agent (si RPC activé).

### D. Titre de fenêtre

- `Pilot` par défaut, `Pilot <chemin>` si projet ouvert.

### E. Design system & icônes

- **Design tokens CSS** : échelles partagées (`--space-*`, `--radius-*`, `--shadow-*`, `--ring`, `--transition*`) + ombres/anneaux de focus par thème (dark/light). Utilisés par tous les composants (modales, boutons, inputs, onglets, menu contextuel) pour un rendu cohérent et « pro ».
- **Icônes Lucide** (SVG inline, package `lucide`) : remplacent les emojis des boutons, titres, menu contextuel, arbre explorateur (fichiers/dossiers) et onglet agent (toolbar + mode Orchestration + micro/send). Tailles uniformes `.icon` (16px) / `.icon-sm` (14px) / `.icon-lg` (20px). Couleur = `currentColor` (suit le thème). Helpers dans `src/js/icons.js` : `refreshIcons(root?)` (rend toutes les `<i data-lucide>` d'un sous-arbre, après injection HTML), `setIcon(el, name)` (bouton à état, ex: abort/reconnect, dossier ouvert/fermé), `setIconText(el, name, text)` (item de menu = icône + libellé). **Icônes par type de fichier** (`sidebar.js`) : `FILE_ICONS` (map extension→icône, ex: `.md`→`file-text`, `.html`→`globe`, `.css`→`palette`, `.ts`→`file-code-2`, `.sh`→`file-terminal`, `.json`→`file-json`, `.yaml`→`braces`, `.env`→`file-key`, `.mp3`→`file-audio`, `.mp4`→`file-video`, `.exe`→`binary`, `.db`→`database`, `.log`→`file-clock`, `.diff`→`file-diff`…) + `FILE_NAMES` (noms complets sans extension ou multi-points, ex: `Dockerfile`→`box`, `Makefile`→`wrench`, `LICENSE`→`scroll-text`, `.env.local`→`file-key`). Résolution : nom complet → extension → défaut `file`. Lucide étant monochrome et sans logos de marque, les langages de programmation génériques partagent `file-code` ; seules les **familles fonctionnelles** sont distinguées. **Coloration par catégorie** : `ICON_CATEGORY` (map icône→catégorie) + helper `iconCategory()` posent une classe `icon-cat-<cat>` sur le wrapper `<span class='icon'>` de l'explorateur (dossiers, fichiers, favoris, projets récents uniquement — pas les boutons de l'agent qui restent neutres). CSS : tokens `--cat-*` par thème (palette Catppuccin Mocha/Latte, désaturée) + règles `.icon-cat-* { color: var(--cat-*) }`. Catégories : folder (ambré), doc (bleu), web (orange), style (violet), code (bleu-ciel), terminal (vert), data (jaune), config (gris), build (orange), secret (rouge), image (turquoise), media (rose), archive (orange foncé), binary (gris foncé), database (cyan), diag (gris), default (neutre). Le SVG Lucide utilisant `currentColor` pour son trait, la couleur posée sur le wrapper se propage à l'icône.

---

## 2. Spécifications Techniques

### File Watching
- Crate `notify` (PollWatcher, polling 2s) → événements Tauri `file-change`.
- Debounce 500ms + déduplication côté backend et frontend.

### PTY (Terminal intégré)
- `portable-pty` : ConPTY (Windows), PTY natif (macOS/Linux).
- Shell : `cmd.exe` / `$SHELL` ou `zsh` / `$SHELL` ou `bash`.
- Streaming via `terminal-output`, ResizeObserver, thème adaptatif.
- Copier/Coller contextuel : `Ctrl+C` copie si sélection, sinon SIGINT.

### Agent Pi (RPC)
- Processus `pi --mode rpc` lancé par `rpc_manager.rs`.
- Dialogue JSON/JSONL sur stdin/stdout, 15+ commandes Tauri.
- **Mode Orchestration** (voir [`spec_orchestration.md`](spec_orchestration.md)) : orchestrateur cloud + codeur local, planification en micro-tâches, édition chirurgicale `SEARCH/REPLACE`, linting-in-the-loop et directive globale.
- **Quality-gate interne** (voir [`spec_quality_gate.md`](spec_quality_gate.md)) : bouton 🛡️ dans la toolbar de l'agent → active un protocole anti-régression embarqué par Pilot (`--skill`), persistant (`quality_gate_enabled`), relance l'agent au clic.
- **Health check au démarrage** (E4) : Pilot sonde `<rpc_pi_path> --version` au lancement ; si l'exécutable est absent/injoignable, toast d'avertissement + gate dans l'onglet agent (écran « π indisponible » avec bouton « Ouvrir les paramètres » au lieu d'une session RPC qui planterait). Re-sonde automatique sur changement de chemin pi.
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
| Windows | `cmd.exe` (ConPTY) | PollWatcher |
| macOS | `$SHELL` ou `/bin/zsh` | PollWatcher |
| Linux | `$SHELL` ou `/bin/bash` | PollWatcher |
