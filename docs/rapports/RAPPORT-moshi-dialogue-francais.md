# Rapport — Moshi (Kyutai) sait-il converser en français ?

> Constat établi le **26 octobre 2026**, en **lecture seule** : aucun dépôt cloné, aucun modèle
> téléchargé, aucun code exécuté, aucun fichier de code du projet modifié.

## 1. Réponse nette

**Non — à ce jour (26/10/2026), aucun modèle de dialogue vocal temps réel publié par Kyutai ne
parle français.** Moshi est **anglais uniquement** depuis sa publication (18/09/2024) : la FAQ
officielle le dit encore aujourd'hui, les cartes de modèles portent `language: [en]`, et les poids
n'ont **jamais été réédités depuis le 18/09/2024**. En français, Kyutai publie de la **synthèse de
voix** (TTS), de la **reconnaissance vocale** (STT) et de la **traduction** fr→en — jamais du
dialogue. Le constat antérieur n'a donc pas vieilli : il est toujours exact.

---

## 2. Ce que Kyutai publie réellement comme dialogue vocal temps réel

Tous les modèles de l'organisation `kyutai` sur Hugging Face ont été listés le 26/10/2026
(**94 modèles**) via l'API : https://huggingface.co/api/models?author=kyutai&limit=200

| Modèle (adresse exacte) | Nature | Langue (carte) | Poids réel | Licence | Dernière modif. |
|---|---|---|---|---|---|
| https://huggingface.co/kyutai/moshiko-pytorch-bf16 | dialogue full-duplex, voix masculine | `en` | `model.safetensors` **15,38 Go** (bf16) | CC-BY 4.0 | **2024-09-18** |
| https://huggingface.co/kyutai/moshika-pytorch-bf16 | idem, voix féminine | `en` | bf16 (mêmes ordres) | CC-BY 4.0 | 2024-09-18 |
| https://huggingface.co/kyutai/moshiko-mlx-q4 · `moshika-mlx-q4` | idem, quantification 4 bits (Mac/iPhone) | `en` | `model.q4.safetensors` **4,81 Go** | CC-BY 4.0 | 2024-09-18 |
| https://huggingface.co/kyutai/moshiko-candle-q8 | idem, backend Rust/Candle int8 | `en` | `model.q8.gguf` **8,17 Go** | CC-BY 4.0 | 2024-09-18 |
| https://huggingface.co/kyutai/moshika-rag-pytorch-bf16 | full-duplex + récupération de connaissances (MoshiRAG) | `en` | — | CC-BY 4.0 | 2026-04-17 |
| https://huggingface.co/kyutai/personaplex-rl-seamless | full-duplex post-entraîné par RL (dérivé de `nvidia/personaplex-7b-v1`) | `en` | 7B | CC BY-NC 4.0 **+** NVIDIA Open Model License (accès restreint) | 2026-06-11 |
| https://huggingface.co/kyutai/moshika-rl-seamless | idem, accès restreint (carte inaccessible sans compte autorisé) | non lisible | — | — | 2026-06-11 |
| https://huggingface.co/kyutai/mimi | **codec audio** (pas un dialogue) | — | 0,38 Go | CC-BY 4.0 | 2025-07-02 |

Taille d'architecture annoncée : « un grand Temporal Transformer de **7 milliards de paramètres** »
(README officiel, https://github.com/kyutai-labs/moshi/blob/main/README.md). Licence des poids :
**CC-BY 4.0** ; code Python **MIT**, backend Rust **Apache** (même README, section *License*).

Aucun de ces modèles de dialogue n'a `fr` dans ses métadonnées.

---

## 3. Existe-t-il une version française du dialogue ? **Non**

Cinq preuves convergentes, toutes datées :

1. **FAQ officielle, présente sur `main` le 26/10/2026** —
   https://github.com/kyutai-labs/moshi/blob/main/FAQ.md :
   > « **Is Moshi multilingual?** At the moment no. **Moshi only speaks English.** It has some basic
   > support for translating some sentences or words to other languages, but you shouldn't expect to
   > use it fully in any other language than English. »
   Cette réponse a été ajoutée le **19/09/2024** (issue #62, réponse de `adefossez` :
   https://github.com/kyutai-labs/moshi/issues/62) et n'a **pas** été modifiée depuis (dernier
   changement de fond du fichier : **2025-04-01**, ajout d'un lien vers `moshi-finetune`, sans
   toucher à la section langue — historique :
   https://api.github.com/repos/kyutai-labs/moshi/commits?path=FAQ.md).

2. **Cartes de modèles** : `language: - en` sur `moshiko-pytorch-bf16`, `moshika-*`, `moshika-rag`,
   `personaplex-rl-seamless` (métadonnées `cardData`, API HF).

3. **Les poids n'ont pas bougé** : `kyutai/moshiko-pytorch-bf16` — `lastModified = 2024-09-18`
   (API HF le 26/10/2026). Aucune réédition, donc aucune version française glissée en silence.

4. **Aucun modèle français de dialogue dans les 94 modèles de l'organisation.** Les seuls modèles
   portant `fr` sont : `stt-1b-en_fr` (transcription), `tts-1.6b-en_fr` (synthèse),
   `pocket-tts*` (synthèse, 6 langues), `hibiki-zero-3b` (**traduction** fr/es/pt/de → en).
   Recherche « moshi + french » sur le Hub : **0 résultat** (aucun affinage communautaire français).

5. **Aucune annonce** : la liste complète du blog officiel (jusqu'au **2026-10-22**) ne contient
   aucun billet sur un dialogue vocal français — https://kyutai.org/blog. Le billet
   « Pocket TTS now supports six languages » (**2026-05-04**) concerne la **synthèse**, pas le
   dialogue.

Côté données d'entraînement, le choix est assumé dans l'article : la backbone textuelle Helium est
pré-entraînée sur « **public English data** », le tokenizer SentencePiece « mostly targeting
**English** », et l'affinage full-duplex sur **Fisher** (2 000 h de conversations téléphoniques
anglaises) — https://arxiv.org/html/2410.00037v2 (sections 3 et 4).

**Depuis quand ?** Depuis l'origine (démo publique du **03/07/2024**, code et poids le
**18/09/2024**) et **sans changement** au 26/10/2026.

---

## 4. Si le dialogue n'est qu'en anglais : accepte-t-il un français approximatif ?

**Il ne « refuse » pas la langue : il répond en anglais.** Aucun mécanisme de détection/refus de
langue n'est documenté dans le dépôt.

- **Test de presse en français, publié le 27/07/2024** — 01net,
  https://www.01net.com/actualites/on-teste-moshi-ia-francaise-reve-detroner-chatgpt.html
  (date vérifiée : `article:published_time = 2024-07-27T07:09:35Z`) :
  > « Comme l'indique Kyutai, Moshi n'est pas encore en mesure de parler une autre langue que
  > l'anglais. […] Nous avons donc plusieurs fois demandé à Moshi de nous répondre en français. En
  > vain. L'assistant vocal persiste à nous assurer qu'il parle français, mais il nous le dit en
  > anglais. **Nous ne sommes pas parvenus à tirer une seule réponse dans la langue de Molière.** »
  (second test francophone concordant : https://www.journaldunet.com/intelligence-artificielle/1531543-on-a-teste-moshi-l-assistant-ia-audio-de-kyutai-cense-concurrencer-chatgpt/)

- **Réponse du dépôt à la question directe** — issue #71 « Does it able to support other languages
  except English? » (**19/09/2024**) : « *no. see FAQ* » —
  https://github.com/kyutai-labs/moshi/issues/71

- **Accent / prononciation non standard** : issue #54 (**19–20/09/2024**), un utilisateur à accent
  indien rapporte « my voice was significantly erroneously transcribed » —
  https://github.com/kyutai-labs/moshi/issues/54. La FAQ reconnaît n'offrir que « some basic support
  for translating some sentences or words ».

- **Témoignages d'un usage réussi en français : introuvable.** Recherche GitHub sur le dépôt
  (`french`, `multilingual`) : 2 résultats seulement, tous deux des questions restées sans solution
  française (#310 sur le TTS interne, #135 renvoyée vers « seamless » de Meta).

**Conclusion** : un français approximatif ne donne pas une conversation française ; au mieux
quelques mots traduits, noyés dans une réponse anglaise. **Aucune preuve** d'un fonctionnement
utilisable en français.

---

## 5. Les voix sont-elles utilisables **sans** le modèle de dialogue ? **Oui**

Le catalogue **`kyutai/tts-voices`** (https://huggingface.co/kyutai/tts-voices) est indépendant de
Moshi : ce sont des **embeddings de locuteur** consommés par les modèles de synthèse
(`library_name: moshi`, mais modèle TTS, pas dialogue).

- **Voix françaises : 35** dans `cml-tts/fr/` — 70 fichiers `.wav` (= 35 originales + 35 versions
  « enhanced ») et 70 embeddings. Source : jeu **CML-TTS** (OpenSLR 146), licence **CC-BY 4.0**
  (README de `tts-voices`, section `cml-tts/fr/` ; arborescence vérifiée par l'API :
  https://huggingface.co/api/models/kyutai/tts-voices/tree/main/cml-tts/fr).
- Autres voix françaises repérables : `unmute-prod-website/degaulle-2.wav` (discours du 18 juin,
  domaine public selon Kyutai). Les `voice-donations` (228 voix retenues, **CC0**, projet juin 2025 →
  février 2026) ne précisent **pas** la langue par fichier → **nombre de voix françaises non
  prouvable**.
- **Moteurs de synthèse qui consomment ces voix** :
  - **Kyutai TTS 1.6B** — https://huggingface.co/kyutai/tts-1.6b-en_fr : langues **en + fr**,
    « actually **1.8B** parameters », poids `dsm_tts_1e68beda@240.safetensors` **3,68 Go**,
    **CC-BY 4.0**, streaming (12,5 Hz), conditionnement par embeddings pré-calculés (pas de clonage
    libre).
  - **Pocket TTS** — https://huggingface.co/kyutai/pocket-tts-without-voice-cloning : langues
    **en, fr, de, pt, it, es**, **CC-BY 4.0**, **100 M paramètres**, **tourne sur CPU** (carte mise à
    jour le **2026-10-21**, accès libre sans validation).
- **Qualité française annoncée (chiffres MOS/WER) : introuvable** sur les pages consultées (carte,
  README `delayed-streams-modeling`, page arXiv 2509.08753).

→ **Réponse : oui, la synthèse française existe et est séparable du dialogue** (35 voix + 2 moteurs
sous licence CC-BY 4.0, dont un qui tourne sans GPU).

---

## 6. Conditions matérielles annoncées

| Point | Fait annoncé | Adresse |
|---|---|---|
| GPU Moshi (PyTorch) | « you will need a GPU with a significant amount of memory (**24GB**) » | README moshi, § Requirements |
| GPU Moshi (Rust/Candle int8) | ~11,2 Go alloués au chargement ; **12 Go possible avec précautions**, **8 Go impossible** | FAQ (entrée « Can I run on a 12GB / 8 GB GPU ? ») + issue #54 |
| Mac | version MLX **testée sur MacBook Pro M3** | README moshi, § MLX |
| Windows | « we do not provide official support for it » | README moshi, § Requirements |
| Latence | **160 ms théoriques** (80 ms Mimi + 80 ms délai acoustique), « **as low as 200 ms** on an **L4 GPU** » | README moshi, § Model architecture |
| Limite de durée | MLX et Rust **s'arrêtent après ~5 min** (buffer fixe) | FAQ |
| Unmute (dialogue complet) | GPU CUDA **≥ 16 Go VRAM**, x86_64, **Linux ou WSL** ; **ni macOS ni Windows natif** ; VRAM : LLM 6,1 Go + STT 2,5 Go + TTS 5,3 Go | https://github.com/kyutai-labs/unmute/blob/main/README.md |
| Pocket TTS (synthèse) | **CPU**, 2 cœurs, **~6× temps réel** sur CPU de MacBook Air M4, **~200 ms** avant le premier morceau | https://huggingface.co/kyutai/pocket-tts-without-voice-cloning |

**Réalisme sur un bureau récent** : *voix française* = **oui, confortable** (Pocket TTS, CPU, aucune
carte graphique). *Dialogue vocal temps réel* = **non, pas prêt à l'emploi** : il faut soit une carte
CUDA ≥ 16–24 Go sous Linux/WSL, soit une machine Apple Silicon en MLX (Moshi anglais seulement,
5 min max).

---

## 7. Alternative locale pour du dialogue vocal **français** temps réel

| Piste | Ce que c'est | Langue française | Complexité / coût |
|---|---|---|---|
| **Unmute** (Kyutai, code **MIT**) — https://github.com/kyutai-labs/unmute | Pipeline VAD → **STT** → **LLM** → **TTS**, websockets, serveurs séparés | **Oui** (`stt-1b-en_fr` délai **0,5 s** + `tts-1.6b-en_fr` + le LLM que vous voulez, ex. vLLM local) | Élevée : 3 services à orchestrer, GPU CUDA **16 Go**, **Linux/WSL** seulement, pas de macOS. **Ce n'est pas du full-duplex** : on attend la fin de la prise de parole avant de répondre |
| **Invincible Voice** (Kyutai) — https://github.com/kyutai-labs/invincible-voice | Même trio STT/LLM/TTS orienté **français** (assistant pour personnes atteintes de la maladie de Charcot) | **Oui** (STT/TTS Kyutai `en_fr`, ou service Gradium) | Deux modes : Gradium (cloud, simple) ou **auto-hébergé** (Kyutai STT/TTS + vLLM) ; démo en ligne https://invincible-voice.kyutai.org/ |
| **Qwen3-Omni 30B-A3B** — https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct | Modèle omni end-to-end (Thinker–Talker), parole en entrée **et** en sortie | **Oui** : la carte liste le **français** en entrée (19 langues) et en sortie (10 langages) — mais la métadonnée de la carte dit `language: en` | Licence **apache-2.0** (champ `license_name`) ; **30B** de paramètres (MoE, 3B actifs) → GPU conséquent ; flux temps réel mais **pas full-duplex** (pas d'interruption) |
| **Fabriquer un Moshi français soi-même** — https://github.com/kyutai-labs/moshi-finetune | Affinage **LoRA** de `moshiko-pytorch-bf16` sur des conversations stéréo transcrites | À construire | **Aucun point de départ français officiel** ; GPU 24 Go + données stéréo annotées ; qualité française **non prouvable** ; aucun résultat publié à ce jour |

---

## 8. Annoncé / publié / espéré

- **Publié (téléchargeable aujourd'hui)** : Moshi (en) + Mimi, Hibiki, **Hibiki-Zero (fr→en, temps
  réel, CC BY-NC-SA 4.0)**, **STT en/fr**, **TTS en/fr**, **Pocket TTS 6 langues**, Unmute, Invincible
  Voice.
- **Annoncé comme projet** : rien de daté sur un « Moshi français ». Le seul engagement écrit est
  l'ouverture du code d'affinage (issue #78, **02/10/2024** : « we plan on releasing some
  training/fine-tuning code ») — **tenu**, puisque `moshi-finetune` existe. Autrement dit : Kyutai
  fournit **le moyen de fabriquer** un Moshi français, pas **un** Moshi français.
- **Espéré** : aucune feuille de route publique ne promet une version française du dialogue
  (blog complet jusqu'au 26/10/2026, aucune mention).

---

## 9. Sources consultées (26/10/2026)

1. https://github.com/kyutai-labs/moshi/blob/main/README.md — architecture 7B, latence 160/200 ms, 24 Go GPU, licences, modèles.
2. https://github.com/kyutai-labs/moshi/blob/main/FAQ.md — « Moshi only speaks English », 12 Go/8 Go, limite 5 min.
3. https://github.com/kyutai-labs/moshi/issues/62, `/71`, `/54`, `/78`, `/135` — réponses datées des mainteneurs.
4. https://arxiv.org/html/2410.00037v2 — données d'entraînement anglaises (Helium, Fisher, tokenizer).
5. https://huggingface.co/api/models?author=kyutai&limit=200&full=true — inventaire des 94 modèles (langues, licences, dates, tailles).
6. https://huggingface.co/kyutai/moshiko-pytorch-bf16 (+ `moshika-*`, `personaplex-rl-seamless`, `moshika-rag-pytorch-bf16`, `hibiki-zero-3b-pytorch-bf16`) — cartes de modèles.
7. https://huggingface.co/kyutai/tts-voices (+ API `tree/main/cml-tts/fr`) — catalogue de voix, 35 voix françaises, licences par source.
8. https://huggingface.co/kyutai/tts-1.6b-en_fr — TTS en+fr, 1,8B réel, 3,68 Go, CC-BY 4.0.
9. https://huggingface.co/kyutai/pocket-tts-without-voice-cloning — TTS 6 langues, CPU, 100M, ~6× temps réel.
10. https://github.com/kyutai-labs/delayed-streams-modeling (README) — `stt-1b-en_fr` (0,5 s de délai) vs `stt-2.6b-en` (anglais seul).
11. https://github.com/kyutai-labs/unmute (README) — 16 Go VRAM CUDA, Linux/WSL, VRAM par service ; licence MIT.
12. https://github.com/kyutai-labs/invincible-voice (README) — assistant vocal français STT/LLM/TTS.
13. https://kyutai.org/ et https://kyutai.org/blog — liste des publications jusqu'au 2026-10-22 ; Pocket TTS 6 langues (2026-05-04).
14. https://www.01net.com/actualites/on-teste-moshi-ia-francaise-reve-detroner-chatgpt.html — test en français, publié le 2024-07-27.
15. https://huggingface.co/Qwen/Qwen3-Omni-30B-A3B-Instruct — français en entrée/sortie vocale, apache-2.0.

## 10. Ce qui reste **non prouvable** en lecture seule

- Le comportement **actuel** de la démo `moshi.chat` face à une phrase française : page rendue en
  JavaScript, non vérifiable sans exécuter de navigateur (les seuls essais francophones datés
  trouvés datent du **27/07/2024**).
- Le **nombre de voix françaises** parmi les 228 dons de voix (`voice-donations`) : la langue n'est
  pas indiquée fichier par fichier.
- La **qualité chiffrée** du TTS français (MOS, similarité de locuteur) : aucune métrique publiée sur
  les pages consultées.
- La **licence exacte** de `moshika-rl-seamless` : carte inaccessible sans autorisation.
