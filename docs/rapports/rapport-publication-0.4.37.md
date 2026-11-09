# Rapport de publication — Pilot v0.4.37

Date : 2026-10-21
Objet : publier la version 0.4.37 (mise à jour de nouveau détectée sans
redémarrage, signalement d'une version en attente, index des mises à jour
proposant **le bon paquet**, ordre d'arrivée mieux tenu).

**Résultat : la 0.4.37 est publiée** (tag `v0.4.37` = `b1b62cb`, release publique,
`latest.json` en 0.4.37, entrée Windows = **installateur NSIS signé**, pas le MSI).
**Une réserve** : le build **Linux** a été annulé par son plafond de 45 min, donc
aucun installateur Linux (voir § 8).

---

## 1. État du dépôt avant d'agir (vérification, pas confiance)

| Élément | Valeur relevée |
|---|---|
| Branche | `main`, `origin/main` = `3f6f817` |
| Avance locale | **3 commits** non poussés (`e711bf7`, `4020ccb`, `af14e63`) — conformes à la description de la mission |
| Retard | **0** (`HEAD..origin/main` vide) |
| Travail en attente | `rapport-maj-non-detectee.md`, `rapport-relecture-maj.md` (non suivis) + `geminiReport.md` (hors sujet) |
| Version déclarée | **0.4.36** dans les 4 fichiers, cohérente avec le tag publié `v0.4.36` = `e151a1e` |
| Tag `v0.4.37` | **absent** en local **et** sur le distant |
| `rapport-p5-fenetre-maj.md` | **déjà versionné** (dans `af14e63`) — rien à refaire |

Conclusion : la 0.4.37 n'était **pas** préparée → publication nécessaire (aucun
travail déjà fait à ne pas recommencer).

## 2. Rapports de chantier

- Committé : `21da254` — `docs(maj): consigner le diagnostic de mise à jour non détectée et la relecture des deux correctifs` (`rapport-maj-non-detectee.md`, `rapport-relecture-maj.md`).
- `rapport-p5-fenetre-maj.md` : déjà dans `af14e63`, non retouché.
- **Laissé de côté, signalé** : `geminiReport.md` (analyse externe du 16 octobre sur la
  gestion des agents, **hors du chantier mise à jour/publication**, non suivi). Aucun
  autre fichier personnel ou hors sujet n'a été ajouté.

## 3. Bump 0.4.36 → 0.4.37 (aucune autre modification)

| Fichier | Avant | Après |
|---|---|---|
| `src-tauri/tauri.conf.json:4` | 0.4.36 | **0.4.37** |
| `package.json:4` | 0.4.36 | **0.4.37** |
| `src-tauri/Cargo.toml:3` (package `pilot`) | 0.4.36 | **0.4.37** |
| `Cargo.lock:3333` (racine, package `pilot`) | 0.4.36 | **0.4.37** |

- Édition **ciblée** du package `pilot` dans `Cargo.lock` (aucun `sed` global, cf.
  précaution de `AGENTS.md`).
- `grep -c 'version = "0.4.37"' Cargo.lock` → **1** (ligne 3333, package `pilot`).
- Diff total du bump : **4 fichiers, +4 / −4** — une seule ligne par fichier,
  aucun autre code touché.

## 4. Notes de version

`release-notes/v0.4.37.md` rédigé en **français clair, orienté utilisateur**, dans
l'ordre demandé : mise à jour de nouveau détectée sans redémarrer → l'application se
signale quand une version attend → elle propose le bon paquet → une demande respecte
mieux l'ordre d'arrivée, puis les améliorations, puis les **limites connues reprises
telles quelles** (attente pouvant changer sans perte ; file des commandes manuelles
rangée par chemin tel qu'écrit).

## 5. Tests et build (portes bloquantes)

| Suite | Commande | Résultat | Verdict |
|---|---|---|---|
| Frontend complet | `npm test` (`vitest run`) | **2 120 tests passés / 2 120**, **128 fichiers**, **0 échec**, 7,44 s | ✅ |
| Rust, espace de travail | `cargo test --workspace` | **797 passés, 1 ignoré, 0 échec** — suites : 112 + 34 + 651 (+1 ignoré) + 3 suites vides | ✅ |
| Rust, desktop seul | inclus ci-dessus (`651 passés, 1 ignoré`) | identique à la référence | ✅ |
| Build frontend | `npm run build` | exit 0, `dist/index.html` 104,6 Ko, mêmes avertissements de découpage de chunks qu'avant | ✅ |
| Build Rust (profil dev) | `cargo build --manifest-path src-tauri/Cargo.toml` | `Finished` en 8,0 s (17 avertissements préexistants, aucun nouveau) | ✅ |
| Build Rust (profil **release**) | `cargo build --release --manifest-path src-tauri/Cargo.toml` | **`Finished release profile in 1m 49s`** | ✅ |

Aucun échec → la publication a pu continuer.

## 6. ÉTAPE CRITIQUE — l'index propose-t-il le bon paquet Windows ?

### 6.1 Avant le tag (preuve locale, sans réseau)

Simulation de l'index avec les noms d'artefacts attendus de la 0.4.37, en appelant
la **logique réelle** de `scripts/latest-json-platforms.js` (celle utilisée par
`scripts/gen-latest-json.js` dans le workflow) :

```
ECARTE: Pilot_0.4.37_x64_en-US.msi
windows-x86_64 -> Pilot_0.4.37_x64-setup.exe   (+ Pilot_0.4.37_x64-setup.exe.sig)
darwin-x86_64  -> Pilot_x64.app.tar.gz
darwin-aarch64 -> Pilot_aarch64.app.tar.gz
linux-x86_64   -> Pilot_0.4.37_amd64.AppImage
OK: windows-x86_64 pointe l'installateur NSIS signé
```

Le MSI est **explicitement écarté** (`isExcludedWindowsInstaller`) et la cible
`windows-x86_64` désigne le **NSIS `-setup.exe`** avec son fichier de signature.
Test dédié de cette logique : `npx vitest run scripts/gen-latest-json-platforms.test.js`
→ **7 passés / 0 échec**.

### 6.2 Après publication (preuve en ligne, sur le vrai index)

Fichier réellement téléchargé depuis `releases/latest/download/latest.json` :

| Contrôle | Valeur |
|---|---|
| `version` | **0.4.37** |
| `pub_date` | 2026-10-21T07:17:27.714Z |
| `platforms` | `windows-x86_64`, `darwin-aarch64`, `darwin-x86_64` (**3**) |
| `windows-x86_64.url` | `.../download/v0.4.37/Pilot_0.4.37_x64-setup.exe` → **installateur NSIS** ✅ |
| L'URL est-elle un MSI ? | **non** ✅ |
| Signature présente | **416 caractères**, **identique** au fichier `.sig` publié ✅ (contenu décodé : `untrusted comment: signature from tauri secret key …`) |

**Le point critique est vérifié, en local puis en ligne : l'index propose
l'installateur, jamais le MSI.**

## 7. Commit, push, tag

| Étape | Résultat |
|---|---|
| Commit version + notes | `b1b62cb` — `chore(version): passer en 0.4.37 avec ses notes de version` (5 fichiers, +74 / −4) |
| Push `main` (simple, **sans force**) | ✅ `git rev-list --left-right --count origin/main...HEAD` → `0 0` |
| Tag `v0.4.37` | créé sur `b1b62cb`, poussé ✅ |

```
$ git rev-parse v0.4.37
b1b62cb24aca9dfab67478a9f6594b82d0a61adc
$ git ls-remote --tags origin v0.4.37 v0.4.36
b1b62cb24aca9dfab67478a9f6594b82d0a61adc  refs/tags/v0.4.37
e151a1ede7a288ceafda11d912a9599d1972b79a  refs/tags/v0.4.36   (intact)
```

## 8. Publication (workflow `release.yml` sur le tag)

Run `39555344682` :

| Job | Conclusion | Fin |
|---|---|---|
| `test (ubuntu-22.04)` | success | 06:30:34Z |
| `test (windows-latest)` | success | 06:31:45Z |
| `test (macos-latest)` | success | 06:30:27Z |
| `create-release` | success | 06:26:02Z |
| `build (windows-latest, x86_64-pc-windows-msvc)` | success | 06:46:32Z |
| `build (macos-latest, aarch64-apple-darwin)` | success | 06:38:30Z |
| `build (macos-latest, x86_64-apple-darwin)` | success | 06:42:16Z |
| `build (ubuntu-22.04, x86_64-unknown-linux-gnu)` | **cancelled** (plafond de 45 min) | 07:17:14Z |
| `latest-json` | success | 07:17:30Z |

**Réserve Linux (non forcée)** : le job Linux a été annulé par son
`timeout-minutes: 45`, qui est un choix **délibéré** du workflow (garder
`latest.json` rapide pour les cibles qui fonctionnent). Conséquence : la release
ne contient **ni AppImage, ni `.deb`**, et `latest.json` n'a **pas** d'entrée
`linux-x86_64`. Les utilisateurs **Windows et macOS** reçoivent la mise à jour
normalement ; les utilisateurs **Linux** ne la recevront pas automatiquement.
Aucune relance n'a été tentée : elle demanderait un jeton GitHub (`POST
/actions/runs/{id}/rerun-failed-jobs`), absent de cet environnement, et le plafond
est un réglage volontaire du projet.

## 9. Vérifications en ligne (après publication)

| Élément vérifié | Valeur relevée |
|---|---|
| Release `v0.4.37` | id `419224682`, `draft: false`, `prerelease: false`, `name: "Pilot v0.4.37"`, `tag_name: v0.4.37` |
| Commit ciblé | `b1b62cb24aca9dfab67478a9f6594b82d0a61adc` = commit de version = commit du tag = `main` distant |
| Date de publication | 2026-10-21T06:25:59Z |
| Éléments joints | **11** : `latest.json`, `Pilot_0.4.37_x64-setup.exe` (+ `.sig`), `Pilot_0.4.37_x64_en-US.msi` (+ `.sig`), `Pilot_0.4.37_x64.dmg`, `Pilot_0.4.37_aarch64.dmg`, `Pilot_x64.app.tar.gz` (+ `.sig`), `Pilot_aarch64.app.tar.gz` (+ `.sig`) |
| Taille du fichier d'index | 6 191 octets |
| Description de la release | **4 190 caractères** = exactement les notes de version (titre `Pilot v0.4.37`, ordre d'arrivée et « Limites connues » présents) |
| `latest.json` : version | **0.4.37** (cohérente avec la version du dépôt et le nom de la release) |
| `latest.json` : notes | 4 190 caractères (les notes, pas un body générique) |
| Index Windows | installateur NSIS **signé** (§ 6.2) |
| Nombre de plateformes servies | **3** (Windows x64, macOS arm64, macOS x64) — Linux absent (§ 8) |

## 10. Ce que je n'ai pas pu vérifier

- **L'installation réelle** des binaires produits (aucune exécution de
  l'installateur sur une machine ici) : seule la présence, la taille et la
  signature des fichiers en ligne sont vérifiées.
- **Rendu visuel** de la page de release (seul le contenu texte du corps est lu
  via l'API).
- **La mise à jour de bout en bout** depuis une version installée : elle dépend de
  `latest.json`, dont la cohérence est vérifiée, mais l'application n'a pas été
  démarrée.
- **Le build Linux** : jamais abouti (§ 8).

## 11. Points de vigilance respectés

- Aucun tag posé avant que les suites frontend **et** Rust soient vertes, **et**
  avant la vérification locale du point critique (§ 6.1).
- Aucun `git` destructif : pas de force push, pas de `reset --hard`, aucun tag
  supprimé ni déplacé, aucune réécriture d'historique.
- Aucune donnée utilisateur supprimée, aucun élément déjà publié modifié ou retiré
  (`v0.4.36` et ses assets sont intacts).
- Aucun tag existant republié (`v0.4.37` n'existait nulle part avant).
- Aucun appel à l'outil qui liste les sessions d'agents.
- Aucun code applicatif modifié : version, notes, rapports, et la note de mise à
  jour de `fiche-reference-pilot.md` (§ 12).

## 12. Documentation

- `release-notes/v0.4.37.md` : ajouté (source des notes de la release et de l'index).
- `fiche-reference-pilot.md` : note de mise à jour ajoutée en tête (la fiche décrivait
  l'état **avant** la 0.4.36 ; elle indique désormais que 0.4.36 **et** 0.4.37 sont
  publiées et renvoie à ce rapport). Aucune autre section de la fiche modifiée.
- `help/*` et les specs : **inchangés par cette mission** — leur mise à jour a été
  faite par les trois correctifs eux-mêmes (`4020ccb`, `af14e63`), et l'aide
  intégrée (`help/handbook.md`) est régénérée à partir de ces blocs.
- `plan_dev.md` : non modifié (résumé de roadmap, sans dépendance à la version).

## 13. Commits de la mission

| Commit | Contenu |
|---|---|
| `21da254` | rapports de chantier (`rapport-maj-non-detectee.md`, `rapport-relecture-maj.md`) |
| `b1b62cb` | version 0.4.37 dans les 4 fichiers + `release-notes/v0.4.37.md` |
| (ce rapport) | `docs(publication): rapport de publication 0.4.37 et note de mise à jour de la fiche` |
