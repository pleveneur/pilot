# Rapport — Oreille intégrée Whisper : compiler SANS outillage C++

> Mission : faire compiler **et** fonctionner le moteur de dictée intégré
> (`whisper`, `asr_whisper.rs`, livré par `e044e89`) sur la machine du
> propriétaire, **sans y installer quoi que ce soit**.
> Date : 2026-11-16. Version du dépôt : 0.6.24 (aucun bump, aucune publication).

---

## 1. Le point de départ, mesuré

`cargo build --features whisper` échouait **avant même de compiler du code
Pilot** :

```
error: unable to find libclang: couldn't find any valid shared libraries
       matching: ['clang.dll', 'libclang.dll']
```

État de la machine (constaté, pas supposé) :

| Élément | Valeur |
|---|---|
| Cible Rust | `x86_64-pc-windows-msvc`, rustc 1.95.0 |
| `LIBCLANG_PATH` | **vide** |
| `C:\Program Files\LLVM` | **absent** ; aucun `libclang.dll` sur le disque |
| Compilateur C++ MSVC | **présent** (Build Tools 18.4.11626.88, MSVC 14.50.35717) |
| `cmake` | **présent** (4.3.1, `C:\Program Files\CMake`) |

Autrement dit : la machine sait déjà compiler du C++ ; c'est **uniquement**
`libclang` — l'outil dont `bindgen` a besoin pour *décrire* l'API en Rust — qui
manquait. Le correctif devait donc porter sur la génération des liaisons, pas
sur l'outillage C++.

---

## 2. Étape 1 — ce que la bibliothèque amont prévoit (vérifié, pas de mémoire)

`whisper-rs` 0.16 → `whisper-rs-sys` 0.15. Source amont lue dans le registre
cargo :

1. **Une échappatoire documentée existe.** `whisper-rs/README.md` (§
   *Troubleshooting*, « I get a panic during binding generation build! ») :

   > You can attempt to fix it yourself, or you can set the
   > `WHISPER_DONT_GENERATE_BINDINGS` environment variable. This skips
   > attempting to build the bindings whatsoever and copies the existing ones.
   > **They may be out of date, but it's better than nothing.**

   Elle est réellement implémentée : la branche fait
   `std::fs::copy("src/bindings.rs", out.join("bindings.rs"))`, et la caisse
   **livre** ce fichier (201 Kio, 5 964 lignes).
2. **Aucune archive précompilée.** `whisper-rs-sys` n'offre ni binaire, ni
   archive de bibliothèque : il copie `whisper.cpp/` (13 Mio) dans `OUT_DIR` et
   le construit par **`cmake`**. Ce chemin-là n'exige que le compilateur C++ du
   système.
3. **Pourquoi le repli `Err` de l'amont n'aide pas** : `bindgen` est appelé par
   `clang-sys`, qui **panique** à la recherche de `libclang` — le `match` de
   repli (`Err` → copie des liaisons) n'est donc jamais atteint.

**Premier essai, immédiat** : `WHISPER_DONT_GENERATE_BINDINGS=1 cargo check
--lib --features whisper` → **échec**, et c'est l'information décisive :

```
error[E0080]: evaluation of constant value failed
  ["Size of _G_fpos_t"][::std::mem::size_of::<_G_fpos_t>() - 16usize];   (12 ≠ 16)
  ["Size of _G_fpos64_t"]…                                              (12 ≠ 16)
  ["Size of _IO_FILE"][::std::mem::size_of::<_IO_FILE>() - 216usize];    (208 ≠ 216)
```

Traduction : les liaisons pré-générées ont été produites **sur une machine
glibc**. Le texte du README (« may be out of date ») est un euphémisme — elles
ne sont pas neutres de plateforme, elles décrivent `stdio.h` de la glibc.
Trois assertions de disposition seulement, sur des types que **Whisper
n'utilise jamais**.

Conclusion de l'étape 1 : la voie existe, elle est **la bonne** (aucun outil à
installer), mais elle est **inutilisable telle quelle** hors glibc.

---

## 3. Étape 2 et 3 — pourquoi elles sont devenues inutiles

L'ordre imposé de la mission (autre crate → programme séparé) ne se justifiait
que si l'étape 1 était une impasse. Deux petites corrections locales ont suffi ;
les voies de repli sont donc **écartées**, mais documentées au § 7 pour la
mémoire du projet.

---

## 4. Le correctif appliqué (copie locale, `[patch.crates-io]`)

Précédent du dépôt réutilisé : `src-tauri/vendor/wry` (caisse amont copiée à
l'identique puis corrigée). Nouvelle copie :
**`src-tauri/vendor/whisper-rs-sys`** (0.15.0, 790 fichiers, 13 Mio —
`whisper.cpp` et sa licence MIT compris), déclarée dans le **manifeste racine** :

```toml
[patch.crates-io]
wry = { path = "src-tauri/vendor/wry" }
whisper-rs-sys = { path = "src-tauri/vendor/whisper-rs-sys" }
```

`Cargo.lock` : la seule différence est la disparition de `source`/`checksum` de
`whisper-rs-sys` (2 lignes) — la caisse vient du disque.

### Les trois changements, et rien d'autre (détail : `VENDOR-PATCH.md`)

| # | Fichier | Changement |
|---|---|---|
| 1 | `build.rs` | l'aiguillage `if env::var("WHISPER_DONT_GENERATE_BINDINGS").is_ok()` devient `if bundled_bindings_only()` : variable honorée si posée ; sinon `libclang` est **cherché** (`LIBCLANG_PATH`, `PATH`, emplacements LLVM usuels — Windows, Homebrew, Debian, `/usr/lib/llvm`) et, s'il est trouvé, le comportement de l'amont est **conservé à l'identique** (liaisons régénérées) ; s'il est introuvable, un `cargo:warning` français le dit et les liaisons pré-générées servent. Recherche bornée (profondeur 1-2), **aucune écriture, aucune création**. |
| 2 | `build.rs` | `cargo:rerun-if-changed=src/bindings.rs` : sur une machine sans LLVM, ce fichier est la **seule** source des liaisons ; l'amont ne surveillait que `wrapper.h` (défaut rencontré pendant la mise au point : le `OUT_DIR` n'était pas régénéré). |
| 3 | `src/bindings.rs` | liaisons **neutres de plateforme** : (a) les trois assertions `_G_fpos_t` / `_G_fpos64_t` / `_IO_FILE` passent sous `#[cfg(target_env = "gnu")]` — ce sont des `stdio.h` de la glibc, **aucun type de l'API Whisper** ; (b) `ggml_log_level` et `whisper_gretype` deviennent `c_int` sur Windows-MSVC (les énumérations MSVC sont des `int` **signés**, et `whisper-rs` déclare `repr(i32)` sur cette cible) et restent `c_uint` ailleurs — c'est exactement ce que `bindgen` produirait sur chaque plateforme. Sans (b) : **13 erreurs** `E0308 expected i32, found u32` (`common_logging.rs` ×6, `whisper_grammar.rs` ×7). |

Rien d'autre : `whisper.cpp`, `wrapper.h`, `src/lib.rs`, `Cargo.toml` amont et le
reste de `build.rs` sont intacts. Aucune dépendance nouvelle, aucun réglage
utilisateur, aucune modification de la configuration de la machine.

---

## 5. Résultat mesuré

| Vérification | Résultat |
|---|---|
| `cargo check --lib --features whisper` | **vert**, `Finished` (7,3 s en incrémental) |
| `cargo build --lib --features whisper` (caisse nettoyée) | **vert en 1 min 08 s**, warning affiché : `whisper-rs-sys (Pilot) : libclang introuvable — liaisons pré-générées employées (aucun outillage C++ à installer).` |
| `cargo test --lib --features whisper asr_whisper` | **11 tests verts / 11**, dont le nouveau `avec_la_feature_le_moteur_natif_est_lie_et_repond` |
| Preuve que le natif est **lié et appelé** | le test fait répondre `whisper.cpp` lui-même : journaux `whisper_init_from_file_with_params_no_state: loading model from 'modele-absent-pour-ce-test.bin'` puis `failed to open …` |
| Compilation C++ en mode **Release** (le mode d'une vraie livraison) | `cmake --build --config Release` : **15 s, 0 erreur**, `whisper.lib` + `ggml.lib` + `ggml-cpu.lib` + `ggml-base.lib` produits |
| Build **par défaut** (feature désactivée) | `cargo test --lib` : **974 verts**, 3 ignorés — inchangé |
| Tests front | `npm test` : **5 984 tests / 324 fichiers, 0 échec** |
| Socle et serveur GDS | `cargo test -p gds-core -p gds-server` : **139 + 34 verts** |

Le moteur **compile donc réellement, sans rien installer**. Reste à vérifier
sur le terrain la transcription elle-même (§ 6).

---

## 6. Ce qui n'a PAS été mesuré, et pourquoi

**Aucune transcription réelle n'a été exécutée** : elle exige le fichier de
modèle `ggml-large-v3-turbo-q8_0.bin` (**874 188 075 o**), et la mission
interdisait explicitement de le télécharger. Ce qui est prouvé, c'est que :

- la bibliothèque native est **liée dans le binaire** et **appelée** (ses
  propres journaux sortent pendant le test) ;
- le chemin d'inférence (`WhisperContext::new_with_params`, `create_state`,
  `FullParams` — `Greedy { best_of: 1 }`, `set_n_threads`, `set_language("fr")`,
  `set_translate(false)`, `set_no_timestamps(true)`, `set_single_segment(false)`)
  est celui de l'amont, **inchangé** : il n'a été ni réécrit ni contourné.

Le propriétaire peut le constater en trois gestes, tous déjà présents :
Paramètres → Assistant → « Mode Vocal » → « Moteur intégré (dans Pilot) » →
bouton d'installation du modèle (téléchargement **sur geste** uniquement,
`asr_whisper_download.rs`) → parler. Tant que le modèle manque, l'écran reçoit
`modele-absent` avec sa phrase française et la dictée repart sur l'autre oreille.

---

## 7. Les options écartées, chiffrées (pour mémoire)

| Option | Coût | Pourquoi écartée |
|---|---|---|
| **A. Copie locale corrigée** (retenue) | 790 fichiers / 13 Mio vendus, 3 modifications ; build +69 s en debug (dont ~15 s de C++), +15 s en Release ; **0 installation** | — |
| **B. Installer LLVM** (`libclang.dll`) + `LIBCLANG_PATH` | installation système (plusieurs centaines de Mio à ~2 Gio selon la variante — **non mesuré**, installation interdite) + variable d'environnement à maintenir | Refusée par la consigne, et rend Pilot dépendant d'un outillage que le propriétaire ne veut pas |
| **C. Réécrire sur `candle-transformers` 0.11.1** (Whisper en Rust pur) | pas de C++ ni de `libclang`, mais nouveau format de modèle (`safetensors`) ⇒ réécriture de la couche d'inférence **et** du téléchargement, arbre de dépendances lourd | Change ce qui fonctionne ; l'API Whisper de l'amont n'est plus la référence |
| **D. `sherpa-rs` 0.6.8** (bindings `sherpa-onnx`, binaires fournis) | ni `libclang` ni `cmake`, mais **autre moteur** et modèles ONNX à télécharger ; ferait doublon avec l'oreille du service local | Deux moteurs à maintenir pour le même geste |
| **E. Programme `whisper.cpp` séparé** (dernier recours) | binaire à livrer sur 3 plateformes, cycle de vie à gérer, risque de fenêtre noire (règle `gds_core::proc::hide_console`) | Inutile dès lors que la liaison statique fonctionne |

---

## 8. Anti-régression : ce qui protège ce correctif

- **`src/js/oreille-integree-whisper-sans-outillage.test.js`** (10 verrous, tous
  verts) : la copie locale est bien celle que cargo compile (version 0.15.0
  vérifiée dans le `Cargo.toml` vendu) ; `bindgen` n'est plus une condition de
  compilation (aiguillage, recherche de `libclang`, `rerun-if-changed`, ordre
  aiguillage → `bindgen::Builder`) ; les trois assertions glibc sont bornées à
  `target_env = "gnu"` ; les deux énumérations suivent la règle MSVC ; la
  feature reste **optionnelle** (`default = []`, `optional = true`) ; aucun
  module vocal existant (`asr_voicestudio.rs`, `tts_local.rs`,
  `tts_voicestudio.rs`) ne dépend de `whisper` ; la preuve de liaison existe
  côté Rust et reste sous `#[cfg(feature = "whisper")]`.
- **`avec_la_feature_le_moteur_natif_est_lie_et_repond`** (Rust) : échoue si la
  bibliothèque native cesse d'être liée ou si la phrase « pas compilé » revient
  avec la feature active.
- **Rien du comportement vocal n'est touché** : oreille VoiceStudio, Piper,
  synthèse VoiceStudio, Web Speech, garde du nom, échéance de silence, veille de
  20 s, envoi automatique, défaut `voicestudio` — tout est inchangé et couvert
  par ses propres verrous (5 984 tests front verts).

## 9. Fichiers touchés

| Fichier | Nature |
|---|---|
| `Cargo.toml` (racine) | `[patch.crates-io]` + commentaire de justification |
| `Cargo.lock` | 2 lignes (`source`/`checksum` de `whisper-rs-sys`) |
| `src-tauri/vendor/whisper-rs-sys/**` | **nouvelle** copie locale corrigée (790 fichiers) + `VENDOR-PATCH.md` |
| `src-tauri/Cargo.toml` | commentaires (feature et dépendance) |
| `src-tauri/src/asr_whisper.rs` | commentaire d'en-tête + **1 test** de preuve de liaison |
| `src/js/oreille-integree-whisper-sans-outillage.test.js` | **nouveau** verrou (10 tests) |
| `spec_voice_input.md` | § 9bis, point 8 (compile sans rien installer) + verrous |
| `AGENTS.md` | arborescence (`vendor/whisper-rs-sys`) + ligne de navigation |
| `docs/rapports/RAPPORT-oreille-integree-whisper-deblocage.md` | ce rapport |

## 10. Ce qui reste à décider (propriétaire)

1. **Activer la feature dans les livraisons ?** Aujourd'hui `default = []` : le
   moteur intégré n'existe que si l'on construit avec `--features whisper`. Pour
   qu'il soit dans l'application installée, il faut ajouter ce drapeau aux
   commandes de build du workflow de release (+~1 min de C++ par plateforme ;
   `cmake` est présent sur les runners Windows/macOS/Linux). **Non fait** : c'est
   une décision de livraison, hors du périmètre de cette mission.
2. **Installer le modèle (874 Mio) et faire une dictée réelle** : dernier
   contrôle de terrain, sur geste de l'utilisateur, jamais automatique.
