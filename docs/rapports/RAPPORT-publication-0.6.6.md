# Rapport de publication — Pilot v0.6.6

> Statut : **PUBLIÉE — vérifiée sur GitHub** (voir § 5 et § 6)
> Date : 2026-10-30
> Rédigé par : Nova (publieur)

---

## 1. État du dépôt au moment de l'ouverture

| Élément | Valeur |
|---|---|
| Branche | `main` |
| HEAD | `c22d968` — « ecran Vocal : le cercle en haut, la photo du personnage dessous » |
| `origin/main` | `10d43d0` — « chore: bump version to 0.6.5 » |
| Nombre de commits d'avance | **14** (et non 12 comme annoncé dans la consigne) |
| Dernière étiquette publiée | `v0.6.5` (le commit `10d43d0`) |
| Remote de publication | `origin` → `https://github.com/pleveneur/pilot.git` |

### Le GDS est-il basculé ? — NON

`.pilot/gds.json` contient `"enabled": false`.
La publication GitHub est donc autorisée (règle absolue respectée).

> Note : un remote local nommé `gds` existe
> (`G:\IA_PL\pilot\src-tauri\laya.__probe2__\pilot-gds-absent-10988`), reliquat
> d'un test. Il n'est **pas** utilisé : aucune commande de ce rapport ne le cible.

## 2. Les 14 commits à publier (contenu du lot Vocal)

```
c22d968 ecran Vocal : le cercle en haut, la photo du personnage dessous
12bde11 fix(vocal): les deux cadres font la même taille, le cercle reste centré
8fbd27a fix(vocal): la barre du bas s'efface de nouveau, panneaux plus transparents et bleutes
443b686 fix(vocal): marges intérieures, transparence visible, portrait ~3 x
d34c789 fix(vocal): le cercle reste allumé quand on masque l'affichage
5749322 feat(vocal): cadre arrondi des panneaux et bouton de masquage sans texte
684e9f3 fix(theme): les panneaux translucides prennent la teinte du theme, tout de suite
476ba3f fix(vocal): les quatre remarques du proprietaire sur l'ecran Vocal
a0daf4e fix(vocal): l'etat nu ne masque ni le portrait, ni le bouton, ni la saisie
815038f fix(vocal): l'etat nu ne peut plus emporter le portrait du personnage
0a4d3da Écran Vocal : la colonne de gauche affiche enfin la discussion
7769b64 Ecran Vocal : le personnage en haut a droite, le cercle vide, et le bouton de masquage enfin visible
afef214 Ecran Vocal : le portrait au centre du cercle, plus de ligne d'activite
82cf082 Ecran Vocal : la zone d'image en haut, le nom sous le cercle
```

Volume : 66 fichiers, +12 911 / −820 lignes.

## 3. Version dans les quatre fichiers (avant bump)

| Fichier | Version lue | Commande de vérification |
|---|---|---|
| `src-tauri/tauri.conf.json` | `0.6.5` | `grep -m2 '"version"' src-tauri/tauri.conf.json` |
| `package.json` | `0.6.5` | `grep -m2 '"version"' package.json` |
| `src-tauri/Cargo.toml` (paquet `pilot`) | `0.6.5` | `grep -n 'version' src-tauri/Cargo.toml` |
| `Cargo.lock` (paquet `pilot` **seulement**) | `0.6.5` | `grep -A2 'name = "pilot"' Cargo.lock` |

Règle de version retenue : **correctifs = dernier chiffre** → `0.6.5` → **`0.6.6`**.
Aucun recul de version. `v0.6.5` ne sera ni republiée ni déplacée.

Pourquoi 0.6.6 et pas une mineure : le lot ne change pas l'architecture de
l'écran Vocal, il corrige et finit un chantier déjà annoncé dans les notes de
`v0.6.5`.

## 4. Contrôles — résultat exact (AVANT publication)

### 4.1 Tests du frontend (Vitest) — VERTS

Rapport de sortie NEUF : `.pilot/tmp-pub/0.6.6-vitest.json`

```
npx vitest run --reporter=json --outputFile=.pilot/tmp-pub/0.6.6-vitest.json
EXIT = 0

numTotalTestSuites  = 1517
numPassedTestSuites = 1517
numFailedTestSuites = 0
numTotalTests        = 4958
numPassedTests       = 4958
numFailedTests       = 0
numPendingTests      = 0
numTodoTests         = 0
success              = true
```

Contrôle du piège « fichier qui ne se charge pas » :
`testResults.filter(t => t.assertionResults.length === 0)` → **0 fichier vide**.
Aucune suite ne compte « 0 test » en silence.

Base connue au dernier relevé : ~4782 tests. Ici **4958**, soit **+176**.
Écart attendu et expliqué : les 14 commits ajoutent des tests (Vocal point 7,
colonnes, état nu, discussion, thème). Aucun signe d'effondrement du total.

Le même contrôle a été **rejoué après le bump** (rapport
`.pilot/tmp-pub/0.6.6-vitest-postbump.json`) : 1517/1517 suites, 4958/4958 tests,
0 échec, `success = true`.

### 4.2 Tests Rust (`cargo test --workspace`) — VERTS

```
EXIT = 0
cargo test: 986 passed, 12 ignored (6 suites, 12.28s)
```

Les 12 tests ignorés sont **préexistants** et justifiés, jamais ajoutés pour
faire passer la publication :

| Fichier | Nombre | Raison déclarée |
|---|---|---|
| `gds-core/src/db.rs` | 6 | exige PostgreSQL (`PILOT_GDS_TEST_URL`) |
| `gds-core/src/http.rs` | 5 | exige PostgreSQL jetable (`PILOT_GDS_TEST_URL`) |
| `src-tauri/src/help.rs` | 1 | exige `pi` dans le PATH + un modèle local |

Preuve qu'aucun `#[ignore]` n'a été ajouté par ce lot :
`git diff v0.6.5..HEAD -- '*.rs' | grep "^+#\[ignore"` → **aucune ligne**.
Même résultat après le bump (EXIT = 0).

### 4.3 Fabrication de l'application — RÉUSSIE (signature faite en CI)

```
npm run tauri build
→ Built application at: G:\IA_PL\pilot\target\release\pilot.exe   (44,5 Mo)
→ Running light  → Pilot_0.6.5_x64_en-US.msi      (79,2 Mo)
→ Running makensis → Pilot_0.6.5_x64-setup.exe    (60,8 Mo)
→ Finished 2 bundles at: …\bundle\msi\… et …\bundle\nsis\…
```

La compilation (`release`, profil optimisé) et la fabrication des **deux**
installeurs aboutissent. La commande ne rend toutefois **pas 0** : elle s'arrête
sur la dernière étape, la **signature de mise à jour** :

```
failed to decode secret key: incorrect updater private key password
```

Ce n'est **pas** un défaut du code :

- la clé privée du poste existe (`~/.tauri/pilot-updater.key`) mais elle est
  protégée par un mot de passe que seul le propriétaire détient ;
- le dépôt public une clé publique (`plugins.updater.pubkey`) et
  `createUpdaterArtifacts: true` ;
- le workflow fournit les **deux** secrets
  (`.github/workflows/release.yml` lignes 269-270 et 415-416 :
  `TAURI_SIGNING_PRIVATE_KEY` **et** `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) ;
- la v0.6.5 a été publiée avec succès le 2026-10-30 à 04:18 UTC par ce même
  chemin, preuve que les deux secrets sont en place.

La signature est donc faite par la CI, pas sur le poste. C'est le
fonctionnement prévu du projet, ce n'est pas un contrôle rouge.

### 4.4 Verdict

| Contrôle | Résultat |
|---|---|
| Tests frontend (4958) | ✅ verts |
| Tests Rust workspace (986) | ✅ verts |
| Fichiers de test vides | ✅ aucun |
| Fabrication (binaire + MSI + NSIS) | ✅ réussie |
| Signature des artefacts | ✅ faite en CI (secrets en place) |

**Aucun contrôle rouge → publication autorisée.**

## 5. Publication

| Élément | Valeur |
|---|---|
| Commit de bump | `fce0c4628a25036da456e9b17cba3b0fb56f5542` — « chore: bump version to 0.6.6 » |
| Fichiers du commit | `Cargo.lock`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `release-notes/v0.6.6.md` (5 fichiers, +76 / −4) |
| `origin/main` après push | `fce0c46` (à jour) |
| Étiquette | `v0.6.6` (annotée, message = `release-notes/v0.6.6.md`), pointant sur `fce0c46` |
| Étiquette poussée | oui — `git push origin v0.6.6` → `ok v0.6.6` |
| `v0.6.5` | **non touchée**, non déplacée, non republiée |

Version dans les quatre fichiers après bump : `0.6.6` (une seule occurrence par
fichier ; seule la ligne du paquet `pilot` du `Cargo.lock` a été modifiée —
contrôle : `cargo tree -p pilot --depth 0` → `pilot v0.6.6`).

### Workflow de publication

- Workflow `release`, run **41046149493**, branche `v0.6.6`, démarré le
  2026-10-30 à 11:10:27 UTC.
- Le run `release` de la v0.6.5 (41002193283) est `completed / success`, ce qui
  confirme la chaîne.

## 5bis. Vérification sur GitHub (faite, pas supposée)

État des tâches du run 41046149493 :

| Tâche | État |
|---|---|
| `create-release` | completed · **success** |
| `test (ubuntu-22.04)` | completed · **success** |
| `test (macos-latest)` | completed · **success** |
| `test (windows-latest)` | completed · **success** |
| `build (macos-latest, x86_64-apple-darwin)` | completed · **success** |
| `build (macos-latest, aarch64-apple-darwin)` | completed · **success** |
| `build (windows-latest, x86_64-pc-windows-msvc)` | completed · **success** |
| `latest-json` | completed · **success** |
| `build-linux` | in_progress (séparé, `continue-on-error`, **aucune tâche n'en dépend**) |

### Release `v0.6.6` — publiée

```
tag        : v0.6.6
nom        : Pilot v0.6.6
publiée    : 2026-10-30T11:10:36Z
brouillon  : false
préversion  : false
```

Fichiers de la release (11) :

| Fichier | Taille |
|---|---|
| `Pilot_0.6.6_x64-setup.exe` | 61,8 Mo |
| `Pilot_0.6.6_x64-setup.exe.sig` | signature présente |
| `Pilot_0.6.6_x64_en-US.msi` | 80,4 Mo |
| `Pilot_0.6.6_x64_en-US.msi.sig` | signature présente |
| `Pilot_0.6.6_x64.dmg` | 37,3 Mo |
| `Pilot_0.6.6_aarch64.dmg` | 98,6 Mo |
| `Pilot_x64.app.tar.gz` `.sig` | 37,6 Mo |
| `Pilot_aarch64.app.tar.gz` `.sig` | 101,0 Mo |
| `latest.json` | présent |

Le fichier `.sig` commence bien par
`untrusted comment: signature from tauri secret key` → signature effectuée par
la CI avec la clé du propriétaire.

### `latest.json` — en 0.6.6

```
version  : 0.6.6
pub_date : 2026-10-30T11:30:10.695Z
notes    : « Modifications depuis v0.6.5 » + le changelog v0.6.6 (3 665 car.)
plateformes :
  windows-x86_64  → Pilot_0.6.6_x64-setup.exe
  darwin-aarch64  → Pilot_aarch64.app.tar.gz
  darwin-x86_64   → Pilot_x64.app.tar.gz
```

Lu depuis `https://github.com/pleveneur/pilot/releases/latest/download/latest.json`,
c'est-à-dire exactement l'adresse que l'application interroge au démarrage :
les installations existantes recevront donc bien la 0.6.6, et non un fichier
resté en 0.6.5.

### Étiquettes — preuve par `git ls-remote`

```
v0.6.5  → 10d43d0743ac63b241c8c9bf3c5306698149e342   (INCHANGÉE)
v0.6.6  → fce0c4628a25036da456e9b17cba3b0fb56f5542   (nouvelle)
main    → fce0c4628a25036da456e9b17cba3b0fb56f5542
```

Le dépôt de travail ne contient plus aucune modification non committée sur les
fichiers suivis ; les fichiers non suivis du propriétaire (conceptions,
propositions, rapports non suivis) **n'ont pas été committés ni déplacés**.
Le GDS n'a pas été touché : ni image, ni conteneur.

## 6. Ce que le propriétaire doit vérifier à la main

1. **Installer la 0.6.6** et confirmer que la mise à jour est bien proposée au
   démarrage (elle doit lire `latest.json` en `0.6.6`).
2. **Écran Vocal** : le cercle en haut, la **photo du personnage juste en
   dessous**, sur le même axe, environ trois fois plus grande qu'en 0.6.5 ; le
   nom sous le cercle.
3. **Colonne de gauche** : la discussion s'affiche dès l'ouverture, les
   questions à droite dans une bulle teintée, les réponses à gauche, et elle
   **se met à jour pendant l'échange**.
4. **Bouton-œil** : il dit « Ne garder que le portrait » / « Tout réafficher »,
   et le masquage **laisse le portrait, le bouton et la zone de saisie** ; le
   cercle reste allumé.
5. **Barre du bas** : elle s'efface de nouveau au repos et revient dès qu'on
   occupe le champ, qu'on écrit dessus, ou que Pilot écoute/parle.
6. **Thème** : passer de sombre à clair et vérifier que les panneaux
   translucides (colonnes, menus, palette) changent **tout de suite** et laissent
   voir la transparence.
7. **Largeur des colonnes** : 47 caractères par ligne, cadre arrondi, listes qui
   gardent leur nombre de lignes avec ou sans personnage.
