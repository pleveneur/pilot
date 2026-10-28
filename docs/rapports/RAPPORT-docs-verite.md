# Rapport — remettre les documents dans le vrai

> Mission documentaire uniquement : aucun fichier de code (Rust ou JS applicatif) modifié,
> aucun rapport supprimé, aucune fonctionnalité créée, aucune date promise.
> Méthode : pour chaque affirmation de l'audit, **constat sur le disque d'abord**, correction
> ensuite. Le disque tranche, pas les documents.

## 1. Tableau des corrections

| # | Affirmation fausse (avant) | Ce que dit le disque | Preuve du constat | Correction appliquée |
|---|---|---|---|---|
| 1 | `plan_dev.md` L8 : « Mode réseau multi-postes : plan figé (v4 + 7 arbitrages), **réalisation à démarrer — rien d'implémenté** » (et L25 « plan figé v4, rien d'implémenté ») | **Faux.** Le portage est implémenté de bout en bout (étapes 1 à 5). Ne restent que les étapes 6-7 (avancement partagé, migration `0009`) et l'étape 9 (test entre deux postes). | `src-tauri/src/gds_handover.rs` (83,6 Ko), `src-tauri/src/gds_write_guard.rs` (21,7 Ko), `gds-core/src/handover.rs` (règles pures, 40 Ko), migration `gds-core/migrations/0008_project_handover.sql` présente, **5 routes** dans `gds-core/src/http.rs` (`/api/gds/handover/take`, `/heartbeat`, `/return`, `/state` + `/force` en `admin_routes`), commandes Tauri enregistrées `src-tauri/src/lib.rs` L4002-4013, interface branchée (`src/js/gds-handover.test.js`, 24,3 Ko). **Dates** : `plan_dev.md` modifié en dernier le 2026-10-25 (5a18ce0) ; le code réseau arrive après (35bee91, 866ede0, 67e4bb5, e0d95da — 2026-10-26). | L8 réécrit : « le portage est implémenté — étapes 1 à 5 », avec ce qui reste et le lien vers `spec_reseau.md` (référence) + `PLAN-mode-reseau-multipostes.md`. Ligne du tableau des restes corrigée. |
| 2 | `plan_dev.md` racontait l'histoire passée (hashes de commits, chantiers terminés) et dépassait le format résumé | Le fichier doit rester **≤ 30 lignes**, état global + liens | Règle écrite dans `AGENTS.md` § Documentation à jour (règle 2) et en tête du fichier lui-même | Section « Assistant » réduite à l'état réel (deux signaux **non reproduits**), hashes de commits retirés ; fichier à **30 lignes** (`wc -l`). |
| 3 | `spec_rpc.md` §12 : « [ ] Modèle par défaut configurable dans les paramètres (sélecteur dans settings) » | **Fait.** Sélecteur « Modèle par défaut » présent dans Paramètres → Fournisseurs (écrit `model-switch.json`), et modèles par défaut propres (Assistant, orchestrateur, codeur, PDF→MD) dans Paramètres → Modèles IA | `index.html` L985 (`#setting-aliases-default` « Modèle par défaut »), `src/js/models-config.js` L536 `populateDefaultModelSelect()` + `saveAll()`, `index.html` L862-885 (`#setting-superagent-default-model`, `#setting-orchestrator-model`, `#setting-coder-model`), `src-tauri/src/models_config.rs` (lecture/écriture `model-switch.json`) | Ligne passée en `[x]`, avec l'emplacement réel du réglage. |
| 4 | `spec_rpc.md` §12 : « [ ] Éditeur intégré pour le dialogue `extension_ui_request` type `editor` (actuellement un simple prompt) » | **Fait.** Un éditeur multiligne s'affiche dans la zone de chat | `src/js/agent-pi.js` L9373 `appendExtensionEditor(container, requestId, payload)` (textarea, Ctrl+Entrée pour valider, Annuler/Valider) | Ligne passée en `[x]` avec la référence. |
| 5 | `spec_rpc.md` §12 : « [ ] Export conversation (HTML/Markdown) » | **Fait.** Export Markdown et copie HTML | `src/js/conversation-export.js` (`toMarkdown` L86, `toHtml` L123, `exportConversationMarkdown` L183), boutons `data-action="export-md"` / `"export-html"` (`agent-pi.js` L370-371) et handlers L1946 / L1950 | Ligne passée en `[x]` avec la référence. |
| 6 | `spec_voice_input.md` L3 : « bouton 🎙️ desktop **présent mais informatif** (micro WebView bloqué par wry/Tauri) » | **Faux.** La dictée desktop est branchée | `src/js/agent-pi.js` L562 (bouton `data-action="voice"`), L845-850 (détection `SpeechRecognition`/`webkitSpeechRecognition`), même mécanisme dans `src/js/super-agent.js` ; micro autorisé par la copie **patchée** de wry : `src-tauri/vendor/wry/src/webview2/mod.rs` L505 `add_PermissionRequested`, branchée par `[patch.crates-io] wry = { path = "src-tauri/vendor/wry" }` | Statut L3 réécrit : implémenté sur les **deux** interfaces (desktop + web remote). |
| 7 | `spec_voice_input.md` §8 : le patch wry est « branché via `[patch.crates-io]` dans `src-tauri/Cargo.toml` » | **Faux (chemin).** La section vit dans le `Cargo.toml` **racine** du workspace | `Cargo.toml` racine contient `[patch.crates-io]` ; un commentaire y explique qu'une section `[patch]` n'est honorée que par le manifeste racine (déplacée depuis `src-tauri/Cargo.toml` à la création du workspace) | Mention corrigée : `Cargo.toml` racine, avec la raison. |
| 8 | `spec_laya.md` L3 : statut limité à « Marche 5 » ; §7 : « **Pas de trace par copie de Pilot** (marche 6) : les deux copies partagent le même `laya.pid` » | **Faux.** La marche 6 est codée : la trace porte le propriétaire, le journal existe, un bouton démarre le service à la demande | `src-tauri/src/laya.rs` en-tête L18-29 (« la trace porte le propriétaire », « le nettoyage du démarrage ne referme donc un service restant que si son propriétaire n'est PLUS vivant »), L620/677/693 (propriétaire) ; `LOG_FILE_NAME = "laya.log"` ; commande `laya_service_start` (`lib.rs` L2651, enregistrée L4097) + bouton et issue réelle (`src/js/settings.js` L2364-2383). Commits `1f4ba09` (2026-09-27) et `d25a165` (test de la trace propriétaire). | Statut en tête : « Marches 2 à 6 implémentées et testées » + description de la marche 6 marquée ✅ ; bullet §7 transformé en « fait en marche 6 ». |
| 9 | `AGENTS.md` L296-297 : `src-tauri/src/gds_db.rs` et `src-tauri/src/gds_git.rs` | **Ces fichiers n'existent pas** à cet endroit : ils ont été extraits dans le socle partagé | `ls src-tauri/src/gds*` → pas de `gds_db.rs` ni `gds_git.rs` ; ils vivent dans `gds-core/src/db.rs` et `gds-core/src/git.rs`, lus par le poste via `use gds_core::db as gds_db;` / `use gds_core::git as gds_git;` (`src-tauri/src/lib.rs` L107-116) | Les deux entrées fausses sont remplacées par les modules **réellement présents** dans `src-tauri/src/` : `gds_admin.rs`, `gds_service.rs`, `gds_ssh.rs`, `gds_client.rs`, `gds_sync.rs` (chacun vérifié sur disque et décrit d'après son en-tête). `gds-core` est déjà décrit plus haut (db, git). |
| 10 | `plan_gds.md` L260 : « Modules : `gds.rs`, `gds_db.rs` (table `users`), `gds_git.rs` » | Chemins faux (même cause que #9) | Identique à #9 | Chemins corrigés : `gds-core/src/db.rs` (ex-`gds_db.rs`), `gds-core/src/git.rs` (ex-`gds_git.rs`). |
| 11 | `plan_gds.md` L414 : « `gds_db.rs` (`project_has_git_repo`) » | La fonction existe, mais dans le socle | `gds-core/src/db.rs` L641 `project_has_git_repo` | Chemin corrigé en `gds-core/src/db.rs`. |

## 2. Ce que j'ai volontairement laissé tel quel

- **`spec_rpc.md` §12 « [ ] Tests multi-plateforme (macOS, Linux) »** : **non vérifié** (je ne
  lance pas de test macOS/Linux ici) → laissé en `[ ]`.
- **Autres mentions historiques de `gds_db.rs` / `gds_git.rs` dans `plan_gds.md`**
  (sections des phases A/B/C déjà réalisées : L110, L231, L388, L395, L484, L509, L534, L546) :
  ces sections racontent la planification d'origine ; les réécrire serait réécrire l'histoire.
  À la place, une **note de lecture** en tête du document (L14-19) donne la correspondance
  (`gds-core/src/db.rs`, `gds-core/src/git.rs`) et précise qu'il n'existe plus de
  `gds_db.rs`/`gds_git.rs` dans `src-tauri/src/` — en distinguant `src-tauri/src/db.rs`
  (SQLite locale `pilot.db`) et `src-tauri/src/git.rs` (Git intégré du poste).
- **`spec_reseau.md`** : rien touché — il dit vrai (il décrit les étapes faites et, en §7, ce
  qui n'est pas fait).
- **`spec_laya.md` §7, autres limites** (rotation du journal, SHA-256, multi-plateforme,
  surveillance périodique) : **non vérifiées** → non touchées.
- **`src-tauri/src/agents.rs`** apparaît modifié dans `git status` : ce n'est **pas** moi (état
  antérieur à ma session). Je ne l'ai ni relu ni modifié.
- **Aucun fichier de code** (Rust, JS applicatif) modifié ; **aucun rapport** de la racine
  supprimé ; version du projet inchangée.

## 3. Aide embarquée (handbook)

`npm run build:handbook` lancé : **45 blocs, 275 538 octets**, `help/handbook.md` **non
modifié** (`git status` ne le liste pas). Explication, pas un échec : aucune de mes corrections
ne tombe dans un bloc `<!-- HELP:* -->` — les blocs `HELP:agent-pi` (`spec_rpc.md`),
`HELP:dictee-vocale` (`spec_voice_input.md`) et `HELP:laya` (`spec_laya.md`) sont intacts, et
aucun autre document touché n'alimente l'aide. Le fichier généré n'est jamais édité à la main.

## 4. Tests

Commande lancée : `npx vitest run` (config `vitest.config.js`). Dans cet environnement, le
lanceur `npx vitest` n'affiche qu'une ligne de synthèse ; le détail a donc été obtenu avec le
binaire réel du projet :

```
node node_modules/vitest/vitest.mjs run --reporter=verbose
```

**Compte réel : 187 fichiers de test, 3246 tests, 3246 réussis, 0 échec**
(`Test Files 187 passed (187)`, `Tests 3246 passed (3246)`, durée 11,36 s, code de sortie 0).
Aucune régression : mes corrections touchent uniquement des documents Markdown.
