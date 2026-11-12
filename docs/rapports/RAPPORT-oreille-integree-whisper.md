# Rapport — Oreille intégrée (Whisper dans Pilot)

**Date** : 2026-11-19 · **Version du dépôt** : `0.6.24` (inchangée) ·
**Périmètre** : Pilot uniquement (aucun service externe touché, rien de publié,
aucun poids de modèle téléchargé, aucune version bumpée).

## 1. Ce qui était demandé

Ajouter une **seconde oreille locale** à la dictée : un moteur de reconnaissance
**embarqué dans Pilot** (Whisper `large-v3-turbo` q8_0 via la bibliothèque Rust
`whisper-rs`), en **option additive désactivée par défaut**, sans rien retirer ni
modifier du chemin existant :

- l'oreille VoiceStudio (port local, `asr_voicestudio.rs`) reste **intacte** ;
- la synthèse Piper (`tts_local.rs`) et la synthèse VoiceStudio
  (`tts_voicestudio.rs`) restent **intactes** ;
- la dictée du navigateur (Web Speech) et **tout le mode vocal** restent
  **intacts** : veille de 20 s, échéance de silence repoussée par la voix, garde
  du nom / mots de réveil, envoi automatique, plafond des sessions vides ;
- le **web distant** ne change pas (pas de Tauri ⇒ oreille du navigateur).

## 2. Ce qui a été ajouté

### 2.1 Une clé de configuration ADDITIVE

| Quoi | Où | Détail |
|---|---|---|
| `local_dictation_engine: String` | `src-tauri/src/lib.rs` (`AppConfig`) | `#[serde(default)]`, défaut `default_local_dictation_engine()` ⇒ `"voicestudio"` |

La case existante **`local_dictation` n'a pas été détournée** (elle garde son sens
« la dictée locale, oui ou non »). La nouvelle clé dit seulement **qui transcrit** :

| Valeur relue | Effet |
|---|---|
| absente / vide / inconnue | service de voix local ⇒ **comportement d'avant, à l'identique** |
| `"integre"` | moteur intégré (Whisper) |

Aucune migration, aucun défaut changé, `serde(default)` garantit qu'un
`config.json` ancien reste lisible.

### 2.2 Un second contrôle dans les Paramètres

`index.html` — dans la **même** section « Mode Vocal » de l'onglet Assistant,
juste sous la case historique :

- `select#setting-local-dictation-engine` (« Oreille : … ») ;
- une note (`#local-dictation-engine-note`) et l'état déjà existant
  (`#local-dictation-state`, conservé) ;
- une rangée **visible seulement si le moteur intégré est choisi**
  (`#local-dictation-install-row`) : bouton **« Installer le modèle de dictée »**
  (`#btn-local-dictation-install`), bouton **« Arrêter le téléchargement »**
  (`#btn-local-dictation-install-cancel`) et un état `aria-live`
  (`#local-dictation-download-state`).

Les **libellés des deux oreilles ne sont pas recopiés** dans le HTML : ils
viennent de `DICTATION_ENGINE_OPTIONS` (`src/js/oreille-locale.js`), source
unique. Un verrou le vérifie.

### 2.3 Décisions pures (JS)

`src/js/oreille-locale.js` **étendu** (jamais remplacé) :

| Ajout | Rôle |
|---|---|
| `LOCAL_DICTATION_ENGINE_KEY` = `local_dictation_engine` | nom unique de la clé |
| `DICTATION_ENGINE_SERVICE` = `voicestudio`, `DICTATION_ENGINE_BUILTIN` = `integre` | les deux valeurs |
| `DICTATION_ENGINE_OPTIONS` | les deux libellés (« Service de voix local (actuel) », « Moteur intégré (dans Pilot) ») |
| `normalizeDictationEngine(valeur)` | toute valeur absente / vide / inconnue ⇒ `voicestudio` ; tolère casse, accents, ponctuation |
| `dictationEngineLabel`, `dictationEngineRequested(cfg)` | libellé lisible, lecture de la configuration |
| `planLocalEar({ requested, status, engine })` | **la** décision, étendue d'un champ ; délègue à `planIntegratedEar` |
| `planIntegratedEar({ requested, status })` | mêmes règles, pour le moteur intégré |
| `integratedEarFallbackSentence(reason)` | une phrase par panne, disant toujours la **conséquence réelle** (retour à un service en ligne) |
| `integratedEarModelSentence`, `integratedEarDownloadSentence` | phrases du modèle et du téléchargement (`null` au repos ⇒ **rien**, aucun téléchargement fantôme) |

Les 4 règles de repli et la phrase annoncée du service local sont **inchangées** :
`planLocalEar` sans `engine` rend exactement le plan d'avant (un verrou compare les
deux objets).

### 2.4 Une seule couture de session

`src/js/super-agent.js` :

- `localDictationEngine` (état en mémoire, relu à chaud) ;
- `refreshLocalDictation()` interroge **un seul** pont : `asr_whisper_status` si le
  moteur intégré est choisi, `asr_voicestudio_status` sinon, puis passe la réponse
  à **la même** décision (`planLocalEar({ …, engine })`) ;
- `oreilleLocalePhrase()` nomme le coupable réel (« Le moteur intégré de dictée » /
  « Le service de voix local ») ;
- `createDictationSession` branche sur le plan : `engine === DICTATION_ENGINE_BUILTIN`
  ⇒ `createIntegratedEar(...)`, sinon le chemin existant. **Aucune seconde règle de
  disponibilité** n'existe dans la dictée ;
- la panne en cours d'écoute recalcule le plan **avec** l'oreille réglée (la
  prochaine tentative part sur la bonne oreille, et le repli est dit).

`src/js/oreille-integree-moteur.js` (**nouveau**, 381 lignes) : `createIntegratedEar`
rend un objet de la **même forme** qu'une session du navigateur — `lang`,
`interimResults`, `continuous`, `onresult`, `onerror`, `onend`, `start`, `stop` —
plus les marques `localEar` / `integratedEar`. Conséquences :

- la garde du nom, l'envoi sur silence, la reprise en main, l'envoi automatique et
  le plafond des sessions vides restent écrits **une seule fois** dans
  `super-agent.js` ;
- **aucune capture n'est ouverte** : le moteur consomme le robinet
  `mic.setAudioTap(...)` de `vocal-mic.js` (un seul micro dans Pilot), convertit en
  PCM 16 bits mono 16 kHz par morceaux de 100 ms, et plafonne les envois en vol ;
- l'arrêt envoie **le reste du tampon avant** `asr_whisper_stop` (aucun mot perdu) ;
- toute panne remonte par `onerror({ error: "local-ear", local: true, message })`
  — la forme que la branche de repli existante attend.

### 2.5 Côté machine : deux modules frères (Rust)

| Fichier | Lignes | Rôle |
|---|---|---|
| `src-tauri/src/asr_whisper.rs` | 669 | moteur intégré |
| `src-tauri/src/asr_whisper_download.rs` | 407 | installation du modèle, **sur geste** |

Commandes (toutes `pub async fn` + `spawn_blocking`, jamais le thread principal) :

`asr_whisper_status`, `asr_whisper_start`, `asr_whisper_send`, `asr_whisper_stop`,
`asr_whisper_cancel`, `asr_whisper_log`, `asr_whisper_download`,
`asr_whisper_cancel_download`, `asr_whisper_download_state` — **les neuf sont
enregistrées** dans `tauri::generate_handler!` (un verrou le lit).

Points tenus :

- **un seul évènement** `asr-whisper-transcript` au format du frère
  (`started` / `partial` / `final` / `error` / `ended`) ;
- `MODEL_FILE = "ggml-large-v3-turbo-q8_0.bin"`, `MODEL_BYTES = 874_188_075`
  (taille exacte du fichier officiel), racine des données à côté des voix locales ;
- raisons lisibles **en français** : `disponible`, `moteur-non-compile`,
  `modele-absent`, `modele-illisible`, `moteur-occupe` ;
- **aucun port réseau**, **aucun programme lancé** (ni fenêtre noire : rien ne passe
  par `Command`), le module est vérifié par un verrou de source ;
- téléchargement : **un seul à la fois** (garde atomique), fichier `.part` voisin du
  final, **reprise par `Range`**, pourcentage borné, **arrêt qui ne supprime rien**,
  renommage seulement à taille exacte (`tts_local::file_complete`) ;
- **l'agent ne télécharge jamais rien** : la commande n'est appelée que par le
  gestionnaire de clic du bouton des Paramètres (un verrou lit les deux sites).

### 2.6 La feature Cargo est OPTIONNELLE

`src-tauri/Cargo.toml` :

```toml
[features]
default = []
whisper = ["dep:whisper-rs"]

[dependencies]
whisper-rs = { version = "0.16", optional = true }
```

Conséquence tenue : **le build par défaut est vert** (`cargo check --lib` OK) et le
module se contente de répondre `moteur-non-compile` avec une phrase française. Le
moteur ne s'active que par `cargo build --features whisper`.

## 3. Ce qui n'a PAS changé (et qui est prouvé)

| Élément | Preuve |
|---|---|
| Le **défaut** de la dictée (service local) | verrou « toute valeur absente, vide ou inconnue retombe sur le service local » + « la décision du service est IDENTIQUE à celle d'avant » (comparaison d'objets) |
| La case historique `local_dictation` | verrou côté Rust (`local_dictation: false` toujours un booléen) et côté JS (`dictationEngineRequested` la lit sans la réécrire) |
| `tts_voicestudio.rs`, `tts_local.rs`, `asr_voicestudio.rs` | **aucune ligne modifiée** (`git status` ne les liste pas) |
| Le **web distant** | aucun fichier de `web/` touché |
| La **garde du nom**, la veille de 20 s, l'échéance de silence, l'envoi automatique | aucune de leurs décisions n'est modifiée : le contrat de session est identique, et les verrous existants (`vocal-nom-garde`, `veille-transcription-locale`, `vocal-conversation`, `envoi-auto-fin-dictee`) passent **inchangés** |
| Le **micro** (une seule capture) | le module ne code ni `getUserMedia`, ni `AudioContext`, ni `navigator.mediaDevices` (verrou), et consomme `setAudioTap` |
| La **version** du projet | `0.6.24`, inchangée |

## 4. Le blocage réel : `whisper-rs` ne compile pas sur cette machine

**Constat mesuré, pas supposé.** Banc d'essai jetable (`cargo add whisper-rs` ⇒
v0.16.0) :

```
error: unable to find libclang
  whisper-rs-sys v0.15.0 (build.rs, bindgen)
  couldn't find any valid shared libraries matching: ['clang.dll', 'libclang.dll']
```

État de l'outillage local : `rustc 1.95.0` / `cargo 1.95.0` présents,
`LIBCLANG_PATH` **vide**, aucun `cl.exe` (MSVC absent du `PATH`), aucun LLVM dans
`C:\Program Files\LLVM`. `whisper-rs` exige **libclang** (bindgen) **et** un
compilateur C++ pour construire `whisper.cpp`.

**Décision tenue** (conforme à la consigne : ne pas bricoler) :

1. **rien n'a été installé ni téléchargé** (ni LLVM, ni MSVC, ni modèle) ;
2. `whisper-rs` est **optionnel** : le code compile et se teste **sans** lui ;
3. sans la feature, l'écran reçoit `moteur-non-compile` et **une phrase française**
   qui dit que le moteur n'est pas compilé dans cette version et que la dictée
   repart vers le navigateur — **jamais un silence, jamais un plantage** ;
4. le module est écrit **complet** (API `whisper-rs` 0.16 vérifiée : `FullParams`,
   `WhisperContext::new_with_params` + `create_state`, `WhisperState::full` +
   `get_segment(i).to_str_lossy()`), pour qu'activer la feature suffise dès que
   l'outillage est présent.

**Ce que le propriétaire devra faire pour l'activer** (une seule fois, sur sa
machine) : installer LLVM (qui fournit `libclang.dll`) et l'outillage C++ de
Visual Studio, puis builder avec `cargo build --features whisper`. **Aucune de ces
installations n'a été faite ici.**

## 5. Tests lancés et résultats

| Commande | Résultat |
|---|---|
| `npx vitest run` (suite front complète) | **323 fichiers / 5974 tests, tous verts** |
| `npx vitest run src/js/oreille-integree-whisper.test.js` | **33 / 33** (nouveau) |
| `npx vitest run oreille-locale-etape1 oreille-locale-etape2` | **52 / 52** (dont 18 verrous de l'étape 2 mis à jour pour le contrat étendu, jamais affaiblis) |
| `cargo test --lib asr_whisper` | **10 / 10** (6 moteur + 4 téléchargement) |
| `cargo check --lib` | **vert** (`Finished dev profile`), 31 avertissements **préexistants**, aucun dans `asr_whisper*` |
| `npm run build:handbook` | régénéré (50 blocs) après mise à jour de `spec_voice_input.md` |

Ce que le nouveau verrou `oreille-integree-whisper.test.js` refuse (il **échoue**
sur le code d'avant, et sur toute régression) :

1. un défaut changé : valeur absente/vide/inconnue qui ne retomberait pas sur le
   service local, ou un plan du service qui ne serait plus identique ;
2. un libellé recopié dans le HTML au lieu de venir de la source unique ;
3. un repli **muet** ou qui n'annonce pas la conséquence réelle (service en ligne),
   ou un statut illisible présenté comme « prêt » ;
4. une **seconde** oreille qui n'aurait pas le même contrat (`lang`,
   `interimResults`, `continuous`, `onresult`, `onerror`, `onend`, `start`, `stop`) ;
5. une **seconde capture micro** dans le nouveau module, ou une adresse réseau /
   un `fetch` ;
6. une commande non branchée dans `lib.rs`, un port ouvert côté Rust, un programme
   lancé ;
7. un téléchargement qui partirait **sans clic** (l'état relu ne doit rien lancer),
   ou un arrêt qui supprimerait un fichier ;
8. une clé non additive côté Rust (absence de `#[serde(default)]`, défaut qui ne
   serait pas `voicestudio`), ou une case `local_dictation` détournée ;
9. une phrase qui nommerait le mauvais coupable, ou une seconde composition de
   cette phrase.

## 6. Ce qui reste à MESURER par le propriétaire (rien n'est inventé ici)

Aucune de ces valeurs n'a été mesurée : le moteur ne peut pas être compilé sur
cette machine, et **le modèle n'a pas été téléchargé**.

| Mesure | Pourquoi elle manque |
|---|---|
| **Délai réel** entre le dernier mot et le texte définitif | exige le moteur compilé + le modèle |
| **Qualité sur le français du propriétaire** (accent, débit, vocabulaire technique) | exige le moteur compilé + le modèle |
| **Temps de chargement du modèle** (874 Mo, q8_0) au premier démarrage d'une dictée | exige le modèle sur disque |
| **RAM et CPU** pendant l'écoute (fil de transcription) | exige le moteur compilé |
| **Fluidité des partiels** (morceaux de 100 ms envoyés au fil de l'eau) | exige le moteur compilé |

Le module impose déjà les garde-fous qui rendent ces mesures interprétables :
`set_language("fr")`, pas de traduction, pas d'horodatage, nombre de fils borné,
et **un seul évènement** par étape — donc la mesure se fera en lisant le journal
existant, sans instrumentation nouvelle.

## 7. Commandes utiles (après ce lot)

```bash
# Les verrous de cette oreille
npx vitest run src/js/oreille-integree-whisper.test.js

# Le pont machine (10 tests, sans la feature)
cargo test --manifest-path src-tauri/Cargo.toml --lib asr_whisper

# Le build par défaut doit rester vert (c'est la règle de ce lot)
cargo check --manifest-path src-tauri/Cargo.toml --lib

# Activer le moteur (aucun outillage C++ à installer depuis le correctif
# du 2026-11-16 — voir RAPPORT-oreille-integree-whisper-deblocage.md)
cargo build --manifest-path src-tauri/Cargo.toml --features whisper
```

## 8. Conclusion

L'oreille intégrée existe **de bout en bout** (réglage → décision → session →
pont machine → installation du modèle sur geste), elle est **désactivée par
défaut**, elle **ne déplace aucune décision existante**, et son indisponibilité est
**toujours dite en français** avec sa conséquence réelle. Le seul point non
franchi à l'époque de ce lot était l'outillage de compilation de `whisper-rs`
(`libclang`), documenté au § 4 — sans bricolage, sans installation, et sans que le
build par défaut en souffre.

**Suite (2026-11-16)** : ce point est franchi. La caisse `whisper-rs-sys` est
copiée localement et patchée (`[patch.crates-io]` racine,
`src-tauri/vendor/whisper-rs-sys`) : elle emploie les liaisons pré-générées quand
`libclang` est introuvable, et seuls `cmake` + le compilateur C++ du système
restent nécessaires — les deux sont déjà présents sur la machine du
propriétaire. Mesures, limites et verrous :
`docs/rapports/RAPPORT-oreille-integree-whisper-deblocage.md`.
