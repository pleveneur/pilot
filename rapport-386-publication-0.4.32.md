# Rapport — Mission 386 : publication de la version 0.4.32

Date : 2026-10-19
Autorisation : explicite du propriétaire (seule mission autorisée à pousser sur GitHub).

## 1. État de départ vérifié

- `git status --porcelain` : dépôt propre, hors un fichier **non suivi** `geminiReport.md`
  (interdit d'enregistrement par la mission → laissé hors de tout `git add`).
- Dernier commit : `0d36bc5 docs(rapport): resultats des tests de la mission 385`.
- Version 0.4.31 confirmée dans `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml` et `Cargo.lock` (package `pilot`, ligne 3333).
- Tag `v0.4.32` : **absent** en local (`git tag --list`) et **absent** sur le distant
  (`git ls-remote --tags origin v0.4.32` → aucune sortie). Aucune republication.

Commits livrés depuis `v0.4.31` (contenu réel des notes de version) :

```
0d36bc5 docs(rapport): resultats des tests de la mission 385
ae57383 feat(file): file d'attente des taches par projet, visible et sans place perdue
5bc3e51 docs(verrou): consigner la re-verification des trois ecarts de la mission 380bis
73a48b4 test(lancement): preuve d'execution que l'agent lance est l'agent demande
96d5b03 fix(agents): le plan-maker va au bout et livre un plan (mission 384)
4ce4285 fix(lancement): ne plus prescrire de plan prealable dans le prompt
76e03f1 fix(verrou): liberation fiable sur tous les chemins de sortie d'un agent
813095c fix(lancement): l'agent lance est exactement l'agent demande
eb1aeae fix(verrou): ne plus laisser un projet bloque apres la fin, l'echec ou la mort
```

## 2. Ce qui a été fait

### 2.1 Notes de version utilisateur

`release-notes/v0.4.32.md` rédigées en français, orientées utilisateur, sans
jargon, sans nom de fichier ni de fonction, triées par catégorie :

- ✨ Nouvelles fonctionnalités : une seule tâche à la fois par projet avec les
  autres en attente et file visible (`/file`, `/file vide`) ; bandeau discret
  « en cours / en attente (2e) ».
- 🐛 Corrections : l'agent lancé est exactement celui demandé (fin du
  planificateur parasite) ; un projet n'est plus bloqué après la fin, l'échec ou
  l'arrêt d'un agent ; messages plus clairs quand une run est interrompue.
- ⚡ Améliorations : le plan préalable devient facultatif ; le planificateur va
  au bout de son travail.

### 2.2 Bump de version à 0.4.32 — quatre fichiers

| Fichier | Ligne | État |
|---|---|---|
| `package.json` | 4 | `"version": "0.4.32"` |
| `src-tauri/tauri.conf.json` | 4 | `"version": "0.4.32"` |
| `src-tauri/Cargo.toml` | 3 | `version = "0.4.32"` |
| `Cargo.lock` | 3333 | `version = "0.4.32"` (sous `name = "pilot"`, ligne 3332) |

Piège `Cargo.lock` respecté : **aucun `sed` global**. L'édition a été faite par
remplacement ciblé du bloc `name = "pilot"\nversion = "0.4.31"`.
Vérification après coup :

```
$ grep -c '0.4.32' Cargo.lock
1
$ grep -n -B1 'version = "0.4.32"' Cargo.lock
3332-name = "pilot"
3333:version = "0.4.32"
```

→ La **seule** occurrence de `0.4.32` dans `Cargo.lock` est celle du package
`pilot` : aucune dépendance n'a été verrouillée à une version inexistante.

### 2.3 Aide intégrée (handbook)

`npm run build:handbook` exécuté : `help/handbook.md` régénéré (41 blocs,
173 904 octets). `git status` ne montre **aucune** modification de
`help/handbook.md` → le fichier généré était déjà à jour (les blocs `<!-- HELP:* -->`
des commits de la journée l'avaient alimenté). Contrôle de contenu : la
documentation de la file (`/file`, `/file vide`, « en attente (2e) ») est bien
présente dans le handbook généré.

### 2.4 Tests

**Tous verts** avant d'aller plus loin (condition d'arrêt respectée).

- Frontend — `npm test` (Vitest) :
  `Test Files 110 passed (110)` / `Tests 1893 passed (1893)`, durée 5,25 s.
  (Les traces `[code-graph] … window is not defined` en sortie standard sont des
  messages attendus d'un test qui simule l'absence de `window` ; le fichier
  `code-graph.test.js` est passé : 6 tests OK.)
- Rust — `cargo test --manifest-path src-tauri/Cargo.toml --lib` :
  `Compiling pilot v0.4.32` puis `641 passed, 1 ignored` (1 suite, 10,45 s).
  L'avertissement `sqlx-postgres v0.8.0` (future incompatible) est préexistant et
  sans effet sur les tests.

### 2.5 Commit unique

Un seul commit : « chore: bump version to 0.4.32 », contenant la version
(4 fichiers) + `release-notes/v0.4.32.md` + ce rapport.
`geminiReport.md` volontairement **non** ajouté.

### 2.6 Push et tag

- `git push origin main`
- `git tag v0.4.32 && git push origin v0.4.32`

Le workflow `.github/workflows/release.yml` construit et publie les 4 plateformes.

### 2.7 Image du serveur GDS

**Non reconstruite** — conforme à la consigne : ce projet n'est pas basculé sur
le GDS, l'étape 2 du protocole de release ne s'applique pas ici.

## 3. Vérifications après push

_(section complétée après le push — voir ci-dessous)_

## 4. Interdits respectés

- Aucun `git push --force`, aucune réécriture d'historique.
- Aucune republication de tag (le tag `v0.4.32` n'existait ni en local ni sur le distant).
- Aucune écriture dans `%APPDATA%`.
- Aucun appel à `list_agent_sessions` ni à un outil listant les sessions.
- `geminiReport.md` non enregistré (laissé non suivi).
