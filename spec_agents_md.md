# Spécification — Génération / mise à jour d'AGENTS.md (issue #5)

> Bouton dans la toolbar agent permettant de **créer ou mettre à jour**
> `AGENTS.md` à la racine du projet, via le modèle d'IA actif du chat.
> `AGENTS.md` est le fichier d'instructions projet lu nativement par pi et plh.

## 1. Contexte

`AGENTS.md` est découvert et injecté **nativement** par les coding-agents :

- **pi** : `packages/coding-agent/src/core/resource-loader.ts` — candidates
  `AGENTS.md` / `CLAUDE.md`, remontée des répertoires parents, fichier global
  `~/.pi/agent/AGENTS.md`. Désactivable via `--no-context-files` / `-nc`.
- **plh** : `crates/plh-context/src/project_context.rs` — même logique, fichier
  global `~/.plh/agent/AGENTS.md`. Injection dans une section
  `<project_instructions>` du system prompt.

**Conséquence** : Pilot **n'injecte pas** `AGENTS.md` lui-même (sinon doublon
dans le contexte). Le Context Engine (H1) l'utilise seulement comme **index**
pour parser sa table de navigation et charger les specs référencées — sans
injecter son contenu (cf. `spec_context_engine.md` §3, note AGENTS.md).

## 2. Objectif

Un agent fraîchement ouvert sur le projet doit pouvoir travailler efficacement
dès la première intervention. `AGENTS.md` lui fournit : stack, structure,
commandes, conventions, pièges, navigation vers les specs.

La création manuelle étant fastidieuse, Pilot propose un bouton qui délègue à
l'IA (modèle du chat) l'analyse du projet et la rédaction du fichier.

## 3. UI

### 3.1 Bouton toolbar agent

Bouton **📄** (`data-action="agents-md"`, id `agent-amd-btn`, icône Lucide
`file-text`) dans la toolbar agent, **juste après** le bouton mémoire projet
(📝 `notebook-pen`).

Title : « Générer / mettre à jour AGENTS.md (instructions projet pour l'agent) ».

Au clic :
1. Désactive le bouton (le temps de la génération).
2. Ajoute un message système « 🤖 Génération / mise à jour d'AGENTS.md… ».
3. Appelle `generateAgentsMd(state.currentModel, ui)`.
4. Réussite → toast success + message système + ouvre `AGENTS.md` dans
   l'éditeur (onglet édition) + affiche le résumé de l'agent.
5. Échec → toast error + message système d'erreur.
6. Réactive le bouton (`finally`).

Indépendant de toute option de config (toujours disponible dès qu'un projet
est ouvert et qu'un modèle est sélectionné).

## 4. Commande Rust `generate_agents_md`

`src-tauri/src/agents_md.rs` — `#[tauri::command] generate_agents_md(state,
model: String) -> Result<String, String>`.

- `model` : modèle actif du chat (format `provider/modelId`), fourni par le
  frontend. Vide → erreur (pi `--no-session` n'a pas de modèle par défaut).
- `cwd` = `projectPath` (depuis `state.project_path`) : pi accède à ses outils
  (`ls`, `read`, `write`, `edit`) pour analyser le projet et écrire le fichier.
  **Discovery native** : pi lit l'`AGENTS.md` existant dans son system prompt
  (utile pour la mise à jour — il voit le contenu courant).
- Réutilise `help::ask_pi_caged_timed` (pi temporaire `--mode rpc --no-session`,
  séquence synchronisée `new_session → set_model → prompt`, aucune pollution de
  la session de coding principale).
- Timeout : **300 s** (5 min) — l'agent enchaîne lectures + écriture.
- Retourne le texte de synthèse de l'agent (résumé court des sections
  créées/mises à jour). Le fichier est écrit directement par l'agent.

## 5. Prompt de génération

`build_agents_md_prompt(project_path, exists)` :

- **Création** (`exists = false`) : « CRÉE le fichier AGENTS.md à la racine. »
- **Mise à jour** (`exists = true`) : « METS À JOUR le fichier AGENTS.md.
  Conserve les sections existantes toujours pertinentes, enrichis-les et
  corrige ce qui est obsolète. Ne supprime pas les règles utiles déjà présentes. »

Procédure imposée (l'agent utilise ses outils) :
1. `ls` la structure du projet.
2. Lire les manifestes (README, package.json, Cargo.toml, pyproject.toml,
   tsconfig.json…) + 1–2 fichiers source représentatifs.
3. `write` (création) ou `edit` (mise à jour ciblée) d'`AGENTS.md`.

Contenu attendu (Markdown, 60–120 lignes) :
- Rôle / langue de communication imposée à l'agent.
- Stack technique par couche.
- Structure du projet (schéma en code block).
- Commandes (build, test, lint, run).
- Conventions (nommage, style, patterns).
- Pièges / anti-patterns (si détectables).
- Navigation rapide (optionnel) : table `| Tâche | Fichier(s) à lire |`.

Règles : factuel (uniquement ce qui est observé), concis, commentaires/code en
anglais, prose dans la langue du projet, **ne modifie aucun autre fichier**,
répond par un court résumé (5–10 lignes) sans recopier le contenu.

## 6. Frontend `agents-md.js`

`src/js/agents-md.js` — `generateAgentsMd(model, ui)` :

- Vérifie `window._pilotProjectPath` et `model` (erreurs explicites sinon).
- `ui` = hooks `{ onInfo, onError, onSuccess }` (toasts + messages système,
  fournis par le handler `agent-pi.js`).
- `invoke("generate_agents_md", { model })`.
- Réussite → ouvre `AGENTS.md` dans l'éditeur via `window._pilotTabs.openFile`.
- Retourne le résumé de l'agent (ou `null`).

## 7. Robustesse

- Pas de projet ouvert → erreur claire, pas de crash.
- Pas de modèle sélectionné → erreur claire (le bouton est quand même actif ;
  l'erreur n'apparaît qu'au clic pour ne pas cacher le bouton si le modèle
  n'est pas encore chargé).
- Timeout 5 min → erreur non-bloquante, l'utilisateur peut relancer.
- pi qui échoue (modèle invalide, endpoint injoignable) → erreur remontée avec
  contexte (exit code + stderr) via `ask_pi_caged_timed`.
- L'agent écrit le fichier lui-même : Pilot ne valide pas le contenu (l'utilisateur
  vérifie dans l'éditeur qui s'ouvre automatiquement).
- La session de coding principale n'est **jamais touchée** (pi `--no-session`).

## 8. Limites V1 / futures

- V1 : un seul bouton (créer + mettre à jour automatiquement selon l'existence).
  Une action « régénérer from scratch » (écrasement total) pourrait être ajoutée
  en V2 si besoin.
- V1 : pas de prévisualisation / diff avant écriture. L'utilisateur relit dans
  l'éditeur. Un mode « proposer un diff à valider » = V2 (porte A4 ?).
- V1 : le résumé de l'agent est affiché mais pas persisté. Un historique des
  générations = V2.

<!-- HELP:agents-md -->
### 📄 Générer / mettre à jour AGENTS.md

Pilot peut générer ou mettre à jour le fichier `AGENTS.md` à la racine du
projet en utilisant l'IA.

- **Bouton 📄** (toolbar agent, à côté du bouton 📝 mémoire projet) : analyse
  le projet (structure, manifestes, fichiers source) et crée ou met à jour
  `AGENTS.md`. Utilise le **modèle actif du chat**.
- `AGENTS.md` est lu automatiquement par pi et plh au début de chaque session :
  c'est le fichier d'instructions projet (stack, structure, commandes,
  conventions, pièges). Pilot ne le réinjecte pas (discovery native).
- En **mise à jour**, l'agent conserve les sections existantes toujours
  pertinentes et enrichit/corrige le reste.
- Après génération, le fichier s'ouvre dans l'éditeur pour vérification.
<!-- /HELP:agents-md -->