# Plan de Développement — Pilot

## ✅ Clarifié (vérifié 2026-08) — RAG & injection de contexte avec PLh : rien à porter

Le bloc « Portage du Context Engine RAG vers PLh » ci-dessous était une **erreur de
formulation** (corrigée). Vérification faite sur `G:\IA_PL\PLh` :

1. **Le RAG ne vit pas dans l'agent (pi/plh), il vit dans Pilot.** C'est **Pilot**
   (`context_engine.rs`, embeddings Ollama + SQLite + cosinus) qui calcule le
   contexte, écrit `.pilot/context-inject.md`, et l'**injecte** via l'extension
   `pilot-context` (`before_agent_start` → `event.systemPrompt`). pi ne fait pas
   de RAG ; plh non plus n'en a pas besoin.
2. **L'injection Pilot fonctionne déjà avec PLh** : PLh supporte `--extension`
   (`crates/plh-cli/src/args.rs`, flag `-e`/`ext`) et le hook `before_agent_start`
   (`crates/plh-extensions/src/host.rs` `on_before_agent_start` + `shim.ts`
   `ctx.cwd`). La sonde `probe_extension_support` de Pilot (test `--help` →
   `--extension`) retourne donc `true` pour PLh → `pilot-context` est chargée →
   l'injection H1 (contexte) + H3 (mémoire) s'applique à pi **et** plh.
3. **PLh a déjà son propre RAG** (fait — `docs/rag.md`, crate `plh-rag`,
   commandes RPC `context_index_status` / `build_context_index` /
   `query_context_index`, config `~/.plh/agent/rag.json`, 13 tests, injection au
   1er prompt dans `loop.rs`). Le « portage » proposé est donc déjà réalisé.

**⚠️ Point de conception à surveiller (non bloquant)** : PLh peut injecter son
propre préambule RAG au niveau de sa boucle agent **ET** Pilot peut injecter le
sien via `pilot-context`. Si les deux RAG sont activés (Pilot `context_rag_enabled`
+ PLh `rag.enabled`), doublon possible (deux préambules, double coût Ollama).
Par défaut les deux sont `false` → pas de casse, mais à documenter si on les active
simultanément.

**Prochaine étape suggérée** : vérifier en pratique l'injection de contexte avec
PLh (prompt + `--extension pilot-context.ts` → le préambule doit arriver dans le
`systemPrompt`), puis décider du prochain chantier (voir roadmap ci-dessous).

---

## 🎯 Vision produit (orientation stratégique)

**Pilot → gestionnaire de projets** basé sur l'usage de **PLh** (ou **Pi**) comme
moteur d'agent.

Au-delà de l'éditeur de texte mono-projet actuel, Pilot vise à terme deux piliers :

1. **Gestionnaire de projets** — ouvrir **plusieurs projets simultanément**, chacun
   avec son propre agent (pi/plh), ses onglets, son état et son historique.
   *Réactive l'ancienne idée C2 (Workspace multi-projets), précédemment jugée
   « abandonnée » dans une optique mono-projet.*
2. **Gestionnaire de source** — intégrer la gestion de code source (via **git**
   ou un gestionnaire intégré) pour permettre le **développement multi-utilisateurs**.
   *Rejoint les briques déjà posées côté remote (accès web, supervision) — cf.
   `spec_web_remote.md`.*

### Implications pour la roadmap

- **Multi-projets** : chantier majeur (AppState multi-sessions, RPC séparé par
  projet, sidebar multi-onglets). Dépend fortement du découpage `lib.rs` déjà
  bien avancé.
- **Multi-utilisateurs** : chantier d'architecture (conflits, branches, droits,
  partage). S'appuie sur le web remote existant (`web_server.rs`, `web_auth.rs`).
- Ces deux piliers **réactivent des idées reportées** : D3 (WebAuthn), D4
  (partage read-only), et donnent un sens à H6 (routing) / H10 (MCP).

> **Note de cohérence** : la vision multi-utilisateurs redonne de la priorité à
> des items auparavant « reportés sine die » (D3, D4, et une partie du remote).
> La roadmap ci-dessous marque ces changements de priorité.

---

## Statut global

**Phases 1 à 10 : ✅ Terminées.** Le projet est fonctionnel et complet.

## En cours

*Gestion d'agents multi-rôles (H2 V2)* — onglet **🎭 Agents** : registre global `~/.pilot/agents.json`, coordinateur + agents spécialisés (architecte, codeur, reviewer, testeur, documenteur), protocole séquentiel `[[CALL:agent_id]]`, bus frontend, garde-fous (profondeur, budget, cycle, timeout), sélection automatique du modèle selon le backend (`pi` vs `plh`). Voir [`spec_gestion_agents.md`](spec_gestion_agents.md) et [`plan_gestion_agents.md`](plan_gestion_agents.md).

## Dernière fonctionnalité livrée

| Domaine | Fichier | Statut |
|---|---|---|
| Discussion inter-projets (H12/#15) | [`spec_interproject.md`](spec_interproject.md) | ✅ Implémenté (2026-08) — liaison persistée de projets (`project_links`), dépôt d'une tâche/analyse dans `cible/.pilot/handoffs/`, ouverture+activation de la cible, lancement de son agent et prompt de traitement, projet source en lecture seule (consigne). Modale 🔗 (lier/unlier/envoyer). 4 commandes Tauri (`get_project_links`, `set_project_links`, `remove_project_link`, `interproject_handoff`). Bouton 🔗 dans la barre d'actions |
| Indicateur d'activité par projet (#13) | [`spec_multiprojects.md`](spec_multiprojects.md) §6.7 | ✅ Implémenté (2026-08) — pastille animée dans la barre « Projets en cours » (agent occupé/en attente), y compris pour un agent parké qui travaille en arrière-plan. Observateur RPC `agent_start`/`agent_settled` → map `agent_activity`, commande `get_project_agent_states`, polling 2 s côté frontend |
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

## Roadmap retenue (décision 2026-07-30, mise à jour 2026-08)

Pôle **agent IA** consolidé en priorité. H6 (routing) et H10 (MCP) reportés.

### Vision — piliers stratégiques (à terme, cf. section « Vision produit » ci-dessus)

| # | Pilier | Statut | Spec / détail |
|---|---|---|---|
| V1 | **Gestionnaire de projets multi-projets** — ouvrir plusieurs projets simultanément, un agent pi/plh par projet | ✅ V1 implémentée | Réactive C2 · [`spec_multiprojects.md`](spec_multiprojects.md) · AppState multi-projets (adaptateur progressif), barre « Projets en cours » (sans doublon dans le dropdown), bascule/fermeture, session pi par projet, web-remote select. N agents simultanés = évolution future |
| V2 | **Gestionnaire de source** — dev multi-utilisateurs via git ou gestionnaire intégré | 🔲 À lancer | S'appuie sur le remote existant (`web_server.rs`, `web_auth.rs`). Réactive D3/D4. Chantier d'architecture (conflits, branches, droits) |

| # | Feature | Statut | Spec / détail |
|---|---|---|---|
| 1 | **H2 V2** — Gestion d'agents multi-rôles (séquentiel) | 🔄 En cours | `spec_gestion_agents.md` · onglet 🎭 Agents, registre `~/.pilot/agents.json`, coordinateur + sous-agents, protocole `[[CALL:...]]` |
| 2 | **D1** — Notifications desktop « agent terminé à distance » | ✅ Implémenté (2026-07-30) | `idees_evolutions.md` §D1 · plugin `tauri-plugin-notification`, déclenché à l'`agent_end` si prompt d'origine web |
| 3 | **H1 V2** — Context Engine embeddings/RAG local (Ollama + SQLite) | ✅ Implémenté (2026-07-30) | `spec_context_engine.md` §7 · `context_engine.rs` (chunking + cosinus + SQLite WAL), fallback V1 auto, build lazy + refresh incrémental, UI Paramètres (adresse/port/modèle + test) |
| 3 | **H9** — Historique de sessions searchable (mémoire des décisions) | ✅ Implémenté (2026-08-01) | `.pilot/sessions.jsonl` (append) + `.pilot/sessions-tags.json` + full-text/regex search + filtres tag/file/kind + détail (relecture JSONL pi) + tags éditables + rétro-indexation auto (1re ouverture) + capture live (agent_end chat). Voir [`spec_session_history.md`](spec_session_history.md). Complément de H3 (faits) et H1 (contexte) |
| 5 | **H7** — Mode « Projet sensible » (local-first garanti, badge 🔒) | ✅ Implémenté V1 (2026-08) | badge 🔒/🔓 cliquable (toolbar π), config `sensitive_projects` persistée, dictée vocale cloud bloquée (local-first). Routing cloud H6 toujours reporté |
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
| F2 | Export conversation agent | ✅ Implémenté (2026-08) | boutons 📥 (Markdown .md) toolbar π via `conversation-export.js` |
| F3 | Copy as HTML | ✅ Implémenté (2026-08) | bouton ⧉ (HTML presse-papiers) toolbar π via `conversation-export.js` |
| E3 | CI multi-plateforme RPC | ✅ Implémenté (2026-08) | job `test` en matrice ubuntu/windows/macos — tests Rust+JS sur les 3 OS avant release |
| 22 | Conflits fichiers (diff/reload) | ✅ Implémenté (2026-08) | `_showConflictTab` — dialogue 3 choix (Recharger/Garder/Diff read-only via `openGitDiffModal`), auto-reload si non modifié ; corrige le bug `_showConflictTab` inexistant |

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

*Dernière mise à jour : 2026-08* — multi-projets V1 implémenté (persistance, bascule, parking de sessions par projet = agents pi vivants en arrière-plan, canaux d'événements par projet, dropdown UI, web-remote select). Prochaine session : vérifier l'injection de contexte avec PLh (RAG déjà porté côté PLh — cf. section « Rien à porter » en tête de ce plan) puis choisir le prochain chantier dans la roadmap.

## Consolidation (qualité / dette technique)

| Élément | Statut | Détail |
|---|---|---|
| Socle de tests unitaires Rust | ✅ Implémenté (2026-08) | 31 tests sur `web_auth`, `web_rate`, `context_engine`, `tailscale`, `review`, `agents_md` (+ correction d'un test cassé) |
| Socle de tests JS (Vitest) | ✅ Implémenté (2026-08) | 74 tests sur les fonctions pures `orchestration.js` + `orchestration-reviewer.js` (parsing plan, marqueurs, glob, granularité adaptative) ; CI les exécute. A révélé + corrigé un bug de regex dans `extractMentionedFiles` (backslashes perdus) |
| Découpage `lib.rs` | 🔄 Presque terminé | 15 modules extraits (git, terminal, files, pdf, models_config, search, code_check, plan, session_history, tabs, web_commands, agents, rpc) ; lib.rs **4806→1572 lignes** (−67%) ; reste config/arborescence/watcher (infra couplée) |
| CI anti-régression | ✅ Implémenté (2026-08) | job `test` (cargo test) exigée avant le build de release |
| Doc remise à niveau | ✅ Implémenté (2026-08) | README (version d'installeur, liens, structure), arborescence AGENTS.md |

| Granularité atomic + overrides session | `spec_orchestration.md` §19 | ✅ Implémenté (2026-07-30) — 4e niveau de finesse `atomic` (~10-25 lignes, 1 fichier, modèle local) ; écran d'activation enrichi : granularité + reviewer sélectionnables (overrides session non persistés) |
