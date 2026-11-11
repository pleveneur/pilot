# RAPPORT — Ajouter deux options vocales à Pilot (écouter, parler)

Date : 2026-11-17 (révision 2) · Projet : `G:\IA_PL\pilot`
Demande du propriétaire : *« Peut-on ajouter à Pilot deux options de plus — Parakeet
TDT 0.6B v3 pour écouter, Pocket TTS pour parler — sans toucher à ce qui existe, et à
quel prix ? »*

**Cadre corrigé (décision du propriétaire, définitive)** : on ne remplace **rien** et on
ne retire **rien**. VoiceStudio reste installé, configuré et utilisé ; la case
« Transcrire avec le service de voix local » reste, la lecture à voix haute reste, Piper
reste la voix par défaut. L'étude porte sur **deux options ajoutées**, choisies par un
réglage, comme on choisit déjà entre le navigateur et le service local.

Étude **en lecture seule** : aucun fichier de code, de test ou de configuration n'a été
modifié. Le seul fichier écrit est celui-ci. Rien n'a été installé, téléchargé, lancé, ni
réglé sur le poste. Aucun commit.

> La révision 1 de ce rapport était écrite avec l'angle « remplacer VoiceStudio ». Elle
> est remplacée par celle-ci, même chemin de fichier.

---

## 0. Conclusion, en une page

### Verdict

**L'ajout est réaliste. Il ne faut pas ajouter les deux d'un coup.**

Trois faits, vérifiés sur le disque, décident du dossier :

1. **Le choix par réglage existe déjà et fonctionne.** La dictée se choisit aujourd'hui
   avec **une seule case** (`local_dictation`, faux par défaut) : décochée, c'est le
   moteur du navigateur ; cochée, c'est le service local. La voix se choisit avec **un
   seul champ** (`read_aloud_voice`) dont les valeurs forment déjà trois familles :
   système, `local:piper:<modèle>`, `local:voicestudio:<profil>`. Ajouter une option,
   c'est **ajouter une valeur et une branche** dans ces deux points uniques. Ce n'est pas
   une architecture à inventer.
2. **L'oreille coûte plus cher que la bouche.** Le pont d'écoute est aujourd'hui un
   **client HTTP** : la machine ne décode rien elle-même. Passer au décodage dans Pilot
   fait entrer la **première dépendance native d'inférence** du projet (vérifié : zéro
   `onnx`, `sherpa`, `ort`, `candle`, `whisper` dans les quatre `Cargo.toml`), et il faut
   y ajouter une **détection de silence** que Pilot n'a pas (vérifié : aucun VAD dans le
   dépôt). La bouche, elle, peut réutiliser la lecture audio qui existe déjà
   (`playLocalChunks`) et le découpage en groupes de phrases qui existe déjà.
3. **La gêne est mesurée, et elle est côté écoute.** La seule mesure de dictée locale
   consignée dans le dépôt donne **premier texte partiel vers 0,9 s** et **texte final
   vers 9,5 s** pour **5,7 s de parole** (`spec_voice_input.md`, lignes 517-524) — et
   elle a été faite avec **`sherpa-whisper-tiny`**, Parakeet étant alors **refusé** par le
   service (licence non acceptée), pas parce qu'il manquait. Le texte final plus lent que
   la parole est exactement la douleur décrite par le propriétaire.

### Ce qu'il faut savoir avant de décider

- **Rien n'est à supprimer pour ajouter.** Les deux ajouts tiennent dans des valeurs
  nouvelles : un moteur de plus dans le choix de dictée, une famille de voix de plus dans
  le champ unique de la voix.
- **La case existante et le nouveau choix doivent cohabiter sans se contredire.** Le
  moyen le moins risqué est une **clé neuve** (`dictation_engine`, vide par défaut =
  comportement actuel) **à côté** de `local_dictation`, qui n'est ni renommée ni
  reinterpretée. Un fichier de configuration ancien, ou une version ancienne de Pilot,
  ne voient rien changer.
- **Le verrou de la case est explicite.** `src/js/oreille-locale-etape2.test.js`
  (lignes 124-149) exige **exactement une** `id="setting-local-dictation"` de
  `type="checkbox"`, **un seul** site d'écriture `local_dictation:` avec un texte exact,
  et **deux occurrences** de `local_dictation` dans `lib.rs`. Remplacer la case par une
  liste casse ces assertions : c'est un **test à faire évoluer**, pas une fonctionnalité
  perdue — mais il faut le compter.
- **Les modèles sont déjà sur le poste.** Aucun téléchargement n'est nécessaire pour
  essayer : 641 Mo d'export sherpa-onnx int8 de Parakeet, 209 Mo du modèle français de
  Pocket TTS, 681 Mo d'un GGUF q8_0 de Parakeet, et 5,4 Go du dépôt NVIDIA d'origine
  (trois copies du même poids).
- **La latence du décodage dans Pilot n'est pas établie.** Aucune mesure n'existe pour
  Parakeet exécuté dans Pilot sur ce processeur. C'est le seul chiffre qui manque, et
  c'est celui qui décidera si l'ajout tient sa promesse.

### L'option recommandée — une seule

**A. Ajouter l'écoute seule d'abord** (Parakeet TDT 0.6B v3, exécuté dans Pilot), avec
Pocket TTS laissé pour un second temps.

Pourquoi celle-là :

- elle traite **la douleur mesurée** (le texte final à 9,5 s) et **rien d'autre** ;
- elle **ne touche pas** la moitié qui marche déjà (Piper, quatre voix, hors ligne) ni la
  voix imitée du service ;
- elle se branche sur une **couture déjà taillée** : `createDictationSession(SR)`
  (`super-agent.js` ligne 5577) choisit le fournisseur, et tout le reste — garde du nom,
  envoi sur silence, reprise en main, envoi automatique — est écrit **une seule fois** ;
- elle laisse le temps de mesurer avant d'engager la seconde dépendance native.

**Condition de poursuite, à écrire dans la mission** : si le texte final du moteur intégré
n'est pas **plus rapide** que la mesure actuelle (9,5 s pour 5,7 s de parole), on
s'arrête là et l'option reste disponible sans être recommandée.

### Le prix, en points de contact (pas en jours)

| | A. Écoute seule | B. Les deux |
|---|---|---|
| Fichiers de production touchés ou créés | **8** (dont 2 neufs) | **15** (dont 5 neufs) |
| Fichiers de test à écrire ou faire évoluer | **3** | **9** |
| Documents à mettre à jour | **3** | **5** |
| Dépendance native d'inférence nouvelle | **1** | 1 (la même) ou 2 |
| Place disque ajoutée si Pilot possède ses poids | +641 Mo | +850 Mo |
| Place disque ajoutée si Pilot lit le cache existant | 0 | 0 |
| Mémoire vive en plus | non établi | +1,1 Go (mesuré par le propriétaire) |
| Carte graphique | 0 (estimé) | 0 (mesuré pour Pocket TTS) |
| Latence de dictée | non établi | sans objet |

Chaque ligne correspond à des fichiers réels, nommés au § 3.

---

## 1. État actuel — ce qui est vérifié sur le disque

### 1.1 Le choix de la dictée : une case, une clé, deux moteurs

| Élément | Valeur lue dans le code |
|---|---|
| Réglage | `local_dictation: bool`, `#[serde(default)]`, **faux** par défaut (`lib.rs` 792-801, défaut ligne 1347) |
| Case | une seule, `id="setting-local-dictation"`, onglet **Assistant** → section « Mode Vocal » (`index.html` 1522-1536) |
| Lecture du réglage | `localDictationRequested(config)` (`oreille-locale.js` 59) — seul `true` active |
| Décision | `planLocalEar({requested, status})` (`oreille-locale.js` 84) : `use`, `reason`, `modelId`, `modelLabel`, `sentence`, `fallback` |
| Choix du fournisseur | `createDictationSession(SR)` (`super-agent.js` 5577) : service local si `plan.use`, sinon le moteur du navigateur |
| Ligne d'état | `localEarStatusLine(...)` (`oreille-locale.js` 190), affichée dans la ligne **existante** de l'écran Vocal (`super-agent.js` 6718) |
| Repli | une phrase par raison (`service-absent`, `service-muet`, `aucun-modele-francais`, `dictee-non-prete`), disant **toujours** que le son repart vers un service en ligne |
| Commandes Tauri | 6 : `asr_voicestudio_status`, `_start`, `_send`, `_stop`, `_cancel`, `_log` (`asr_voicestudio.rs` 1042-1215) |
| Périmètre | **l'écran Vocal seulement** : c'est là que le micro de l'application est ouvert |

Deux points à ne pas confondre avec ce que Pilot fait :

- **Pilot ne choisit pas le modèle de dictée.** Il le **lit** dans la réponse du service
  (`model_label`) et le dit. Il n'y a **aucun** réglage de modèle, et **aucun** palier de
  performance dans Pilot (vérifié : aucune occurrence de « palier » ni de « performance »
  dans `settings.js` ni dans `index.html`). Ces réglages-là vivent dans VoiceStudio.
- **Une seule capture dans tout le projet.** `vocal-mic.js` est le seul endroit qui ouvre
  le micro, et `oreille-locale-etape2.test.js` refuse un second `getUserMedia`. L'oreille
  locale **consomme** le son déjà capté (robinet silencieux), elle n'ouvre rien.

### 1.2 La lecture à voix haute : un seul champ, trois familles de valeurs

| Élément | Valeur lue dans le code |
|---|---|
| Réglage | `read_aloud_voice` — un seul champ, une seule section (« Lecture des réponses ») |
| Familles | `""` (voix du système), `local:piper` et `local:piper:<modèle>`, `local:voicestudio:<profil>` |
| Décision unique | `resolveReadingVoice(options)` (`read-aloud.js` 513) → `voiceForCharacter(...)` (`character-voices.js` 150) |
| Liste proposée | `voiceChoiceOptions(voices, local, voicestudio, wanted)` (`read-aloud.js` 572) |
| État du choix | `voiceChoiceStatus(...)` (`read-aloud.js` 637) : `ok`, `local-unknown`, `local-missing`, `voicestudio-unknown`, `voicestudio-down`, `voicestudio-missing`, et `empty` / `missing` pour la voix du système |
| Branches de lecture | `speak` : moteur annoncé (1128), voix imitée (1178), voix locale Piper (1250) |
| Repli | `voicestudio-fallback` → Piper → système, dit à côté du bouton « 🔊 Écouter » et journalisé |
| Poids du code | 54 mentions de `voicestudio` dans `read-aloud.js`, 24 dans `settings.js`, 72 dans `voicestudio-voice.js` |

C'est **exactement le modèle d'architecture demandé** : une valeur de plus dans un champ
unique, une branche de plus derrière un point unique, une liste qui ne propose jamais une
voix inventée, et un repli qui se dit.

### 1.3 La mesure de dictée qui existe déjà

`spec_voice_input.md` (lignes 500-530) consigne une mesure réelle sur ce poste :

- modèle **réellement** employé : `sherpa-whisper-tiny` — **`sherpa-parakeet-tdt-v3`
  refusé par le service** (licence non acceptée) ;
- session ouverte en ~30 ms, **premier partiel à ~0,9 s**, partiels ensuite toutes les ~1 s ;
- **texte final à ~9,5 s**, pour ~5,7 s de son ;
- service arrêté : constat en ~2 s, phrase en français, aucune exception.

**Ce que cette mesure ne dit pas** : si Parakeet était accepté, le texte final arriverait
sans doute plus tôt (le modèle est plus rapide que whisper-tiny sur du français), mais
**aucune mesure ne le prouve ici**. Et l'état actuel de l'acceptation de licence n'est pas
établi : rien n'a été interrogé.

### 1.4 Ce que porte déjà la voix dans le projet

- **20 modules de production** importent un module de voix (`read-aloud.js`,
  `local-voice.js`, `voicestudio-voice.js`, `oreille-locale*.js`, `vocal-mic.js`,
  `vocal-nom-garde.js`, `voice-auto-send.js`, `speech-text.js`…).
- **56 fichiers de test** sur 305 touchent la voix.
- Frères Rust : `asr_voicestudio.rs` 1 917 lignes, `tts_local.rs` 1 038,
  `tts_voicestudio.rs` 564, `tts_local_download.rs` 1 123.

Ce poids n'est pas un défaut : c'est la mesure de ce qu'une chaîne vocale demande déjà, et
c'est ce qui rend crédible le chiffrage du § 3.

---

## 2. Ce que les deux ajouts demandent, concrètement

### 2.1 Ajout n° 1 — écouter avec Parakeet, dans Pilot

| Question | Réponse |
|---|---|
| Où le son entre | le robinet existant de `vocal-mic.js` (aucune seconde capture) |
| Où le texte sort | même contrat qu'aujourd'hui : objet de la **forme** d'une session `SpeechRecognition` (`start/stop/onresult/onerror/onend`) |
| Ce qu'il faut écrire côté machine | un module **frère** de `asr_voicestudio.rs` : session, morceaux de 100 ms (3 200 octets, valeur existante), décodage, évènements, journal |
| Ce qui n'existe pas et qu'il faut créer | **la détection de silence** : Parakeet n'a **pas** de mode flux (`NeMo-Speech.cpp` : « inference is full-utterance only ; streaming requests are rejected »). Il faut découper la parole en morceaux et décider quand un morceau est fini |
| Ce qui existe pour s'en inspirer | NVIDIA publie un script de découpage par fenêtres glissantes (`speech_to_text_streaming_infer_rnnt.py`) ; des tiers emploient un accord local à deux transcriptions (`LocalAgreement-2`). **Aucun de ces codes n'est dans le dépôt** |
| Dépendance | la **première** dépendance native d'inférence du projet (sherpa-onnx, `parakeet-rs`, ou binaire `nemo-speech` en side-car — **à trancher, non tranché ici**) |
| Licence du modèle | **CC-BY-4.0** (vérifié sur la fiche du modèle) |
| Français | dans les **25 langues** déclarées, détection automatique, ponctuation et majuscules, horodatage au mot |

### 2.2 Ajout n° 2 — parler avec Pocket TTS

| Question | Réponse |
|---|---|
| Où le texte entre | `resolveReadingVoice` puis `speak`, comme la voix imitée aujourd'hui |
| Où le son sort | `playLocalChunks` **existant** (aucune seconde boucle de lecture) |
| Découpage | `groupSentencesForVoiceStudio` **existant** : 1 phrase d'abord, puis 4 phrases / 700 caractères, jamais une phrase coupée |
| Nouvelle valeur | `local:pocket:<id>` dans le **même** champ `read_aloud_voice` |
| Ce qu'il faut écrire côté machine | un module frère de `tts_voicestudio.rs` : synthèse, WAV en mémoire (base64), aucun fichier audio |
| Ce qu'il faut écrire côté fenêtre | un frère de `voicestudio-voice.js` (623 lignes) : valeurs, libellés, état, dialogue avec la machine |
| Dépendance | Python/PyTorch, binaire autonome, portage Rust, ou lecture par sherpa-onnx — **non tranché ici** |
| Licence | code **MIT**, poids **CC-BY-4.0**, et **chaque voix a sa propre licence** |

### 2.3 Où se placerait le nouveau choix, et comment il cohabiterait

**Pour écouter**, deux variantes possibles. Les deux gardent la case existante en place.

| Variante | Effet | Coût vérifié |
|---|---|---|
| **V1 — clé neuve à côté** (recommandée) | `dictation_engine: String`, `#[serde(default)]`, **vide = comportement actuel**. Valeurs : `""` (historique), `"browser"`, `"voicestudio"`, `"pilot"`. `local_dictation` garde **exactement** son sens et reste écrite | les 3 assertions du verrou `oreille-locale-etape2.test.js` restent vraies ; 0 migration ; une version ancienne de Pilot ignore la clé |
| V2 — la case devient une liste | `local_dictation` remplacé par un choix à trois | 3 assertions à réécrire (lignes 124-149) + 1 ligne d'`index.html` + 1 site d'écriture `settings.js` : 3542 ; risque de configuration à convertir |

La cohabitation à l'écran est simple dans les deux cas : la case garde son sens (« service
de voix local »), et un **choix** au-dessus dit lequel des moteurs sert. Une seule règle
à tenir : **les deux ne doivent jamais se contredire à l'enregistrement** (V1 impose que
cocher la case écrive aussi `dictation_engine = "voicestudio"`, ou que la ligne d'état
dise laquelle gagne — c'est la décision de conception à trancher, **pas tranchée ici**).

**Pour parler**, l'ajout est une **valeur de plus** dans la liste qui existe déjà. Rien à
déplacer : la section « Lecture des réponses » affiche déjà `automatique`, les quatre voix
Piper, les voix du service, et les voix du système.

---

## 3. Le coût réel

### 3.1 Points à toucher — écoute (option A)

| # | Fichier | Nature |
|---|---|---|
| 1 | `src-tauri/Cargo.toml` | 1 dépendance native d'inférence (3 systèmes) |
| 2 | `src-tauri/src/asr_local.rs` **(neuf)** | session, morceaux de 100 ms, découpage sur silence, évènements, journal |
| 3 | `src-tauri/src/asr_local_models.rs` **(neuf)** | poids sur **geste** seulement, reprise, `.part`, annulation (modèle : `tts_local_download.rs`) |
| 4 | `src-tauri/src/lib.rs` | `mod`, état géré (ligne 3810), commandes dans `invoke_handler` (3841-3846) |
| 5 | `src/js/oreille-locale.js` | `planLocalEar` passe de 2 à 3 moteurs (84) ; `localDictationRequested` (59) **inchangé** |
| 6 | `src/js/settings.js` | 1 site de lecture (2409), 1 site d'écriture (3542), l'état (998-1003) |
| 7 | `index.html` | la ligne 1522-1536, la note et la ligne d'état |
| 8 | `src/js/super-agent.js` | `createDictationSession` (5577), `refreshLocalDictation` (7500-7521), ligne d'état (6718), infobulle du micro (5396) |

**Ce qui ne bouge pas** : `vocal-mic.js`, `voice-auto-send.js`, `vocal-nom-garde.js`,
`vocal-conversation.js`, la garde du nom, l'envoi automatique, et **toute la lecture à voix
haute**. C'est là que se trouve l'économie.

### 3.2 Points à toucher — parole (option B, en plus)

| # | Fichier | Nature |
|---|---|---|
| 1 | `src-tauri/src/tts_pocket.rs` **(neuf, en plus du `Cargo.toml` de la ligne 1 du § 3.1)** | synthèse, WAV en mémoire, journal |
| 2 | `src-tauri/src/tts_pocket_download.rs` **(neuf)** | poids et voix, sur geste |
| 3 | `src-tauri/src/lib.rs` | les commandes, à côté de la voix locale (3834-3836) et de la voix imitée (3837-3840) |
| 4 | `src/js/pocket-voice.js` **(neuf)** | frère de `voicestudio-voice.js` : valeurs, libellés, état |
| 5 | `src/js/read-aloud.js` | moteur annoncé (1128), branche de lecture (1178 / 1250), liste (572), état (637), repli (1236, 1732) |
| 6 | `src/js/settings.js` | section « Lecture des réponses » : rendu (1040, 1171), enregistrement (3521) |
| 7 | `index.html` | l'entrée de liste + la copie d'explication comparée au caractère près |
| 8 | `src/js/character-voices.js` | la grammaire des voix de personnage (31-32) doit accepter la famille |
| 9 | `src/js/vocal-enveloppe-aigu.js` | **facultatif** : brancher le son sur l'enveloppe (41, 295). Sans cela, le rythme du texte prend le relais, sans casser |
| 10 | `src/js/main.js` | **facultatif** : préchauffage au démarrage (1501) |

### 3.3 Tests et documents

| | Écoute | Parole |
|---|---|---|
| Tests | 3 : `oreille-locale-etape2.test.js` (le verrou de la case, à faire évoluer en V2 seulement) + 2 neufs (décision à 3 moteurs, repli visible) | 6 : `read-aloud.test.js`, `reglage-voix-onglet-assistant.test.js`, `apercu-voix-parametres.test.js`, `voix-imitee-voicestudio.test.js` (modèle), `voix-par-personnage.test.js`, `prechauffage-voix-imitee-demarrage.test.js` |
| Documents | `spec_voice_input.md` (§ 9 + bloc `HELP:dictee-vocale`), `AGENTS.md`, registre des comportements validés | `spec_read_aloud.md` (§ 4 quater analogue + `HELP`), registre, `AGENTS.md` (déjà compté) |

### 3.4 Disque, mémoire, latence

| | Mesuré (sur le disque ou par le propriétaire) | Estimé | Non établi |
|---|---|---|---|
| Disque — export Parakeet int8 | **641 Mo** présents (`csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`) | — | une copie possédée par Pilot |
| Disque — dépôt NVIDIA | **5,4 Go** présents (fp32 2 392 Mo + `.nemo` 2 393 Mo + GGUF q8_0 681 Mo) | — | lequel Pilot embarquerait |
| Disque — Pocket TTS français | **209 Mo** présents (`model.safetensors`) | — | + voix exportées |
| Disque — Pocket TTS sans clonage | **254 Mo** présents | — | — |
| Total ajouté si Pilot a ses propres poids | — | ≈ 850 Mo | — |
| Mémoire — Pocket TTS | **≈ 1,1 Go** (mesure du propriétaire) | — | pics pendant la synthèse |
| Mémoire — Parakeet dans Pilot | — | — | **mémoire réelle inconnue** |
| Mémoire — VoiceStudio en parallèle | — | — | **non établi** (aucune mesure dans le dépôt) |
| Carte graphique | **0** (Pocket TTS, mesuré) | 0 pour Parakeet (sherpa-onnx tourne sur processeur) | un gain sur processeur faible |
| Latence — dictée | **1er partiel ~0,9 s ; final ~9,5 s pour 5,7 s de son** (via VoiceStudio + whisper-tiny) | — | **le décodage Parakeet dans Pilot** |
| Latence — parole | premier son **0,11-0,17 s**, RTF **0,34-0,36** (propriétaire) | — | la jointure entre morceaux |

**Sur la latence de dictée, la seule réponse honnête** : le délai ressenti = **seuil de
silence** (à régler, souvent 300-500 ms) + **temps de décodage**. Le premier terme est un
réglage ; le second **n'a pas été mesuré dans Pilot**. Ce qui est mesuré, c'est que la
machine tient Pocket TTS à 3× le temps réel en processeur : elle a de la marge.

---

## 4. Risques de l'ajout

### 4.1 Risque de casser un chemin existant

| Risque | Évaluation |
|---|---|
| Le choix à trois moteurs casse la dictée actuelle | **faible en V1** : la clé neuve vide vaut le comportement d'aujourd'hui, et `planLocalEar` garde sa branche « désactivée » à l'identique |
| La case et le nouveau choix se contredisent | **moyen, et réel** : deux réglages pour une décision. Il faut **une** règle d'écriture, écrite dans la spec et verrouillée par un test |
| Le verrou de la case échoue | **certain en V2** (3 assertions, lignes 124-149), **nul en V1** |
| Deuxième capture du micro ouverte par mégarde | **faible** : le verrou « un seul `getUserMedia` dans tout le projet » existe déjà, et il refuse la seconde |
| Le repli devient silencieux | **moyen** : la règle actuelle est « une phrase par raison, qui dit qu'on repart vers un service en ligne ». Un troisième moteur ajoute des raisons, donc des phrases à écrire et à tester |
| La lecture casse une voix existante | **faible** : la voix est un **champ unique** et un point unique de décision. Une valeur inconnue retombe sur la voix générale (règle déjà testée dans `character-voices.js`) |
| La chaîne de publication casse | **le risque le plus sérieux, et il est de construction** : première dépendance native d'inférence dans une chaîne qui construit Windows + deux macOS + Linux, avec un plafond de 90 min sur Linux |

### 4.2 Risque de confusion entre trois choix

Il est **réel, et il est déjà présent** : la liste des voix propose aujourd'hui
`automatique`, quatre voix Piper, les voix du service et celles du système. L'ajout d'une
famille de plus ne crée pas le problème, il l'aggrave d'un cran.

Ce qui limite la confusion, et qui existe déjà :

- **le libellé nomme le moteur** (« Ma voix imitée — <nom> (VoiceStudio) ») ;
- **la ligne d'état dit laquelle des deux oreilles écoute** (« J'écoute avec le service
  local. » / « Le service local est absent : je dicte autrement. ») ;
- **une voix mémorisée ne disparaît jamais de la liste**, avec sa raison en clair.

Ce qu'il faudra ajouter : **le nom du moteur dans le libellé de chaque oreille**, et une
phrase qui dit ce qui se passe quand **deux** moteurs locaux sont disponibles.

### 4.3 Mémoire cumulée si VoiceStudio tourne en même temps

- Pocket TTS : **+1,1 Go** (mesuré).
- Parakeet dans Pilot : **non établi**.
- VoiceStudio (service + modèle qu'il charge) : **non établi** — aucune mesure dans le
  dépôt.
- Piper, si la voix locale est aussi chargée : poids de 28 à 64 Mo par modèle, plus le
  moteur ; consommation réelle **non établie**.

Conclusion partielle honnête : **le cumul n'est pas chiffrable avec ce qui est sur le
disque**. Le poste a de la marge côté carte graphique (Pocket TTS n'en prend aucune), mais
la mémoire vive n'a été mesurée que pour Pocket TTS.

### 4.4 Deux limites de périmètre à écrire noir sur blanc

1. **L'oreille ajoutée resterait dans l'écran Vocal**, comme aujourd'hui : c'est le seul
   endroit où le micro de l'application est ouvert. L'étendre à l'éditeur ou à l'onglet
   agent demanderait une **seconde voie de capture**, ce que le projet interdit
   actuellement par un test.
2. **Un moteur hors flux ne rend pas de texte au fil de la parole.** Parakeet est
   « full-utterance only ». Le texte apparaîtrait **par morceau**, à chaque silence
   détecté. C'est un recul visible par rapport aux partiels continus du service — et
   c'est le seul vrai recul technique de l'option A.

---

## 5. Vérification indépendante

### 5.1 Le français de Parakeet couvre-t-il la dictée ?

**Couvert pour la langue. Suffisant pour la dictée : à nuancer.**

- **Licence et langues** (fiche du modèle, vérifiée) : `cc-by-4.0`, 25 langues européennes
  dont `fr`, détection automatique de la langue sans consigne, ponctuation et majuscules,
  horodatage au mot.
- **Flux** (documentation NVIDIA `NeMo-Speech.cpp`, vérifiée) : « the model does not
  support cache-aware streaming ; inference is full-utterance only ». Le découpage doit
  donc être fait **par l'appelant**.
- **Découpage possible** (vérifié) : NVIDIA publie un script de fenêtres glissantes ; des
  tiers emploient un accord local à deux transcriptions successives pour ne pas afficher
  la fin instable. **Ces codes ne sont pas dans le dépôt** : ce serait du travail neuf.
- **Qualité en français** : un classement tiers place le modèle **19ᵉ sur 39** en
  transcription française. Les taux d'erreur détaillés de l'étude précédente (FLEURS,
  MLS, Common Voice) **n'ont pas été revérifiés ici** : **non établis** dans ce rapport.
- **Le point dur** : ces corpus sont de la **lecture fluide**. Une dictée d'agent mêlant
  noms de fichiers, identifiants et mots anglais n'est pas ce que ces chiffres mesurent.
  **Non établi.**
- **Le point favorable, et il est fort** : c'est **ce moteur-là** que VoiceStudio utilise
  (ou utilise quand sa licence est acceptée) sur cette machine, en export sherpa-onnx
  int8 de 641 Mo **déjà présent**. Le propriétaire connaît donc déjà son comportement réel.

### 5.2 Pocket TTS tient-il sur du texte long ?

**Oui, et Pilot est déjà protégé.**

- Le dépôt de Kyutai annonce **« can handle infinitely long text inputs »**, un **son en
  flux**, un **premier morceau vers 200 ms**, environ **6× le temps réel sur un
  processeur de portable** (M4), **2 cœurs**, exécution **sans carte graphique**,
  **clonage de voix**, et le **français** parmi les langues. Code **MIT**.
- **Sur cette machine**, le propriétaire a mesuré **RTF 0,34-0,36**, premier son
  **0,11-0,17 s**, **≈ 1,1 Go** de mémoire, **0** de carte graphique, et un clonage
  réussi.
- **Pilot ne lui donnerait de toute façon jamais un texte long** :
  `groupSentencesForVoiceStudio` découpe déjà en un premier morceau d'**une** phrase, puis
  des groupes d'au plus **4 phrases / 700 caractères**, sans jamais couper une phrase.
- Le seul point faible réel est la **jointure** entre deux morceaux : chaque morceau est
  synthétisé indépendamment, donc l'intonation peut repartir de zéro à chaque frontière.
  La qualité de l'enchaînement **n'est pas établie**.

### 5.3 Une vérification à ne pas oublier, et qui ne coûte aucun code

Au moment de la mesure consignée, le service employait **`sherpa-whisper-tiny`**, et
**Parakeet était refusé faute de licence acceptée**. Si c'est encore le cas, alors une
partie de la lenteur mesurée (9,5 s) vient **du modèle employé**, pas du pont.
**Accepter la licence de Parakeet dans VoiceStudio** est un geste de l'utilisateur, sans
ligne de code, et il dirait tout de suite si la douleur est le **modèle** ou
l'**intégration**. L'état actuel de cette acceptation **n'est pas établi** : rien n'a été
interrogé ici.

---

## 6. Trois options, une recommandation

### A. Ajouter l'écoute seule d'abord — **recommandée**

- **Effort** : **8** fichiers de production (dont 2 neufs), **3** fichiers de test,
  **3** documents, **une** dépendance native, **une** détection de silence à écrire.
- **Risque** : **moyen**, et borné. Concentré sur la construction multi-systèmes et sur le
  réglage du seuil de silence. L'écran vocal n'est pas réécrit. La case existante reste.
- **Bénéfice** : la dictée française tourne **dans** Pilot, hors ligne, sans logiciel tiers
  à lancer, avec le **même** envoi automatique et la **même** garde du nom. Rien n'est
  retiré : le service local reste une option, et la voix ne change pas d'un iota.
- **Recul assumé** : le texte arrive **par morceau**, plus au fil de la parole.
- **Condition de poursuite** : si le texte final n'est pas plus rapide que la mesure
  actuelle (9,5 s pour 5,7 s de parole), on s'arrête.

### B. Ajouter les deux d'un coup

- **Effort** : **15** fichiers de production (dont 5 neufs, 2 facultatifs), **9** fichiers de test,
  **5** documents, jusqu'à **2** voies d'inférence, **2** modules de téléchargement.
- **Risque** : **élevé**. Deux moteurs natifs d'un coup, sur trois systèmes, dans une
  chaîne de publication fragile, **plus** deux réglages à faire cohabiter au lieu d'un.
- **Bénéfice** : une voix de plus, très légère en mémoire, clonable, sans service tiers —
  alors que la voix marche **déjà** avec Piper et avec le service.
- **Quand** : seulement si la voix devient la priorité, et **après** que l'oreille a
  prouvé sa latence sur cette machine.

### C. N'ajouter rien pour l'instant

- **Effort** : nul.
- **Risque** : nul techniquement ; **réel** pour l'utilisateur, qui garde un texte final
  plus lent que sa parole et dépend d'un logiciel séparé à lancer.
- **Bénéfice** : le texte au fil de la parole est conservé, et rien ne bouge dans une
  chaîne de publication déjà chargée.
- **Ce qu'elle coûte** : la douleur mesurée reste entière, et la vérification du § 5.3
  (licence Parakeet acceptée) devient le seul levier gratuit.

**Recommandation : A.** Elle traite le point mesuré, ajoute une option sans en retirer
aucune, réutilise la couture déjà taillée, et garde B ouverte pour plus tard.

---

## 7. Ce qui n'est **pas** établi

- Le **temps de décodage** de Parakeet exécuté dans Pilot, sur ce processeur, par morceau.
- La **mémoire vive** réellement consommée par Parakeet, et celle de VoiceStudio en
  parallèle.
- Le comportement de Parakeet sur une **dictée courte mêlée d'anglais** et de noms de
  fichiers.
- L'**état actuel** de l'acceptation de la licence Parakeet dans VoiceStudio (donc : quel
  modèle sert vraiment aujourd'hui).
- La qualité d'**enchaînement** des morceaux Pocket TTS, et sa prosodie sur un long texte.
- La **licence exacte de chaque voix** Pocket TTS, et l'effet des conditions d'accès du
  dépôt sur une application qui téléchargerait les poids pour l'utilisateur.
- Le **coût de construction** réel (temps de compilation, taille du binaire, signature et
  notification macOS, plafond Linux) d'une dépendance native d'inférence.
- La **règle d'écriture** entre la case existante et le nouveau choix (V1) : conception
  **non tranchée** ici.
- Les taux d'erreur détaillés de Parakeet en français : **non revérifiés** dans ce rapport.

---

## 8. Comment cela a été vérifié (lecture seule)

- **Lu** : `src/js/oreille-locale.js`, `oreille-locale-moteur.js`, `read-aloud.js`,
  `local-voice.js`, `voicestudio-voice.js`, `character-voices.js`, `settings.js`,
  `super-agent.js`, `main.js`, `vocal-enveloppe-aigu.js`, `index.html`,
  `src-tauri/src/lib.rs`, `asr_voicestudio.rs`, `tts_local.rs`, `tts_voicestudio.rs`,
  `spec_voice_input.md`, `oreille-locale-etape2.test.js`.
- **Compté sur le disque du dépôt** : 20 modules de production touchant la voix,
  56 fichiers de test sur 305, 6 commandes Tauri d'écoute, 1 seule case et 1 seule clé de
  dictée, 3 familles de valeurs pour la voix, 0 dépendance d'inférence dans les quatre
  `Cargo.toml`, 0 détection de silence dans le dépôt.
- **Regardé sur le disque, sans rien ouvrir ni lancer** :
  `~/.cache/huggingface/hub/models--csukuangfj--sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`
  → **641 Mo** ; `models--nvidia--parakeet-tdt-0.6b-v3` → **5,4 Go**
  (`model.safetensors` 2 392 Mo, `.nemo` 2 393 Mo, GGUF q8_0 681 Mo) ;
  `models--kyutai--pocket-tts` → **209 Mo** (dont `french/model.safetensors` 208,9 Mo) ;
  `models--kyutai--pocket-tts-without-voice-cloning` → **254 Mo**. Aucun fichier touché.
- **Vérifié en ligne** : fiche `nvidia/parakeet-tdt-0.6b-v3` (licence CC-BY-4.0, 25 langues
  dont `fr`, détection automatique, ponctuation, horodatage) ; documentation
  `NVIDIA/NeMo-Speech.cpp` (pas de streaming natif, « full-utterance only ») ; scripts de
  découpage (fenêtres glissantes, accord local à deux transcriptions) ; dépôt
  `kyutai-labs/pocket-tts` (MIT, « infinitely long text », flux, ~200 ms au premier
  morceau, ~6× le temps réel sur processeur, 2 cœurs, clonage, français) ; classement
  tiers (19ᵉ sur 39 en français).
- **Repris du propriétaire, et signalé comme tel** : RTF 0,34-0,36 ; premier son
  0,11-0,17 s ; ≈ 1,1 Go ; 0 de carte graphique ; clonage réussi ; parakeet ≈ 2,5 Go
  (confirmé sur le disque : `model.safetensors` 2 392 Mo).

**Protocole qualité** : `.pi/skills/quality-gate/SKILL.md` lu avant de commencer. Aucun
fichier de code, de test ou de configuration touché ; la seule écriture est ce rapport,
qui est de la documentation. Aucun commit, aucun envoi.
