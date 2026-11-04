# Rapport — publication d'une version unique (mission arrêtée, rien n'est publié)

**Date** : 2026-11-04 · **Rôle** : publieur · **Projet** : `G:\IA_PL\pilot`
**Verdict en une ligne** : **AUCUNE release n'a été créée.** Les contrôles locaux
sont tous verts, mais la chaîne d'édition GitHub échoue parce que le runner
macOS n'est jamais attribué (job **annulé**), ce qui met en échec en cascade la
création de la release et les deux passes `latest.json`. Un contrôle rouge
arrête tout : je m'arrête ici et je rends la main.

---

## 1. État trouvé au départ — le brief était périmé sur deux points

Le contexte de mission annonçait « un commit bump 0.6.15, tag v0.6.15 poussé,
aucun fichier de notes pour 0.6.15, corrections non faites ». **Vérifié, et c'est
faux** : la réalité avait déjà deux versions d'avance.

| Point annoncé dans le brief | Réalité constatée (preuve) |
|---|---|
| Dernier tag = `v0.6.15` | Dernier tag = **`v0.6.16`**, puis `v0.6.17` créé par cette mission |
| `release-notes/v0.6.15.md` absent | **présent** (4,1 Ko), et `v0.6.16.md` aussi (3,9 Ko) |
| Publication 0.6.15 refusée/incomplète, utilisateur non servi | **faux** : release `v0.6.15` **publiée** le 2026-11-04T10:27:44Z, **11 fichiers**, `latest.json` présent ; c'est elle qui sert les mises à jour (`/releases/latest` → `v0.6.15`) |
| Les trois lots de corrections non faits | **tous faits et sur `main`** (voir § 2) |

État du dépôt avant travaux : branche `main`, **dépôt propre** (0 modification),
`origin/main` = `0937fbc`, avance locale de 5 commits de documentation seulement.

**Verrou GDS** : `.pilot/gds.json` → `"enabled": false`. Le projet **n'est pas**
basculé sur le GDS ⇒ publication GitHub autorisée par ma règle absolue.

**Étiquettes déjà prises (les deux poussées sur `origin`)** :
`v0.6.15` → `051929b`, `v0.6.16` → `cd1a860`. Aucune des deux n'est republiable.

---

## 2. Les trois lots sont réellement sur `main`

22 commits séparent `v0.6.15` de la tête. Aucun fichier de code n'a été touché
après le tag `v0.6.16` (uniquement des rapports, deux specs et le handbook).

| Lot | Commits | Rapport sur disque |
|---|---|---|
| 1 · Liste des tâches affichée ≠ suivi | `6329ff5` | `RAPPORT-liste-taches-affichee.md` (11 919 o) |
| 2 · Mode Vocal : micro qui s'arrête | `0f0ce3b` | `RAPPORT-micro-arret-mode-vocal.md` (9 556 o) |
| 2 · Mode Vocal : halo figé | `6850cb2` | `RAPPORT-halo-parole-longue.md` (10 764 o) |
| 2 · Mode Vocal : retour en haut | `f102bf8`, `cf99544`, `e3debe1` | `RAPPORT-retour-mode-conversation-en-bas.md` (16 251 o) |
| 3 · Mots de réveil | `ee7607e` | `RAPPORT-mots-de-reveil.md` (8 434 o) |
| 3 · Genre de l'Assistant (+ modèle par personnage) | `6bdbb0d`, `df328d2` | `RAPPORT-genre-et-modele-par-personnage.md` (11 946 o) |
| 3 · Agents jetables par défaut | `09ac19d`, `3fd5bba`, `d9d15c1` | `RAPPORT-agents-jetables-par-defaut.md` (14 486 o) |

Rapports de synthèse complémentaires, également présents :
`RAPPORT-mode-vocal-trois-correctifs.md`, `RAPPORT-reglages-assistant.md`.

**Les trois lots sont donc complets : aucun n'était à refaire.** Ce constat a
guidé la suite (rien à corriger, seulement à publier).

---

## 3. Contrôles AVANT publication — tous verts, chiffres mesurés sur ce poste

| Contrôle | Commande | Résultat réel |
|---|---|---|
| Tests front (avant bump) | `npm test` | **300 fichiers, 5594 tests passés, 0 échec** (15,68 s) |
| Tests Rust (espace complet) | `cargo test --workspace` | **1075 passés, 14 ignorés, 0 échec** (6 suites, 12,64 s) |
| Front reconstruit | `npm run build` | **succès** (code 0) |
| Fabrication de l'application | `npm run tauri build` | **binaire + 2 installateurs produits** (voir ci-dessous) |
| Tests front (après bump 0.6.17) | `npm test` | **300 fichiers, 5594 tests passés, 0 échec** |
| Tests Rust lib (après bump) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **902 passés, 3 ignorés, 0 échec** |

**Fabrication en détail** (`npm run tauri build`, code de sortie 1) :
`Finished release profile in 2m 12s`, `Built application at target\release\pilot.exe`,
puis deux installateurs réellement écrits :
`target\release\bundle\msi\Pilot_0.6.16_x64_en-US.msi` et
`target\release\bundle\nsis\Pilot_0.6.16_x64-setup.exe`.
Le code de sortie 1 vient **uniquement** de la dernière étape : `Error A public key
has been found, but no private key` — la clé privée de signature de mise à jour
n'existe pas sur ce poste (elle est détenue par le propriétaire et fournie au
workflow par les secrets GitHub). Ce n'est **pas** un échec de fabrication et
**pas** la cause de l'arrêt.

Aucun test n'a été modifié, assoupli ni contourné. Aucun `ALLOW_*` de sortie de
secours n'a été employé.

---

## 4. Version retenue et bump — faits

- **Version retenue : `0.6.17`.** `v0.6.16` est déjà taguée et poussée (donc
  jamais republiable), et `v0.6.15` est publiée. La règle du projet (correctifs ⇒
  dernier chiffre) imposait la suivante, sans jamais reculer.
- `v0.6.17` était **libre localement et sur `origin`** avant de taguer (seul
  `v0.6.16` apparaissait dans `git ls-remote --tags`).
- Bump appliqué aux **quatre** fichiers, même valeur : `package.json`,
  `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `Cargo.lock`.
- **`Cargo.lock`** : édition **ciblée** sur le paquet racine (`name = "pilot"`,
  lignes 3334-3335), **jamais** un remplacement global. Vérification après coup :
  `version = "0.6.17"` apparaît **une seule fois** dans le fichier, et c'est bien
  celle de `pilot`. Aucune dépendance n'a été touchée ; `0.6.16` n'apparaît plus.

**Changelog** : `release-notes/v0.6.17.md` rédigé en français, accentué, orienté
utilisateur (aucun nom de fichier, aucune fonction, aucun jargon interne) :
trois nouveautés (mots de réveil, genre de l'Assistant, modèle porté par le
personnage), trois corrections du mode Vocal, deux améliorations (volet
« Tâches » fidèle au suivi, agents jetables), et une section « ce que vous devez
savoir » rappelant que rien ne s'active de soi-même. Il inclut explicitement les
trois lots confiés.

---

## 5. Ce qui a été poussé, et ce qui n'a PAS été publié

| Élément | Valeur | Preuve |
|---|---|---|
| Commit de bump | `063a53b` « chore: bump version to 0.6.17 » (5 fichiers) | `git log --oneline -1` |
| `main` sur GitHub | `063a53b5226a3af0eb28e9a9db8729a7169d597d` | `git ls-remote origin refs/heads/main` |
| Étiquette `v0.6.17` | → `063a53b5226a3af0eb28e9a9db8729a7169d597d` | `git ls-remote --tags origin \| grep v0.6.17` |
| **Release `v0.6.17`** | **AUCUNE** — `GET /releases/tags/v0.6.17` → **HTTP 404** | API GitHub |
| **Release `v0.6.16`** | **AUCUNE** — `GET /releases/tags/v0.6.16` → **HTTP 404** | API GitHub |
| Release qui sert les mises à jour | **`v0.6.15`** (11 fichiers, `latest.json` présent) | `GET /releases/latest` |

**Je ne dis donc pas « publié » : il n'y a ni release, ni fichier d'installation
publié, ni `latest.json` pour 0.6.17.** Les postes installés restent servis par
0.6.15.

---

## 6. Cause exacte de l'arrêt — infrastructure, pas code

Run GitHub Actions **41867732096**, événement `push` sur l'étiquette `v0.6.17`,
conclusion **failure** :

| Job | Résultat |
|---|---|
| `test (windows-latest)` | **success** |
| `test (ubuntu-22.04)` | **success** |
| `test (macos-latest)` | **cancelled** ← cause racine |
| `create-release` | **skipped** (dépend du job de test) |
| `build` (Windows + macOS = chemin critique) | **skipped** |
| `build-linux` | **skipped** |
| `latest-json` / `latest-json-linux` | **failure** (aucun artefact à publier) |

C'est **exactement** la panne qui avait déjà bloqué 0.6.16 (run 41857186819) :
le runner macOS arm64 n'est jamais attribué (file d'attente sans machine,
« not acquired by Runner of type hosted »), le job est **annulé** au bout de
~15 minutes sans avoir exécuté une seule étape, et comme `create-release` est en
`needs: [test]`, l'annulation fait tomber toute la chaîne.

**Pourquoi un 0.6.18 n'aurait rien changé** : la cause est la disponibilité des
runners GitHub macOS, pas le contenu du dépôt. Un nouveau bump aurait produit le
même `cancelled`, en laissant une **troisième** étiquette orpheline. J'ai donc
refusé de le faire : « une seule version, la plus propre possible ».

**Pourquoi je n'ai pas relancé le run existant** : ni l'outil `gh` ni aucun jeton
GitHub ne sont disponibles sur ce poste (vérifié). La relance depuis l'interface
GitHub est un geste du propriétaire.

---

## 7. Ce que j'ai refusé de faire, volontairement

- **Aucune republication d'étiquette** : `v0.6.15` et `v0.6.16` n'ont pas été
  retaguées, ni supprimées, ni repoussées.
- **Aucun `git` destructif** : pas de `reset`, pas de `revert`, pas de
  `checkout` écrasant, pas de force-push, aucune suppression d'étiquette.
- **Aucun test touché ni assoupli**, aucun `ALLOW_*` de secours.
- **Aucune tâche du suivi supprimée**, **aucune règle de travail modifiée**.
  En particulier, je n'ai **pas** touché `.github/workflows/release.yml` : rendre
  la tolérance macOS insensible à l'**annulation** (et pas seulement à l'échec)
  relève d'une décision du propriétaire, pas de mon rôle.
- **Aucun chiffre recopié** : tous les résultats ci-dessus ont été mesurés pendant
  cette mission.

---

## 8. Ce qui reste ouvert

1. **Deux étiquettes sans release** : `v0.6.16` (`cd1a860`) et `v0.6.17`
   (`063a53b`). Elles restent en place, ce sont des faits acquis — les supprimer
   serait destructif.
2. **La mise à jour automatique sert toujours 0.6.15.** Les trois lots corrigés
   sont sur `main` mais **aucun utilisateur ne les a reçus**. C'est le vrai
   problème à trancher.
3. **Le goulot macOS est un défaut de la chaîne**, pas du code : tant qu'il n'est
   pas traité, chaque nouvelle version risque le même échec.

---

## 9. Ce que le propriétaire doit faire à la main

**Voie A — relancer, la moins coûteuse (recommandée)**
1. Ouvrir https://github.com/pleveneur/pilot/actions/runs/41867732096
2. Cliquer **« Re-run all jobs »**. Si un runner macOS est cette fois attribué,
   `create-release` et `build` s'exécutent et la release `v0.6.17` se crée
   normalement (le workflow n'a pas de déclencheur manuel : c'est la seule voie
   non destructive à numéro constant).
3. Si le job macOS est encore annulé : appliquer la voie B avant de relancer.

**Voie B — rendre la chaîne insensible à l'annulation (décision de votre ressort)**
Dans `.github/workflows/release.yml`, la tolérance posée sur macOS couvre
l'**échec** mais pas l'**annulation**. Tant que ce point n'est pas tranché, la
pénurie de runners macOS empêchera toute publication. Je ne l'ai pas modifié :
c'est une règle de travail du projet.

**À vérifier à la main après une publication réussie**
1. La page des releases affiche **Pilot v0.6.17** avec le texte du changelog
   (accents corrects).
2. Les fichiers attendus : installateur Windows NSIS (`*_x64-setup.exe`), `.msi`,
   les deux `.app.tar.gz` macOS avec leur `.sig`, et `latest.json`.
3. Dans `latest.json`, la plateforme `windows-x86_64` pointe sur l'artefact
   **NSIS** (le MSI est volontairement écarté pour cette cible).
4. Un poste déjà installé détecte la mise à jour au démarrage suivant et
   l'installe sans erreur de signature.
5. Dans l'application : micro du mode Vocal qui se rouvre seul, halo qui suit une
   longue parole, conversation qui reste là où vous l'aviez laissée, volet
   « Tâches » fidèle au suivi, et les trois réglages (mots de réveil, genre,
   agents jetables) **tous inactifs par défaut**.

---

## 10. Ce que la mission a réellement produit

- Une version **préparée, testée, bumpée, committée, poussée et étiquetée** :
  `0.6.17`, commit `063a53b`, étiquette `v0.6.17`.
- **Zéro release publiée.** Aucune déclaration de succès n'est possible : la
  preuve manque côté GitHub.
- Ce rapport, sur disque.
