# Rapport de publication — Pilot v0.6.14

> Statut : **PUBLIÉE ET VÉRIFIÉE** — étiquette `v0.6.14` poussée, Release GitHub
> ouverte avec ses **11 fichiers**, `latest.json` annonce **0.6.14** pour Windows
> et les deux macOS (§ 5 et § 6).
> Rédigé par : agent publieur.
> Autorisation : le propriétaire a explicitement ordonné la publication de cette
> version avant le début de la session. Aucune publication décidée de ma part.
> Ce rapport est un fichier **neuf** ; aucun rapport existant n'a été touché.

---

## 1. État du dépôt à l'ouverture

Lu sur le disque, après `git fetch origin --tags --prune`.

| Élément | Valeur constatée |
|---|---|
| Branche | `main` |
| `HEAD` de départ | `e9cd726` — « docs: rapport de publication 0.6.13 » |
| Dernière étiquette | `v0.6.13` |
| Arbre de travail | **17 fichiers modifiés + 1 non suivi** : le travail PDF de la mission **n'était pas commité** |
| GDS | `.pilot/gds.json` → `"enabled": false` ⇒ **publication GitHub autorisée** (règle absolue respectée) |
| Remotes | `origin` = github.com/pleveneur/pilot.git ; `gds` = remote local de test, non utilisé |

### Travail à publier trouvé non commité

Le rapport de mission annonçait le travail fait mais aucun commit n'existait. Rien
n'a été laissé de côté. Contenu commité dans **`c7480be`**
(« feat(pdf): export Markdown vers PDF sans fenêtre d'impression ») :

```
 AGENTS.md                      |   8 +-
 Cargo.lock                     |   1 +      (flate2, dépendance déjà verrouillée)
 help/handbook.md               |  18 ++-    (régénéré : idempotent, md5 stable)
 spec_pdf2md.md                 |  80 ++++++-
 spec_pilot.md                  |   4 +-
 src-tauri/Cargo.toml           |   5 +      (flate2 = "1")
 src-tauri/src/agent_service.rs |  80 +++++++
 src-tauri/src/lib.rs           |   5 +
 src/css/style.css              |  25 +++-
 src/js/agent-pi.js             |  23 ++++
 src/js/agents-bus.js           |  51 +++++++
 src/js/machine-sentinel.js     |  23 +++-
 src/js/pdf-export.js           | 296 ++++++++++++++++++++++++++++-----------
 src/js/super-agent.js          |  25 ++++
 + nouveaux : src-tauri/src/pdf_export.rs, src-tauri/extensions/pilot-pdf.ts,
   src/js/pdf-gateway.js, src/js/pdf-gateway.test.js,
   docs/rapports/RAPPORT-pdf-sans-impression.md
```

`help/handbook.md` a été régénéré deux fois (`npm run build:handbook`) avant
commit : md5 identique (`d9a5fe02077f190d69c6bb0e0081ec40`) ⇒ le fichier livré est
bien le produit de la génération, aucune retouche manuelle.

Le code du travail PDF **n'a pas été modifié** : il était validé, la publication ne
corrige rien.

---

## 2. Numéro de version

| Fichier | Avant | Après |
|---|---|---|
| `src-tauri/tauri.conf.json` | 0.6.13 | **0.6.14** |
| `package.json` | 0.6.13 | **0.6.14** |
| `src-tauri/Cargo.toml` | 0.6.13 | **0.6.14** |
| `Cargo.lock` (package `pilot`, l. 3334-3335) | 0.6.13 | **0.6.14** |

Le disque confirmait 0.6.13 partout : la cible demandée (0.6.14, incrément du
correctif) est cohérente, aucun écart à signaler, aucun recul de version.

`Cargo.lock` a été édité par **remplacement ciblé de la seule paire
`name = "pilot"` + `version`** — aucun `sed` global, aucun ancrage. Vérification
après coup : `version = "0.6.14"` apparaît **exactement 1 fois** dans le fichier
(celle de `pilot`) et `version = "0.6.13"` **0 fois**. Les deux autres versions de
`Cargo.lock` modifiées par le travail PDF sont celles de dépendances
(`flate2` ajouté aux dépendances de `pilot`), pas des versions de paquets.

---

## 3. Changelog utilisateur — `release-notes/v0.6.14.md`

En français, accents compris, orienté utilisateur, sans nom de fichier ni de
fonction. Structure : Nouvelles fonctionnalités / Corrections / Améliorations /
Ce que vous devez savoir.

- **Nouvelles fonctionnalités** : l'export PDF écrit un vrai fichier tout de suite,
  à côté du `.md`, plus de fenêtre d'impression ; un fichier en échec n'empêche plus
  les autres (signulation par nom).
- **Corrections** : l'application ne se fige plus (travail en arrière-plan) ; le
  bouton « Fermer » reste toujours utilisable, Échap ferme la fenêtre.
- **Améliorations** : le même export sert aux agents ; le résultat est dit
  clairement (fichiers écrits / échoués avec la raison).
- **Limites dites honnêtement** : les émojis ne sont pas repris (une paire de
  parenthèses vide possible dans un titre) ; certaines images rares ne sont pas
  incorporées et sont remplacées par une **ligne visible** disant pourquoi ; une
  image distante (`http(s)`, `data:`) n'est pas téléchargée.

---

## 4. Contrôles — exécutés APRÈS le bump, AVANT tout tag

| Contrôle | Commande | Résultat exact |
|---|---|---|
| Tests frontend | `npm test` | **VERT** — `Test Files 290 passed (290)`, `Tests 5362 passed (5362)`, 0 échec, durée 15,34 s |
| Tests Rust (desktop) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **VERT** — `cargo test: 861 passed, 1 ignored (1 suite, 10.90s)` |
| Fabrication | `npm run tauri build` | **RÉUSSIE** — binaire + MSI + NSIS en 0.6.14 (§ 4.3) |

Les deux suites ont été passées **une fois avant** le bump (arbre de travail) et
**une fois après** le bump : mêmes résultats (5362 / 861). Aucun test assoupli,
aucun test supprimé, **aucun `#[ignore]` ajouté** (`git diff -U0 | grep '#\[ignore'`
→ aucun ajout).

### 4.1 Précision sur les « 861 / 0 » du rapport de mission

Le rapport de mission annonçait « Rust 861/0 ». Le chiffre réel est **861 passés,
1 ignoré**. L'unique test ignoré est **pré-existant sur `main`** :
`src-tauri/src/help.rs:854` `integration_ask_pi_caged` (test d'intégration qui exige
`pi` dans le PATH et un modèle local lancé ; il s'exécute sur demande explicite).
Ce n'est ni une régression, ni un test neutralisé pour publier.

### 4.2 `npm test` — VERT

```
 Test Files  290 passed (290)
      Tests  5362 passed (5362)
```

Les traces `Erreur session agent: TypeError … getCurrentWindow` visibles dans la
sortie proviennent d'un test qui simule l'absence de Tauri et **réussit** : ce sont
des messages attendus, pas des échecs.

### 4.3 `npm run tauri build` — RÉUSSIE (signature faite en CI)

Journal complet : `.pilot/tmp-pub/0.6.14-build.log` (ignoré par Git).

| Étape | Résultat |
|---|---|
| `beforeBuildCommand` (serveurs MCP, handbook, Laya, `vite build`) | OK — `✓ 4157 modules transformed`, `✓ built in 12.69s` |
| `cargo build --release` | OK — `Finished release profile [optimized] in 2m 09s`, 26 avertissements, **aucune erreur** |
| Binaire | `target/release/pilot.exe` |
| Paquet MSI | `target/release/bundle/msi/Pilot_0.6.14_x64_en-US.msi` (84,3 Mo) |
| Paquet NSIS | `target/release/bundle/nsis/Pilot_0.6.14_x64-setup.exe` (64,5 Mo) |

`npm run tauri build` se termine avec le code 1 **uniquement** sur la dernière
ligne : `A public key has been found, but no private key. Make sure to set
TAURI_SIGNING_PRIVATE_KEY`. C'est attendu : la clé privée de signature des mises à
jour est un secret GitHub, absente (et non modifiée) sur ce poste. La signature est
faite par la CI, et elle a réussi (§ 5 : `.sig` présents). La fabrication
elle-même est complète.

`help/handbook.md` est resté **inchangé** après la fabrication (`git diff --stat`
vide), l'arbre de travail était **propre** après le commit du bump.

---

## 5. Étiquette, poussée et Release

| Élément | Valeur constatée |
|---|---|
| Commit du bump + changelog | **`fca8583`** — « chore: bump version to 0.6.14 » (5 fichiers, +54/−4) |
| Étiquette locale | `v0.6.14` |
| Étiquette distante | `refs/tags/v0.6.14` = `fca85830b23494f9bfa11fe56db2fc8b40cda5d2` |
| `main` poussé | oui (`git push origin main` → ok) |
| Étiquette préexistante ? | **non** — vérifié avant création en local (`git tag -l`), sur le distant (`git ls-remote --tags`) et côté Release (`aucune release v0.6.14`). Aucun tag forcé, écrasé ni recréé. |
| Workflow | `release` run **#179**, `head_sha` = `fca8583`, déclenché par le tag |

### Jobs du workflow #179

| Job | Résultat |
|---|---|
| `test (windows-latest)`, `test (macos-latest)`, `test (ubuntu-22.04)` | **success** |
| `create-release` | **success** |
| `build (macos-latest, x86_64-apple-darwin)` | **success** |
| `build (macos-latest, aarch64-apple-darwin)` | **success** |
| `build (windows-latest, x86_64-pc-windows-msvc)` | **success** |
| `latest-json` | **success** |
| `build-linux` | encore `in_progress` au moment du rapport — job **séparé**, `continue-on-error`, plafonné à 90 min ; **aucun job n'en dépend** |

### Release GitHub `v0.6.14` — 11 fichiers

Publiée (`draft: false`, `prerelease: false`), le 2026-11-04T06:26:59Z :

```
latest.json
Pilot_0.6.14_x64-setup.exe            + .sig
Pilot_0.6.14_x64_en-US.msi            + .sig
Pilot_0.6.14_x64.dmg
Pilot_0.6.14_aarch64.dmg
Pilot_x64.app.tar.gz                  + .sig
Pilot_aarch64.app.tar.gz              + .sig
```

### Mise à jour automatique

`latest.json` téléchargé depuis la Release :

```
version annoncée : 0.6.14
plateformes      : windows-x86_64, darwin-aarch64, darwin-x86_64
```

Les trois plateformes du chemin critique sont servies ; les utilisateurs installés
recevront 0.6.14 au prochain démarrage de Pilot.

---

## 6. Ce que le propriétaire doit vérifier à la main

1. **Le geste réparé, sur l'application installée.** Ouvrir un `.md` contenant des
   titres, listes, un tableau, une image et un émoji, puis clic droit →
   « Exporter en PDF ». Vérifier : le PDF apparaît **à côté du fichier**, la fenêtre
   ne se fige plus, « Fermer » répond, Échap ferme. Ce que je ne peux pas prouver :
   le rendu visuel d'un PDF ouvert dans un lecteur, et l'absence de gel sur une
   machine utilisateur.
2. **Une limite visible, volontaire.** Un émoji isolé dans un titre peut laisser
   `()` dans le PDF ; une image de format rare est remplacée par une ligne
   `[image non incorporée : … (raison)]`. C'est documenté, pas un défaut caché —
   vérifier que la formulation vous convient.
3. **L'export multi-fichiers.** Sélectionner plusieurs `.md` dont un fichier
   volontairement en échec : les autres PDF doivent être écrits et l'échec nommé.
4. **La mise à jour automatique.** Sur un poste où Pilot **0.6.13** est installé,
   relancer l'application et vérifier que la modale propose bien 0.6.14, avec le
   texte de `release-notes/v0.6.14.md`.
5. **Le job `build-linux`.** S'il aboutit, `latest-json-linux` ajoutera Linux à
   `latest.json` ; sinon Linux n'est pas servi, sans conséquence sur Windows/macOS.
   À revérifier sur https://github.com/pleveneur/pilot/actions (run #179).
6. **Rien de détruit.** Aucun `git reset`, `checkout` écrasant ni `force push` n'a
   été utilisé ; aucune sauvegarde, aucune donnée, aucun réglage d'un autre projet
   n'a été touché. Le moteur vidéo n'a pas été approché. `npm run gds:image` et
   `gds:reload` n'ont **pas** été lancés (projet non concerné).
7. **Résidus locaux** : `.pilot/tmp-pub/` (journal de fabrication, JSON de contrôle)
   et `target/release/bundle/` restent sur le disque, ignorés par Git.

---

## 7. Verdict

**Version 0.6.14 publiée.** Étiquette `v0.6.14` poussée sur `fca8583`, Release
GitHub ouverte avec 11 fichiers, `latest.json` annonçant 0.6.14 pour
`windows-x86_64`, `darwin-aarch64` et `darwin-x86_64`.

Contrôles : **vitest 290 fichiers / 5 362 tests verts**, **Rust 861 passés /
1 ignoré pré-existant / 0 échec**, **fabrication réussie** (binaire + MSI + NSIS).
Seule réserve : `build-linux`, encore en cours, job séparé qui ne bloque ni ne
retarde rien.
