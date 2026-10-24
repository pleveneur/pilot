# Rapport — Voix française locale au choix (dont une voix masculine)

> Mission : rendre la voix locale Piper **choisissable** (au moins une voix
> masculine), avec **téléchargement automatique** du modèle choisi, **un seul**
> réglage (`read_aloud_voice`), repli visible, journal, annulation.
>
> Statut : **terminé** (code, tests, docs ; un seul commit local ; aucune
> publication, aucun bump de version, aucune installation).
>
> Commit local unique : `feat(voix): choisir la voix francaise locale, dont une voix masculine`.

## 0. Journal de progression

- [x] Étape 0 — rapport créé **avant** l'analyse (ce fichier).
- [x] Étape 1 — voix réellement présentes dans `rhasspy/piper-voices` vérifiées
      (noms, qualités, tailles exactes, URLs, genre) ; mécanisme de localisation
      du moteur et du modèle établi dans `tts_local.rs` ; flux du réglage
      `read_aloud_voice` établi (`read-aloud.js` → `local-voice.js` →
      `settings.js` → config Rust).
- [x] Étape 2 — fonctionnalité : catalogue de 4 voix locales (dont 2 masculines),
      un seul réglage, téléchargement sur geste avec état visible + arrêt +
      vérification à nouveau, repli visible et journalisé, docs à jour.
- [x] Étape 3 — tests ajoutés (JS + Rust), dont **un test prouvé par
      neutralisation volontaire** (§ 4.3).
- [x] Étape 4 — `npm test` : **2700 tests passés, 0 échec**.
      `cargo test --manifest-path src-tauri/Cargo.toml --lib` : **708 passés,
      1 ignoré, 0 échec** (dont 14 sur `tts_local*`). Commit local unique.

## 1. Faits vérifiés (aucune invention)

### 1.1 Voix françaises réellement présentes dans `rhasspy/piper-voices`

Répertoires sous `fr/fr_FR/` : `gilles`, `mls`, `mls_1840`, `siwis`, `tom`,
`upmc`. Fichiers exacts (tailles relevées par l'API Hugging Face, en octets) et
locuteurs par modèle (`num_speakers` lu dans le `.onnx.json` officiel) :

| Modèle | Qualité | `.onnx` (octets) | `.onnx.json` | `num_speakers` | Échantillons/échantillonnage | Genre retenu |
|---|---|---|---|---|---|---|
| `fr_FR-gilles-low` | low | 63 104 526 | 4 158 | 1 | 16 kHz | homme |
| `fr_FR-mls-medium` | medium | 76 733 750 | 7 036 | **125** | 22,05 kHz | (multi-locuteurs : écarté) |
| `fr_FR-mls_1840-low` | low | 63 104 526 | 4 160 | 1 | 16 kHz | (non retenu) |
| `fr_FR-siwis-low` | low | 28 130 791 | 4 157 | 1 | 16 kHz | femme |
| `fr_FR-siwis-medium` | medium | 63 201 294 | 4 875 | 1 | 22,05 kHz | femme |
| `fr_FR-tom-medium` | medium | 63 511 038 | 4 959 | 1 | 44,1 kHz | homme |
| `fr_FR-upmc-medium` | medium | 76 733 615 | 4 996 | **2** | 22,05 kHz | (multi-locuteurs : écarté) |

URLs (téléchargement direct, HTTP `Range` accepté) :

```
https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/<nom>/<qualité>/fr_FR-<nom>-<qualité>.onnx
https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/<nom>/<qualité>/fr_FR-<nom>-<qualité>.onnx.json
```

Toutes les voix : `espeak.voice = "fr"`. `upmc` porte
`speaker_id_map = {jessica: 0, pierre: 1}`.

**Preuve du genre** (deux sources concordantes, aucune supposition) :

1. Fiche du jeu de données : `marytts/upmc-pierre-data` — « Pierre Chauvin, a
   **male** native speaker of French ». `MODEL_CARD` : `gilles` = voix
   d'homme réentraînée, `siwis` = voix féminine (`datashare.ed.ac.uk`),
   `tom` = `Tjiho/French-tts-model-piper`, `mls` = `openslr 94`.
2. **Mesure** de la fréquence fondamentale (F0) sur les échantillons **officiels**
   de `rhasspy.github.io/piper-samples`, par autocorrélation dans un
   `OfflineAudioContext` (décimation à ~5 512,5 Hz, médiane sur les trames
   voisées) :

   | Voix | F0 médiane | p25 / p75 | Conclusion |
   |---|---|---|---|
   | `upmc` locuteur 1 (« pierre ») | **137,8 Hz** | 114,8 / 149,0 | homme |
   | `gilles` | **117,3 Hz** | — | homme |
   | `tom` | **141,3 Hz** | — | homme |
   | `siwis` | **196,9 Hz** | — | femme |
   | `upmc` locuteur 0 (« jessica ») | **229,7 Hz** | — | femme |

   Seuil usuel : ≈ 155 Hz sépare voix d'homme (< 155) et voix de femme (> 165).

### 1.2 Comment le moteur et le modèle sont localisés (`src-tauri/src/tts_local.rs`)

- Racine : `<app_data_dir>/voix-locale/` (`LOCAL_VOICE_DIR`).
- Moteur : `voix-locale/piper/piper.exe` (`PIPER_SUBDIR`), avec ses DLL et
  `espeak-ng-data/` à côté. **Windows uniquement** en pratique (le binaire
  officiel est un `.exe`) : ailleurs, le statut reste « absent » → repli.
- Modèle : `voix-locale/voix/fr_FR-<nom>-<qualité>.onnx` + `.onnx.json`
  (`VOICES_SUBDIR`), chemins déduits d'un **seul** dossier (`model_path`,
  `model_config_path`).
- `status_for_dir(root, model)` renvoie : `installed` (moteur **et** `.onnx`
  **et** `.onnx.json` présents), `engine_present`, `model_present`, `missing`
  (liste réelle des fichiers manquants), `dir`, `gender`, `quality`,
  `model_bytes`, `hint` (phrase lisible, jamais un mensonge).
- `voice_for(Option<&str>)` : valeur absente **ou inconnue** → voix par défaut
  (`fr_FR-siwis-medium`).
- Synthèse : `tts_local_synthesize(text, model)` — processus local en
  `spawn_blocking`, `CREATE_NO_WINDOW` sous Windows, sorties drainées, plafond
  30 s, WAV renvoyé en base64. **Aucun réseau** dans ce module.
- Téléchargement : `tts_local_download.rs` (nouveau) — `reqwest::blocking`
  (dépendance **déjà** présente), fichier `.part` + `Range` + renommage.

### 1.3 Flux du réglage `read_aloud_voice` (un seul champ)

1. **Config Rust** (`src-tauri/src/lib.rs`) : `#[serde(default)]
   read_aloud_voice: String` (défaut `""`). Aucun autre champ de voix n'existe.
2. **`settings.js`** : le `<select>` `#setting-read-aloud-voice` est rempli par
   `voiceChoiceOptions()` ; la valeur est enregistrée **telle quelle** dans
   `read_aloud_voice` (`read_aloud_voice: selectReadAloudVoice ?
   selectReadAloudVoice.value : ""`). Aucune traduction de valeur, aucun nom de
   modèle écrit à la main dans l'interface (vérifié par test).
3. **`read-aloud.js`** : `applyVoicePreferenceFromConfig` applique la valeur au
   démarrage et à chaque `pilot-config-changed` ; `createSpeaker` choisit le
   moteur local si `isLocalVoiceChoice(voix)` ; `voiceChoiceStatus` produit la
   note affichée (4 états : `empty`, `missing`, `ok`, `local-missing`).
4. **`local-voice.js`** : traduit la valeur en modèle
   (`localVoiceModelFor`), détient le catalogue (`LOCAL_VOICE_MODELS`), les
   libellés, le statut **par modèle**, la synthèse et le téléchargement.

Compatibilité : `local:piper` = voix par défaut (comportement identique à la
version 0.4.45) ; `local:piper:<modèle>` = une autre voix, **même champ**.

## 2. Avant / après

| | Avant (0.4.45) | Après |
|---|---|---|
| Voix locales proposées | **1**, imposée : `fr_FR-siwis-medium` (femme) | **4** (`siwis-medium` femme défaut, `tom-medium` homme, `gilles-low` homme, `siwis-low` femme), avec genre et taille écrits dans la liste |
| Choix de la voix locale | impossible | une entrée par voix dans la liste des voix (après « Automatique ») |
| Réglage | `read_aloud_voice` (`local:piper` seulement) | **le même champ unique** ; `local:piper` = voix par défaut, `local:piper:<modèle>` = les autres |
| Modèle manquant | message « déposez les fichiers à la main » | phrase + bouton **« Télécharger le modèle »** ; le téléchargement part aussi du **choix** d'une voix dont le modèle manque |
| Téléchargement | aucun | `tts_local_download` : un seul modèle à la fois, `.part` + reprise `Range` + renommage, tailles vérifiées, progression poussée (taille + %) |
| Arrêt | aucun | **`tts_local_cancel_download`** (bouton « × Arrêter le téléchargement ») — **rien n'est supprimé**, un `.part` reprend |
| État périmé | impossible à rafraîchir sans rouvrir la modale | bouton **« Vérifier à nouveau »** + relecture de l'état à l'ouverture des Paramètres |
| État du moteur | global, un seul modèle | **par modèle** (`localVoiceStatusFor`) : un modèle présent ne fait jamais croire qu'un autre l'est |
| Repli | visible + journal | **inchangé** (moteur absent, modèle absent, synthèse en échec, audio refusé, délai, **téléchargement en échec**) : lecture avec la voix du système, état `local-fallback`, une ligne dans `voix-locale.log` |
| Réseau à la lecture | aucun | **aucun** (vérifié par test : le chemin de lecture ne peut pas atteindre `tts_local_download`) |

## 3. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src-tauri/src/tts_local.rs` | table `VOICES` (4 voix, genre/qualité/taille), `LocalVoice`, `voice_for`, chemins par modèle, statut étendu (`gender`, `quality`, `model_bytes`, `engine_present`, `model_present`), commandes `tts_local_status(model)` / `tts_local_synthesize(text, model)`, 3 tests |
| `src-tauri/src/tts_local_download.rs` | **nouveau** — téléchargement + arrêt + état, 6 tests |
| `src-tauri/src/lib.rs` | `mod tts_local_download;` + 3 commandes enregistrées |
| `src/js/local-voice.js` | catalogue `LOCAL_VOICE_MODELS`, `localVoiceModelLabel`, `localVoiceValueFor` / `localVoiceModelFor` / `localVoiceChoices`, statut **par modèle** (`localStatusByModel`, `localVoiceStatusFor`, `isLocalVoiceInstalledFor`), `model` transmis à la synthèse et à la lecture, état de téléchargement (`normalizeDownloadState`, `downloadProgressText`, `formatMegabytes`, `downloadLocalVoiceModel`, `cancelLocalVoiceDownload`, `refreshLocalVoiceDownloadState`) |
| `src/js/read-aloud.js` | liste des voix = toutes les voix locales ; `model` transmis à `playLocalChunks` ; `voiceChoiceStatus` compare le **modèle** de l'état ; statut du bouton par modèle |
| `src/js/settings.js` | rendu par modèle, ligne d'état du téléchargement, 3 boutons (télécharger / arrêter / vérifier à nouveau), abonnement à `tts-local-download-progress`, téléchargement **sur geste seulement** |
| `index.html` | dans la section « Lecture des réponses » : `#read-aloud-download-state`, `#btn-read-aloud-download`, `#btn-read-aloud-download-cancel`, `#btn-read-aloud-recheck` ; note locale mise à jour |
| `src/js/voix-locale-choix.test.js` | **nouveau** — 15 tests (catalogue, un seul réglage, compatibilité, état par modèle, téléchargement sur geste, arrêt, échec) |
| `spec_read_aloud.md` | catalogue (tableau), téléchargement/arrêt/revérification, état par modèle, couverture de tests |
| `help/overview.md` | bloc `HELP:lire-reponses` mis à jour (voix au choix, téléchargement sur geste, arrêt, vérifier à nouveau) → `npm run build:handbook` régénéré |
| `README.md` | section « Écouter une réponse » mise à jour |
| `AGENTS.md` | lignes `local-voice.js`, `tts_local.rs`, ajout `tts_local_download.rs`, couverture de tests |

Aucun fichier d'un autre chantier touché (`RAPPORT-diag-indicateur-travail.md`,
`RAPPORT-publication-0.4.43-BLOQUEE.md`, `RAPPORT-demarrage-assistant-bloque.md`
laissés tels quels). Aucune version modifiée, aucun tag, aucune publication.

## 4. Tests

### 4.1 Résultats réels (exécutés sur la machine)

```
npx vitest run
  → PASS (2700) FAIL (0)

cargo test --manifest-path src-tauri/Cargo.toml --lib
  → cargo test: 708 passed, 1 ignored (1 suite, 10.91s)

cargo test --manifest-path src-tauri/Cargo.toml --lib tts_local
  → cargo test: 14 passed, 695 filtered out (1 suite, 0.02s)
```

### 4.2 Ce que couvrent les nouveaux tests

| Exigence | Test |
|---|---|
| liste des voix + libellés (genre, qualité, taille) | `voix-locale-choix.test.js` § 1 |
| un seul réglage (`read_aloud_voice`), aucun second champ, une seule écriture | `voix-locale-choix.test.js` § 2 ; `voix-locale.test.js` (valeur définie une seule fois, 0 recopie ailleurs) |
| compatibilité `local:piper` (défaut) et modèle inconnu → défaut | `voix-locale-choix.test.js` § 3 |
| l'état d'un modèle ne vaut pas pour un autre | `voix-locale-choix.test.js` § 4 (JS) + `tts_local.rs` (`une_voix_masculine_a_ses_propres_fichiers_et_son_propre_etat`) |
| aucun réseau à la lecture | `voix-locale.test.js` § 2 (source sans `fetch`/`http`) + `voix-locale-choix.test.js` § 5 (une lecture ne peut pas atteindre `tts_local_download`) |
| téléchargement **seulement sur geste** | `voix-locale-choix.test.js` § 5 (compte d'appels dans `settings.js` ; `refreshReadAloudVoice` n'appelle jamais le téléchargement) |
| état visible (taille, %, terminé/arrêté/impossible) | `voix-locale-choix.test.js` § 5 (`downloadProgressText`) |
| repli visible + journal | `voix-locale.test.js` § 3 (état `local-fallback`, ligne `tts_local_log`) |
| **annulation** | `voix-locale-choix.test.js` § 5 (commande d'arrêt, état `cancelled`, aucune suppression) + `tts_local_download.rs` (`le_fichier_temporaire_ne_touche_pas_au_fichier_final`) |
| fichiers jamais supprimés / pas de retéléchargement | `tts_local_download.rs` (`un_fichier_present_n_est_jamais_retelescope_ni_reecrit`), et absence de `remove_file(` dans le module (vérifiée par test) |
| chemins et URLs exacts | `tts_local_download.rs` (`le_nom_du_modele_se_decoupe_et_les_urls_sont_exactes`, `chaque_voix_proposee_a_une_url_et_deux_fichiers`) |

### 4.3 Preuve par neutralisation volontaire (au moins un test)

Test choisi : `voix-locale-choix.test.js` →
« un état de moteur ne concerne qu'UN modèle / un modèle installé ne rend pas les
autres installés ».

1. **Neutralisation délibérée** : dans `src/js/read-aloud.js`, la ligne

   ```js
   const localInstalled =
     !!(local && local.installed) && (!statusModel || statusModel === localModel);
   ```

   est remplacée par `const localInstalled = !!(local && local.installed);`
   (on supprime la comparaison du nom de modèle).
2. **Résultat avec la neutralisation** :
   `FAIL (1) … expected 'ok' to be 'local-missing'` — le statut d'un modèle
   (voix de femme installée) était attribué à une **autre** voix : Pilot aurait
   annoncé « prête » une voix dont le modèle est absent (lecture muette au lieu
   du repli annoncé). Le test **échoue donc bien sans le correctif**.
3. **Restauration** de la comparaison → `PASS (15) FAIL (0)`.

## 5. Incertitudes / limites assumées

1. **Portée du moteur** : Piper officiel est distribué en `.exe` Windows. Le
   catalogue et la synthèse fonctionnent, mais sur macOS/Linux le statut reste
   « moteur absent » → **repli visible** sur la voix du système (jamais de
   blocage). Le téléchargement livré ici ne concerne que les **modèles**, pas le
   binaire du moteur (hors périmètre demandé).
2. **Téléchargement automatique** : interprété comme « lancé par le **geste**
   de choisir une voix dont le modèle manque » (ou par le bouton dédié), jamais
   au démarrage ni à l'ouverture des Paramètres — pour respecter la contrainte
   « aucun téléchargement sans geste ». Si l'intention était « dès la sélection
   enregistrée au démarrage », c'est un changement d'une ligne à arbitrer.
3. **Modèles multi-locuteurs écartés** (`upmc` 2 voix, `mls` 125 voix) : les
   proposer exigerait un second réglage (le locuteur), ce que la mission
   interdit (un seul réglage).
4. **Voix `mls` (125 locuteurs)** : non mesurable individuellement de façon
   fiable ; son `.onnx` est le plus gros (76,7 Mo) pour une qualité non
   supérieure — écartée.
5. **Tailles** : ce sont celles publiées par l'API Hugging Face au moment de la
   mission ; si le dépôt amont change, la vérification de taille à l'arrivée
   (`received != expected`) fait échouer proprement le téléchargement (message
   visible + journal), elle ne corrompt rien.
6. **`tom`** provient d'un dépôt tiers (`git.bksp.space/Tjiho/French-tts-model-piper`,
   AGPLv3) redistribué par `rhasspy/piper-voices` : la licence du modèle n'est pas
   CC comme les autres. Non bloquant pour un usage local, mais à connaître en cas
   de redistribution.
7. **Tests de téléchargement réseau réel** : non exécutés (aucun accès Internet
   requis par les tests, volontairement). Les tests couvrent la logique
   (URLs, tailles, `.part`, reprise, aucun retéléchargement) par fonctions pures
   et vérifications de fichiers, pas une session HTTP complète.
