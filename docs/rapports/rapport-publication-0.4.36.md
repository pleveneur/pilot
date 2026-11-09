# Rapport de publication — Pilot v0.4.36

Date : 2026-10-21
Agent : codeur (registre Pilot)
Objet : publier la version 0.4.36 contenant les trois correctifs de la file
d'attente (P1, P2, P3), la documentation corrigée et les limites connues.

---

## 0. Résultat en une ligne

**La 0.4.36 est publiée** (tag `v0.4.36` = `e151a1e`, release publique, `latest.json`
en 0.4.36). **Une seule réserve** : le build **Linux** a été **annulé par son propre
plafond de 45 min**, donc **aucun installateur Linux** n'est joint et `latest.json`
ne contient **pas** l'entrée `linux-x86_64` (Windows et macOS sont complets et
signés). Détail et conséquences au § 8.

---

## 1. État du dépôt AVANT toute action (vérifié, pas supposé)

| Contrôle | Résultat |
|---|---|
| Branche | `main` |
| `origin/main` | `3c67064` (`chore: bump version to 0.4.35`) |
| Commits locaux en avance | **7** (et non 6 comme annoncé dans la mission) |
| Fichiers suivis modifiés | aucun |
| Fichiers non suivis | **5** (voir § 2) |
| Tag `v0.4.36` | **absent** en local **et** sur le distant |
| Version déclarée | `0.4.35` dans les 4 endroits |

Les 7 commits locaux : `8aa8f0d` (doc délai), `13f7552` (P2), `9031b37` (rapport
P2), `4cf5356` (P1), `275eb04` (P3), `9b075eb` (doc finale), `59f3db1` (rapport P3).
Le 7e commit (`59f3db1`, re-vérification P3) n'était pas listé dans la mission mais
fait partie du même travail : il a donc été traité comme tel, sans modification.

Conclusion : rien n'était préparé, aucune version 0.4.36 n'existait → **publication
nécessaire**, pas de doublon rejoué.

---

## 2. Fichiers non suivis : ce qui a été fait

| Fichier | Décision |
|---|---|
| `rapport-delai-inactivite.md` | **committé** (fait partie du travail : vérification du délai d'inactivité) |
| `rapport-file-attente-pertes-doublons.md` | **committé** (constat des pertes/doublons) |
| `rapport-relecture-file.md` | **committé** (relecture des correctifs) |
| `rapport-relecture-finale.md` | **committé** (relecture finale, verdict PUBLIABLE) |
| `geminiReport.md` | **laissé intact et non suivi** : analyse externe datée du 16 octobre, antérieure au chantier, jamais suivie par git — **signalé**, pas committé (hors travail décrit), pas supprimé |

Commit : `4f0c154` — `docs(rapports) : consigner les rapports de vérification du
chantier file d'attente` (4 fichiers, +1052 lignes, aucun code).

---

## 3. Bump 0.4.35 → 0.4.36

Quatre fichiers, même valeur partout, édition **ciblée** (aucun `sed` global —
précaution incident v0.2.30) :

| Fichier | Avant | Après |
|---|---|---|
| `src-tauri/tauri.conf.json:4` | 0.4.35 | **0.4.36** |
| `package.json:4` | 0.4.35 | **0.4.36** |
| `src-tauri/Cargo.toml:3` (package `pilot`) | 0.4.35 | **0.4.36** |
| `Cargo.lock:3333` (racine, package `pilot`) | 0.4.35 | **0.4.36** |

Contrôles après bump :

- `grep -c 'version = "0.4.36"' Cargo.lock` → **1** (ligne 3333, package `pilot`).
- Aucune occurrence résiduelle de `0.4.35` dans ces quatre fichiers.
- `npm run build:handbook` relancé : **aucun changement** (43 blocs, 200 759 octets) —
  l'aide intégrée était déjà à jour avec les commits de documentation.
- **Aucune autre modification de code applicatif.**

---

## 4. Notes de version

`release-notes/v0.4.36.md` rédigé en **français clair, orienté utilisateur**, au
format des versions précédentes (`# Pilot vX.Y.Z`, puis ✨ / 🐛 / ⚡), avec en plus
une section **ℹ️ Limites connues**. Il contient les cinq points exigés :

1. un **arrêt d'agent ne détruit plus les missions en attente** (conservées,
   nommées, rejouées) ;
2. une demande **respecte l'ordre d'arrivée**, même quand le projet paraît libre ;
3. un projet a une **identité unique**, quelle que soit l'écriture de son chemin ;
4. le **délai d'inactivité annoncé est exact** (10 minutes par défaut) et un **test
   empêche la documentation de diverger** à nouveau ;
5. les **deux limites connues** (ordre d'attente qui peut changer sans perte ;
   file des commandes manuelles rangée par chemin brut).

---

## 5. Tests exécutés avant de taguer

| Suite | Commande | Résultat exact | Verdict |
|---|---|---|---|
| Frontend complet | `npm test` | **2091 passés / 2091** (124 fichiers), **0 échec** | ✅ |
| Rust, espace de travail | `cargo test --workspace` | **797 passés, 1 ignoré, 0 échec** (6 suites, 12,04 s) | ✅ |
| Rust, desktop seul | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **651 passés, 1 ignoré, 0 échec** (identique à la référence 0.4.35) | ✅ |
| Build de production | `npm run build` | **exit 0**, `dist/index.html` 104,6 Ko, mêmes avertissements de découpage de chunks qu'avant | ✅ |

Aucun test n'a échoué → la publication a pu continuer (étape bloquante franchie).
Les tests Rust n'ont produit que les avertissements d'imports inutilisés déjà
présents avant la mission (aucun nouveau).

---

## 6. Commit, push, tag

| Étape | Résultat |
|---|---|
| Commit version + notes | `e151a1e` — `chore(version): passer en 0.4.36 avec ses notes de version` (5 fichiers, +64/−4) |
| Push `main` (simple, sans force) | ✅ exit 0 — `git rev-list --left-right --count origin/main...HEAD` → `0 0` |
| Tag `v0.4.36` | créé puis poussé — ✅ exit 0 |

Vérifications du tag :

```
$ git rev-parse v0.4.36
e151a1ede7a288ceafda11d912a9599d1972b79a
$ git ls-remote --tags origin v0.4.36
e151a1ede7a288ceafda11d912a9599d1972b79a  refs/tags/v0.4.36
$ git ls-remote --tags origin v0.4.35
3c670644c52680bb6df9b548e4724fd3ea5cfaad  refs/tags/v0.4.35   (intact)
```

Aucun historique réécrit, aucun tag supprimé ou déplacé, aucun force push.

**Constat annexe, sans action** : le tag `v0.4.34` existe **en local** mais **pas sur
le distant** (le rapport de publication 0.4.35 affirmait le contraire). Rien n'a été
créé ni supprimé à ce sujet — c'est signalé, pas corrigé (hors mission).

---

## 7. Publication (workflow `release.yml` sur le tag)

Run `39546865158` du 2026-10-21 :

| Job | Conclusion |
|---|---|
| `test (ubuntu-22.04)` | success |
| `test (windows-latest)` | success |
| `test (macos-latest)` | success |
| `create-release` | success |
| `build (windows-latest, x86_64-pc-windows-msvc)` | success |
| `build (macos-latest, aarch64-apple-darwin)` | success |
| `build (macos-latest, x86_64-apple-darwin)` | success |
| `build (ubuntu-22.04, x86_64-unknown-linux-gnu)` | **cancelled** (plafond de 45 min, Cf. § 8) |
| `latest-json` | success |

Contrôles en ligne (API GitHub) :

| Élément vérifié | Valeur relevée |
|---|---|
| Release `v0.4.36` | id `419174342`, `draft: false`, `prerelease: false`, `name: "Pilot v0.4.36"` |
| Commit ciblé par la release | `e151a1e…` = commit de version = tag = `main` |
| Éléments joints (assets) | **11** |
| Description de la release | 3 424 caractères = **les notes de version** (présence vérifiée du titre, de l'ordre d'arrivée et des limites connues) |
| `latest.json` publié | 5 399 octets, **version `0.4.36`**, `pub_date` 2026-10-21T05:48:21Z, notes 3 424 car. |
| Plateformes dans `latest.json` | `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64` — **toutes signées** |
| Cohérence version dépôt / version publiée | `0.4.36` partout : `package.json`, `tauri.conf.json` (arbre du tag), `latest.json`, nom de la release |

Les 11 éléments : `latest.json`, `Pilot_0.4.36_x64-setup.exe` (+ `.sig`),
`Pilot_0.4.36_x64_en-US.msi` (+ `.sig`), `Pilot_0.4.36_x64.dmg`,
`Pilot_0.4.36_aarch64.dmg`, `Pilot_x64.app.tar.gz` (+ `.sig`),
`Pilot_aarch64.app.tar.gz` (+ `.sig`).

---

## 8. Réserve à connaître : aucun installateur Linux

- **Ce qui s'est passé** : le job `build (ubuntu-22.04)` a tourné de **05:02:47 à
  05:48:07** puis a été **annulé par son plafond `timeout-minutes: 45`**, qui est un
  choix **délibéré** du workflow (commentaire dans `release.yml` : garder `latest.json`
  rapide pour les cibles qui fonctionnent).
- **Effet** : la release ne contient **ni AppImage, ni `.deb`** (11 éléments, tous
  Windows/macOS) et `latest.json` n'a **pas d'entrée `linux-x86_64`**. Les
  utilisateurs **Windows et macOS** reçoivent la mise à jour normalement ; les
  utilisateurs **Linux** ne la recevront **pas** automatiquement.
- **Ce que je n'ai pas fait, et pourquoi** : relancer le job Linux ou régénérer
  `latest.json` demande un **jeton GitHub** (`POST /actions/runs/{id}/rerun-failed-jobs`
  et l'upload d'assets) : **aucun jeton n'est disponible** dans cet environnement
  (`GH_TOKEN` / `GITHUB_TOKEN` absents). Je n'ai donc **rien forcé** et je n'ai touché
  à aucun élément déjà publié.
- **Décision qui vous revient** : soit relever `timeout-minutes` du job Linux (et
  relancer la chaîne), soit publier une 0.4.37 avec la seule cible Linux corrigée. Le
  plafond est un réglage volontaire du projet : le changer sort du périmètre de cette
  mission de publication.

---

## 9. Ce que je n'ai pas pu vérifier

- **L'installation réelle** des binaires produits (aucune exécution sur une machine
  Windows/macOS/Linux ici — seule la présence, la taille et les signatures des
  fichiers en ligne sont vérifiées).
- **Le rendu visuel** des notes de version sur la page de la release (seul le
  contenu texte du corps a été lu via l'API).
- **Le build Linux**, qui n'a jamais abouti (§ 8).
- La **mise à jour automatique de bout en bout** depuis une version installée : elle
  dépend de `latest.json`, dont la cohérence a été vérifiée, mais l'application n'a
  pas été démarrée.

---

## 10. Points de vigilance respectés

- Aucun tag posé avant que les suites frontend **et** Rust soient vertes.
- Aucun `git` destructif : pas de force push, pas de `reset --hard`, pas de tag
  supprimé ni déplacé, pas de réécriture d'historique, pas de branche supprimée.
- Aucune donnée utilisateur supprimée, aucun élément déjà publié modifié ou retiré.
- Aucun tag déjà existant republié (`v0.4.36` n'existait nulle part avant).
- Aucun appel à l'outil qui liste les sessions d'agents.
- Aucun code applicatif modifié : uniquement version, notes de version, rapports,
  et la note de mise à jour de la fiche de référence.
