# Spec — Revue de code assistée (H5)

> Onglet « 🔍 Review » : l'agent joue le rôle de **second reviewer** sur le
> diff Git de la session. Lecture seule — il ne modifie rien, il analyse.

## 1. Objectif

Compléter le pôle *écriture (A4 porte pré-écriture) → historique (C1 Git) →
**revue** (H5)*. L'agent lit le diff Git et produit une revue structurée
(bugs, sécurité, perfs, style, cohérence specs). C'est un **second reviewer**,
pas une auto-validation : il ne modifie aucun fichier.

## 2. Architecture

### 2.1 Backend (Rust)

- **`src-tauri/src/review.rs`** — module dédié.
  - Commande **`ask_review(state, scope, question, history) → String`** :
    1. lit `config.review_model` (format `provider/modelId`) ;
    2. récupère le diff Git via `git_review_diff()` :
       - `scope="working"` → `git diff HEAD` (working tree vs HEAD) ;
       - `scope="last"` → `git diff HEAD~1 HEAD` (dernier commit) ;
    3. tronque le diff à **60 000 caractères** (note de troncation ajoutée) ;
    4. construit le prompt cadré (consigne « second reviewer » + diff + historique
       réinjecté + question) ;
    5. appelle **`help::ask_pi_caged`** (pi temporaire `--no-session`, cwd =
       dossier temporaire) → isole pi du projet (aucun accès fichier, aucune
       pollution de la session de coding principale).
  - `git_review_diff()` vérifie d'abord `git rev-parse --is-inside-work-tree` ;
    `Err` si pas un repo Git (ou `git` absent). `Ok("")` si diff vide → l'appelant
    signale « rien à reviewer ».
- **Réutilisation** : `ask_pi_caged` est refactorée depuis `help.rs` (était
  `ask_pi_for_help`, privée → `pub`). Mêmes garanties que l'aide intégrée :
  process pi tué après la réponse, stderr capturée pour diagnostic, timeouts
  stricts (30 s accusé, 120 s stream).
- **`lib.rs`** : champ `AppConfig.review_model` (défaut vide) + commande
  `set_review_model` (persiste le choix du sélecteur). `mod review` déclaré.

### 2.2 Frontend

- **`src/js/review.js`** — `createReview(container)` (pattern `help.js`) :
  - sélecteur de **portée** (modifs non commitées / dernier commit) ;
  - sélecteur de **modèle** (persiste `review_model` ; fallback sur
    `help_model` si déjà choisi, sinon 1er de la liste) ;
  - bouton **🔍 Lancer la revue** → `ask_review(scope, "", [])` (revue initiale) ;
  - textarea + ➤ pour les **questions de suivi** → `ask_review(scope, question, history)` ;
  - historique géré côté frontend, réinjecté à chaque tour (pi est sans mémoire) ;
  - rendu Markdown via `renderMarkdown` (réutilise `preview.js`).
- **`src/js/tabs.js`** : mode `"review"` + `_openReview` + cleanup
  (`unlistenReview`) + exclusion de la persistance d'onglets.
- **`index.html`** : bouton 🔍 (`btn-review`, `project-only`) dans l'action-panel.
- **`src/css/style.css`** : `.review-actions` / `.review-launch` / `.review-scope`
  (les messages réutilisent les classes `.help-*` pour cohérence visuelle).

## 3. Prompt de revue

```
MODE REVUE DE CODE. Tu es un second reviewer expérimenté. Tu analyses le DIFF
Git fourni ci-dessous et tu produis une revue structurée. Tu N'utilises AUCUN
outil, ne lis ni ne modifie aucun fichier, n'exécutes aucune commande : tout
le contexte nécessaire est dans le diff. Réponds en français, en Markdown.

Portée de la revue : {modifs non commitées | dernier commit}.

=== DIFF GIT ===
```diff
{diff tronqué à 60k}
```
=== FIN DIFF ===

Structure ta revue ainsi (saute toute section sans remarque) :
- 🟢 Points positifs
- 🔴 Bugs / erreurs
- ⚠️ Sécurité
- ⚡ Performance
- 🎨 Style / cohérence
- 📐 Cohérence specs
- 💡 Suggestions (court, actionnable, cite des lignes)
```

## 4. Limitations V1

- **Diff dans le prompt uniquement** : pi n'accède pas au projet (cwd = temp).
  L'agent ne peut pas lire de fichiers additionnels pour le contexte. Si le
  diff est tronqué (> 60 k caractères), la revue est partielle — l'utilisateur
  peut réduire la portée (dernier commit) ou committer par morceaux.
- **Pas de revue sur commits arbitraires** : V1 = working tree vs HEAD ou
  dernier commit uniquement. (V2 : sélection d'une plage de commits.)
- **Lecture seule** : l'agent ne propose jamais de correctif appliqué
  automatiquement. L'utilisateur décide de la suite (commit / correction
  manuelle / `git restore`).
- **Repo Git requis** : projet non versionné → message d'erreur clair.

## 5. Sécurité

- pi temporaire `--no-session` + cwd neutre = **aucun risque de modification**
  du projet, même si l'agent tente d'utiliser des outils (il n'a accès à aucun
  fichier du projet).
- Le diff est fourni en lecture seule dans le prompt.
- Aucune commande de modification exposée côté review.

<!-- HELP:review -->
## 🔍 Onglet Review (revue de code assistée)

L'onglet **🔍 Review** (bouton 🔍 dans la barre d'action, visible quand un projet
est ouvert) fait jouer à l'agent le rôle de **second reviewer** sur ton diff Git.

**Démarrage** :
1. Clique 🔍 → ouvre l'onglet Review.
2. Choisis la **portée** : « Modifs non commitées (vs HEAD) » ou « Dernier
   commit (HEAD~1..HEAD) ».
3. Choisis un **modèle** (comme pour l'aide ; se souvient du choix).
4. Clique **🔍 Lancer la revue**.

L'agent analyse le diff et produit une revue structurée : 🟢 points positifs,
🔴 bugs, ⚠️ sécurité, ⚡ perfs, 🎨 style, 📐 cohérence specs, 💡 suggestions.

**Questions de suivi** : tape dans la zone en bas (ex: « approfondis la sécurité
du fichier `lib.rs` ») + Entrée. L'historique est réinjecté à chaque tour.

**Points clés** :
- **Lecture seule** : l'agent ne modifie jamais tes fichiers (process pi isolé,
  n'accède pas au projet).
- **Diff Git uniquement** : pas de revue sur des fichiers non versionnés.
- **Repo Git requis** : ouvre un projet versionné, sinon message d'erreur.
- Si le diff est très grand, il est tronqué à 60 k caractères — passe en « dernier
  commit » ou committe par morceaux pour une revue complète.

Voir [`spec_review.md`](spec_review.md) pour le détail technique.
<!-- /HELP:review -->