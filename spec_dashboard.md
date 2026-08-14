# Spécification — Tableau de bord projet

> Onglet **📊 Tableau de bord** : vue détaillée du **projet actif**, alimentée
> par les métriques fichiers/Git (Rust) + la base de suivi de l'assistant
> (super-agent) + l'index de sessions (session_history). **Lecture seule** : ne
> modifie aucun fichier du projet. Issue #51.

<!-- HELP:dashboard -->
## Aide utilisateur — Tableau de bord

L'onglet **📊 Tableau de bord** (bouton **📊** de la barre latérale, visible
quand un projet est ouvert) affiche une vue d'ensemble du **projet actif** :
stockage, Git, langages, activité de l'agent IA, vélocité et documentation.
Tout est **en lecture seule** : le tableau de bord n'édite jamais vos fichiers.

### Ce que vous voyez
- **En-tête** : nom du projet, chemin local, client associé (si renseigné dans
  l'onglet 🧭 Assistant) et horodatage du dernier rafraîchissement.
- **Stockage & Poids** : taille totale du répertoire, nombre de fichiers et de
  dossiers, poids du **code source pur** (hors dépendances/caches comme
  `node_modules`, `target`, `.git`…) et les fichiers les plus lourds.
- **État Git** : branche active, fichiers modifiés, non suivis (untracked) et
  prêts à être commités (staged).
- **Analyse du Code & Langages** : répartition des langages en %, métriques
  globales (lignes, fonctions, classes), marqueurs TODO/FIXME et écosystème de
  dépendances détecté (Node.js, Rust/Cargo, Python…).
- **Activité & Métriques de l'Agent IA** : nombre de sessions, tokens
  consommés sur 7 jours, total de messages échangés, actions exécutées (Bash,
  éditions, écritures) et date de la dernière session.
- **Évolution & Vélocité (7 jours)** : commits, fichiers modifiés, lignes et
  taille modifiées sur la période.
- **Contexte & Documentation** : extrait du README, fichiers de mémoire /
  décisions d'architecture, derniers fichiers modifiés avec horodatage relatif.
- **Bandeau d'Alertes & Suggestions** : badges des points d'attention (fichiers
  volumineux, éléments non commités, langage principal).

### Actualiser
Le bouton **Actualiser** relance l'analyse du projet. L'analyse peut prendre
quelques secondes sur les gros projets (parcours du répertoire + Git).
<!-- /HELP:dashboard -->

---

## Architecture

| Couche | Rôle |
|---|---|
| **Backend** `src-tauri/src/dashboard.rs` | Commande `get_project_dashboard` : scan du répertoire (stockage, langages, métriques code), état Git, activité agent, vélocité, contexte, alertes. Réutilise `crate::run_captured` (git), `session_history::read_session_index` / `project_sessions_dir` / `project_to_session_folder` (activité) et la config (client associé). |
| **Frontend** `src/js/dashboard.js` | `createDashboard(container)` : rend les 8 sections, bouton Actualiser, appel `invoke("get_project_dashboard")`. |
| **Onglet** `src/js/tabs.js` | Mode `dashboard` (`_openDashboard`), bouton 📊 dans `index.html` + câblage `main.js`. |
| **CSS** `src/css/style.css` | Classes `.dash-*` (cartes, métriques, barres de langages, alertes). |

## Sections & sources de données

| Section | Source |
|---|---|
| En-tête (nom, chemin, client, rafraîchissement) | `state.project_path` + config `super_agent_project_client` + horodatage local |
| Stockage & Poids | Scan récursif du répertoire (exclusion des dossiers de dépendances/caches) |
| État Git | `git rev-parse` / `git status --porcelain` (via `run_captured`) |
| Analyse Code & Langages | Scan des fichiers code (extension → langage), comptage lignes/fonctions/classes, TODO/FIXME, détection des manifests de dépendances |
| Activité Agent | Index `.pilot/sessions.jsonl` (sessions, tokens 7 j, messages) + scan des fichiers de session pi (actions d'outils) |
| Évolution & Vélocité | `git log --since=7 days ago` (commits) + fichiers modifiés sur 7 j (mtime) |
| Contexte & Documentation | README (extrait), fichiers mémoire/décisions, derniers fichiers modifiés |
| Alertes & Suggestions | Règles : fichiers volumineux, éléments non commités, langage principal, taille globale |

## Règles

- **Lecture seule stricte** : aucune commande ne modifie les fichiers du projet.
- **Robustesse** : le scan ignore les dossiers exclus (`node_modules`, `target`,
  `.git`, `dist`, `build`, `.venv`, `__pycache__`, `.pilot`, …) et tolère les
  fichiers illisibles / binaires (métriques code limitées aux fichiers texte
  < 2 Mo).
- **Non bloquant** : l'analyse est exécutée dans la commande Tauri (le frontend
  affiche un état « Analyse… » pendant le chargement).
- **Pas de doublon de l'onglet 🧭 Assistant** : l'Assistant est un chat de
  suivi multi-projets ; le Tableau de bord est une vue de métriques du projet
  actif. Le dashboard s'appuie sur la base de l'assistant (client) mais ne
  remplace pas sa conversation.
