# Moshi peut-il servir d'OREILLE seule (parole française → texte) ?

## Réponse nette (6 lignes)

1. **Non.** Le Moshi de dialogue ne produit pas le texte de l'utilisateur : son flux texte est la transcription **de sa propre voix** (son « monologue interne »).
2. Kyutai l'écrit noir sur blanc : *« we do not use the textual representation corresponding to the stream of the user »*.
3. Il n'existe **aucun mode documenté** « audio entrant → texte seul » pour le Moshi de dialogue, et **aucun mode documenté** « texte → sa voix » non plus.
4. **Mais Kyutai publie exactement l'oreille demandée**, dans le même code : `kyutai/stt-1b-en_fr` — transcription **français + anglais**, ponctuée, 0,5 s de délai, détecteur de fin de parole.
5. **Recommandation :** oreille = `kyutai/stt-1b-en_fr` (~2,36 Go) **ou**, sans carte graphique, `whisper.cpp` (modèle `ggml-large-v3-turbo-q5_0`, 574 Mo) ; voix = le Piper français **déjà installé** dans Pilot.
6. Le conseil de l'éditeur pour un agent vocal est d'ailleurs la chaîne oreille → cerveau → voix (son propre produit *Unmute*), pas le modèle tout-en-un.

---

## 1. La sortie naturelle de Moshi

### 1.1 Moshi produit de l'audio, et un texte qui décrit **sa** parole

Le README officiel du dépôt (`https://github.com/kyutai-labs/moshi`, fichier `README.md`) :

> « Moshi models **two streams of audio**: one corresponds to Moshi speaking, and the other one to the user speaking.
> Along with these two audio streams, Moshi predicts text tokens corresponding to **its own speech**, its
> **inner monologue**, which greatly improves the quality of its generation. »

Donc : deux flux audio (Moshi / utilisateur) + **un** flux texte, et ce flux texte est celui de Moshi.

### 1.2 Sur quoi ce flux texte est entraîné — le point décisif

Article officiel : `https://arxiv.org/html/2410.00037v2`, section **3.4.4 « Inner Monologue »** :

> « we define a text stream W […] derived from the sequence of text tokens obtained by applying the
> SentencePiece tokenizer to the transcription of the audio corresponding to **Moshi** with Whisper »

Et, dans la même section :

> « Note that we **do not use** the textual representation corresponding to the stream of **the user**,
> as transcribing this flux in real time would be challenging, and relying on an external ASR system
> contradicts our end-to-end speech-to-speech approach. »

Section **4.2 « Audio Data »** :

> « we sample one speaker randomly as the main speaker (i.e., **Moshi speaking**) »
> « For Fisher, the text stream only contains the transcription of the main speaker. »

**Conclusion du point 1.** La sortie texte de Moshi n'est **pas une oreille**. C'est une reformulation
interne de ce que Moshi s'apprête à dire — au mieux la transcription de sa propre voix, jamais la vôtre.
C'est un perroquet de lui-même, pas un transcripteur. Le code confirme : `moshi/moshi/run_inference.py`
n'affiche que ce flux texte (`self.printer.print_token(text)` sur `tokens[:, 0]`), et rien d'autre.

---

## 2. Le découplage

### 2.1 « Faire écouter Moshi sans qu'il réponde » — non, pas pour le modèle de dialogue

Aucune option de ce type n'existe dans le CLI officiel. Toutes les options de
`https://github.com/kyutai-labs/moshi/blob/main/moshi/moshi/run_inference.py` sont : `--tokenizer`,
`--moshi-weight`, `--mimi-weight`, `--hf-repo`, `--batch-size`, `--device`, `--half`, `--config`,
`--cfg-coef`, `infile`, `outfile`. Il n'y a **ni `--no-audio`, ni `--text-only`, ni équivalent**.

Tentative publique d'utiliser Moshi en entrée texte seul :
`https://github.com/kyutai-labs/moshi/issues/199` (« Run Moshi with only text input », ouvert le
2025-02-03) — l'auteur obtient *« an output that is not coherent (i.e., just random words) »*, et la
question est **restée sans réponse** à ce jour. Donc : **bricolage interne, pas de mode documenté.**

### 2.2 « Lui donner un texte et lui faire dire une phrase » — pas avec Moshi, **oui** avec Kyutai TTS

- Moshi de dialogue : la FAQ officielle (`https://github.com/kyutai-labs/moshi/blob/main/FAQ.md`) dit
  *« Can I change Moshi's voice / personality? This would require fine tuning, which is not currently
  supported. »* → pas de lecture de texte à voix haute séparément de son dialogue.
- **Mais** le même dépôt contient un outil de synthèse vocale :
  `https://github.com/kyutai-labs/moshi/blob/main/moshi/moshi/run_tts.py`, avec par défaut
  `DEFAULT_DSM_TTS_REPO = 'kyutai/tts-1.6b-en_fr'`
  (`https://github.com/kyutai-labs/moshi/blob/main/moshi/moshi/models/tts.py`).
  C'est un modèle **distinct** de Moshi, mais de la même famille et du même code.
- Ce modèle TTS est **anglais + français** :
  `https://huggingface.co/kyutai/tts-1.6b-en_fr` → « Language(s) (NLP): **English and French** »,
  « This model is able to perform streaming text-to-speech generation, including dialogs. »
- Preuve d'usage français côté dépôt : `https://github.com/kyutai-labs/moshi/blob/main/data/tts.jsonl`
  contient une entrée `"id": "ceci_test"` avec la phrase
  *« Bonjour, ceci est un test. Merci de bien vouloir respecter la consigne. Nous allons aussi
  synthétiser une voix en français. »*.
- Les voix sont des empreintes pré-calculées, choisies dans `https://huggingface.co/kyutai/tts-voices`
  (dossier `cml-tts/fr/…` pour des voix françaises).

**Conclusion du point 2.** Le découplage existe, mais **dans l'autre sens de ce que vous cherchez** :
Moshi ne sait pas être une oreille ; Kyutai fournit en revanche deux modèles **séparés** — un
« oreille » (STT) et une « bouche » (TTS) — qui, eux, sont faits pour être découplés.

### 2.3 L'oreille officielle de Kyutai (le vrai candidat)

`https://huggingface.co/kyutai/stt-1b-en_fr` :

> « This is a model for streaming speech-to-text (STT, also known as automatic speech recognition, ASR). »
> « `kyutai/stt-1b-en_fr`, an **English and French** model with ~1B parameters, a 0.5 second delay, and a semantic VAD. »
> « The model produces transcripts **with capitalization and punctuation**. »

`https://kyutai.org/stt/` :

> « It outputs well-formatted transcripts with punctuation, and comes with **word-level timestamps** as well. »
> « In terms of accuracy, it still performs on par with state-of-the-art *non-streaming* models that have
> access to the whole audio at once. »
> « Kyutai STT predicts not only the text but also **the probability that the user is done talking**. »

Lancement documenté (même CLI que Moshi, cas `dep_q == 0` = texte seul) :
`https://github.com/kyutai-labs/delayed-streams-modeling` →

```bash
python -m moshi.run_inference --hf-repo kyutai/stt-2.6b-en audio/bria.mp3
```

(pour le français : même commande avec `--hf-repo kyutai/stt-1b-en_fr` ; le dépôt HF fournit son
`config.json` `model_type: stt`, et le dépôt moshi fournit `configs/stt_1b_enfr.json`.)
Dans ce mode, `run_inference.py` n'écrit **que du texte** : il ne décode aucun audio.

---

## 3. Qualité en français parlé

### 3.1 Compréhension du français par Moshi : **contradiction documentée**

La FAQ officielle de Moshi (`https://github.com/kyutai-labs/moshi/blob/main/FAQ.md`) :

> « **Is Moshi multilingual?** At the moment **no. Moshi only speaks English.** It has some basic support
> for translating some sentences or words to other languages, but you shouldn't expect to use it fully in
> any other language than English. »

L'article (section 3.2.2 « Language identification », `https://arxiv.org/html/2410.00037v2`) :

> « we apply a language identifier based on fastText to keep **English data only**. »

Et section 4.2 : les 7 millions d'heures d'audio d'entraînement sont *« the majority of which contains
English speech »*.

**Donc : l'impression d'usage « Moshi comprend bien le français » n'est étayée par aucune source
officielle.** Ce qui est documenté, c'est l'inverse (anglais seulement, avec un peu de traduction
improvisée). Je ne peux pas établir d'où vient cette impression : **non vérifiable sans essai** dans
votre configuration exacte.

### 3.2 L'oreille française officielle (stt-1b-en_fr) : ce qui est documenté, ce qui ne l'est pas

| Question | Réponse | Source |
|---|---|---|
| Français pris en charge ? | Oui, `en` + `fr` | `https://huggingface.co/kyutai/stt-1b-en_fr` |
| Volume de français à l'affinage | **600 heures** de français (contre 1000 h d'anglais propriétaire + 2000 h Fisher anglais) | même page, § Training Data |
| Pré-entraînement | 2,5 M d'heures d'audio public, transcriptions **synthétiques par Whisper** | même page, § Pretraining |
| Ponctuation / majuscules | Oui | même page + `https://kyutai.org/stt/` |
| Horodatage au mot | Oui | `https://kyutai.org/stt/` |
| Détection de fin de parole | Oui (VAD « sémantique »), **uniquement dans le serveur Rust** : « The semantic VAD is available in the Rust server but not yet in the other implementations. » | `https://kyutai.org/stt/` |
| Hésitations, phrases inachevées, accents, mots techniques, noms de fichiers | **Introuvable** : aucune donnée publiée. Un mécanisme d'amorçage peut aider l'orthographe des noms propres (`scripts/stt_from_file_with_prompt_pytorch.py`, `--prompt_text "Loonah"`), mais l'éditeur prévient : « this is an experimental feature and its behavior is very sensitive to the prompt provided ». | `https://github.com/kyutai-labs/delayed-streams-modeling` |
| WER par langue (français) | **Introuvable** : la page projet n'affiche qu'un graphique image, sans chiffres ; l'article `https://arxiv.org/abs/2509.08753` ne donne pas de WER français dans la page consultée | `https://kyutai.org/stt/` |

### 3.3 Poids et carte graphique (mesuré sur les fichiers publiés, pas supposé)

Tailles exactes des fichiers, relevées sur `https://huggingface.co/api/models/kyutai/stt-1b-en_fr?blobs=true` :

| Fichier | Taille |
|---|---|
| `model.safetensors` (989 204 480 paramètres, BF16) | 1 978 423 520 octets ≈ **1,98 Go** |
| `mimi-pytorch-e351c8d8@125.safetensors` (codec audio Mimi) | 384 644 900 octets ≈ **385 Mo** |
| `tokenizer_en_fr_audio_8000.model` | 120 378 octets |
| **Total** | ≈ **2,36 Go** |

Côté carte graphique :
- Le README moshi prévient, pour le **modèle de dialogue** : « you will need a GPU with a significant
  amount of memory (**24GB**) » (`https://github.com/kyutai-labs/moshi`).
- Pour l'**oreille**, le code Rust prévoit explicitement le processeur :
  `https://github.com/kyutai-labs/delayed-streams-modeling/blob/main/stt-rs/src/main.rs` →
  `/// Run the model on cpu.` `#[arg(long)] cpu: bool`, et la fonction `device()` retombe sur
  `Ok(Device::Cpu)` s'il n'y a ni CUDA ni Metal.
  **Donc « ça peut démarrer sans carte graphique » est établi par le code. « Ça tient le temps réel
  sur votre processeur » n'est documenté nulle part → non vérifiable sans essai.**

---

## 4. Les alternatives, et la recommandation

### 4.1 La chaîne de Kyutai lui-même pour un agent vocal français

`https://github.com/kyutai-labs/unmute` (produit vocal de Kyutai) :

> « The speech-to-text transcribes what the user says, the LLM generates a response in text, and the
> text-to-speech reads it out loud. »
> « Hardware: a GPU with CUDA support and at least **16 GB VRAM**. »
> `./dockerless/start_stt.sh  # Needs 2.5GB of vram`
> `./dockerless/start_tts.sh  # Needs 5.3GB of vram`

Autrement dit : **même l'éditeur de Moshi n'utilise pas Moshi pour ça.** Il utilise oreille → LLM →
voix. C'est un argument fort en faveur de votre idée de départ, à ceci près que l'oreille et la voix
sont **deux modèles distincts**, pas Moshi.

### 4.2 Recommandation : l'oreille locale la plus solide aujourd'hui

**Choix recommandé (sans carte graphique) : `whisper.cpp`.**

- Support processeur annoncé explicitement : `https://github.com/ggml-org/whisper.cpp` →
  « Support for **CPU-only** inference » ; plateformes listées : Windows (MSVC et MinGW), macOS, Linux,
  Android, Raspberry Pi…
- Poids réels des modèles (relevés sur
  `https://huggingface.co/api/models/ggerganov/whisper.cpp?blobs=true`) — attention : les fichiers
  `.en` sont **anglais seulement**, il faut prendre les autres pour le français :

| Modèle (multilingue) | Taille disque |
|---|---|
| `ggml-tiny.bin` | 77,7 Mo |
| `ggml-base.bin` | 148,0 Mo |
| `ggml-small.bin` | 487,6 Mo |
| `ggml-large-v3-turbo-q5_0.bin` | **574,0 Mo** |
| `ggml-large-v3-turbo-q8_0.bin` | 874,2 Mo |
| `ggml-large-v3-turbo.bin` | 1 624,6 Mo |
| `ggml-large-v3.bin` | 3 095,0 Mo |

**Recommandation précise : `ggml-large-v3-turbo-q5_0.bin` (574 Mo), sur processeur.** C'est le meilleur
compromis taille / qualité française disponible hors ligne, sans carte graphique, et il reste deux fois
plus léger que l'oreille Kyutai. (Le tableau du README whisper.cpp donne d'ailleurs, pour comparaison :
`tiny` 75 MiB, `base` 142 MiB, `small` 466 MiB, `medium` 1,5 GiB, `large` 2,9 GiB.)

**Seconde option, si vous acceptez une carte graphique : `kyutai/stt-1b-en_fr`** (2,36 Go). Avantages :
conçu pour le temps réel (0,5 s de délai), ponctuation, horodatage au mot, détection de fin de parole,
et surtout **entraîné spécifiquement pour le français** par un éditeur francophone. Inconvénient :
2,36 Go, et aucune preuve publiée de son comportement sans carte.

### 4.3 Comparaison en une ligne

| | Moshi comme oreille | Meilleure oreille locale |
|---|---|---|
| Ce que ça donne | **impossible proprement** : le texte produit est le monologue de Moshi, pas vos paroles (`arxiv.org/html/2410.00037v2` §3.4.4) | `whisper.cpp` + `large-v3-turbo-q5_0` (574 Mo, processeur) ou `kyutai/stt-1b-en_fr` (2,36 Go, français natif) |
| Coût | bricolage interne non documenté, résultat non garanti | 574 Mo à 2,36 Go, aucune modification de Moshi |

---

## 5. Conclusion opérationnelle

### 5.1 Réponse nette

**NON** — on ne peut pas faire « Moshi écoute / la voix locale prononce ». Motif unique et suffisant :
la sortie texte de Moshi n'est pas une transcription de l'utilisateur, c'est la transcription de sa
propre parole (citation exacte au §1.2). Un modèle dont le texte décrit ce qu'il va dire ne peut pas
servir d'oreille, quelle que soit la qualité de son écoute.

Corollaire : votre constat « il comprend bien le français, mais prononce mal » **ne peut pas être
corrigé en gardant Moshi pour l'écoute**, puisque Moshi ne sait pas restituer ce qu'il a compris.

### 5.2 Si c'était « oui », le prix

Non applicable. Pour être complet : la seule voie théorique serait de réentraîner Moshi pour produire la
transcription de l'utilisateur dans son flux texte. Ce n'est pas documenté, c'est contraire à la
conception revendiquée par l'éditeur (« relying on an external ASR system contradicts our
end-to-end speech-to-speech approach »), et le code d'affinage publié
(`https://github.com/kyutai-labs/moshi-finetune`) n'est même pas adapté aux modèles STT/TTS
(« This code has not been adapted to the Speech-To-Text and Text-To-Speech models yet »,
`https://github.com/kyutai-labs/delayed-streams-modeling/blob/main/FAQ.md`). Donc : **hors de portée**,
et vous aviez raison d'écarter cette piste pour des raisons de coût.

### 5.3 La chaîne la plus simple qui donne le même résultat

**oreille locale → agent Pilot → voix Piper française déjà installée.** Trois étages, aucun Moshi.

| Étage | Ce qui existe déjà dans Pilot | Ce qui manque |
|---|---|---|
| **Oreille (voix → texte)** | rien de local : la dictée actuelle utilise la **Web Speech API** du navigateur (`spec_voice_input.md`, décision 2 : « `SpeechRecognition` natif du navigateur. Pas de backend, pas de Whisper. ») — donc un service **non local**, ce qui ne répond pas à votre exigence « la voix reste sur la machine » | un moteur local : `whisper.cpp` (574 Mo) ou Kyutai STT (2,36 Go) |
| **Cerveau** | l'agent Pi et l'Assistant, déjà là | rien |
| **Voix (texte → parole)** | **le Piper français, quatre voix, déjà installé et fonctionnel** (`src/js/local-voice.js`, `src-tauri/src/tts_local.rs`, spec `spec_read_aloud.md`) | rien |

Risques de cette chaîne, dits franchement :
- **qualité de l'oreille française** : c'est le seul point faible réel. Ni whisper ni Kyutai ne publient
  de chiffre de WER en français parlé spontané → **à mesurer vous-même** sur vos propres phrases avant
  d'aller plus loin ;
- **latence** : un whisper sur processeur n'est pas temps réel ; acceptable pour « je dicte une
  instruction », pas pour une conversation interruptible ;
- **noms de fichiers et de dossiers** : c'est là que toute oreille se casse les dents (les modèles
  connaissent mal ces chaînes). Kyutai prévoit un amorçage expérimental pour l'orthographe des noms
  propres (§3.2) ; whisper.cpp n'a pas d'équivalent documenté → **non vérifiable sans essai**.

---

## 6. Ce que je n'ai pas pu établir (à ne pas lire comme un « non »)

- **WER français du STT Kyutai** : introuvable (graphique image sans chiffres sur `https://kyutai.org/stt/`).
- **WER français de whisper large-v3-turbo** : introuvable dans les sources consultées.
- **Débit réel de `stt-1b-en_fr` sur processeur** : non vérifiable sans essai (le code prévoit le CPU,
  aucune mesure publiée).
- **Comportement de Moshi en français** : non documenté ; la documentation officielle dit « anglais
  seulement ». L'origine de votre bonne impression n'est pas explicable par les sources.
- **La dictée actuelle de Pilot est-elle locale ou distante ?** La spec du projet ne le dit pas ; la
  Web Speech API ne documente pas où le calcul se fait. Si votre exigence est « rien ne sort de la
  machine », ce point doit être vérifié de votre côté.

---

## 7. Sources (adresses exactes)

1. `https://github.com/kyutai-labs/moshi` — README officiel (architecture, « inner monologue », prérequis CUDA 24 Go, support Windows non officiel).
2. `https://arxiv.org/html/2410.00037v2` — article Moshi, §3.2.2 (anglais seulement), §3.4.4 « Inner Monologue », §4.2 « Audio Data ».
3. `https://github.com/kyutai-labs/moshi/blob/main/FAQ.md` — « Moshi only speaks English », « changer la voix exige un affinage, non supporté ».
4. `https://github.com/kyutai-labs/moshi/issues/199` — tentative d'entrée texte seul, restée sans réponse.
5. `https://github.com/kyutai-labs/moshi/blob/main/moshi/moshi/run_inference.py` — CLI, options réelles, affichage du seul flux texte.
6. `https://github.com/kyutai-labs/moshi/blob/main/moshi/moshi/run_tts.py` et `.../models/tts.py` — outil de synthèse vocale, dépôt par défaut `kyutai/tts-1.6b-en_fr`.
7. `https://github.com/kyutai-labs/moshi/blob/main/data/tts.jsonl` — exemple français officiel.
8. `https://huggingface.co/kyutai/stt-1b-en_fr` — oreille anglais + français, ponctuation, données d'affinage (600 h français).
9. `https://huggingface.co/api/models/kyutai/stt-1b-en_fr?blobs=true` — tailles exactes des fichiers (2,36 Go au total).
10. `https://kyutai.org/stt/` — ponctuation, horodatage au mot, VAD sémantique (serveur Rust seulement), symétrie STT/TTS.
11. `https://github.com/kyutai-labs/delayed-streams-modeling` — commandes officielles `python -m moshi.run_inference`, amorçage par prompt, `configs/config-stt-en_fr-hf.toml`.
12. `https://github.com/kyutai-labs/delayed-streams-modeling/blob/main/FAQ.md` — code d'affinage non adapté aux STT/TTS.
13. `https://github.com/kyutai-labs/delayed-streams-modeling/blob/main/stt-rs/src/main.rs` — option `--cpu` et repli `Device::Cpu`.
14. `https://huggingface.co/kyutai/tts-1.6b-en_fr` — TTS anglais + français, 1,8 Md de paramètres, voix par empreintes.
15. `https://huggingface.co/kyutai/tts-voices` — empreintes de voix, dont des voix françaises (`cml-tts/fr/…`).
16. `https://github.com/kyutai-labs/unmute` — la chaîne STT → LLM → TTS de Kyutai, GPU CUDA ≥ 16 Go, STT 2,5 Go de VRAM / TTS 5,3 Go.
17. `https://github.com/ggml-org/whisper.cpp` — « Support for CPU-only inference », plateformes (Windows inclus), tableau des modèles.
18. `https://huggingface.co/api/models/ggerganov/whisper.cpp?blobs=true` — tailles exactes des modèles `ggml-*`.
19. Dépôt Pilot : `spec_voice_input.md` (dictée = Web Speech API), `src/js/local-voice.js` et `src-tauri/src/tts_local.rs` (voix Piper française locale), `spec_read_aloud.md`.

*Aucun téléchargement de modèle, aucune installation, aucune modification de code n'a été effectuée.
Seuls des fichiers du dépôt ont été lus, et les tailles de fichiers ont été relevées via l'API publique
de Hugging Face (métadonnées, sans télécharger les poids).*
