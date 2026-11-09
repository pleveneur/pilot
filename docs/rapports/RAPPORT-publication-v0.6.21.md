# Rapport de publication — Pilot v0.6.21

Date : 2026-11-06 · Rédigé par le publieur (agent du registre).
Accord de publication : **explicite du propriétaire pour cette version** (0.6.21),
transmis avec la tâche. Aucune publication n'a été décidée de ma propre initiative.

## 1. État du dépôt avant publication

- Branche : `main`, propre hors un document de conception non suivi
  (`docs/conceptions/CONCEPTION-memoire-personnelle-du-personnage.md`).
- Dernier commit avant bump : `c53226e` — « le texte d'instructions qui fige un
  personnage est vu et réparable ».
- Dernière étiquette de référence : `v0.6.20` (publiée).
- Écart avec `origin/main` avant push : 7 commits d'avance (les 7 changements de
  cette version).
- **GDS** : `.pilot/gds.json` porte `"enabled": false` → le projet n'est **pas**
  basculé sur le GDS, la publication GitHub est donc autorisée. `v0.6.21`
  n'existait ni en local ni sur `origin` (vérifié avant toute écriture).

## 2. Contenu réel de la version (7 commits, `v0.6.20..HEAD`)

| Commit | Sujet |
|---|---|
| `c53226e` | Le texte d'instructions qui fige un personnage est vu et réparable |
| `273bced` | Le personnage n'est plus figé dans les instructions |
| `9389c52` | Saisir le modèle du personnage depuis les Options (tâche 403) |
| `dd1407b` | Ouvrir un fichier — onglet de Pilot ou programme par défaut (tâche 394) |
| `ced6312` | L'onglet « Tâches » devient « Travaux » |
| `2b4346e` | Cocher un point de checklist par son nom et clôturer une tâche avec un motif tracé |
| `d4a45c4` | L'étiquette de projet des bulles nomme le projet réellement visé |

## 3. Numéro de version

- Version publiée : **0.6.21** (correctif du dernier chiffre, comme la règle du
  projet l'exige ; aucun recul : 0.6.20 → 0.6.21).
- Bump appliqué dans les **quatre fichiers**, même valeur partout :
  - `src-tauri/tauri.conf.json` (4 : `"version": "0.6.21"`)
  - `src-tauri/Cargo.toml` (3 : `version = "0.6.21"`)
  - `package.json` (4 : `"version": "0.6.21"`)
  - `Cargo.lock` (3335 : `version = "0.6.21"`, **ligne du paquet `pilot`**)

### Nuance à connaître sur « Cargo.toml (racine) »

La tâche indiquait `Cargo.toml` à la racine. Dans ce dépôt, `Cargo.toml` à la
racine est le **manifeste de workspace** : il ne déclare **aucun** paquet et
**aucune** version. Le paquet `pilot` (celui qui porte la version de
l'application) vit dans `src-tauri/Cargo.toml`. C'est donc ce fichier qui a été
modifié, exactement comme lors du bump 0.6.20 (`edb47d7`, qui touchait
`src-tauri/Cargo.toml`). Aucun autre fichier n'a été touché par erreur.

### Piège `Cargo.lock` évité

Aucun `sed` global, aucun ancrage `0,/motif/`. L'édition a ciblé le bloc
`name = "pilot"` puis sa ligne `version` juste en dessous. Vérification après
bump : `0.6.21` apparaît **une seule fois** dans `Cargo.lock` (ligne 3335, paquet
`pilot`) et **zéro** occurrence de `0.6.20` ne subsiste dans les quatre fichiers.

## 4. Changelog

- Fichier : `release-notes/v0.6.21.md` (UTF-8, accents vérifiés sur le disque).
- Rédigé en français simple, orienté utilisateur, trié par catégorie
  (✨ nouvelles fonctionnalités / 🐛 corrections / ⚡ améliorations / ⚠️ à savoir).
- Aucun nom de fichier ni de fonction interne. Contenu limité aux six
  changements visibles confirmés par l'historique des commits et les blocs
  d'aide des specs correspondantes.
- Repris **mot pour mot** par le corps de la Release et par les `notes` de
  `latest.json` (vérifié plus bas).

## 5. Contrôles AVANT publication (tous verts)

| Contrôle | Commande | Résultat exact |
|---|---|---|
| Tests front | `npx vitest run` | **5724 passés, 0 échec** |
| Tests Rust desktop | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **925 passés, 3 ignorés**, 0 échec |
| Tests Rust workspace | `cargo test --workspace` | **1098 passés, 14 ignorés** (6 suites), 0 échec |
| Fabrication du front | `npm run build` (vite) | succès (avertissements de découpage de chunks seulement, préexistants) |

Aucun test n'a été supprimé, ignoré ni assoupli. Les builds des installateurs
sont faits par le workflow de release (voir § 7) : `cargo test --workspace`
compilait déjà l'application et le socle.

## 6. Image locale du serveur GDS — étape SAUTÉE

- `docker --version` répond (Docker 29.4.3), mais le **démon est arrêté** :
  `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`.
- Aucune image locale n'était donc lisible, et rien n'a été démarré : lancer
  Docker Desktop n'est pas de mon ressort et la consigne interdit toute
  consommation inutile.
- Conséquence : **l'image `pilot-gds:local` n'a pas été reconstruite**.
- Aucune commande de nettoyage n'a été exécutée (ni `docker system prune`, ni
  équivalent). `npm run gds:reload` n'a pas été lancé : le conteneur en
  fonctionnement est la décision du propriétaire.

## 7. Étiquette, poussée et workflow

- Commit de bump + changelog + document de conception :
  `632dd366e5dbeac892152e3868bfbb42197f5da1` — `chore: bump version to 0.6.21`
  (6 fichiers, 628 insertions, 4 suppressions).
- `git push origin main` : OK ; `origin/main` = `632dd36`.
- Étiquette : **`v0.6.21`** (annotée), objet `e0c083420b340b794f0a9d27fbc759e593126559`,
  pointant sur `632dd36`, poussée : `refs/tags/v0.6.21` présent sur `origin`.
- Workflow `release` : **run #186**, déclenché par le push du tag `v0.6.21`
  (`head_sha` = `632dd36`).

### État des jobs au moment de ce rapport

| Job | État |
|---|---|
| `test (ubuntu-22.04)` | ✅ success |
| `test-macos` | ✅ success |
| `test (windows-latest)` | ✅ success |
| `create-release` | ✅ success |
| `build (windows-latest, x86_64-pc-windows-msvc)` | ✅ success |
| `build (macos-latest, aarch64-apple-darwin)` | ✅ success |
| `build (macos-latest, x86_64-apple-darwin)` | ✅ success |
| `latest-json` | ✅ success |
| `build-linux` | ⏳ in_progress (hors chemin critique, aucun job n'en dépend) |

### Preuve côté GitHub (fichiers réels)

Release `v0.6.21` : **publiée** (`draft: false`, `prerelease: false`)
le 2026-11-06T07:19:08Z, **11 fichiers** :

- `Pilot_0.6.21_x64-setup.exe` (62,01 Mo) + `.sig`
- `Pilot_0.6.21_x64_en-US.msi` (80,84 Mo) + `.sig`
- `Pilot_0.6.21_aarch64.dmg` (99,07 Mo)
- `Pilot_0.6.21_x64.dmg` (37,61 Mo)
- `Pilot_aarch64.app.tar.gz` (101,47 Mo) + `.sig`
- `Pilot_x64.app.tar.gz` (37,94 Mo) + `.sig`
- `latest.json` (mise à jour automatique)

`latest.json` publié : `version: 0.6.21`, `pub_date 2026-11-06T07:31:23Z`, trois
cibles — `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`. Les `notes`
contiennent bien le changelog français accentué. **macOS est présent** : aucune
mention d'absence macOS n'apparaît (elle n'aurait aucun sens ici).

## 8. Ce que le propriétaire doit vérifier à la main

1. **Le run #186 finit en vert** : seul `build-linux` tournait encore. S'il
   échoue, il est hors chemin critique (aucune conséquence sur Windows/macOS ni
   sur `latest.json`) ; s'il réussit, `latest-json-linux` ajoutera Linux.
2. **Installation réelle** : lancer `Pilot_0.6.21_x64-setup.exe` sur son poste et
   vérifier les six points visibles (étiquette de projet des bulles, cocher un
   point de checklist et clôture refusée nommée, onglet « Travaux », ouverture
   d'un fichier depuis l'Assistant, modèle du personnage dans Options →
   Assistant, encart « Nettoyer ce texte »).
3. **Modèle du personnage** : la référence est écrite dans la **fiche du
   personnage** (`modele.txt`). Vérifier qu'une saisie `fournisseur/modèle`
   correcte s'applique et qu'une référence mal formée est refusée.
4. **Texte d'instructions** : si l'encart de signalement apparaît, vérifier que le
   bouton « Nettoyer ce texte » conserve bien les règles de travail et le cadre,
   et que l'ancienne version reste dans `prompt-history.md`.
5. **Changelog** : relire `release-notes/v0.6.21.md` tel qu'il est publié dans la
   Release. Rien n'y a été inventé : tout correspond aux commits listés au § 2.
6. **Image GDS** (non faite) : si elle est souhaitée, démarrer Docker Desktop puis
   lancer `npm run gds:image` (reconstruction seule). Le rechargement du
   conteneur reste **sa** décision (`npm run gds:reload`).

## 9. Points restés en attente (signalés, non décidés par moi)

- **`package-lock.json`** porte `version: 0.3.9` à la racine (désynchronisation
  antérieure, déjà présente avant cette version). Il ne fait pas partie des
  quatre fichiers de version et le bump 0.6.20 ne l'avait pas touché non plus :
  je ne l'ai pas modifié. À corriger sur décision du propriétaire.
- **Ce rapport n'est pas committé** : il est écrit après le tag, sur le disque.
  Committer le pousserait `main` au-delà de `v0.6.21` ; c'est au propriétaire de
  décider (les rapports de publication précédents, eux, ont été versionnés).
- **Document de conception** `docs/conceptions/CONCEPTION-memoire-personnelle-du-personnage.md` :
  committé tel quel, **sans aucune modification de son contenu**.

## 10. Rien de destructif n'a été fait

Aucun `git reset`, aucun `checkout` écrasant, aucun `force push`, aucune
suppression de fichier, de donnée ou de sauvegarde. Aucun fichier de code
applicatif modifié : cette version ne contient que ce qui était déjà commité.
