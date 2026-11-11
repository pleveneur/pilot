# Rapport de publication — Pilot v0.4.35

Date : 2026-10-20
Agent : codeur (registre Pilot)
Objet : publier v0.4.35 (la v0.4.34 est sortie VIDE : aucune binaire, aucun fichier de
mise à jour — un test réseau échouait sur la machine Linux de la chaîne, corrigé au
commit 2555bc0).

## 1. Base de départ (avant bump)

| Suite | Attendu | Résultat | Verdict |
|---|---|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 651 | 651 passés, 1 ignoré, 0 échec | ✅ |
| `npm test` | 2062 | 2062 passés (120 fichiers), 0 échec | ✅ |

## 2. Notes de version

`release-notes/v0.4.35.md` rédigé en français, orienté utilisateur, trié par
catégories. Il reprend **tout** ce qui a été corrigé depuis la version installée
(0.4.33), puisque rien n'a été publié entre-temps :

- ✨ agent qui travaille sans onglet ouvert → repère « arrière-plan » ;
  arrêts d'agent nommés (plus seulement comptés).
- 🐛 agent non coupé au bout de 25 min (outil long ≠ blocage) ; bip de fin de tour
  qui ne sonne plus au milieu du travail ; file de tâches vidée toujours
  journalisée avec son motif.
- ⚡ garde-fou de vérification étendu + preuve de non-vacuité ; chaîne de
  publication rendue déterministe (test MCP) ; documentation et aide intégrées à
  jour.

## 3. Bump 0.4.34 → 0.4.35

Quatre fichiers modifiés, même valeur partout :

| Fichier | Avant | Après |
|---|---|---|
| `src-tauri/tauri.conf.json` | 0.4.34 | 0.4.35 |
| `package.json` | 0.4.34 | 0.4.35 |
| `src-tauri/Cargo.toml` (package `pilot`) | 0.4.34 | 0.4.35 |
| `Cargo.lock` (racine, package `pilot`) | 0.4.34 | 0.4.35 |

Contrôle anti-piège (incident v0.2.30) : `grep 'version = "0.4.35"' Cargo.lock`
→ **1 seule** occurrence (ligne 3333, package `pilot`). Aucun `sed` global utilisé
(édition ciblée via l'outil d'édition). Aucune occurrence résiduelle de `0.4.34`
dans ces quatre fichiers.

## 4. Vérifications après bump

| Commande | Résultat | Verdict |
|---|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 651 passés, 1 ignoré, 0 échec | ✅ |
| `npm test` | 2062 passés, 0 échec | ✅ |
| `npm run build` | exit 0, aucun avertissement nouveau (mêmes avertissements de découpage de chunks qu'avant) | ✅ |

## 5. Commit / push / tag

- Commit : `3c670644c52680bb6df9b548e4724fd3ea5cfaad` —
  `chore: bump version to 0.4.35` (bump 4 fichiers + `release-notes/v0.4.35.md`)
- Push `main` → `origin/main` : OK (exit 0)
- Tag `v0.4.35` créé puis poussé : OK (exit 0)

## 6. Vérification du tag sur le distant

```
$ git ls-remote --tags origin v0.4.35
3c670644c52680bb6df9b548e4724fd3ea5cfaad	refs/tags/v0.4.35
```

- Hash du commit taggé (local `HEAD` = tag `v0.4.35`) :
  `3c670644c52680bb6df9b548e4724fd3ea5cfaad` — identique au tag distant ✅
- `v0.4.34` intact sur le distant :
  `0faf12a93f02c4bded8fb8f46b4b069e5b573f13  refs/tags/v0.4.34` (inchangé, non
  touché, non déplacé, non supprimé).

## 7. Suite à surveiller (hors mission)

Le workflow `release.yml` doit produire les binaires des 4 plateformes et
`latest.json`. Le test MCP qui bloquait le build Linux est désormais déterministe
(commit `2555bc0`) : c'est précisément le point à confirmer en regardant le run du
tag `v0.4.35`. Cette vérification de bout en bout (releases publiées, artefacts
non vides) n'entre pas dans cette mission.

## Points de vigilance respectés

- Aucun tag posé avant que les deux suites soient vertes.
- Le tag et la release `v0.4.34` n'ont été ni touchés, ni déplacés, ni supprimés
  (nettoyage = mission séparée).
- Aucun tag existant republié.
- Aucun code applicatif modifié : uniquement version + notes + ce rapport.
- `geminiReport.md` non touché. Aucun appel à `list_agent_sessions`.
