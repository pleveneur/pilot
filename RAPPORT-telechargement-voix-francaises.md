# Rapport — Installation des voix françaises locales (« Installer la voix locale »)

> Micro-tâche : rendre la **voix française locale** réellement utilisable pour
> n'importe qui installe Pilot. Un **seul geste** doit installer le moteur ET
> deux voix françaises (une femme, un homme), avec une progression lisible, une
> reprise après interruption, et **jamais** de fichier tronqué déclaré installé.

---

## 1. État trouvé (avant modification)

Le moteur local était **câblé mais ininstallable** : rien ne téléchargeait
`piper.exe`.

| Point constaté | Où |
|---|---|
| Modules déclarés (`mod tts_local;`, `mod tts_local_download;`) | `src-tauri/src/lib.rs:86-87` |
| Les 6 commandes exposées (`tts_local_status`, `tts_local_synthesize`, `tts_local_log`, `tts_local_download`, `tts_local_cancel_download`, `tts_local_download_state`) | `src-tauri/src/lib.rs:3667-3672` |
| Vérification d'état (présence du moteur et du modèle) | `src-tauri/src/tts_local.rs:355` (`status_for_dir_with_engine`), `:417`, `:633` |
| Synthèse (hors périmètre : **non modifiée**) | `src-tauri/src/tts_local.rs:578`, commande `:658` |
| Téléchargement existant : **modèles seulement** | `src-tauri/src/tts_local_download.rs:224` (`missing_files`), `:332` (`fetch_one`) |
| Texte affiché quand le moteur manque : « déposez le dossier piper » (**aucun geste possible**) | `src-tauri/src/tts_local.rs:325-345` et `src/js/local-voice.js:142-152` |
| Bouton de la section : « **Télécharger le modèle** » (un modèle à la fois, moteur jamais fourni) | `index.html:1362`, `src/js/settings.js:804` |
| Défaut de modèle tronqué : l'état se contentait de `is_file()` → un `.onnx` incomplet pouvait être **déclaré installé** | `src-tauri/src/tts_local.rs` (ancien `status_for_dir_with_engine`) |

**Conséquence constatée** : sur une machine vierge, appuyer sur « Télécharger le
modèle » téléchargeait bien 60 Mo… et la voix locale restait **inutilisable**
(avertissement honnête « il manque le moteur », mais sans aucun moyen de
l'obtenir). Le propriétaire, lui, avait déjà le moteur à la main.

---

## 2. Ce que le geste installe, et dans quel ordre

**Un seul bouton** : `#btn-read-aloud-download` → **« Installer la voix locale »**
(`index.html:1362`, libellé unique `LOCAL_VOICE_INSTALL_LABEL`,
`src/js/local-voice.js:80`).

Côté Rust, `tts_local_download(model)` (`src-tauri/src/tts_local_download.rs:768`)
construit un plan (`plan_bundle`, `:265`) puis l'exécute (`download_bundle`, `:582`) :

| Ordre | Étape | Source | Taille attendue |
|---|---|---|---|
| 1 | **Moteur de lecture** (seulement s'il manque et si Pilot sait l'installer) | `ENGINE_ARCHIVE_URL` (`:50`) — `piper_windows_amd64.zip` officiel | archive **22 477 236 o** (`ENGINE_ARCHIVE_BYTES`, `:56`) → **38 846 222 o** décompressés (`ENGINE_UNPACKED_BYTES`, `:61`) |
| 2 | **Voix de femme** `fr_FR-siwis-medium` (qualité moyenne, voix par défaut) | `BUNDLE_MODELS[0]` (`:69`) + dépôt officiel des voix | `.onnx` **63 201 294 o** + `.onnx.json` 4 875 o |
| 3 | **Voix d'homme** `fr_FR-tom-medium` (qualité moyenne) | `BUNDLE_MODELS[1]` (`:69`) | `.onnx` **63 511 038 o** + `.onnx.json` 4 959 o |

**Total annoncé avant le geste** (calculé, jamais inventé) :
`localVoiceBundleBytes()` (`src/js/local-voice.js:107`) = **149 189 568 o**
(≈ **142,3 Mo**) moteur compris, **126 712 332 o** (≈ 120,8 Mo) si le moteur est
déjà là (fichiers de configuration `.onnx.json`, ~10 Ko, non comptés).
La taille est affichée dans l'infobulle du bouton (`src/js/settings.js:804`).

**Où ça atterrit** (rien n'est déplacé ni supprimé) :

- moteur décompressé dans `<app_data>/voix-locale/piper/` — `piper.exe` **vérifié
  après extraction** (`unpack_engine`, `:440`) ; archive conservée dans
  `<app_data>/voix-locale/telechargements/` (`DOWNLOADS_SUBDIR`, `:63`) ;
- modèles dans `<app_data>/voix-locale/voix/<modèle>.onnx` (+ `.onnx.json`) ;
- **moteur partagé** : s'il existe déjà pour une autre version de Pilot,
  `resolve_engine_root` (`src-tauri/src/tts_local.rs:271`) le réutilise et
  l'étape 1 **disparaît du plan** (aucune copie, aucun téléchargement).

**Seulement ce qui manque** : `missing_files` (`:224`) et `file_complete`
(`src-tauri/src/tts_local.rs:199`) filtrent les fichiers **présents et de taille
exacte**. Un fichier complet n'est **jamais** retéléchargé.

**Rien sans geste** : une seule porte d'entrée (`tts_local_download`, garde
atomique `DOWNLOADING`, `:768`), appelée uniquement par le clic du bouton ou le
choix d'une voix dont le modèle manque (`src/js/settings.js:992`). Rien au
démarrage, rien à l'ouverture des Options, rien à la lecture.

---

## 3. Progression affichée (étapes + taille + pourcentage)

L'état poussé (`tts-local-download-progress`, `PROGRESS_EVENT` `:73`) porte
désormais **l'étape** en plus du total : `step`, `step_label`, `step_index`,
`step_count`, `step_bytes`, `step_bytes_total`, `step_percent`
(`DownloadState`, `:91`). L'écran les lit dans `normalizeDownloadState`
(`src/js/local-voice.js:537`) et les rend dans `downloadProgressText`
(`:591`) :

- « Installation de la voix locale en cours — 47,4 Mo / 142,3 Mo (33 %) ·
  étape 2 sur 3 : la voix de femme 26,0 Mo / 60,3 Mo (41 %)… » ;
- le moteur a donc **sa propre progression** (avant, il n'en avait aucune).

---

## 4. Ce qui se passe si on interrompt

| Situation | Comportement |
|---|---|
| Clic sur **« × Arrêter l'installation »** (`tts_local_cancel_download`, `:807`) | l'installation s'arrête ; **aucun fichier n'est effacé** (ni `.part`, ni archive, ni modèle déjà reçu) ; l'état dit « arrêtée » et la lecture reste sur la voix du système |
| Fermeture de Pilot en plein téléchargement | idem : le `.part` reste sur le disque |
| Geste relancé plus tard | `fetch_one` (`:332`) envoie `Range: bytes=<déjà reçu>` et **complète** le fichier temporaire ; le fichier final n'est publié (renommage) qu'une fois la **taille exacte** atteinte |
| Modèle tronqué présent sur le disque | annoncé **« incomplet »** par l'état (`src-tauri/src/tts_local.rs:397`) et **réparé** par le geste — jamais déclaré installé, jamais supprimé |
| Moteur décompressé incomplètement | `piper.exe` absent après extraction ⇒ l'étape échoue avec un message clair, l'archive reste en place pour réessayer |

Garanties vérifiées par test (voir § 6) : **aucune** occurrence de
`remove_file`/`remove_dir` dans le code de production de
`tts_local_download.rs`.

---

## 5. Défaut corrigé : un modèle tronqué n'est plus « installé »

- `file_complete(path, expected)` (`src-tauri/src/tts_local.rs:199`) exige la
  **taille exacte** du catalogue ; `status_for_dir_with_engine` (`:397`)
  l'utilise pour le `.onnx` **et** pour son `.onnx.json`, et écrit
  **« (incomplet) » / « (incomplète) »** dans la phrase d'état au lieu de
  « installé ».
- La reprise (`fetch_one`) réutilise le fichier tronqué : il est **complété**,
  jamais effacé.
- Tests Rust ajoutés : `un_modele_tronque_n_est_jamais_declare_installe`.

---

## 6. Test de cohérence des deux catalogues (nouveau)

**`src/js/catalogue-voix-locales.test.js`** (14 assertions) lit les deux sources
et **échoue** si elles divergent :

- `VOICES` (Rust, `src-tauri/src/tts_local.rs:75`) **vs** `LOCAL_VOICE_MODELS`
  (JS, `src/js/local-voice.js`) : **mêmes identifiants**, **mêmes tailles**
  `.onnx`, **mêmes genres**, **mêmes qualités**, aucun doublon de chaque côté ;
- `BUNDLE_MODELS` (Rust, `:69`) **vs** `LOCAL_VOICE_BUNDLE_MODELS` (JS, `:71`) :
  exactement **les deux mêmes voix**, une femme + un homme, qualité moyenne ;
- `ENGINE_ARCHIVE_BYTES` (Rust) **vs** `LOCAL_VOICE_ENGINE_ARCHIVE_BYTES` (JS) :
  même valeur, et `localVoiceBundleBytes()` égale la somme du catalogue ;
- `DEFAULT_MODEL_NAME` (Rust) = `DEFAULT_LOCAL_VOICE_MODEL` (JS) ;
- URL exactes : archive du moteur (dépôt Piper) et base des modèles
  (`rhasspy/piper-voices`).

Il verrouille aussi les **garanties** de l'installation : aucune suppression,
reprise `Range` + `.part`, publication après vérification de taille,
`file_complete` utilisé, moteur Windows seulement, une seule porte d'entrée,
ordre du plan (moteur → femme → homme).

---

## 7. macOS et Linux

- `tts_local::engine_install_supported()` = `cfg!(windows)`
  (`src-tauri/src/tts_local.rs:188`).
- Plan d'installation : l'étape moteur n'est ajoutée **que** si le moteur
  manque **et** si Pilot sait l'installer (`:265`). Ailleurs : deux étapes
  (les voix), **aucune erreur, aucun échec, aucun téléchargement inutile**.
- La phrase d'état le dit en clair (`missing_hint`,
  `src-tauri/src/tts_local.rs:351`, et `localVoiceMissingHint`,
  `src/js/local-voice.js:194`) : Pilot ne fournit pas le moteur pour ce
  système, la lecture utilise la voix du système.
- Un moteur déposé **à la main** reste utilisable (le partage inter-versions
  est inchangé), donc Linux/macOS ne régressent pas : ils fonctionnent comme
  avant, mais sans le bouton trompeur.

---

## 8. Lecture hors ligne (vérification)

Le chemin de lecture **ne dépend pas** du module d'installation : `read-aloud.js`
→ `tts_local_synthesize` → `tts_local.rs` (`synthesize_base64_with_engine`,
:578) → processus local `piper.exe`. Aucune occurrence de
`tts_local_download` dans `tts_local.rs` (vérifié) ; aucun appel réseau dans le
chemin de synthèse ; l'archive et les modèles sont **déjà sur le disque** après
le geste. La lecture reste donc **hors ligne**, y compris sans réseau.

---

## 9. Documentation mise à jour

- `help/overview.md` (bloc `HELP:lire-reponses`) : le geste unique, ce qu'il
  installe, la progression par étape, la reprise, le fichier tronqué, macOS/Linux,
  et « après l'installation, aucun appel réseau ». `help/handbook.md` régénéré
  (`npm run build:handbook`).
- `README.md` : section « Écouter une réponse de l'assistant » réécrite.
- `spec_read_aloud.md` : § 2 (boutons et ligne d'état), § 2 bis (aperçu), § 4
  (installation complète, garanties, cohérence des catalogues).

---

## 10. Résultats des tests

| Commande | Résultat |
|---|---|
| `npx vitest run src/js/catalogue-voix-locales.test.js` | **14 réussis, 0 échec** |
| `npx vitest run` (voix : choix, locale, aperçu, chargement auto, réglage) | **98 réussis, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib tts_local` | **23 réussis, 0 échec**, 763 filtrés |
| `cargo check --lib` | OK |
| `npm test` (suite complète) | **193 fichiers, 3 379 tests réussis, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (suite complète) | **785 réussis, 0 échec**, 1 ignoré |

### 10 bis. Suites complètes (après les corrections d'alignement)

- **1 échec intermédiaire corrigé**, et non contourné : `src/js/source-slice.test.js`
  interdit tout découpage de source **non protégé** dans les tests ; le nouveau
  test utilisait `src.slice(0, src.indexOf("#[cfg(test)]"))`. Il utilise
  désormais `sliceSource(...)` (ancres exigées, fragment minimal) : aucun site
  non protégé ajouté, inventaire inchangé.
- Aucun autre test n'a été modifié en dehors des **deux assertions de libellé**
  (voir § 11.2).

---

## 11. Désaccords signalés (non corrigés d'office)

1. **Ordre des catalogues** : l'ordre de `VOICES` côté Rust (siwis-medium,
   siwis-low, tom-medium, gilles-low) diffère de l'ordre de
   `LOCAL_VOICE_MODELS` côté JS (siwis-medium, tom-medium, gilles-low,
   siwis-low). L'ordre JS est l'ordre **affiché** dans la liste des voix ;
   l'ordre Rust n'a aucun effet visible (seul `VOICES[0]` sert de repli). Le test
   de cohérence compare donc les catalogues **comme des ensembles** (contenu) et
   non comme des listes ordonnées. **Je ne réordonne pas** l'interface sans
   décision : cela changerait l'ordre des voix proposées.
2. **Libellé du bouton** : « Télécharger le modèle » devient **« Installer la
   voix locale »** (le geste installe plus qu'un modèle ; il installe aussi le
   moteur). Deux tests existants ont été alignés sur ce libellé
   (`voix-locale-choix.test.js`, `apercu-voix-parametres.test.js`). Si le
   propriétaire préfère un autre mot, c'est **une seule constante** à changer
   (`LOCAL_VOICE_INSTALL_LABEL`) plus ces deux assertions.
3. **Voix non installées par le geste** : `fr_FR-siwis-low` et
   `fr_FR-gilles-low` (qualité légère) restent proposées au choix, mais **ne sont
   pas** téléchargées par le geste (consigne : ni qualité légère, ni autre
   langue). Choisir l'une d'elles installe le paquet complet (moteur + les deux
   voix moyennes) : elle-même devra être installée par un geste séparé, comme
   avant. À trancher si l'on veut que le geste couvre aussi ces deux voix.
4. **`ENGINE_UNPACKED_BYTES`** reste une valeur documentaire (aucun calcul ne
   l'utilise) : marquée `#[allow(dead_code)]` plutôt que supprimée, pour que la
   taille décompressée annoncée dans la doc reste vérifiable à un seul endroit.

---

## 12. Fichiers touchés (tous dans le périmètre de la mission)

| Fichier | Nature |
|---|---|
| `src-tauri/src/tts_local_download.rs` | réécrit : plan multi-étapes (moteur + 2 voix), extraction du zip, reprise, progression par étape, aucune suppression |
| `src-tauri/src/tts_local.rs` | `engine_install_supported`, `file_complete`, `missing_hint` réécrit, état « incomplet », 2 tests ajoutés |
| `src-tauri/Cargo.toml` | dépendance `zip` 4 (`deflate`) |
| `src/js/local-voice.js` | catalogue du paquet, total calculé, état d'étape, phrase d'état, libellé unique |
| `src/js/settings.js` | bouton « Installer la voix locale », taille annoncée, commentaires |
| `src/js/read-aloud.js` | phrase d'aperçu alignée sur le geste |
| `index.html` | libellé et infobulles de la section « Lecture des réponses » |
| `src/js/catalogue-voix-locales.test.js` | **nouveau** test de cohérence JS ↔ Rust |
| `src/js/voix-locale-choix.test.js`, `src/js/apercu-voix-parametres.test.js` | assertions alignées sur le libellé du bouton |
| `help/overview.md`, `help/handbook.md` (généré), `README.md`, `spec_read_aloud.md` | documentation du geste réel |

**Non touché volontairement** : la synthèse (`tts_local.rs` chemin de lecture),
le nom et la valeur du réglage `read_aloud_voice`, la colonne de gauche, le
bandeau haut, les boutons du coin supérieur droit (autres missions en cours).
