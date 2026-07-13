# Idées d'évolutions — Pilot

## 1. Git intégré
- [ ] 1.1 Afficher le statut modifié/indexé dans l'explorateur
- [ ] 1.2 Diff visuel entre version sauvegardée et version courante

## 2. Gestion RPC de pi

✅ Implémenté — voir [spec_rpc.md](spec_rpc.md). Chat agent, streaming, sessions, modèles, inline completion, prompt builder, confirmation dialog.

## 3. Pdf2md

✅ Implémenté — voir [spec_pdf2md.md](spec_pdf2md.md). Phase 1 (heuristiques) + Phase 2 (IA configurable via session pi temporaire).

## 4. Édition fractionnée (Split View)

Ouvrir l'éditeur et la prévisualisation côte à côte (ou deux fichiers), comme VS Code ou Typora.

- [x] 4.1 Layout flex avec split vertical
- [x] 4.2 Sync scroll éditeur ↔ prévisualisation Markdown (proportionnel + clic sur heading pour naviguer)
- [x] 4.3 Raccourci `Ctrl+Shift+E` pour basculer entre mode simple / split
- [x] 4.4 Séparateur draggable pour redimensionner les panneaux
- [x] 4.5 Mise à jour en temps réel de la prévisualisation (debounce 300ms)

✅ Implémenté — Voir `tabs.js` (méthodes `_enterSplitMode`, `_exitSplitMode`, `_updateSplitPreview`, `_setupSplitScrollSync`, `_setupSplitDividerDrag`) et `style.css` (classe `.split-mode`).

Intérêt : c'est LE workflow principal d'un éditeur Markdown — voir le rendu en temps réel pendant qu'on écrit. Actuellement il faut basculer entre onglet édition et onglet preview, ce qui est frustrant.

## 5. Persistance des onglets au redémarrage

Sauvegarder quels onglets étaient ouverts (fichier, mode, position du curseur, scroll) et les rouvrir au lancement.

- [x] 5.1 Sauvegarder la session d'onglets dans `app_data_dir/sessions/<hash>.json` à chaque changement
- [x] 5.2 Restaurer les onglets au démarrage (si un projet est chargé automatiquement)
- [x] 5.3 Indicateur visuel « fichier modifié extérieurement » + choix (recharger / garder sa version)

✅ Implémenté — voir fichiers : `src/js/session-persistence.js`, `src/js/tabs.js` (méthodes `_scheduleSave`, `_markConflictTab`), `src-tauri/src/lib.rs` (commandes `save_tab_session`/`load_tab_session`).

Intérêt : actuellement, fermer Pilot = perdre tout son contexte de travail. C'est le premier repro qu'un utilisateur ferait.

## 6. Recherche dans les fichiers (Global Search)

Un panneau de recherche full-text qui scanne tous les fichiers du projet, style VS Code `Ctrl+Shift+F`.

- [x] 6.1 Nouveau panneau search en bas de la zone de travail (résultats cliquables)
- [x] 6.2 Indexation côté Rust avec regex crate pour la performance
- [x] 6.3 Surlignage des occurrences dans les résultats + navigation au fichier/ligne
- [x] 6.4 Support regex et filtre par extension

✅ Implémenté — Voir `search-panel.js`, `lib.rs` (commande `search_in_files`), `style.css` (classe `#search-panel`). Raccourci `Ctrl+Shift+F`.

## 7. Outline / Table des matières Markdown

Un panneau qui affiche les headings du fichier Markdown en cours, cliquable pour naviguer.

- [x] 7.1 Extraction des headings `#`, `##`, `###` en temps réel (depuis le contenu CodeMirror)
- [x] 7.2 Panneau collapsible à droite de l'éditeur
- [x] 7.3 Cliquer un heading scroll l'éditeur à la bonne ligne

✅ Implémenté — Voir `outline.js`, raccourci `Ctrl+Shift+O`. Mise à jour en temps réel via `onChange` dans `tabs.js`.

## 8. Système de notifications (Toasts)

Remplacer les `alert()` et `console.error()` silencieux par des notifications visuelles non-bloquantes.

- [x] 8.1 Composant toast en bas à droite (succès ✅, erreur ❌, avertissement ⚠️, info ℹ️, auto-dismiss 3-6s)
- [x] 8.2 Toast d'erreur pour les opérations Tauri qui échouent (sauvegarde, lecture, création, suppression, renommage)
- [x] 8.3 Toast de confirmation (fichier sauvegardé, projet ouvert, fichier/dossier créé/supprimé/renommé)
- [x] 8.4 Toast persistant pour les erreurs importantes (session RPC perdue, fichier supprimé)

✅ Implémenté — Voir `toast.js` (`showToast`, `toastSuccess`, `toastError`, `toastWarning`, `toastInfo`, `toastPersistent`), `style.css` (classe `.toast`).

## 9. Raccourcis clavier supplémentaires

Compléter les raccourcis pour un workflow fluide.

- [x] 9.1 `Ctrl+P` : focus sur le filtre de fichiers de la sidebar
- [x] 9.2 `Ctrl+Shift+P` : palette de commandes (fuzzy search sur les actions)
- [x] 9.3 `Ctrl+G` : Go to Line
- [x] 9.4 `Ctrl+Shift+F` : recherche globale dans les fichiers
- [x] 9.5 `Ctrl+Shift+E` : basculer édition / prévisualisation / split
- [x] 9.6 `Ctrl+Shift+S` : Enregistrer sous
- [x] 9.7 `Ctrl+Tab` / `Ctrl+Shift+Tab` : onglet suivant / précédent

✅ Implémenté — Palette de commandes avec fuzzy search, navigation clavier (flèches + Enter), raccourcis dans la modale.

## 10. Compteur de mots et statistiques dans la barre de statut

Afficher des informations utiles dans la barre de statut.

- [x] 10.1 Compteur de mots / caractères / lignes pour les fichiers Markdown
- [x] 10.2 Temps de lecture estimé (standard : ~200 mots/min en français)
- [x] 10.3 Encodage du fichier (UTF-8, etc.)
- [x] 10.4 Indicateur de fin de ligne (LF / CRLF)

✅ Implémenté — Barre de statut : mots · caractères · lignes · temps lecture (MD), encodage (UTF-8 / UTF-8 BOM / UTF-16), EOL (LF / CRLF). Commande Rust `get_file_info` pour la détection.

## 11. Support KaTeX / LaTeX dans la prévisualisation

Rendre les formules mathématiques `$...$` et `$$...$$` dans la preview.

- [x] 11.1 Intégrer KaTeX comme plugin markdown-it (`@traptitech/markdown-it-katex`)
- [x] 11.2 Synchroniser le thème KaTeX avec le thème Pilot (dark/light)
- [x] 11.3 Support dans l'export PDF

✅ Implémenté — Voir `preview.js` (plugin markdown-it-katex), `style.css` (`.katex { color: inherit }`), `index.html` (katex.min.css). L'export PDF inclut les formules car elles sont rendues en HTML.

## 12. Redimensionnement persistant de la sidebar

- [x] 12.1 Sauvegarder la largeur de la sidebar dans la config
- [x] 12.2 La restaurer au démarrage
- [x] 12.3 Double-clic sur le séparateur = revenir à la largeur par défaut

✅ Implémenté — Séparateur draggable (`#sidebar-separator`), commande Rust `set_sidebar_width`, champ `sidebar_width` dans `AppConfig`, double-clic = 280px.

## 14. Enregistrer sous (Save As)

- [x] 14.1 `Ctrl+Shift+S` : ouvrir le dialogue natif pour choisir le chemin de sauvegarde
- [x] 14.2 Mettre à jour le chemin de l'onglet après sauvegarde

✅ Implémenté — `Ctrl+Shift+S` + palette de commandes « Enregistrer sous… ». Le chemin, le nom et le dirty flag de l'onglet sont mis à jour.

## 15. Sauvegarde automatique configurable

- [x] 15.1 Option `auto_save` dans les paramètres (délai en ms, ex: 3000)
- [x] 15.2 Timer qui sauvegarde après chaque modification si l'option est activée
- [x] 15.3 Indicateur visuel dans la barre de statut (auto-save actif/inactif)

✅ Implémenté — Champ `auto_save` + `auto_save_delay` dans `AppConfig`, checkbox + input délai dans les paramètres, timer debounce dans `TabsManager.scheduleAutoSave()`, indicateur `💾 Auto (3s)` dans la barre de statut.

## 16. MiniMap CodeMirror

Ajouter la minimap (carte d'aperçu du fichier) sur le côté droit de l'éditeur.

- [ ] 16.1 Intégrer `@codemirror/minimap` ou équivalent
- [ ] 16.2 Toggle dans les paramètres ou raccourci dédié
- [ ] 16.3 Synchronisation du scroll entre éditeur et minimap

Intérêt : pour les fichiers longs (+200 lignes), la minimap donne une vue d'ensemble et permet une navigation rapide.

## 17. Vue brouillon (Scratchpad)

Un onglet spécial sans fichier associé, persisté en `localStorage`, pour les notes rapides.

- [x] 17.1 Onglet "📝 Brouillon" toujours disponible, contenu sauvegardé dans `localStorage`
- [x] 17.2 Raccourci `Ctrl+Shift+N` pour ouvrir le brouillon
- [x] 17.3 Export possible vers un fichier `.md` du projet

✅ Implémenté — Voir `tabs.js` (méthodes `_openScratchpad`, `_saveScratchpad`, `_exportScratchpad`), bouton 📝 dans le panneau d'actions, palette de commandes, `session-persistence.js` (marqueur `__scratchpad__`).

Intérêt : tout développeur a besoin d'un espace temporaire. Actuellement, il faut créer un fichier, puis le supprimer.

## 18. Raccourcis personnalisables (Keybindings)

- [ ] 18.1 Section dans les paramètres pour remapper les raccourcis
- [ ] 18.2 Stockage dans la config Tauri
- [ ] 18.3 Prévisualisation des conflits de raccourcis

Intérêt : chaque utilisateur a ses habitudes (Vim, Emacs, VS Code). Permettre la personnalisation rend Pilot adaptatif.

## 19. Thèmes personnalisables

Au-delà de dark/light, permettre à l'utilisateur de créer ses propres thèmes.

- [ ] 19.1 Système de thème CSS custom (fichier `theme-user.css` dans `app_data_dir`)
- [ ] 19.2 Éditeur visuel simple dans les paramètres (couleur de fond, texte, accent)
- [ ] 19.3 Quelques thèmes prédéfinis supplémentaires (Catppuccin, Nord, Solarized)

Intérêt : les thèmes sont un facteur majeur d'adoption pour les éditeurs de code.

## 20. Favoris / Bookmarks dans l'arborescence

- [x] 20.1 Section "⭐ Favoris" en haut de l'arborescence
- [x] 20.2 Ajouter/retirer un favori par clic droit → "Ajouter aux favoris"
- [x] 20.3 Persistance dans la config
- [x] 20.4 Raccourci clavier rapide pour ajouter le fichier actif aux favoris

✅ Implémenté — Section ⭐ Favoris collapsible en haut de la sidebar, bouton contextuel ⭐ Ajouter/Retirer des favoris, raccourci `Ctrl+Shift+B`, persistance dans `AppConfig.favorites`, palette de commandes. Voir `sidebar.js` (`_loadFavorites`, `_renderFavorites`, `toggleFavorite`), `lib.rs` (`add_favorite`, `remove_favorite`).
 
## 21. Export vers d'autres formats

- [ ] 21.1 Export HTML autonome (fichier `.html` avec CSS inline)
- [ ] 21.2 Export DOCX (via Pandoc si disponible, ou `html-docx-js`)
- [ ] 21.3 Copy as HTML (copier le HTML rendu dans le presse-papiers)

Intérêt : l'export PDF existe déjà, mais HTML et DOCX sont très demandés pour le partage de documentation.

## 22. Gestion avancée des conflits de fichiers

Actuellement, un fichier modifié extérieurement est juste marqué en flash rouge. Proposer un vrai choix.

- [ ] 22.1 Dialogue modal : "Le fichier a été modifié extérieurement" avec 3 options : Recharger / Garder ma version / Ouvrir un diff
- [ ] 22.2 Vue diff côte à côte (mon fichier vs fichier sur disque)
- [ ] 22.3 Auto-rechargement intelligent : si je n'ai pas modifié le fichier, recharger silencieusement

Intérêt : le flash rouge actuel est frustrant car on ne sait pas quoi faire. Un vrai dialogue de résolution de conflit est la base du CRUD fichier.

---

## 23. Brainstorming du 13/07/2026 — pipeline d'évolutions

> Récapitulatif de tout ce qu'il reste à faire, organisé par thème, avec pour
> chaque idée les **fichiers concernés**. Les idées déjà couvertes plus haut (1-22)
> ne sont pas reprises ici sauf si re-priorisées. La priorisation recommandée est
> en fin de section.

### 🅰️ Productivité agent IA (cœur de Pilot)

#### A1 — Snapshots / point de restauration avant tâche d'orchestration
- [ ] Avant chaque tâche d'orchestration, snapshot des fichiers concernés dans `.pilot/snapshots/<taskId>/`. Bouton « ↩️ Annuler la dernière tâche » restore.
- **Fichiers :** `src/js/orchestration.js` (capture/restore), `src/js/agent-pi.js` (UI bouton + handler), `src-tauri/src/lib.rs` (commandes `snapshot_task` / `restore_snapshot`), `spec_orchestration.md`.
- **Valeur :** 🔴 très haute · **Effort :** moyen

#### A2 — Bibliothèque de prompts favoris / snippets
- [ ] Prompts réutilisables taggés, insertion 1 clic dans la zone agent.
- **Fichiers :** nouveau `src/js/prompt-library.js`, `src/js/agent-pi.js` (branchement UI), `src-tauri/src/lib.rs` (config `prompt_snippets` + commandes CRUD), `index.html`, `src/css/style.css`.
- **Valeur :** 🟡 haute · **Effort :** faible

#### A3 — Pinning de fichiers dans le contexte agent
- [ ] Fichiers « épinglés » toujours envoyés en contexte implicite à chaque prompt (ex: `AGENTS.md`, `spec_pilot.md`).
- **Fichiers :** `src/js/agent-pi.js` (injection contexte + UI pin), `src/js/sidebar.js` (action clic-droit « Épingler au contexte agent »), `src-tauri/src/lib.rs` (config `pinned_context_files`), `spec_rpc.md`.
- **Valeur :** 🟡 haute · **Effort :** moyen

#### A4 — Mode « diff review » agent (Accepter / Rejeter par hunk)
- [ ] Après qu'un outil de l'agent a modifié un fichier, afficher le diff inline (avant/après) avec Accepter/Rejeter par hunk. **Composant partagé avec C1 (Git).**
- **Fichiers :** nouveau `src/js/diff-view.js`, `src/js/agent-pi.js` (interception tool_execution_end + UI), `src-tauri/src/lib.rs` (snapshot avant modif via tool), `src/css/style.css` (styles diff), `spec_rpc.md`.
- **Valeur :** 🔴 très haute · **Effort :** moyen-haut

#### A5 — Branche parallèle « scratch session »
- [ ] Lancer un 2e prompt « what-if » sans polluer la session principale (pi `--no-session` temporaire, comme l'aide).
- **Fichiers :** `src/js/agent-pi.js` (UI onglet/fenêtre secondaire), `src-tauri/src/rpc_manager.rs` (réutiliser `convert_text_with_pi` / pattern temporaire), `src-tauri/src/lib.rs` (commande `ask_agent_scratch`).
- **Valeur :** 🟡 haute · **Effort :** moyen

#### A6 — Coût cumulé par projet + onglet « 📊 Usage »
- [ ] Agrégation des `session_stats` par projet dans `.pilot/usage.json`, graphe simple.
- **Fichiers :** nouveau `src/js/usage.js`, `src/js/main.js` (onglet), `src-tauri/src/lib.rs` (commandes `record_usage` / `get_usage`), `index.html`, `src/css/style.css`.
- **Valeur :** 🟠 moyenne · **Effort :** faible

### 🅱️ Édition / éditeur

#### B1 — Multi-curseurs / sélection en colonne
- [ ] Activer les extensions CodeMirror 6 multi-curseurs (`@codemirror/search` cursorAt + `multipleSelections`).
- **Fichiers :** `src/js/editor.js` (extensions CodeMirror), `package.json` (dépendance si besoin).
- **Valeur :** 🟡 haute · **Effort :** faible

#### B2 — Lint diagnostics inline dans l'éditeur
- [ ] Afficher les erreurs `check_syntax` (déjà appelé par orchestration) via `@codemirror/lint` pour l'édition manuelle aussi.
- **Fichiers :** `src/js/editor.js` (extension lint), `src-tauri/src/lib.rs` (réutiliser `check_syntax` en commande standalone), `package.json` (`@codemirror/lint`).
- **Valeur :** 🟡 haute · **Effort :** moyen

#### B3 — Find & Replace dans projet (pas seulement search)
- [ ] Étendre `search-panel.js` en replace avec preview (remplacement unitaire / tous).
- **Fichiers :** `src/js/search-panel.js` (UI replace + handler), `src-tauri/src/lib.rs` (commande `replace_in_files`), `src/css/style.css`, `index.html`.
- **Valeur :** 🟡 haute · **Effort :** faible-moyen

#### B4 — MiniMap CodeMirror (déjà noté idée 16)
- [ ] Intégrer `@codemirror/minimap` + toggle paramètres + sync scroll.
- **Fichiers :** `src/js/editor.js`, `src/js/settings.js` (toggle), `src-tauri/src/lib.rs` (config `minimap_enabled`), `package.json` (`@codemirror/minimap`), `src/css/style.css`.
- **Valeur :** 🟠 moyenne · **Effort :** faible

#### B5 — Snippets / templates de fichier
- [ ] Clic droit → « Nouveau fichier depuis template » (ex: `spec_*.md`, `AGENTS.md`, `main.rs`). Templates dans `app_data_dir/templates/`.
- **Fichiers :** `src/js/sidebar.js` (menu contextuel + modale), `src-tauri/src/lib.rs` (commandes `list_templates` / `create_from_template`), `index.html`, `src/css/style.css`.
- **Valeur :** 🟡 haute · **Effort :** faible

#### B6 — Drag & drop de fichiers dans l'éditeur → lien/chemin
- [ ] Étendre `image-paste.js` : drop d'un fichier non-image insère un chemin relatif (ou `![]()` pour images).
- **Fichiers :** `src/js/image-paste.js` (généralisation), `src/js/tabs.js` (drop handler).
- **Valeur :** 🟠 moyenne · **Effort :** faible

### 🅲️ Organisation / navigation projet

#### C1 — Git intégré (déjà noté idée 1) — statut + diff visuel
- [ ] 1.1 Statut modifié/indexé dans l'arborescence (couleurs + badges).
- [ ] 1.2 Diff visuel entre version sauvegardée et version courante (réutilise A4 `diff-view.js`).
- **Fichiers :** `src-tauri/src/lib.rs` (commandes `git_status` / `git_diff` via `git2` ou CLI `git`), nouveau `src-tauri/src/git.rs`, `src/js/sidebar.js` (badges statut), `src/js/diff-view.js` (partagé avec A4), `src/css/style.css`, `spec_pilot.md`.
- **Valeur :** 🔴 très haute · **Effort :** moyen

#### C2 — Workspace multi-projets
- [ ] Ouvrir plusieurs projets en onglets de sidebar, chacun avec son agent pi séparé.
- **Fichiers :** `src-tauri/src/lib.rs` (AppState multi-sessions), `src-tauri/src/rpc_manager.rs` (multi-session), `src/js/sidebar.js`, `src/js/main.js`, `src/js/agent-pi.js`. ⚠️ Gros chantier (pi partagé, state).
- **Valeur :** 🟠 moyenne · **Effort :** haut

#### C3 — Tags / labels sur fichiers
- [ ] Au-delà des favoris, tags colorés filtrables (ex: « à revoir », « draft », « spec »).
- **Fichiers :** `src/js/sidebar.js` (UI tags + filtre), `src-tauri/src/lib.rs` (config `file_tags: HashMap<String, Vec<String>>`), `src/css/style.css`.
- **Valeur :** 🟠 moyenne · **Effort :** moyen

#### C4 — Recent files popover (`Ctrl+Alt+R`)
- [ ] Liste des 20 derniers fichiers ouverts dans le projet, fuzzy search.
- **Fichiers :** `src/js/main.js` (raccourci + popover), `src/js/session-persistence.js` (historique), `index.html`, `src/css/style.css`.
- **Valeur :** 🟡 haute · **Effort :** faible

### 🅳️ Mode remote / supervision

#### D1 — Notifications desktop « agent terminé à distance »
- [ ] Toast desktop quand l'agent termine une tâche longue lancée depuis le téléphone.
- **Fichiers :** `src-tauri/src/lib.rs` (notification native via `tauri-plugin-notification` à `agent_end` si origine web), `src/js/main.js` (listener), `package.json` + `src-tauri/Cargo.toml` (plugin notification), `spec_web_remote.md`.
- **Valeur :** 🟡 haute · **Effort :** faible

#### D2 — Vue « activité » web (dashboard supervision)
- [ ] Page web condensée : plan d'orchestration en cours + tâches cochées, sans le chat complet.
- **Fichiers :** `web/index.html` (nouvelle vue), `web/js/app.js` (route vue), `web/css/web.css`, `src-tauri/src/web_server.rs` (route `/api/plan` si orchestration), `spec_web_remote.md`.
- **Valeur :** 🟠 moyenne · **Effort :** moyen

#### D3 — WebAuthn / passkey sur le web remote
- [ ] Remplace la passphrase par biométrie téléphone (anticipé §6.8 spec web remote).
- **Fichiers :** `web/index.html` + `web/js/app.js` (WebAuthn API), `src-tauri/src/web_auth.rs` (vérification assertion), `src-tauri/Cargo.toml` (dépendances webauthn), `spec_web_remote.md`.
- **Valeur :** 🟠 moyenne · **Effort :** moyen-haut

#### D4 — Partage de session en lecture seule (URL temporaire)
- [ ] Token jetable pour montrer une conversation sans accès aux commandes.
- **Fichiers :** `src-tauri/src/web_auth.rs` (tokens jetables read-only), `src-tauri/src/web_server.rs` (scope read-only), `web/js/app.js` (mode dégradé), `spec_web_remote.md`.
- **Valeur :** 🟠 moyenne · **Effort :** moyen

### 🅴️ Robustesse / qualité

#### E0 — Observabilité des échecs du codeur ✅ TERMINÉ
- [x] Journal des tentatives par tâche (marqueur, raison, durée, fichiers, extrait réponse, erreurs linting) + détection de bouclage + bloc repliable dans le panneau d'orchestration. Voir [`spec_orchestration_observability.md`](./spec_orchestration_observability.md) (validé 2026-07-13).
- [x] **Nudge proactif après arrêt prématuré en réflexion** (validé 2026-07-13) : détection des modèles faibles (9B) qui s'arrêtent après la Phase 1 (REFLEXION_DONE sans bloc) → relance in-session vers la Phase 2 (max 2 par tâche) pour éviter l'escalade cloud systématique. Voir `spec_orchestration_observability.md` §5.
- **Fichiers :** `src/js/orchestration.js` (fonctions pures `createAttemptLog`/`detectLoop`/`summarizeTaskAttempts`/`normalizeForLoop`/`makeExcerpt`/`detectReflectionOnly`/`buildNudgeAfterReflectionPrompt`), `src/js/agent-pi.js` (`logTaskAttempt`/`deriveFailureMarker`/`renderOrchestrationAttempts` + instrumentation `handleTaskFailure`/SELF_FIX/lint/DONE/escalade + branche nudge), `src/css/style.css` (`.orch-attempts*`), `spec_orchestration_observability.md`.

#### E1 — Quality-gate interne ✅ TERMINÉ
- [x] Bouton 🛡️ embarqué, `--skill` Pilot, persistance config. Voir `spec_quality_gate.md` et Évolution 7 dans `Bugs et Evolutions.md` (validé 2026-07-11).

#### E2 — Auto-test post-modification (mode Orchestration)
- [ ] Après chaque tâche, lancer les tests du projet (`npm test` / `cargo test` / `pytest`) au lieu de juste `check_syntax`.
- **Fichiers :** `src/js/orchestration.js` (détection test runner + prompt SELF_FIX), `src/js/agent-pi.js` (handler linting loop), `src-tauri/src/lib.rs` (commande `run_project_tests`), `spec_orchestration.md`.
- **Valeur :** 🔴 très haute · **Effort :** moyen

#### E3 — Tests d'intégration multi-plateforme (déjà noté spec_rpc §12)
- [ ] CI macOS/Linux pour le RPC (Tauri + pi).
- **Fichiers :** nouveau `.github/workflows/ci.yml` (ou équivalent), `src-tauri/src/rpc_manager.rs` (tests `#[cfg(test)]`), `spec_rpc.md`.
- **Valeur :** 🟡 haute · **Effort :** moyen

#### E4 — Health check pi au démarrage
- [ ] `get_available_models` au lancement ; si pi absent, désactiver l'onglet agent gracieusement.
- **Fichiers :** `src/js/main.js` (check au démarrage), `src/js/agent-pi.js` (UI désactivée), `src-tauri/src/lib.rs` (commande `pi_health_check`).
- **Valeur :** 🟡 haute · **Effort :** faible

### 🅵️ Export / partage

#### F1 — Export HTML autonome (déjà noté 21.1)
- [ ] Un `.html` avec CSS inline, partageable sans Pilot.
- **Fichiers :** `src/js/pdf-export.js` (généralisation en `exportMarkdownTo`), `src/js/sidebar.js` (menu contextuel), `src/css/style.css` (CSS inline), `spec_pilot.md`.
- **Valeur :** 🟡 haute · **Effort :** faible

#### F2 — Export conversation agent (déjà noté spec_rpc §12)
- [ ] Sauver le chat agent en Markdown/HTML pour archivage.
- **Fichiers :** `src/js/agent-pi.js` (bouton + export), `src-tauri/src/lib.rs` (commande `export_session` optionnelle), `spec_rpc.md`.
- **Valeur :** 🟡 haute · **Effort :** faible

#### F3 — Copy as HTML (déjà noté 21.3)
- [ ] Copier le rendu Markdown dans le presse-papiers.
- **Fichiers :** `src/js/preview.js` (action), `src/js/sidebar.js` (menu contextuel), `index.html`.
- **Valeur :** 🟠 moyenne · **Effort :** faible

#### F4 — Live share d'un fichier (URL Tailscale temporaire)
- [ ] Exposer un `.md` en lecture sans login complet.
- **Fichiers :** `src-tauri/src/web_server.rs` (route publique `/share/<token>`), `src-tauri/src/web_auth.rs` (token share), `spec_web_remote.md`.
- **Valeur :** 🟢 basse · **Effort :** moyen

### 🅶️ UX / confort

#### G1 — Thèmes personnalisés (déjà noté 19)
- [ ] 19.1 Thème CSS custom (`theme-user.css` dans `app_data_dir`) · 19.2 Éditeur visuel · 19.3 Thèmes prédéfinis (Catppuccin, Nord, Solarized).
- **Fichiers :** `src/css/style.css` (variables à extraire), `src/js/theme.js` (chargement custom), `src/js/settings.js` (sélecteur + éditeur), `src-tauri/src/lib.rs` (config `theme` étendue).
- **Valeur :** 🟠 moyenne · **Effort :** faible-moyen

#### G2 — Raccourcis personnalisables (déjà noté 18)
- [ ] 18.1 Section paramètres remapper · 18.2 Stockage config · 18.3 Prévisualisation conflits.
- **Fichiers :** `src/js/main.js` (keymap depuis config), `src/js/settings.js` (UI), `src-tauri/src/lib.rs` (config `keybindings: HashMap`).
- **Valeur :** 🟠 moyenne · **Effort :** moyen

#### G3 — Command palette étendue (symboles + récents)
- [ ] Ajouter actions « sauter à un symbole » (fonctions/headers) + récents.
- **Fichiers :** `src/js/main.js` (palette), `src/js/languages.js` (extraction symboles), `index.html`.
- **Valeur :** 🟠 moyenne · **Effort :** faible

#### G4 — Status bar : dernier save + horloge session
- [ ] Info « dernier save il y a Xs » pour rassurer.
- **Fichiers :** `src/js/tabs.js` (statut bar), `index.html`, `src/css/style.css`.
- **Valeur :** 🟢 basse · **Effort :** faible

### Priorisation recommandée (ratio valeur/effort)

| Rang | Idée | Fichiers principaux |
|------|------|---------------------|
| 🥇 | E1 — Quality-gate interne ✅ | (déjà fait) |
| 🥈 | E0 — Observabilité des échecs ✅ | (déjà fait) |
| 🥉 | A4 — Diff review agent | `diff-view.js` (nouveau), `agent-pi.js`, `lib.rs` |
| 4 | C1 — Git intégré | `git.rs` (nouveau), `lib.rs`, `sidebar.js`, `diff-view.js` |
| 4 | A1 — Snapshots avant tâche | `orchestration.js`, `agent-pi.js`, `lib.rs` |
| 5 | E2 — Auto-test post-modification | `orchestration.js`, `agent-pi.js`, `lib.rs` |
| 6 | A3 — Pinning fichiers contexte | `agent-pi.js`, `sidebar.js`, `lib.rs` |
| 7 | F1 + F2 — Export HTML + conversation | `pdf-export.js`, `agent-pi.js`, `sidebar.js` |
| 8 | D1 — Notifications desktop « agent terminé » | `lib.rs`, `main.js`, plugin notification |

### Décisions à trancher avant implémentation

1. **Priorité produit** : consolider le pôle **agent IA** (A4, A1, E2) ou le pôle **éditeur classique** (C1 Git, B1, B3) en premier ?
2. **Snapshots vs Git** : si C1 (Git) est fait, A1 (snapshots) devient-il redondant (Git = restauration) ou garde-t-on un mécanisme Pilot spécifique sans dépendre d'un repo Git ?
3. **Diff review (A4) partagé avec Git (C1)** : confirmes-tu un seul composant `diff-view.js` pour les deux usages ?
4. **Thèmes non couverts** : y a-t-il un axe que j'ai manqué (collaboration temps réel, plugins/extensions Pilot, marketplace de prompts, intégration LSP) ?