# Correctif local de Pilot — `whisper-rs-sys` 0.15.0

Cette copie du crate amont `whisper-rs-sys` **0.15.0** (utilisée par
`whisper-rs` 0.16, donc par la feature Cargo `whisper` de Pilot) est **patchée
localement**. Elle est déclarée dans le manifeste **racine** de Pilot :

```toml
[patch.crates-io]
whisper-rs-sys = { path = "src-tauri/vendor/whisper-rs-sys" }
```

Elle suit le précédent du dossier `src-tauri/vendor/wry` : un crate amont est
copié à l'identique, puis corrigé du strict nécessaire pour que Pilot compile
sur les machines du propriétaire, sans rien installer.

## Pourquoi ce correctif existe

`whisper-rs-sys` génère ses liaisons FFI avec **`bindgen`**, qui exige
`libclang`. Le chargeur de `bindgen` (`clang-sys`) **panique** quand
`libclang` est absent : le repli `Err` prévu par l'amont n'est jamais atteint.
Résultat mesuré sur la machine du propriétaire (2026-11-16) :
`error: unable to find libclang` — ni LLVM, ni MSVC en ligne de commande dans le
`PATH`.

Or Pilot n'a **pas** besoin de `bindgen` à la compilation : l'amont livre déjà
des liaisons pré-générées (`src/bindings.rs`, 5 964 lignes) et prévoit une
échappatoire documentée, `WHISPER_DONT_GENERATE_BINDINGS`, qui se contente de
copier ce fichier. Le seul outil réellement nécessaire pour construire
`whisper.cpp` est **`cmake` + le compilateur C++ du système** (MSVC sous
Windows), tous deux déjà présents.

## Les quatre changements, et rien d'autre

1. **`build.rs` — plus de `bindgen` quand `libclang` est absent.**
   L'aiguillage `if env::var("WHISPER_DONT_GENERATE_BINDINGS").is_ok()` devient
   `if bundled_bindings_only()`. Cette fonction :
   - retourne `true` si la variable d'environnement est posée (échappatoire
     amont, conservée) ;
   - cherche `libclang` (`LIBCLANG_PATH`, `PATH`, puis les emplacements
     d'installation courants — Windows, Homebrew, Debian, `/usr/lib/llvm`) et
     retourne `false` s'il le trouve : **le comportement de l'amont est alors
     conservé à l'identique** (liaisons régénérées) ;
   - sinon affiche un `cargo:warning` explicite en français et retourne `true` :
     liaisons pré-générées employées, aucun outillage à installer.
   La recherche est **bornée** (profondeur 1 ou 2) et **ne crée rien**.
2. **`build.rs` — `cargo:rerun-if-changed=src/bindings.rs`.**
   `src/bindings.rs` est la seule source des liaisons sur une machine sans LLVM ;
   l'amont ne surveille que `wrapper.h`. Sans cette ligne, une correction du
   fichier ne relançait pas le script de construction (cargo réutilisait le
   `OUT_DIR` précédent — constaté pendant la mise au point).
3. **`src/bindings.rs` — liaisons rendues neutres de plateforme.**
   Le fichier livré a été généré sur une machine **glibc**. Sur Windows/macOS,
   il ne compilait pas. Corrections, toutes bornées par `cfg` :
   - les trois assertions de disposition `_G_fpos_t`, `_G_fpos64_t`,
     `_IO_FILE` décrivent `stdio.h` de la **glibc** (elles échouaient avec
     `E0080` : 12 vs 16 octets, 208 vs 216 octets) ⇒ passées sous
     `#[cfg(target_env = "gnu")]`. Aucun type de l'API Whisper n'est concerné ;
   - `ggml_log_level` et `whisper_gretype` sont `c_uint` dans le fichier glibc,
     alors que les énumérations MSVC sont des `int` **signés** — `whisper-rs`
     déclare d'ailleurs `repr(i32)` sur `windows-msvc`. Ces deux alias
     deviennent `c_uint` hors Windows-MSVC et `c_int` sur Windows-MSVC : c'est
     exactement ce que `bindgen` produirait sur chaque plateforme (13 erreurs
     `E0308` `expected i32, found u32` avant cette correction).
4. **`build.rs` — `cargo:rustc-link-search` seulement pour les dossiers qui
   portent une bibliothèque** (correctif du 2026-11-16, livraison de l'oreille).
   L'amont annonce **tous** les sous-dossiers de l'arbre CMake (plus de 200 :
   `CMakeFiles`, `.tlog`, copies de travail…). Cargo reporte ces chemins dans le
   `PATH` des binaires qu'il **exécute** (`cargo test`, `cargo run`) : `PATH`
   dépassait 8 191 caractères, seuil au-delà duquel `cmd.exe` ne trouve plus les
   programmes des entrées suivantes — le témoin `cmd /C ping` de `plface`
   sortait aussitôt (`'ping' n'est pas reconnu…`) et **quatre tests**
   échouaient sous `--features whisper` (`plface` × 2,
   `agent_service` × 2), sans aucun rapport avec le produit. Le filtre
   (`dossier_porte_une_bibliotheque`) ne change **rien** à l'édition de liens :
   tout dossier contenant `whisper.lib`, `ggml*.lib`, `.a`, `.so` ou `.dylib`
   est toujours annoncé, et la récurrence est conservée.

**Aucune** autre ligne n'est modifiée : `whisper.cpp`, `wrapper.h`,
`src/lib.rs`, `Cargo.toml` et le reste du `build.rs` sont ceux de l'amont.
Rien n'est ajouté au dépôt de Pilot que ces fichiers, aucune dépendance
nouvelle, aucun réglage utilisateur.

## Vérification

```bash
# 1. La feature compile SANS libclang (le warning doit s'afficher) :
cargo check --manifest-path src-tauri/Cargo.toml --lib --features whisper

# 2. Le moteur natif est réellement lié et appelé (test sous la feature) :
cargo test --manifest-path src-tauri/Cargo.toml --lib --features whisper asr_whisper

# 3. Le build PAR DÉFAUT reste vert, feature désactivée :
cargo test --manifest-path src-tauri/Cargo.toml --lib

# 3 bis. Et la suite COMPLÈTE sous la feature (975 tests ; c'est le point 4
# qui la rend verte : sans le filtre, 4 tests tombaient sur le `PATH`) :
cargo test --manifest-path src-tauri/Cargo.toml --lib --features whisper

# 4. Le verrou du correctif (côté JS) :
npx vitest run src/js/oreille-integree-whisper-sans-outillage.test.js
npx vitest run src/js/oreille-integree-whisper-livraison.test.js
```

Résultat mesuré le 2026-11-16 (Windows, MSVC 14.50, `cmake` 4.3.1, **ni LLVM
ni `libclang`**) : étapes 1 à 4 vertes ; `cargo:warning=whisper-rs-sys (Pilot) :
libclang introuvable — liaisons pré-générées employées`. Suite complète sous la
feature : **975 réussis, 3 ignorés, 0 échec** ; sans la feature : **974
réussis, 3 ignorés, 0 échec**.

## Ré-appliquer le correctif lors d'une montée de version

Le correctif n'est **pas** reporté automatiquement : si `whisper-rs` (et donc
`whisper-rs-sys`) monte de version, il faut **refaire la copie** puis
ré-appliquer les trois points ci-dessus.

1. Repérer la version demandée par `whisper-rs` (`cargo tree -i whisper-rs-sys`
   ou le `Cargo.lock` produit par un `cargo update`).
2. Copier la caisse neuve dans `src-tauri/vendor/whisper-rs-sys` :

   ```bash
   VERSION=<nouvelle version>
   rm -rf src-tauri/vendor/whisper-rs-sys
   cp -r ~/.cargo/registry/src/*/whisper-rs-sys-$VERSION src-tauri/vendor/whisper-rs-sys
   rm -f src-tauri/vendor/whisper-rs-sys/.cargo-ok
   ```

3. Ré-appliquer les quatre points (blocs commentés `PILOT` dans `build.rs` et
   `src/bindings.rs` : les chercher avec `rg "PILOT|VENDOR-PATCH"`).
4. Mettre à jour la version annoncée dans `src/js/oreille-integree-whisper-sans-outillage.test.js`
   (le verrou vérifie `version = "0.15.0"` dans le `Cargo.toml` vendu).
5. Relancer les vérifications ci-dessus.

Le verrou JS échoue dès que l'un des changements vérifiés disparaît : le
correctif ne peut pas être perdu en silence.
