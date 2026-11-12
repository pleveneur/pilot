# Rapport — l'oreille Whisper intégrée entre dans l'application livrée

Date : 2026-11-16 · Projet : `G:\IA_PL\pilot` · Version préparée : **0.6.25**
Suite : `c8c366c` (l'oreille compile sans outillage C++) et `e044e89` (oreille
additive, désactivée par défaut).

---

## 1. Le défaut corrigé

L'oreille intégrée existait dans le dépôt, compilait, s'affichait dans les
réglages… mais **pas dans l'application installée**. La feature Cargo `whisper`
n'était activée que par une ligne de commande tapée à la main par le
propriétaire ; le workflow de publication construisait sans elle. Sur un poste
réel, l'écran ne pouvait donc répondre que :

> Le moteur intégré n'est pas compilé dans cette version de Pilot.

Autrement dit : une fonctionnalité livrée sur parole, mais **rien à essayer**
après installation.

---

## 2. La commande modifiée (une seule ligne, un seul job)

`.github/workflows/release.yml`, job **`build`** (celui que suivent `latest-json`
et la mise à jour automatique) :

```yaml
# avant
args: --target ${{ matrix.rust_target }}

# après  (ligne ~371, précédée d'un commentaire de 15 lignes)
args: --target ${{ matrix.rust_target }} --features whisper
```

Pourquoi **une seule** ligne suffit : la matrice de ce job porte exactement les
**trois cibles publiées** —

| Entrée de matrice | Cible Rust | Plateforme publiée |
|---|---|---|
| `windows-latest` | `x86_64-pc-windows-msvc` | Windows x64 |
| `macos-latest` | `aarch64-apple-darwin` | macOS Apple Silicon |
| `macos-latest` | `x86_64-apple-darwin` | macOS Intel |

Le drapeau n'est conditionné à aucune cible : il vaut pour les trois.

**Ce qui n'a pas été touché, volontairement** :

- job `build-linux` : Linux ne fait pas partie des trois plateformes demandées,
  et ce job est déjà `continue-on-error`, hors chemin critique. Il continue de
  construire **sans** la feature — donc sans risque nouveau, et son binaire
  répond `moteur-non-compile` (phrase française) si quelqu'un l'active.
- aucune autre commande de fabrication n'a été ajoutée : `tauri-action` compile
  lui-même, et une seconde compilation à côté produirait un binaire **sans** le
  moteur.

Coût mesuré de la feature sur cette machine : **~1 min de C++ par cible**
(`whisper.cpp` + `ggml` par `cmake`/MSVC), plus le link.

---

## 3. Builds réellement lancés, et résultats

Machine : Windows 11, MSVC 14.50, `cmake` 4.3.1, **ni LLVM ni `libclang`**.

| Commande | Résultat | Preuve |
|---|---|---|
| `cargo build --release --features whisper --manifest-path src-tauri/Cargo.toml` | ✅ `Finished release profile in 2m16s` (puis 1m55s après le correctif du § 5) | `target/release/pilot.exe` = **44,3 Mo** |
| `cargo build --release` (**sans** feature, même machine) | ✅ `Finished release profile in 1m53s` | `pilot.exe` = **42,0 Mo** — **écart de +2,3 Mo**, c'est le moteur |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (**sans** feature) | ✅ **974 réussis, 3 ignorés, 0 échec** | comportement par défaut intact |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --features whisper` | ✅ **975 réussis, 3 ignorés, 0 échec** | le 975ᵉ est le test de liaison natif |
| `cargo test --workspace` | ✅ **1 147 réussis, 0 échec** (974 desktop + 139 `gds-core` + 34 `gds-server`) | le socle et le serveur GDS ne sont pas touchés |
| `npx vitest run` (front complet) | ✅ **325 fichiers, 5 995 tests, 0 échec** | dont 20 verrous neufs (§ 6) |

### L'application produite contient vraiment le moteur

Un build n'est pas une preuve ; le binaire l'est. Les **deux** binaires de
release ont été construits et comparés sur la même machine :

| Symbole recherché | Sans la feature (42,0 Mo) | Avec la feature (44,3 Mo) |
|---|---|---|
| `whisper_full_with_state` (whisper.cpp lié) | **0** | **13** |
| `ggml_` (moteur ggml) | 0 | **80** |
| `large-v3-turbo` (modèle attendu, nommé) | 3 | 3 |
| `moteur-non-compile` (phrase de repli en français) | **1** | 1 |

La dernière ligne est aussi importante que les autres : **sans** le moteur, le
binaire porte bien la phrase française de repli — il ne plante pas, il ne se
tait pas. Et la présence du modèle nommé dans les deux binaires montre que le
repli n'est pas un texte perdu dans un fichier mort : il est dans l'application.

Sur `target/release/pilot.exe` construit **avec** la feature :

```
whisper_full_with_state   13 occurrences   (whisper.cpp réellement lié)
ggml_                     80 occurrences   (moteur ggml)
large-v3-turbo             3 occurrences   (le modèle attendu est nommé)
asr_whisper_download*     commande présente (téléchargement sur geste)
```

Et le test `avec_la_feature_le_moteur_natif_est_lie_et_repond` (sous
`#[cfg(feature = "whisper")]`) s'exécute et affiche, dans la suite verte :

```
whisper_init_from_file_with_params_no_state: loading model from 'modele-absent-pour-ce-test.bin'
whisper_init_from_file_with_params_no_state: failed to open 'modele-absent-pour-ce-test.bin'
```

C'est le moteur natif qui **répond** : il est appelé, il ne trouve pas le
modèle (c'est le cas testé) et il rend une erreur propre.

### Sans la feature, rien ne dépend de la feature

- `default = []` est inchangé : `cargo test`, `npm run tauri dev` et le job
  `test` de la CI ne compilent pas `whisper-rs`.
- Les trois voisins vocaux (`asr_voicestudio.rs`, `tts_local.rs`,
  `tts_voicestudio.rs`) ne contiennent aucune mention de la feature (§ 6, test
  dédié).
- Le module `asr_whisper.rs` compile dans les deux cas et, sans le moteur,
  répond `moteur-non-compile` **avec une phrase française**.

---

## 4. Utilisateur sans modèle : message clair, repli annoncé, jamais de plantage

Chaîne réellement branchée (lecture seule, aucun code modifié ici) :

1. `planLocalEar({ requested, status, engine })` interroge
   `asr_whisper_status` — jamais un service joint par la fenêtre.
2. Sans modèle, la réponse porte `modele-absent` ; le plan rend `use: false`,
   une **phrase française** (`RAPPORT`… `integratedEarModelSentence`) qui dit la
   taille du modèle, le **geste** à faire, et **ce qui se passe à la place**.
3. La phrase est dite **une fois par panne** : `annoncerRepliLocal` (hors mode
   Vocal, dans la conversation) ou `localEarStatusLine` (dans le mode Vocal, où
   l'écran nu ne parle qu'par sa ligne d'état). Jamais en boucle, jamais tu.
4. Aucune exception ne remonte : le statut est lu dans un `try/catch`, et
   l'échec de la commande devient un plan de repli.
5. Les quatre raisons sont couvertes par des verrous existants :
   `moteur-non-compile`, `modele-absent`, `modele-illisible`, `moteur-occupe`
   (`src/js/oreille-integree-whisper.test.js`, 33 tests, verts).

**Rien ne se télécharge tout seul** : le constat (`asr_whisper.rs`) ne contient
aucune requête réseau (`reqwest`, `ureq`, `TcpStream`, URL) — c'est un verrou du
§ 6 ; le téléchargement vit dans son module frère, appelé **uniquement** par le
geste des Paramètres.

---

## 5. Défaut trouvé pendant la vérification, et corrigé

La suite complète **sous la feature** tombait d'abord sur **4 tests** :

```
agent_service::tests::collect_session_states_lists_all_sessions
agent_service::tests::purge_ghost_running_states_resets_orphan_rows_and_keeps_live_ones
plface::tests::kill_process_spares_other_names_and_stops_matching_process
plface::tests::trace_d_une_autre_copie_vivante_n_est_pas_refermee
```

Aucun rapport avec le produit : ces tests lancent un témoin `cmd /C ping`, et le
témoin mourait aussitôt (`'ping' n'est pas reconnu en tant que commande interne`).

Cause mesurée : `whisper-rs-sys` annonce **chaque sous-dossier** de l'arbre CMake
(plus de 200 : `CMakeFiles`, `.tlog`, copies de travail) en
`cargo:rustc-link-search`. Cargo reporte tous ces chemins dans le **`PATH`** des
binaires qu'il exécute (`cargo test`, `cargo run`). Le `PATH` obtenu dépassait
8 191 caractères — seuil au-delà duquel `cmd.exe` ne trouve plus les programmes
des entrées suivantes, dont `C:\Windows\System32\ping.exe`.

Correctif (4ᵉ changement de la copie locale, `PILOT` commenté, décrit dans
`src-tauri/vendor/whisper-rs-sys/VENDOR-PATCH.md`) : `add_link_search_path`
n'annonce plus que les dossiers qui **portent réellement une bibliothèque**
(`.lib`, `.a`, `.dylib`, `.so`). La récursion est conservée et l'édition de liens
est identique — les dossiers de `whisper.lib` / `ggml*.lib` sont toujours
annoncés. Le `PATH` retombe à quelques entrées.

Après le correctif : **975 réussis, 0 échec** sous la feature. Ce correctif a
aussi une valeur hors tests : `cargo run` propageait ce `PATH` noyé à
l'application, donc à ses propres lancements de processus.

---

## 6. Verrous ajoutés (pour que la livraison ne se perde plus)

| Fichier | Ce qu'il protège | Tests |
|---|---|---|
| `src/js/oreille-integree-whisper-livraison.test.js` (neuf) | le drapeau est posé sur la ligne `args:` du job `build`, les **trois** cibles publiées sont toujours dans la matrice, aucune seconde compilation sans le drapeau, `default = []` intact, aucun module vocal existant ne dépend de la feature, le repli est une phrase française qui dit sa conséquence, le défaut reste `voicestudio`, le module de constat n'ouvre aucune requête réseau | 10 |
| `src/js/oreille-integree-whisper-sans-outillage.test.js` (+1) | le filtre du § 5 ne peut pas être retiré en silence (et les quatre extensions de bibliothèque restent couvertes) | 11 |

Un futur changement de `release.yml` qui retirerait `--features whisper` **fait
donc échouer la CI** — la fonctionnalité ne peut plus redevenir invisible.

---

## 7. Version, changelog, documentation

- **0.6.25** dans les quatre fichiers (`src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `package.json`, `Cargo.lock` — une **seule**
  occurrence de `version = "0.6.25"`, celle du paquet `pilot`). La 0.6.24 reste
  intacte ; **aucun tag, aucun push, aucune publication** n'a été fait.
- `release-notes/v0.6.25.md` (obligatoire pour la publication) : nouvelle
  oreille locale optionnelle, modèle à télécharger **sur un geste**, **rien ne
  change par défaut**, et l'app installée contient désormais le moteur.
- `spec_voice_input.md` § 9bis point 8 : la feature reste optionnelle **dans le
  code** mais est **posée dans la publication**, avec le verrou associé.
- `AGENTS.md` (ligne de navigation « Dictée vocale ») : même précision, pour que
  la prochaine session ne croie pas la feature absente des livraisons.
- `src-tauri/vendor/whisper-rs-sys/VENDOR-PATCH.md` : 3 → **4** changements,
  avec la cause du § 5 et les commandes de vérification à jour.

---

## 8. Ce qui reste à mesurer par le propriétaire APRÈS installation

Tout ceci ne peut pas être prouvé avant d'avoir l'application installée et un
micro ; c'est la liste honnête de ce qui reste ouvert.

1. **Installer la 0.6.25** (Windows d'abord) et vérifier que l'application
   démarre normalement : l'ajout du moteur ne doit rien changer au lancement.
2. Paramètres → Assistant → « Mode Vocal » → **Oreille : Moteur intégré (dans
   Pilot)**, puis **télécharger le modèle** (~874 Mo) : barre de progression,
   arrêt possible sans rien perdre, reprise ensuite.
3. **Sans modèle**, choisir le moteur intégré : vérifier que le message annonce
   la taille, le geste et le repli (dictée du navigateur = service en ligne), et
   qu'il n'est dit **qu'une fois**.
4. **Avec le modèle**, dans l'écran Vocal, prononcer le nom : mesurer
   (a) la latence du premier mot, (b) la qualité en français courant, (c) le
   comportement en cas de silence long (échéance de 15 s contre bruit de fond),
   (d) que **la veille de 20 s** ne s'arme pas pendant une longue transcription.
5. **Le reste du vocal ne doit pas bouger** : garde du nom, envoi automatique,
   reprise en écoute après chaque réponse, coupure de parole (« barge-in »),
   lecture à voix haute (Piper / VoiceStudio), oreille VoiceStudio.
6. **macOS** (Intel et Apple Silicon) : le seul point non mesuré ici. Le drapeau
   est le même ; il faut confirmer que `cmake` + C++ du runner compilent
   `whisper.cpp` dans le temps du job (le budget du workflow reste 90 min) et que
   l'application signée contient bien le moteur.
7. **Linux** : non embarqué (décision de périmètre) ; l'écran doit y répondre
   `moteur-non-compile` en français, sans plantage.

---

## 9. Commandes à lancer pour refaire ces vérifications

```bash
# Front complet (dont les 20 verrous de livraison)
npm test

# Défaut, SANS la feature (ce que compile la CI)
cargo test --manifest-path src-tauri/Cargo.toml --lib

# Espace de travail complet (desktop + socle + serveur GDS)
cargo test --workspace

# Moteur réellement lié et appelé
cargo test --manifest-path src-tauri/Cargo.toml --lib --features whisper asr_whisper

# Suite complète sous la feature
cargo test --manifest-path src-tauri/Cargo.toml --lib --features whisper

# Le binaire livrable, avec le moteur
cargo build --release --features whisper --manifest-path src-tauri/Cargo.toml

# La preuve dans le binaire (symboles whisper.cpp + ggml)
grep -a -c "whisper_full_with_state" target/release/pilot.exe
```
