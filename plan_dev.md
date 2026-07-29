# Plan de Développement — Pilot

## Statut global

**Phases 1 à 10 : ✅ Terminées.** Le projet est fonctionnel et complet.

## En cours

*Gestion d'agents multi-rôles (H2 V2)* — onglet **🎭 Agents** : registre global `~/.pilot/agents.json`, coordinateur + agents spécialisés (architecte, codeur, reviewer, testeur, documenteur), protocole séquentiel `[[CALL:agent_id]]`, bus frontend, garde-fous (profondeur, budget, cycle, timeout), sélection automatique du modèle selon le backend (`pi` vs `plh`). Voir [`spec_gestion_agents.md`](spec_gestion_agents.md) et [`plan_gestion_agents.md`](plan_gestion_agents.md).

## Dernière fonctionnalité livrée

| Domaine | Fichier | Statut |
|---|---|---|
| Mode Orchestration V3 | [`spec_orchestration.md`](spec_orchestration.md) | ✅ Implémenté (2026-07-29) — Triptyque Réfléchir/Faire/Contrôler (SELF_FIX in-session), 3 tentatives, vérification finale par le codeur, contrôles utilisateur par tâche, batch désactivé par défaut, métriques temps réel |
| Auto-test post-modification (E2) | [`spec_orchestration_autotest.md`](spec_orchestration_autotest.md) | ✅ Implémenté (2026-07-29) — extension du linting-in-the-loop : exécution des tests du projet après chaque tâche (npm/cargo/pytest/go), boucle SELF_FIX sur les échecs, baseline paresseuse pour ignorer les tests déjà rouges, portée hybride (ciblé par tâche + complet en vérification finale), opt-in, override manuel, commande `run_project_tests` (Rust, sans shell, timeout impératif), observabilité étendue (bloc 🧪 dans le journal) |
| Snapshots / annulation de tâche (A1) | [`spec_orchestration_snapshots.md`](spec_orchestration_snapshots.md) | ✅ Implémenté (2026-07-29) — `git stash create -u` avant chaque tâche (snapshot non-référencé), bouton ↩️ « Annuler la dernière tâche » dans le panneau (restaure les `changedFiles` via `git checkout <sha>` + suppression des fichiers créés), défaut activé, échec gracieux si non-Git, dépend de C1 |
| Reviewer indépendant (H2 V1) | [`spec_orchestration_reviewer.md`](spec_orchestration_reviewer.md) | ✅ Implémenté (2026-07-29) — 2e session pi `--no-session` (contexte vierge, canal `rpc-event-reviewer` séparé) relit le diff de chaque tâche après tests E2, `APPROVED`/`CHANGES_REQUESTED`, scope paramétrable (`all`/`critical` + globs éditables), opt-in (défaut off), budget unifié (`maxCorrections`), fallback gracieux (crash/timeout → validation sans review), modèle reviewer configurable (défaut = orchestrateur), badges 🔍 dans le journal, 7 commandes Tauri dédiées, pose l'architecture multi-sessions pour H2 V2 |
| Automatisation Tailscale Serve | [`spec_web_remote.md`](spec_web_remote.md) §14 | ✅ Implémenté (2026-07-11) — proxy HTTPS 443 auto, resync port, URL + QR code (opt-in) |
| Aide intégrée (❓) | [`spec_help.md`](spec_help.md) | ✅ Implémenté (2026-07-11) — Niveau 1 Option A : chat LLM sur handbook généré depuis les specs (blocs HELP), process pi temporaire cadré, isolé de l'agent de coding |
| Quality-gate interne | [`spec_quality_gate.md`](spec_quality_gate.md) | ✅ Implémenté (2026-07-11) — bouton 🛡️ dans la toolbar agent, skill embarqué via `--skill`, persistance config, relance immédiate de l'agent |
| Observabilité orchestration | [`spec_orchestration_observability.md`](spec_orchestration_observability.md) | ✅ Implémenté (2026-07-13) — journal des tentatives du codeur par tâche (marqueur, raison, durée, bouclage), bloc repliable dans le panneau d'orchestration, synthèse dans les messages système |
| Context Engine (H1 V1) | [`spec_context_engine.md`](spec_context_engine.md) | ✅ Implémenté (2026-07-19) — injection auto-contexte projet avant le 1er prompt de chaque session agent (AGENTS.md, fichier actif, imports, manifestes, specs, recents), budget tokens configurable, bouton 📑, V1 heuristique |
| Diff Review agent (A4 V2) | [`spec_diff_review.md`](spec_diff_review.md) | ✅ Implémenté — porte pré-écriture : extension pi `pilot-edit-gate` bloque write/edit avant exécution, diff Accepter/Refuser (Refuser = fichier intact), paramètre `confirm_file_edits` (défaut off), auto-approve en orchestration |
| Mémoire de projet (H3 V1) | [`spec_project_memory.md`](spec_project_memory.md) | ✅ Implémenté — `PROJECT_MEMORY.md` tenu par l'agent (conventions, pièges, décisions), injecté avant chaque tâche (orchestration) et 1er prompt (chat), extraction auto opt-in après tâche d'orchestration, bouton 📝 |
| Git intégré (C1) | [`spec_review.md`](spec_review.md) | ✅ Implémenté (2026-07-29) — badges de statut Git dans l'explorateur (CLI `git status --porcelain`) + diff visuel read-only (`git_diff_file`, réutilise `diff-view.js`) |
| Health check pi (E4) | — | ✅ Implémenté (2026-07-29) — sonde `--version` au démarrage + gate gracieuse dans l'onglet agent (écran « π indisponible ») + toast |
| Historique de sessions (H9) | [`spec_session_history.md`](spec_session_history.md) | ✅ Implémenté (2026-08-01) — onglet 📜 : index local `.pilot/sessions.jsonl` (append) + tags `.pilot/sessions-tags.json`, recherche full-text/regex + filtres tag/file/kind, détail (relecture JSONL pi), tags éditables, rétro-indexation auto à la 1re ouverture (lecture du dossier de sessions pi), capture live à l'agent_end (chat standard). 6 commandes Tauri (`index_sessions`, `search_sessions`, `get_session_detail`, `set_session_tags`, `list_session_tags`, `record_session_entry`). Ne dépend pas de pi (consultable hors-ligne). Complément de H3 (faits) et H1 (contexte) |
| Revue de code assistée (H5) | [`spec_review.md`](spec_review.md) | ✅ Implémenté (2026-07-29) — onglet 🔍 Review : second reviewer sur `git diff` (working tree / dernier commit), pi temporaire cadré lecture seule, revue structurée + questions de suivi |

## Roadmap retenue (décision 2026-07-30)

Pôle **agent IA** consolidé en priorité. H6 (routing) et H10 (MCP) reportés.

| # | Feature | Statut | Spec / détail |
|---|---|---|---|
| 1 | **H2 V2** — Gestion d'agents multi-rôles (séquentiel) | 🔄 En cours | `spec_gestion_agents.md` · onglet 🎭 Agents, registre `~/.pilot/agents.json`, coordinateur + sous-agents, protocole `[[CALL:...]]` |
| 2 | **D1** — Notifications desktop « agent terminé à distance » | ✅ Implémenté (2026-07-30) | `idees_evolutions.md` §D1 · plugin `tauri-plugin-notification`, déclenché à l'`agent_end` si prompt d'origine web |
| 3 | **H1 V2** — Context Engine embeddings/RAG local (Ollama + SQLite) | ✅ Implémenté (2026-07-30) | `spec_context_engine.md` §7 · `context_engine.rs` (chunking + cosinus + SQLite WAL), fallback V1 auto, build lazy + refresh incrémental, UI Paramètres (adresse/port/modèle + test) |
| 3 | **H9** — Historique de sessions searchable (mémoire des décisions) | ✅ Implémenté (2026-08-01) | `.pilot/sessions.jsonl` (append) + `.pilot/sessions-tags.json` + full-text/regex search + filtres tag/file/kind + détail (relecture JSONL pi) + tags éditables + rétro-indexation auto (1re ouverture) + capture live (agent_end chat). Voir [`spec_session_history.md`](spec_session_history.md). Complément de H3 (faits) et H1 (contexte) |
| 5 | **H7** — Mode « Projet sensible » (local-first garanti, badge 🔒) | À faire (effort faible) | refuse tout routing cloud, dictée via fallback local. `idees_evolutions.md` §H7 |
| 5 | **H2 V2** — Multi-codeurs spécialisés en **parallèle** | À faire | architecture `rpc-event-reviewer` (confirmée) → N sub-agents (test-writer, doc-writer, refactorer), chacun avec un `system` de rôle. `spec_orchestration.md` |
| 6 | **H6** — Routing multi-modèle intelligent | Reporté (sauf si indispensable pour H2 V2) | `idees_evolutions.md` §H6 |
| 7 | **H10** — MCP / tools extensibles | Reporté (plus tard) | `idees_evolutions.md` §H10 |

## Compléments éditeur / robustesse (à faire un jour, en parallèle quand on touche aux fichiers)

| # | Feature | Statut | Détail |
|---|---|---|---|
| B1 | Multi-curseurs | ✅ Implémenté (2026-08-02) | `EditorState.allowMultipleSelections.of(true)` dans `editor.js` — Alt+clic ajoute un curseur, `Mod-d` sélection suivante (déjà branché) |
| B2 | Lint diagnostics inline | ✅ Implémenté (2026-08-02) | `@codemirror/lint` + commande Rust `lint_file` (eslint `--format json`, JS/TS V1, debounce 1.2s, silencieux si absent), module `src/js/editor-lint.js` |
| B3 | Find & Replace | ✅ Implémenté (2026-08-02) | Ligne de remplacement dans le panneau de recherche (`search-replace-row`), commande Rust `replace_in_files` (remplacement littéral ou regex via `NoExpand`), aperçu+confirmation, rechargement des onglets ouverts concernés |
| F1 | Export HTML autonome | ✅ Implémenté (2026-08-02) | `src/js/html-export.js` : réutilise `export_pdf` (HTML complet) + résolution images en base64 + dialogue de sauvegarde natif. Item « Exporter en HTML » dans le menu contextuel (fichiers .md) |
| C4 | Recent files popover | ✅ Implémenté (2026-08-02) | `Ctrl+Alt+R` ou palette — popover fuzzy, `src/js/recent-files.js` (historique par projet dans localStorage, max 20, dédoublonné), enregistré à chaque `openFile` |
| F2 | Export conversation agent | À faire | |
| F3 | Copy as HTML | À faire | |
| E3 | CI multi-plateforme RPC | À faire | |
| 22 | Conflits fichiers (diff/reload) | À faire | réutilise A4 |

## Ce qui reste (specs détaillées)

| Domaine | Fichier |
|---|---|
| Agent Pi (RPC) | [`spec_rpc.md`](spec_rpc.md) — section « Reste à faire » |
| Conversion PDF → MD | [`spec_pdf2md.md`](spec_pdf2md.md) |
| Idées complètes (avec verdicts) | [`idees_evolutions.md`](idees_evolutions.md) |

## Commandes

```bash
npm run tauri dev    # Développement
npm run tauri build  # Production
```

---

*Dernière mise à jour : 2026-07-30*

| Granularité atomic + overrides session | `spec_orchestration.md` §19 | ✅ Implémenté (2026-07-30) — 4e niveau de finesse `atomic` (~10-25 lignes, 1 fichier, modèle local) ; écran d'activation enrichi : granularité + reviewer sélectionnables (overrides session non persistés) |
