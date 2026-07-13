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