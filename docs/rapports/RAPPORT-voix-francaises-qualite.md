# Rapport — Voix françaises Piper : existe-t-il une qualité « high » ?

> Lecture seule. Aucun modèle téléchargé, aucun fichier du projet modifié (seul ce rapport est créé).
> Date de consultation : **2026-10-26** (UTC). Source principale : dépôt public `rhasspy/piper-voices`
> (Hugging Face), consulté par son API de fichiers (`/api/models/.../tree/main/...`), son
> `voices.json` racine et les `MODEL_CARD` / `.onnx.json` de chaque voix.

## Réponse directe

**NON. Il n'existe AUCUNE voix française Piper de qualité `high` dans `rhasspy/piper-voices`,
ni `x_low`.** Le français ne compte que **7 voix** : 4 en `low`, 3 en `medium`. Le niveau
`high` existe bien dans ce dépôt, mais **pas en français** (ex. `de_DE-thorsten-high`,
108,6 Mio ; `it_IT-serena-high` ajoutée le 2026-08-06).

Le dossier `fr/` ne contient qu'une seule locale : **`fr_FR`** (pas de `fr_CA`, `fr_BE`, etc.) —
preuve : `https://huggingface.co/api/models/rhasspy/piper-voices/tree/main/fr`
→ `[{"path":"fr/fr_FR", ...}]`.

## 1. Liste EXACTE des voix françaises publiques (état du dépôt au 2026-10-26)

Qualités = **noms des dossiers** du dépôt, confirmés par le champ `quality` du `voices.json`
racine ET par `audio.quality` à l'intérieur du `.onnx.json` de chaque modèle (les trois
sources concordent, rien n'est recopié d'un tableau).

Taille `.onnx` = taille exacte renvoyée par l'API de fichiers HF (octets) ; `.json` = fichier de
configuration associé.

| Identifiant | Locuteurs | Qualité | Échantillonnage | `.onnx` (octets) | `.onnx.json` |
|---|---|---|---|---|---|
| `fr_FR-siwis-low` | 1 | **low** | 16 000 Hz | 28 130 791 (26,8 Mio) | 4 157 o |
| `fr_FR-gilles-low` | 1 | **low** | 16 000 Hz | 63 104 526 (60,2 Mio) | 4 158 o |
| `fr_FR-mls_1840-low` | 1 | **low** | 16 000 Hz | 63 104 526 (60,2 Mio) | 4 160 o |
| `fr_FR-siwis-medium` | 1 | **medium** | 22 050 Hz | 63 201 294 (60,3 Mio) | 4 875 o |
| `fr_FR-tom-medium` | 1 | **medium** | **44 100 Hz** | 63 511 038 (60,6 Mio) | 4 959 o |
| `fr_FR-upmc-medium` | 2 | **medium** | 22 050 Hz | 76 733 615 (73,2 Mio) | 4 996 o |
| `fr_FR-mls-medium` | **125** | **medium** | 22 050 Hz | 76 733 750 (73,2 Mio) | 7 036 o |

URL de téléchargement (forme exacte, `resolve/main`) :

```
https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/<voix>/<qualité>/fr_FR-<voix>-<qualité>.onnx
https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/<voix>/<qualité>/fr_FR-<voix>-<qualité>.onnx.json
```

Exemples littéraux :
- `…/fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx` (60,6 Mio) + `…/fr_FR-tom-medium.onnx.json` (4 959 o)
- `…/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx` (60,3 Mio)
- `…/fr/fr_FR/upmc/medium/fr_FR-upmc-medium.onnx` (73,2 Mio) — locuteurs `jessica` (0) et `pierre` (1)
- `…/fr/fr_FR/mls/medium/fr_FR-mls-medium.onnx` (73,2 Mio) — 125 locuteurs (MLS, openslr.org/94)

**Genre : non déclaré par le dépôt.** Aucun `MODEL_CARD` français ne mentionne le genre ; seul
`upmc` expose des prénoms (`jessica`, `pierre`). Les mentions « femme / homme » de la table locale
de Pilot (`LOCAL_VOICE_MODELS`, `tts_local.rs::VOICES`) **ne sont pas vérifiables** depuis les
métadonnées du dépôt : non prouvable par cette source.

Preuves par voix (`MODEL_CARD`, licence et jeu de données) :
- siwis : dataset `datashare.is.ed.ac.uk/handle/10283/2353`, CC-BY 4.0, finetuné depuis lessac (medium)
- tom : dataset `git.bksp.space/Tjiho/French-tts-model-piper`, **AGPLv3**, 44,1 kHz
- upmc : `github.com/marytts/upmc-pierre-data`, CC-BY-SA 4.0, 2 locuteurs
- mls / mls_1840 : MLS (`openslr.org/94`), CC-BY 4.0 ; `mls-medium` **entraîné de zéro** (pas un finetune)
- gilles : dataset Kaggle francophone mono-locuteur, CC0, 16 kHz

## 2. Y a-t-il une voix française `high` ? Utilisable par le moteur Piper standard ?

**Non — aucune.** Vérifié à trois niveaux pour `fr/fr_FR` :
1. arborescence des dossiers : seules les qualités `low` et `medium` apparaissent (les qualités
   sont des noms de dossiers : `…/<voix>/low|medium`) ;
2. `voices.json` racine : les 7 entrées `fr_FR-*` portent `"quality": "low"` ou `"medium"` ;
3. contenu des `.onnx.json` : `audio.quality` vaut `low` ou `medium` (vérifié sur `gilles-low`
   → 16 000 Hz / `low`, `siwis-medium` → 22 050 Hz / `medium`, `tom-medium` → 44 100 Hz / `medium`).

Le niveau `high` existe pour d'autres langues (preuve : `de_DE-thorsten-high`, `.onnx` de
**113 895 201 o = 108,6 Mio**, `voices.json` racine), et le dépôt **continue d'en ajouter**
(commit du 2026-08-06 « Add it_IT-serena-high (Italian, high) »). La tierce française n'a jamais
reçu d'équivalent : **non prouvable qu'une voix française `high` existe ailleurs dans un format
Piper public** — les miroirs communautaires consultés (`speaches-ai/piper-fr_FR-*`,
`csukuangfj/vits-piper-fr_FR-*`) ne distribuent **que les 7 mêmes voix** ; les trois modèles
`fr_FR-tjiho-model1..3` (même jeu de données que `tom`) pèsent 63 511 165 o, soit la classe de
taille « medium », pas « high ».

## 3. À défaut de `high` : quelles `medium` sont les plus « haut de gamme » ?

Faits comparables (aucun classement subjectif, la qualité perçue n'est pas mesurable en lecture seule) :

- **`fr_FR-tom-medium` est la seule voix française à 44 100 Hz** (toutes les autres : 22 050 Hz
  en medium, 16 000 Hz en low) et la plus récente des voix mono-locuteur ajoutées
  (`csukuangfj` l'a exportée en juin 2024, après `siwis` en octobre 2023). C'est déjà celle que
  Pilot installe. Taille 60,6 Mio.
- `fr_FR-siwis-medium` : 22 050 Hz, 60,3 Mio, finetune lessac — l'autre medium mono-locuteur,
  également déjà installée par Pilot.
- `fr_FR-upmc-medium` (73,2 Mio, 2 locuteurs) et `fr_FR-mls-medium` (73,2 Mio, **125 locuteurs**)
  sont plus lourdes mais **multi-locuteurs** ; la table de Pilot les exclut volontairement
  (mono-locuteur seulement, cf. commentaire de `VOICES` dans `src-tauri/src/tts_local.rs`).

## 4. La qualité annoncée correspond-elle au contenu ? (contrôle)

Oui, pour les 7 voix : **trois sources concordantes** par voix (nom du dossier = `quality` du
`voices.json` = `audio.quality` du `.onnx.json`), et **tailles identiques** entre l'API de
fichiers HF et la table locale de Pilot pour les 4 voix qu'il propose :

| Voix | taille dépôt HF | taille table Pilot | concordance |
|---|---|---|---|
| siwis-medium | 63 201 294 | 63 201 294 | ✅ |
| tom-medium | 63 511 038 | 63 511 038 | ✅ |
| gilles-low | 63 104 526 | 63 104 526 | ✅ |
| siwis-low | 28 130 791 | 28 130 791 | ✅ |

Conclusion : la table locale de Pilot est **à jour et exacte** ; elle n'oublie aucune voix
mono-locuteur française. Les deux voix qu'elle ne liste pas (`upmc-medium`, `mls-medium`) sont
multi-locuteurs.

## Ce qui n'est pas prouvable ici

- le **genre** réel de `siwis`, `tom`, `gilles` (aucune métadonnée) ;
- la **qualité perçue** (naturel, prosodie) : elle exigerait d'écouter les `samples/*.mp3`
  publics — hors périmètre (aucun téléchargement) ;
- l'existence d'un modèle français `high` **hors** de l'écosystème Piper public (par ex.
  entraîné et gardé privé) : non prouvable, et de toute façon indisponible pour le moteur actuel.

## URLs consultées (2026-10-26)

- `https://huggingface.co/api/models/rhasspy/piper-voices/tree/main/fr`
- `https://huggingface.co/api/models/rhasspy/piper-voices/tree/main/fr/fr_FR?recursive=true`
- `https://huggingface.co/api/models/rhasspy/piper-voices/tree/main/fr/fr_FR/siwis/medium`
- `https://huggingface.co/rhasspy/piper-voices/raw/main/voices.json`
- `https://huggingface.co/rhasspy/piper-voices/raw/main/fr/fr_FR/{siwis,tom,gilles,upmc,mls,mls_1840}/{low,medium}/MODEL_CARD`
- `https://huggingface.co/rhasspy/piper-voices/raw/main/fr/fr_FR/{gilles/low,siwis/medium,tom/medium}/fr_FR-*.onnx.json`
- `https://huggingface.co/api/models/rhasspy/piper-voices/commits/main?path=fr/fr_FR`
- `https://huggingface.co/api/models?search=fr_FR-piper&limit=20` (miroirs communautaires)
- `https://huggingface.co/api/models/csukuangfj/vits-piper-fr_FR-tjiho-model{1,2,3}/tree/main`
