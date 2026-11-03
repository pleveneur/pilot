# Rapport — publication de Pilot v0.6.13

**Date** : 2026-11-03 (horloge du poste)
**Ordre du propriétaire** : publier la **0.6.13** de bout en bout, du contrôle
qualité au tag poussé — accord explicite donné pour cette version avant le début
des opérations.

## VERDICT : **PUBLIÉE ET VÉRIFIÉE**

Étiquette `v0.6.13` poussée, Release GitHub ouverte et **non provisoire** avec
ses **11 fichiers**, `latest.json` qui annonce **0.6.13** aux trois cibles du
chemin critique, et la Release créée **après** le verdict des tests (preuve
horodatée au § 5). Les utilisateurs installés recevront la mise à jour.

---

## 1. Version, commit, étiquette

| Élément | Valeur |
|---|---|
| Version précédente | `0.6.12` (étiquette `v0.6.12` **consommée** : poussée, aucune Release) |
| Version publiée | **`0.6.13`** (règle du projet : correctifs = dernier chiffre, aucun retour en arrière) |
| Commit de contenu | **`a7e4c0f`** — `chore: bump version to 0.6.13` (contient le bump + le changelog renommé) |
| Commit de réparation | **`ee4e3ce`** — `fix(publication): la porte du changelog lit le fichier de la convention du depot` |
| Étiquette | **`v0.6.13`** — **annotée**, objet `1193813`, cible `a7e4c0f`, **poussée** (`refs/tags/v0.6.13` et `refs/tags/v0.6.13^{}` sur `origin`) |
| Branche | `main` poussée : `origin/main` = `a7e4c0f` (aucun écart au moment du push) |
| GDS | `.pilot/gds.json` → `"enabled": false`, `server_url` vide ⇒ pas de bascule GDS, publication GitHub autorisée |
| `v0.6.12` | **non touchée** : ni déplacement, ni suppression, ni republication (aucune commande ne l'a visée) |
| `v0.6.13` déjà prise ? | **Non** — vérifié juste avant le tag : aucune étiquette `v0.6.13` locale ni distante |

Bump des quatre endroits (`git diff` = une ligne par fichier) :

- `src-tauri/tauri.conf.json` : `0.6.12` → `0.6.13`
- `package.json` : `0.6.12` → `0.6.13`
- `src-tauri/Cargo.toml` : `0.6.12` → `0.6.13`
- `Cargo.lock` (racine) : **paquet `pilot` uniquement** (motif `name = "pilot"`
  + `version` juste dessous). Piège v0.2.30 vérifié : le verrou contient une
  **seconde** occurrence de `version = "0.6.12"`, celle de la dépendance
  `postgres-protocol` — **non touchée**. Contrôle après coup :
  `grep -c 'version = "0.6.13"' Cargo.lock` → **1**.

---

## 2. Un écart avec la consigne, dit franchement

La consigne annonçait « le contenu du travail est commité et poussé ». **C'était
faux** : la réparation de la garde du changelog (quatre fichiers de `scripts/`,
`spec_pilot.md` et son rapport) était **présente sur le disque mais non
committée**. Publier sans la committer aurait rejoué l'échec de la 0.6.12, la
chaîne d'intégration utilisant la version des scripts **du dépôt**.

Elle a donc été committée telle quelle (`ee4e3ce`), **sans être modifiée** :

| Fichier | Nature |
|---|---|
| `scripts/release-gates.js` | `notesPathForTag` rend `release-notes/v<version>.md` (le `v` ajouté s'il manque, jamais doublé) |
| `scripts/create-release.js`, `scripts/gen-latest-json.js` | commentaires alignés sur ce chemin ; le chemin reste calculé à **un seul endroit** |
| `scripts/release-gates.test.js` | assertions retournées + deux tests neufs (le refus nomme exactement le fichier attendu ; chaque changelog présent dans `release-notes/` est atteint par la porte) |
| `spec_pilot.md` | la ligne documentation de la porte de publication |
| `docs/rapports/RAPPORT-correctif-garde-changelog.md` | le rapport de la réparation |

Aucun test n'a été supprimé ni assoupli : la suite front est passée de la
situation antérieure à deux tests de plus, et la porte refuse **toujours**
franchement une publication sans note lisible.

---

## 3. Changelog

- `release-notes/v0.6.12.md` → **`release-notes/v0.6.13.md`** par `git mv`
  (le diff de l'étiquette est `{v0.6.12.md => v0.6.13.md}`, donc un **renommage**,
  pas une suppression : le contenu est conservé).
- Titre adapté (`# Pilot v0.6.13`).
- Un point ajouté en fin de « ⚡ Améliorations », en français et sans jargon :
  la version précédente était prête mais sa publication a été bloquée par un
  contrôle trop strict ; le contrôle est corrigé. **Aucun nom de fichier, de
  fonction ni de variable** dans le texte.
- Aucune version du dépôt ne porte plus un changelog au nom d'une version qui
  n'existera jamais : il ne reste plus de `release-notes/v0.6.12.md`.
- Le corps de la Release publiée commence par `## Modifications depuis v0.6.12`
  puis le texte du fichier — vérifié dans l'API (§ 4).

---

## 4. Release et fichiers livrés

Release GitHub `Pilot v0.6.13`, identifiant **`432696326`**,
`draft: false`, `prerelease: false`, publiée le `2026-11-03T12:53:32Z`.

**11 fichiers**, tous à l'état `uploaded` :

| Fichier | Taille |
|---|---|
| `latest.json` | 6 361 o |
| `Pilot_0.6.13_x64-setup.exe` (+ `.sig`) | 64 824 596 o |
| `Pilot_0.6.13_x64_en-US.msi` (+ `.sig`) | 84 455 424 o |
| `Pilot_0.6.13_aarch64.dmg` | 103 670 952 o |
| `Pilot_0.6.13_x64.dmg` | 39 182 089 o |
| `Pilot_aarch64.app.tar.gz` (+ `.sig`) | 106 114 919 o |
| `Pilot_x64.app.tar.gz` (+ `.sig`) | 39 512 842 o |

`latest.json` (téléchargé depuis la Release) :

| Cible | Paquet | Signature |
|---|---|---|
| `windows-x86_64` | `Pilot_0.6.13_x64-setup.exe` (NSIS, le MSI reste écarté) | présente |
| `darwin-aarch64` | `Pilot_aarch64.app.tar.gz` | présente |
| `darwin-x86_64` | `Pilot_x64.app.tar.gz` | présente |

`version` annoncée : **`0.6.13`**. Les notes jointes sont le changelog français.

---

## 5. Preuve que la Release a attendu le verdict des tests

Exécution `41638503538` (déclenchée par l'étiquette `v0.6.13`), horodatage UTC
des jobs :

| Job | Fin | Verdict |
|---|---|---|
| `test (macos-latest)` | 12:48:40 | ✅ success |
| `test (ubuntu-22.04)` | 12:50:38 | ✅ success |
| `test (windows-latest)` | 12:53:20 | ✅ success |
| `create-release` | **début 12:53:23**, fin 12:53:35 | ✅ success |
| `build` (windows + 2 macOS) | après | ✅ success |
| `latest-json` | après | ✅ success |
| `build-linux` | encore en cours à la rédaction | ne bloque rien (hors chemin critique) |

`create-release` a démarré **3 secondes après la fin du dernier job de tests** :
la dépendance `needs: [test]` a bien fait son travail, la Release n'a pas été
créée avant le verdict. Aucune variable d'échappement n'a été utilisée
(`ALLOW_MISSING_RELEASE_NOTES`, `ALLOW_INCOMPLETE_RELEASE`,
`ALLOW_EXISTING_RELEASE` : toutes absentes), et aucune garde n'a été contournée.

Le contrôle de `main` (`quality-gate`, exécution `41638443218`) est également
**vert**.

---

## 6. Contrôles locaux — résultats

| Contrôle | Commande | Résultat |
|---|---|---|
| Aide intégrée régénérée | `npm run build:handbook` | ✅ 47 blocs, aucun bloc manquant, **aucun diff** produit |
| Tests front | `npx vitest run` | ✅ **PASS, 0 échec** (avant le bump, puis à nouveau après) |
| Tests Rust du bureau | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ **passés, 0 échec, 1 ignoré** (avant le bump, puis à nouveau une fois le paquet compilé en `0.6.13`) |
| Tests du socle et du serveur | `cargo test -p gds-core -p gds-server` | ✅ **passés, 0 échec, ignorés signalés** |
| Porte du changelog, essayée pour de vrai | `evaluateReleaseNotes({tag:'v0.6.13', notes: contenu du fichier})` | ✅ `ok: true` — chemin attendu `release-notes/v0.6.13.md`, fichier **présent** |
| Front de production | `npm run build` | ✅ `dist/` produit (13 Mo), `index.html` 146,8 Ko |
| Fabrication de l'application | `npx tauri build --no-bundle` | ✅ `target/release/pilot.exe`, `Pilot_0.6.13_x64_en-US.msi`, `Pilot_0.6.13_x64-setup.exe` produits |

**Point d'honnêteté, identique aux publications précédentes** : la fabrication
se termine par `A public key has been found, but no private key`. C'est la
**signature de l'uptader**, qui exige `TAURI_SIGNING_PRIVATE_KEY` — clé qui
n'existe **que** dans les secrets GitHub. Son absence en local est attendue et
n'empêche pas la fabrication : binaire et deux installateurs sont sur le disque.
La preuve que la signature a bien eu lieu est ailleurs, et elle existe : les
fichiers `.sig` sont présents dans la Release et les signatures sont renseignées
dans `latest.json`.

Aucun test n'a été supprimé, assoupli ni ignoré pour faire passer un contrôle.

---

## 7. Ce que le propriétaire doit vérifier à la main

1. **Ouvrir la Release** https://github.com/pleveneur/pilot/releases/tag/v0.6.13
   et compter les fichiers (**11 attendus**, liste au § 4).
2. **Relire le texte destiné aux utilisateurs** : il doit correspondre à ce que
   vous constatez en usage, en particulier les deux corrections de fond (l'état
   réel du travail de l'Assistante, la vérification réelle d'une tâche dite
   « terminée »).
3. **La mise à jour automatique dans l'application installée** : ouvrir la
   version installée, laisser passer la vérification, et vérifier qu'elle
   propose **0.6.13**. C'est la seule preuve qui compte pour un utilisateur.
4. **La 0.6.12** : elle reste une étiquette sans Release. Rien n'a été
   distribué sous ce numéro et rien ne doit l'être ; ne la republiez pas.
5. **`build-linux`** : au moment de la rédaction, ce job séparé tournait encore.
   Il n'est pas requis pour la mise à jour Windows/macOS et ne peut pas retenir
   `latest.json`. S'il vous intéresse, regardez-le séparément.

---

## 8. Ce qui n'a PAS été fait (et ne devait pas l'être)

- **aucune commande git destructive** : pas de `reset`, pas de `checkout`
  écrasant, pas de `force push`, aucune suppression de branche ni de donnée ;
- **le tag `v0.6.12` n'a été ni déplacé, ni supprimé, ni republié** ;
- **aucune variable d'échappement** de publication, aucune garde contournée ;
- **aucune modification du contenu du travail livré** : publier, pas refactorer ;
  seul le contenu du travail déjà présent a été committé, puis le numéro de
  version et le nom du changelog ont été mis à jour ;
- **aucun moteur vidéo ni réglage d'un autre projet** touché ;
- **aucun outil de suivi de sessions d'agents** appelé.

VERDICT : la 0.6.13 est **réellement publiée** — étiquette poussée, Release
ouverte avec ses 11 fichiers, `latest.json` annonçant `0.6.13` sur les trois
cibles du chemin critique, et la Release créée après le verdict des tests.
