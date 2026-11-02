# État du chantier « voix françaises locales » — audit en lecture seule

- **Date de l'audit** : 26 octobre 2026, HEAD `v0.5.0-53-g9163e80` (arbre de travail : `src-tauri/src/agents.rs` modifié avant l'audit, non touché ici).
- **Périmètre** : `src/js/local-voice.js`, `src/js/read-aloud.js`, `src/js/speech-text.js`, `src/js/settings.js`, `index.html`, `src-tauri/src/tts_local.rs`, `src-tauri/src/tts_local_download.rs`, `src-tauri/src/lib.rs`, les 5 tests de voix, `spec_read_aloud.md`, `help/overview.md`, `README.md`, et l'état réel du disque (`%APPDATA%`).
- **Ce que cet audit n'a pas fait** : aucun fichier de code modifié, aucun commit, aucune installation, aucun téléchargement de modèle, **aucun lancement de Piper**. Chaque affirmation ci-dessous est adossée à un `fichier:ligne` ou à une observation de disque reproduite en annexe. Là où la preuve manque, il est écrit **non vérifiable**.
- Les rapports déjà présents (`RAPPORT-diag-voix-locales-absentes.md`, `RAPPORT-apercu-voix-parametres.md`) ont été tenus pour non fiables : tout a été revérifié sur le disque.

---

## 1. Le moteur : y a-t-il du code qui sait faire parler une voix locale ?

**Oui, et il est branché jusqu'à l'écran.** La chaîne est continue, sans trou :

| Étage | Preuve |
|---|---|
| Module Rust déclaré | `src-tauri/src/lib.rs:86` (`mod tts_local;`), `:87` (`mod tts_local_download;`) |
| 6 commandes exposées à l'écran | `src-tauri/src/lib.rs:3667-3672` : `tts_local_status`, `tts_local_synthesize`, `tts_local_log`, `tts_local_download`, `tts_local_cancel_download`, `tts_local_download_state` |
| État du moteur + du modèle | `tts_local.rs:362-418` (`status_for_dir_with_engine`), commande `tts_local.rs:633` |
| Synthèse d'un morceau de texte | `tts_local.rs:585` (`synthesize_base64_with_engine`), commande `tts_local.rs:658` ; lancement du binaire `tts_local.rs:480` (`run_piper`) |
| Journal du repli | `tts_local.rs:446` (`append_log`), commande `tts_local.rs:677` |
| Appel depuis le navigateur | `src/js/local-voice.js:450` (`synthesizeSpeechAudio`) → `invoke("tts_local_synthesize", { text, model })` (`local-voice.js:455-456`) → WAV en `data:audio/wav;base64`,… (`local-voice.js:106`) |
| Lecture audio des morceaux | `src/js/local-voice.js:712` (`playLocalChunks`) : synthèse d'avance, arrêt immédiat, une suite de phrases |
| Choix de la voix locale dans la lecture | `src/js/read-aloud.js:690` (`if (isLocalVoiceChoice(choice))`) → `playLocalChunks` ; toute la prise de parole passe par ce point unique (vérifié par `apercu-voix-parametres.test.js:132`) |
| Le réglage arrive bien à la lecture | `src/js/main.js:649` et `:652` → `applyVoicePreferenceFromConfig` (`read-aloud.js:291`) |

Deux points de conception qui comptent pour la suite :

- **Le moteur est cherché aussi dans l'autre version de Pilot du même ordinateur**, en lecture seule, sans copie : `tts_local.rs:190` (`product_identifier`), `:213` (`engine_candidate_roots`), `:247` (`resolve_engine_root`), et l'information est dite à l'écran (`engine_shared`, `local-voice.js:377-386`).
- **Pilot n'embarque ni ne télécharge le moteur** : le dossier `piper` est à déposer à la main (`tts_local.rs:325-345`, texte « page officielle de Piper » **sans lien**).

**Non vérifiable par cet audit** : que ce binaire Piper produise réellement du son sur cette machine. L'exécution du moteur était exclue. Indice fort, décrit en annexe A.

---

## 2. Le catalogue : combien de voix, lesquelles, et sont-elles cohérentes ?

**4 voix françaises, mono-locuteur**, définies deux fois (Rust et JS), **identiques aujourd'hui** :

| Modèle | Genre | Qualité | Taille .onnx | Taille .onnx.json |
|---|---|---|---|---|
| `fr_FR-siwis-medium` (défaut) | femme | medium | 63 201 294 o | 4 875 o |
| `fr_FR-siwis-low` | femme | low | 28 130 791 o | 4 157 o |
| `fr_FR-tom-medium` | homme | medium | 63 511 038 o | 4 959 o |
| `fr_FR-gilles-low` | homme | low | 63 104 526 o | 4 158 o |

- Table Rust : `src-tauri/src/tts_local.rs:75-105` (constante `VOICES`), `:80-102` pour les deux tailles de chaque voix.
- Table JS : `src/js/local-voice.js:51-56` (`LOCAL_VOICE_MODELS`), voix par défaut `:59` (`DEFAULT_LOCAL_VOICE_MODEL`).
- **Cohérence vérifiée taille par taille avec les fichiers réellement présents sur le disque** : `%APPDATA%\com.pilot.editor\voix-locale\voix\` contient les 4 `.onnx` + les 4 `.onnx.json` aux tailles exactes du tableau (annexe A). Aucun écart.
- Le genre est écrit en clair à l'écran (`tts_local.rs:285` `gender_label`, réutilisé par `ready_hint` `:294`).
- Les 4 URL de modèles répondent **HTTP 200** (requête réelle du 26/10/2026, annexe B).

**Manque** : c'est un catalogue **dupliqué** (une table Rust, une table JS) et **aucun test ne compare les deux listes** — `voix-locale.test.js:272` vérifie seulement que `tts_local.rs` ne parle pas réseau, `voix-locale-choix.test.js:470` ne lit que ce même fichier. Une modification d'un seul côté casserait libellés/tailles/URL sans test rouge.

---

## 3. Le téléchargement du modèle : marche-t-il, et par quel geste ?

**Oui, un modèle à la fois, sur geste seulement, sans jamais rien supprimer.**

- Dépôt source unique : `tts_local_download.rs:39` (`VOICES_BASE_URL = https://huggingface.co/rhasspy/piper-voices/resolve/main`), URL construite `{base}/fr/fr_FR/{name}/{quality}/{file}` (`:120`), **deux** fichiers par voix (`.onnx` + `.onnx.json`) aux tailles exactes (`:132-141`).
- Écriture sûre : fichier temporaire `…​.part` (`:41`, `:148-150`), reprise `Range: bytes=<déjà>` (`:221`), `206` = reprise / `200` = tout (`:228`), plafond 200 Mo (`:45`, `:234`, `:268`), vérification de taille, puis **renommage** (`:284`). **Aucun `remove_file`** dans tout le fichier (assertion de test : `voix-locale-choix.test.js:388`).
- Un fichier déjà présent n'est jamais retéléchargé ni réécrit (`missing_files`, `:154-167`).
- Côté écran : bouton `#btn-read-aloud-download` (`index.html:1329`), annulation `#btn-read-aloud-download-cancel` (`index.html:1330`), revérification `#btn-read-aloud-recheck` (`index.html:1331`), état + progression `#read-aloud-download-state` (`index.html:1326`), libellés « taille + % » (`local-voice.js:516`). Branchements : `settings.js:2110` (télécharger), `:2114` (arrêter), `:2123` (revérifier), plus le **choix d'une voix dont le modèle manque** qui déclenche elle-même le téléchargement (`settings.js:2101-2107`).
- Aucun téléchargement sans geste : vérifié par test (`voix-locale-choix.test.js:311`).
- Le succès n'est annoncé comme succès que si la voix est **réellement utilisable** : `local-voice.js:560-606` (`downloadDoneMessage`) distingue « installé », « modèle seul téléchargé mais moteur manquant » (avertissement explicite) et « échec ».

**Limite constatée** : le bouton « Télécharger le modèle » est masqué au départ (`style="display:none"`, `index.html:1329`) et n'apparaît que pour une voix locale dont le modèle manque ; sur une installation neuve, l'utilisateur voit donc surtout le texte « il manque le moteur ».

---

## 4. La lecture : la voix locale est-elle réellement utilisée, et que se passe-t-il en cas d'échec ?

**Le chemin est correct et le repli est bien un repli, mais il n'est pas visible au moment où l'utilisateur écoute.**

- Si et seulement si le modèle **et** le moteur sont présents : `read-aloud.js:690` → `localVoiceStatusFor` / `refreshLocalVoiceStatus` → `playLocalChunks` (`local-voice.js:712`). Une vérification **précède** toute lecture (test : `apercu-voix-parametres.test.js:318`).
- Échec de synthèse (moteur absent, panne, WAV vide) : `synthesizeSpeechAudio` renvoie `null` **et journalise** (`local-voice.js:455-466`), `playLocalChunks` renvoie `unavailable` (`local-voice.js:741`), et `read-aloud.js:728` émet `notify("local-fallback")` : **la lecture continue avec la voix du système**, elle ne s'arrête pas.
- Le repli est **écrit dans le journal disque** `voix-locale.log` (chemin `tts_local.rs:111`, fonction `:446`), avec un plafond de 256 Ko (`:113`).
- Le texte explicite existe : `read-aloud.js:444-456` rend « Voix française locale indisponible : lecture avec la voix du système (détail dans le journal). »

**Le défaut visible (moyen)** : ce texte n'apparaît que dans la ligne `#read-aloud-state` des **Paramètres** (`index.html:1317`, alimentée par `settings.js:624`), or la fenêtre des Paramètres est fermée pendant qu'on lit une réponse dans le chat. Dans la conversation, `read-aloud.js:1081` transforme `local-fallback` en simple état « en cours de lecture » : **l'utilisateur entend une autre voix que celle qu'il a choisie sans aucune explication à l'écran** — seul le journal en garde trace. L'aperçu voix, lui, affiche bien le repli sur la rangée concernée (`settings.js:967-970`, test `apercu-voix-parametres.test.js:332`).

Autres points vérifiés : lecture hors ligne sans réseau à la lecture (`voix-locale.test.js:265-283` : pas de `reqwest`, pas d'URL dans `tts_local.rs`), texte nettoyé avant synthèse par `speech-text.js` seul (`apercu-voix-parametres.test.js:139`), une seule lecture à la fois (`:188`), arrêt immédiat au départ des Options (`:236`).

---

## 5. Le réglage : où vit-il réellement dans l'écran actuel ?

**Un seul champ, une seule section, dans le panneau `superagent` des Paramètres.**

- Section « Lecture des réponses à voix haute » : `index.html:1301-1333` ; sélecteur `#setting-read-aloud-voice` `:1305` ; aperçus par voix `#read-aloud-voice-previews` `:1314` ; état `#read-aloud-state` `:1317` ; note `#read-aloud-voice-note` `:1320` ; note voix locale `#read-aloud-local-note` `:1323` ; téléchargement `:1326-1331`.
- Emplacement : ce bloc est dans `data-settings-panel="superagent"` (ouvert `index.html:1149`), c'est-à-dire l'onglet que les tests appellent « Assistant » (`reglage-voix-onglet-assistant.test.js` : `PANEL = 'data-settings-panel="superagent"'`). **Ambiguïté de libellé à connaître** : `index.html` a aussi un onglet `agent` (« Agent Pi ») ; la voix n'y est pas.
- Une seule valeur de configuration : `read_aloud_voice` (`tts_local.rs` n'en ajoute aucune ; test `voix-locale.test.js:196-203` : exactement 2 occurrences dans `lib.rs`, déclaration + défaut, et aucune clé `read_aloud_*` parasite).
- Valeurs : `""` = automatique, `local:piper` = voix locale par défaut, `local:piper:<modèle>` = une autre voix — **un seul champ**, jamais un second réglage (`spec_read_aloud.md:177-183` ; la valeur littérale n'est écrite qu'une fois dans le code, `local-voice.js:93`, vérifié par `voix-locale.test.js:180-193`).
- La section se remplit **toute seule à l'ouverture**, une fois, sans boucle : `settings.js:717` (`ensureLocalVoiceChecked`, gardes `localVoiceAutoChecked` / `localVoiceCheckInFlight`), correctif du commit `bbce78f` ; couvert par `voix-locales-chargement-automatique.test.js` (14 tests : sans clic, chemin unique, une fois par ouverture, jamais de ligne vide, aucun téléchargement déclenché).
- La réutilisation du moteur de l'autre version est **dite**, pas silencieuse : `local-voice.js:377-386`.
- Documentation : `spec_read_aloud.md:51,54,177-183,191-259` ; `help/overview.md` bloc `HELP:lire-reponses` ; `README.md:110-129`.

---

## 6. Les tests : que tiennent-ils vraiment ?

**93 tests JS verts + 17 tests Rust verts, exécutés aujourd'hui sur ce HEAD.**

| Fichier | Tests | Ce qu'il tient |
|---|---|---|
| `src/js/voix-locale.test.js` | 17 | 5 exigences de départ : réglage unique, aucune valeur recopiée, repli obligatoire + visible + journalisé, hors ligne sans réseau, texte nettoyé |
| `src/js/voix-locale-choix.test.js` | 23 | liste des voix, boutons présents dans `index.html`, **aucun téléchargement sans geste** (`:311`), **aucun `remove_file`** (`:388`), moteur partagé réellement utilisé (`sharedEngineStatus`) |
| `src/js/voix-locales-chargement-automatique.test.js` | 14 | l'état se charge à l'ouverture des Options, une seule fois, jamais de ligne vide, aucun téléchargement déclenché |
| `src/js/apercu-voix-parametres.test.js` | 18 | l'aperçu passe par le **chemin réel** de lecture, un seul aperçu à la fois, un échec n'est jamais muet, modèle absent ⇒ on le dit et on ne lit pas une autre voix, documentation à jour |
| `src/js/reglage-voix-onglet-assistant.test.js` | 21 | le réglage est bien dans le panneau « Assistant », IDs attendus présents |
| `src-tauri/src/tts_local.rs` (tests) | 12 | table complète et sans doublon, chemins dérivés d'un seul dossier, moteur de l'autre version réutilisé, dossier voisin étranger jamais utilisé, synthèse sans moteur ⇒ repli journalisé, journal illisible sans erreur |
| `src-tauri/src/tts_local_download.rs` (tests) | 5 | une URL et deux fichiers par voix, nom de modèle découpé correctement, `.part` ne touche pas le fichier final, fichier présent jamais retéléchargé |

**Le test qui « mord » sur le branchement écran** (celui qui échouerait si le lien entre le réglage et la lecture disparaissait) :
- `apercu-voix-parametres.test.js:132` (« la prise de parole n'existe qu'à UN endroit »), `:150` (« l'aperçu passe par `createSpeaker()`, puis par `speak()` »), `:318` (« la vérification d'installation PRÉCÈDE toute lecture »), `:332` (« un repli du moteur local reste visible sur la rangée ») ;
- `voix-locale-choix.test.js` bloc « moteur déjà installé pour l'autre version de Pilot », qui prouve avec un faux `invoke` que **la voix choisie est réellement parlée sans repli**.

**Ce que les tests ne couvrent pas** : (a) aucune comparaison table JS ↔ table Rust ; (b) aucun test n'exécute Piper pour de vrai — le seul test de synthèse vérifie le **repli** (`tts_local.rs:881`) ; (c) aucun test ne vérifie que le repli est annoncé **dans le chat** (il ne l'est pas, §4).

Résultat des commandes jouées pendant l'audit :
- `npx vitest run src/js/voix-locale.test.js src/js/voix-locale-choix.test.js src/js/voix-locales-chargement-automatique.test.js src/js/apercu-voix-parametres.test.js src/js/reglage-voix-onglet-assistant.test.js` → **PASS (93) FAIL (0)**
- `cargo test --manifest-path src-tauri/Cargo.toml --lib tts_local` → **17 passed; 0 failed**

---

## 7. Ce qui manque, par gravité

### Gravité haute — bloque un utilisateur qui installe Pilot

1. **Le moteur Piper n'est ni fourni, ni téléchargé, ni indiqué par un lien.** Le téléchargement ne récupère que les **deux fichiers du modèle** (`tts_local_download.rs:132-141`) ; le moteur manquant donne un texte qui nomme le dossier `piper` et parle de « page officielle de Piper » **sans URL ni liste de fichiers** (`tts_local.rs:325-345`, repris par `local-voice.js:142-152`), et la doc utilisateur ne le dit pas davantage (`README.md:122-129`, `help/overview.md` bloc `HELP:lire-reponses` : aucun nom de binaire, aucun lien). Conséquence : sur une machine vierge, appuyer sur « Télécharger le modèle » ne rend **jamais** la voix locale utilisable — l'avertissement honnête « il est téléchargé, mais il manque le moteur » (`local-voice.js:587-593`) est le point d'arrivée normal.

### Gravité moyenne

2. **Le repli n'est pas annoncé là où l'utilisateur écoute.** `read-aloud.js:1081` réduit `local-fallback` à « lecture en cours » ; le texte explicatif (`read-aloud.js:452`) ne vit que dans la ligne d'état des Paramètres (`index.html:1317`), fermés pendant la lecture d'une réponse. L'utilisateur entend une voix qui n'est pas celle qu'il a choisie, sans explication visible (le journal disque, lui, est correct).
3. **Catalogue en double source, sans test de cohérence** : `tts_local.rs:75-105` et `local-voice.js:51-56` (identiques aujourd'hui, vérifié). Aucun test ne les compare.
4. **La doc utilisateur ne dit pas quoi déposer.** Ni le nom `piper.exe`, ni les DLL, ni `espeak-ng-data` n'apparaissent dans `README.md` ni dans l'aide ; seule l'application, en cas de manque, nomme le dossier — sans son contenu.

### Gravité faible

5. **Un modèle tronqué serait déclaré installé.** `missing_files` considère un fichier comme présent dès que sa taille est > 0 (`tts_local_download.rs:154-167`) et l'état ne teste que `is_file()` (`tts_local.rs:376-386`) : un `.onnx` partiel (téléchargement interrompu + renommage manuel) passerait pour installé, Piper échouerait, et l'interface n'offre aucun moyen de le réparer — rien n'étant jamais supprimé, par choix.
6. **Le journal ne trace que les échecs.** Une lecture locale réussie ne laisse aucune ligne (`tts_local.rs:585-620` : `append_log` seulement sur erreur) : impossible de prouver après coup qu'une voix locale a servi.
7. **Rapport obsolète encore présent dans l'arbre** : `RAPPORT-diag-voix-locales-absentes.md` décrit une absence de voix corrigée depuis par `bbce78f` (chargement automatique de l'état, `settings.js:717`) ; le relire aujourd'hui induit en erreur.
8. **Aucun test de bout en bout avec le moteur réel** (les tests Rust ne couvrent que le cas « moteur absent »).

---

## Conclusion — « aujourd'hui, un utilisateur peut-il faire parler Pilot avec une voix française locale ? »

**Réponse : oui, mais uniquement sur cette machine ; non pour un utilisateur qui installe Pilot.**

- **Sur ce poste, oui.** Le moteur est là (`%APPDATA%\com.pilot.editor\voix-locale\piper\piper.exe`, binaire Windows « MZ », + DLL + `espeak-ng-data` à 120 entrées), les 4 modèles sont là aux tailles exactes, le code est branché de bout en bout (§1), et le journal ne contient **aucun échec de synthèse depuis le 24/10/2026 22:34** alors que le dossier `tmp\` a été modifié **aujourd'hui à 13:27:43** — c'est-à-dire qu'une synthèse a été tentée moteur présent, sans erreur journalisée. La preuve directe (entendre le son) exigerait de lancer Piper, ce que cet audit s'interdit : sur ce point précis, **non vérifié**.
- **Pour un nouvel utilisateur, non — et c'est le seul empêchement réel.** Ce qui l'en empêche exactement : **Pilot n'amène jamais le moteur de lecture**. `tts_local_download.rs` ne sait télécharger que `fr_FR-<voix>.onnx` et son `.json` (`:132-141`) ; quand `piper.exe` est absent, l'état est `installed: false` (`tts_local.rs:362-394`), la lecture bascule sur la voix du système (`read-aloud.js:728`) et l'écran affiche « il manque le moteur de lecture (`piper.exe`), qui n'est jamais téléchargé automatiquement. Déposez le dossier « piper » (page officielle de Piper) » (`tts_local.rs:334-341`) — sans lien, sans liste de fichiers, et sans qu'aucune ligne du README ni de l'aide ne le documente. Le bouton « Télécharger le modèle » fonctionne, mais il ne peut pas combler ce manque.
- Second empêchement, moins grave mais bien réel pour un utilisateur déjà équipé du moteur : **il ne saura pas qu'il écoute une autre voix que la sienne**, puisque le repli n'est annoncé que dans les Paramètres fermés (`read-aloud.js:1081`, §4).

---

## Annexe A — état réel du disque au 26/10/2026 14:37

| Chemin | Contenu observé |
|---|---|
| `%APPDATA%\com.pilot.editor\voix-locale\piper\` | `piper.exe` (498 Ko, en-tête `4D 5A`), `espeak-ng.dll`, `onnxruntime.dll`, `piper_phonemize.dll`, `libtashkeel_model.ort`, `espeak-ng-data\` (120 entrées), `lang\`, `voices\` — **moteur présent** (dossier daté 24/10 22:30) |
| `…​\com.pilot.editor\voix-locale\voix\` | les 4 `.onnx` + les 4 `.onnx.json`, tailles exactes du tableau §2 (dossier daté 25/10 16:58) |
| `…​\com.pilot.editor\voix-locale\tmp\` | dossier présent, **modifié le 26/10 à 13:27:43** → au moins une synthèse lancée avec moteur + modèle présents (`tts_local.rs:600`) |
| `…​\com.pilot.editor\voix-locale\voix-locale.log` | 2 Ko, dernière ligne **24/10 22:34:58** : « Voix francaise locale non installee (… il manque le moteur Piper (piper.exe), le modèle fr_FR-siwis-medium.onnx, sa configuration … ) : repli sur la voix du systeme. » — antérieur à l'installation du moteur (22:30 est le dossier `piper`, mais les DLL/modèles n'étaient alors pas complets) et **aucun échec depuis**. Le plafond du journal est 256 Ko (`tts_local.rs:113`) : aucune rotation n'a effacé de ligne. |
| `%APPDATA%\com.pilot.editor.dev\voix-locale\` | `voix\` avec seulement `siwis-medium` + `tom-medium` (tailles exactes), `voix-locale.log` (1,4 Ko), **aucun `piper\`, aucun `tmp\`** → la version de développement **ne possède pas le moteur** dans son propre dossier de données ; elle doit donc le réutiliser depuis `com.pilot.editor` (`tts_local.rs:247`). Le journal du 24/10 23:38 y signale encore un repli, antérieur au correctif de partage (`bbce78f`). |

## Annexe B — vérifications réseau faites pendant l'audit (aucun téléchargement de fichier)

`GET` suivis de redirection sur les 4 URL construites par `tts_local_download.rs:120` → **HTTP 200** pour `fr_FR-siwis-medium.onnx`, `fr_FR-tom-medium.onnx`, `fr_FR-gilles-low.onnx`, `fr_FR-siwis-low.onnx`. Les tailles annoncées par la table ne peuvent pas être revérifiées côté serveur (le CDN ne renvoie pas d'en-tête exploitable en `HEAD`) ; elles sont en revanche **exactes sur les fichiers présents sur le disque**, que le code vérifie après téléchargement (`tts_local_download.rs:234-285`).
