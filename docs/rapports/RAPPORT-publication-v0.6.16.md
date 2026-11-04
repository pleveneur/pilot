# Rapport — préparation et publication de la version 0.6.16

**Date** : 2026-11-04 · **Publieur** (rôle publication) · **Projet** : `G:\IA_PL\pilot`

## 1. Verdict en une ligne

**La version 0.6.16 n'est PAS publiée.** Le commit et l'étiquette sont sur GitHub,
mais **aucune release n'a été créée** : le workflow de publication s'est arrêté
parce que la machine de test macOS n'a jamais été attribuée (job « annulé »), ce
qui a mis en échec en cascade la création de la release et les deux passes
`latest.json`. Les contrôles **locaux** étaient tous verts — c'est la chaîne
d'édition qui a échoué, pas le code.

## 2. État du dépôt au départ

| Point | Constat |
|---|---|
| Branche | `main` |
| Dépôt propre | **oui** (`git status --short` vide) |
| GDS actif | **non** — `.pilot/gds.json` : `"enabled": false` ⇒ publication GitHub autorisée |
| Dernière étiquette avant travaux | `v0.6.15` |
| Commits à publier | 13 (dont les sept corrections/évolutions confiées au codeur) |
| Remote | `origin` = `https://github.com/pleveneur/pilot.git` |

## 3. Les sept rapports annoncés — tous présents

| # | Sujet | Fichier | Présent |
|---|---|---|---|
| 1 | Liste des tâches affichée / suivi réel | `docs/rapports/RAPPORT-liste-taches-affichee.md` | oui |
| 2 | Micro du mode Vocal qui s'arrêtait seul | `docs/rapports/RAPPORT-micro-arret-mode-vocal.md` | oui |
| 3 | Halo figé sur une parole longue | `docs/rapports/RAPPORT-halo-parole-longue.md` | oui |
| 4 | Conversation en bas au retour du mode Vocal | `docs/rapports/RAPPORT-retour-mode-conversation-en-bas.md` | oui |
| 5 | Mots de réveil paramétrables | `docs/rapports/RAPPORT-mots-de-reveil.md` | oui |
| 6 | Genre de l'Assistant (+ modèle par personnage) | `docs/rapports/RAPPORT-genre-et-modele-par-personnage.md` | oui |
| 7 | Agents jetables par défaut | `docs/rapports/RAPPORT-agents-jetables-par-defaut.md` | oui |

## 4. Contrôles locaux — TOUS VERTS (chiffres réels, mesurés sur ce poste)

| Contrôle | Commande | Résultat |
|---|---|---|
| Tests front | `npm test` | **300 fichiers, 5594 tests passés, 0 échec** (15,63 s) |
| Tests Rust (espace complet) | `cargo test --workspace` | **1075 passés, 14 ignorés, 0 échec** |
| Front reconstruit | `npm run build` | **succès** |
| Fabrication de l'application | `npm run tauri build` | **succès** : `target\release\pilot.exe`, `Pilot_0.6.15_x64_en-US.msi`, `Pilot_0.6.15_x64-setup.exe` (profil release, 2 min 05) |
| Re-contrôle après bump front | `npm test` | **300 fichiers, 5594 tests passés, 0 échec** |
| Re-contrôle après bump Rust | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **902 passés, 3 ignorés, 0 échec** |

**Point à connaître sur la fabrication locale** : la signature de mise à jour
échoue sur ce poste (`incorrect updater private key password`) parce que le mot
de passe de la clé privée n'est pas disponible ici — il est détenu par le
propriétaire et fourni au workflow par les secrets GitHub. Cela n'empêche ni la
fabrication du binaire ni celle des deux installateurs, et **ce n'est pas la
cause de l'échec** : c'est le workflow qui signe les artefacts publiés.

## 5. Version et bump — faits et vérifiés

- Version retenue : **0.6.16** (règle du projet : correctifs/évolutions ⇒ dernier
  chiffre ; aucune rupture ⇒ pas de montée de `0.6` à `0.7`). `v0.6.16` était
  libre (vérifié localement **et** sur le remote avant de taguer).
- Bump appliqué aux **quatre** fichiers, même valeur partout :
  `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `Cargo.lock`.
- `Cargo.lock` : édition **ciblée** sur le paquet racine (`name = "pilot"`, ligne
  3334-3335), **jamais** de `sed` global. Vérification : `version = "0.6.16"`
  apparaît **une seule fois** dans `Cargo.lock`, et c'est bien celle de `pilot`.
  L'autre `0.6.15` restant dans le fichier est celui de la dépendance
  `mac-notification-sys` — normal, non touché.

## 6. Changelog utilisateur

Fichier écrit et committé : **`release-notes/v0.6.16.md`** (en français, accentué,
orienté utilisateur) : trois nouveautés (mots de réveil, genre de l'Assistant,
modèle porté par le personnage), trois corrections (micro du mode Vocal, halo sur
parole longue, conversation au retour du plein écran), deux améliorations (volet
« Tâches » fidèle au suivi, agents jetables), et une section « ce que vous devez
savoir » rappelant qu'aucune nouveauté ne s'active d'elle-même.

## 7. Ce qui a été poussé (preuves)

| Élément | Valeur | Preuve |
|---|---|---|
| Commit de bump | `cd1a860` « chore: bump version to 0.6.16 » (5 fichiers) | `git log --oneline -1` |
| `main` sur GitHub | `cd1a860e3bd0b0f2b789225a25ea68ed09fded6e` | `git ls-remote origin refs/heads/main` |
| Avance locale restante | 0 commit | `git rev-list --count origin/main..main` = 0 |
| Étiquette | `v0.6.16` → `cd1a860e3bd0b0f2b789225a25ea68ed09fded6e` | `git ls-remote origin refs/tags/v0.6.16` |

## 8. L'échec de la chaîne d'édition — cause exacte

Run GitHub Actions **41857186819**, événement `push` sur le tag `v0.6.16`,
conclusion **failure**. Détail des jobs :

| Job | Résultat |
|---|---|
| `tests` (quality-gate) | **success** |
| `test (windows-latest)` | **success** |
| `test (ubuntu-22.04)` | **success** |
| `test (macos-latest)` | **cancelled** ← cause racine |
| `create-release` | skipped (dépend du job de test) |
| `build` (Windows + macOS = chemin critique) | skipped |
| `build-linux` | skipped |
| `latest-json` | failure (aucun artefact à publier) |
| `latest-json-linux` | failure |

Le job `test (macos-latest)` a démarré à 15:23:15 et s'est terminé « cancelled » à
15:38:17 **sans avoir exécuté une seule étape** : il est resté en file et n'a
jamais obtenu de machine. C'est la panne déjà connue sous le nom « not acquired by
Runner of type hosted » (pénurie de runners macOS arm64), documentée dans le
workflow pour expliquer la tolérance `continue-on-error` posée sur macOS — mais
cette tolérance couvre un **échec**, pas une **annulation**, donc le run entier
est tombé.

Conséquence vérifiée : `GET /repos/pleveneur/pilot/releases/tags/v0.6.16` répond
**404**. Il n'y a **ni release, ni fichier d'installation, ni `latest.json`** pour
0.6.16, et donc aucune mise à jour automatique ne partira vers les postes
installés.

## 9. Ce que je n'ai pas fait, volontairement

- **Aucun `git` destructif** : pas de `reset`, pas de `revert` du commit, pas de
  force-push.
- **Aucune suppression d'étiquette** : `v0.6.16` reste en place (supprimer puis
  repousser un tag est un geste destructif et interdit par mes règles).
- **Aucune republication d'étiquette** : je n'ai pas retagué, je n'ai pas poussé
  le même tag une seconde fois.
- **Aucun test assoupli ni contourné**, aucun `ALLOW_*` de sortie de secours
  utilisé.
- **Aucune tâche du suivi supprimée**, aucune règle de travail modifiée.

## 10. Ce que le propriétaire doit faire à la main (sa décision)

Deux voies, au choix — je n'en prends aucune sans son accord :

1. **Relancer la chaîne sur le même commit** (le plus propre, aucune étiquette
   touchée) : ouvrir
   https://github.com/pleveneur/pilot/actions/runs/41857186819
   puis **« Re-run all jobs »**. Si un runner macOS est cette fois attribué (ou si
   le job est annulé à nouveau mais que le reste passe), la release et
   `latest.json` se créeront normalement. Le workflow n'a **pas** de déclencheur
   manuel (`workflow_dispatch`) : cette relance depuis l'interface est la seule
   voie non destructive.
2. **Abandonner 0.6.16 et publier 0.6.17** : nouveau bump, nouveau changelog
   (copie de `v0.6.16.md`), nouveau commit, nouvelle étiquette. L'étiquette
   `v0.6.16` resterait alors orpheline (sans release) — c'est acceptable, mais il
   faut le savoir.

**Piste durable à trancher** (hors de mon rôle, je ne modifie pas les règles de
travail) : rendre la tolérance macOS insensible à l'**annulation** et pas
seulement à l'échec, pour qu'une machine macOS manquante ne fasse plus tomber le
chemin critique Windows.

## 11. À vérifier à la main après la relance

1. La page des releases affiche bien **Pilot v0.6.16** avec le texte du
   changelog (accents corrects).
2. Les fichiers attendus sont présents : installateur Windows NSIS
   (`*_x64-setup.exe`), paquet `.msi`, les deux `.app.tar.gz` macOS avec leur
   `.sig`, et `latest.json`.
3. Dans `latest.json`, la plateforme `windows-x86_64` pointe sur l'artefact
   **NSIS** (le MSI est volontairement écarté pour cette cible).
4. Un poste déjà installé détecte la mise à jour au démarrage suivant et
   l'installe sans erreur de signature.
5. Dans l'application mise à jour : les quatre corrections visibles (micro du
   mode Vocal, halo, retour de conversation, volet « Tâches ») et les trois
   réglages (mots de réveil, genre, modèle par personnage), **tous inactifs par
   défaut**.
