# RAPPORT — Diagnostic : le modèle `llama-cpp/gemma4-E4b-Uncensored` « ne répond jamais »

- **Mission** : diagnostic en **lecture seule** (aucun fichier de code, aucune configuration,
  aucun réglage de modèle modifié ; aucun agent lancé ; aucune suppression/déplacement).
- **Date de l'examen** : 2026-11-06, entre 12:05 et 12:35 (horloge machine).
- **Question du propriétaire** : j'envoie une demande au modèle `llama-cpp/gemma4-E4b-Uncensored`,
  **rien ne revient**. Est-ce normal ? Pourquoi ?
- **Conventions** : `~` = `C:\Users\pldistance`. `%APPDATA%` = `C:\Users\pldistance\AppData\Roaming`.
  Aucune clé, aucun jeton, aucun secret n'est recopié ici (les fichiers cités en contiennent —
  ils ne sont **pas** reproduits).

---

## 0. Verdict (une phrase)

**Le modèle n'est pas muet : il est déclaré, son serveur tourne, il répond, et deux sessions
réelles de ce matin le montrent en train de répondre — mais ce modèle précis est équipé d'un
`systemPrompt` maison qui lui ordonne de ne JAMAIS écrire de texte (une seule `<tool_call>` par
tour, la prose seulement à la toute fin) et d'appeler des outils qui n'existent pas dans Pilot
(`read_file`, `write_file`, `run_command`) ; mesuré : un appel réel rend **0 morceau de texte**
et une rafale d'appels d'outils. À cela s'ajoute le fait, prouvé, qu'**aucune demande partie de
Pilot avec ce modèle n'a laissé la moindre trace** : le silence observé n'est donc pas une preuve
que le modèle est en cause, et deux causes très différentes restent possibles (voir § 6, classées).**

---

## 1. Ce qui est **normal** et ce qui ne l'est **pas** (langage simple)

| Constat | Normal ? |
|---|---|
| Le serveur local écoute sur `:4567` et sert un modèle | ✅ normal |
| Le nom déclaré dans Pilot (`gemma4-E4b-Uncensored`) n'est pas le nom du fichier `.gguf` | ✅ normal — un serveur llama.cpp à **un seul modèle chargé** ignore le champ `model` |
| Le modèle répond « Bonjour » en HTTP et via la ligne de commande `pi` | ✅ normal (et c'est le cas) |
| Le modèle « réfléchit » longuement avant d'écrire, avec des appels d'outils | ⚠️ acceptable, mais ici **excessif** |
| Un modèle laisse une bulle **vide** alors qu'il travaille | ❌ **anormal** — c'est le symptôme à expliquer |
| Une consigne de modèle qui **interdit d'écrire du texte** | ❌ **anormal** (défaut de configuration, § 4) |
| Une consigne qui apprend des outils **inexistants** dans Pilot | ❌ **anormal** (§ 4) |
| Un appel d'outil qui échoue 5 fois de suite sans changer de stratégie | ❌ **anormal** (§ 5) |

---

## 2. Preuve n° 1 — le modèle est déclaré (et où)

**Fichier** : `~/.pi/agent/models.json`

- Fournisseur `llama-cpp` :
  - `api` = `openai-completions`
  - `baseUrl` = `http://localhost:4567/v1`
  - `apiKey` = une valeur factice (aucun secret réel)
  - `compat` = `{ supportsDeveloperRole: false, supportsReasoningEffort: false, supportsTools: false }`
- Modèle `gemma4-E4b-Uncensored` :
  - `contextWindow` = **64000**
  - `input` = `["text", "image"]` (vision déclarée)
  - `maxTokensEnabled` = `false` (donc **aucun `max_tokens`** envoyé : c'est le serveur qui décide)
  - `systemPrompt` = **1 695 caractères** (voir § 4 — c'est le cœur du problème)
- Autre modèle du même fournisseur : `Qwen3.8-27B` (`contextWindow` 65536, **sans** `systemPrompt`).

**Fichier** : `~/.pi/agent/model-switch.json` → alias `"mm-local": "llama-cpp/gemma4-E4b-Uncensored"`,
modèle par défaut `ollama-pl/deepseek-v4.1-flash:1017-cloud`.

**Pilot lit bien ce fichier** : `src-tauri/src/agents.rs` (fonction `available_model_specs`,
≈ l. 851-880) construit la liste du sélecteur de modèles en lisant
`~/.<stem>/agent/models.json` (ici `~/.pi`, cf. `resolve_agent_home` dans `src-tauri/src/rpc.rs`
l. 728-742). **Conclusion partielle : le modèle est proposé dans Pilot.** Ce n'est donc pas un
modèle « invisible ».

**Fichier** : `%APPDATA%/com.pilot.editor/config.json` — les modèles d'orchestration, de revue,
d'aide et de PDF sont **tous vides** ; `super_agent_model` = `llama-cpp/Qwen3.8-27B` ;
`show_thinking` = `true`. Le nom `gemma4-E4b-Uncensored` **n'apparaît nulle part** dans la
configuration de Pilot.

---

## 3. Preuve n° 2 — le modèle est réellement servi et répond

| Vérification | Résultat |
|---|---|
| Processus | `llama-server.exe`, **PID 13260**, démarré le 2026-11-06 à 11:40:41, écoute `0.0.0.0:4567` (LISTENING) |
| Fichier réellement chargé | `Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf` + `--mmproj …f16.gguf` + `--spec-draft-model gemma-4-E4B-it-assistant-f16.gguf` |
| Paramètres serveur | `--ctx-size 64000`, `-ngl 99`, `--flash-attn on`, `--spec-type draft-mtp`, `--temp 1.0 --top-p 0.95 --top-k 20` |
| `GET /v1/models` | **HTTP 200** → l'unique modèle est `Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf` (`n_ctx` = 64000, `n_ctx_train` = 131072) |
| `GET /props` | `supports_tools: true`, `supports_tool_calls: true`, `supports_system_role: true`, `supports_reasoning_effort: false` ; vision / vidéo / audio : `true` |
| `POST /v1/chat/completions` avec `model:"gemma4-E4b-Uncensored"` (**l'identifiant déclaré, pas le nom du fichier**) | **HTTP 200**, texte `"Bonjour."` |
| `pi --list-models` | `llama-cpp  gemma4-E4b-Uncensored  64K  16.4K  thinking:no  images:yes` — le contexte affiché (64K) est bien celui du serveur (64000) : **pas de décalage déclaré/servi sur le contexte** |
| `pi -p --no-session --model llama-cpp/gemma4-E4b-Uncensored "Dis bonjour en un mot."` | `Bonjour !`, code de sortie 0 ; une tâche de lecture de fichier réussit aussi |

**Conclusion partielle : ni le fichier, ni le serveur, ni le nom déclaré, ni le contexte ne sont
en cause.** Le modèle répond.

---

## 4. Preuve n° 3 — **ce modèle est configuré pour ne pas écrire de texte** (défaut principal, spécifique à ce modèle)

Le champ `systemPrompt` de **cette seule entrée** de `~/.pi/agent/models.json` (1 695 caractères)
contient des règles qui, appliquées, produisent exactement « rien ne revient » :

- règle 2 : *« ACTION FIRST : Execute the required tool call IMMEDIATELY **without explanatory
  text** before the XML block. »*
- règle 3 : *« **SINGLE TOOL PER TURN**: Output exactly **ONE `<tool_call>` per response** »*
- règle 5 : *« Only when ALL steps are completed and verified, finish your final response with
  `<task_completed>SUMMARY_OF_WORK</task_completed>` »*
- et la liste d'outils enseignée est **fictive** : `read_file(path)`, `write_file(path, content)`,
  `run_command(command)`. Ces outils **n'existent pas** dans Pilot/pi (les vrais sont `read`,
  `write`, `edit`, `bash`, `fetch_content`, …).

**Mesure réelle** (appel en flux, avec ce `systemPrompt`, sur le serveur en marche) :
**52 morceaux de `reasoning_content`, 0 morceau de `content`, 11 morceaux de `tool_calls`,
`finish_reason: "tool_calls"` à ≈ 2,6 s.**

➡️ **Zéro texte = bulle vide à l'écran.** C'est la mécanique du silence, et elle est **propre à ce
modèle** (l'entrée `Qwen3.8-27B` du même fournisseur n'a **aucun** `systemPrompt`).

**Aggravant prouvé** : le fournisseur est déclaré `compat.supportsTools: false` alors que le
serveur annonce `supports_tools: true` / `supports_tool_calls: true`. Les deux déclarations se
contredisent ; le `systemPrompt` XML est manifestement là pour « compenser », mais il compense
avec **les mauvais noms d'outils et l'interdiction d'écrire**.

---

## 5. Preuve n° 4 — le modèle part en boucle sur un appel d'outil invalide (et ce n'est **pas** propre à ce modèle)

Deux transcriptions réelles, **ce matin**, dans `~/.pi/agent/sessions/--C--Users-pldistance--/` :

1. `2026-11-06T08-00-22-935Z_01a1afdf-….jsonl` (30 lignes, modèle **gemma4-E4b-Uncensored**,
   `thinkingLevel: "off"`) : « salut » → réponse texte correcte ; puis demande d'image →
   `toolCall fetch_content` → **`Error: No URL provided. Use the 'url' parameter, or 'urls' for
   parallel fetches.`** → **5 fois de suite** le même appel invalide → puis `get_search_content`
   (« findMode "exact" requires findText ») → puis `write` de `asiat.jpg` avec un contenu
   **placeholder texte** (« Placeholder — Adam & Dan »), donc pas une image.
2. `2026-11-06T08-04-07-375Z_01a1afe2-….jsonl` (60 lignes, modèle **Qwen3.8-27B**, donc **un
   autre modèle du même fournisseur**) : même boucle `fetch_content` → même erreur → relances.

➡️ **`finish_reason: "tool_calls"` + texte vide** : côté interface, l'agent « travaille » mais
n'affiche aucun texte ; plusieurs relances identiques donnent l'impression d'un moteur figé.

---

## 6. Ce qui explique le silence, par ordre de vraisemblance

### 6.1 (Le plus probable, prouvé) Le modèle obéit à une consigne qui lui interdit d'écrire
`systemPrompt` du § 4 : une seule `<tool_call>` par tour, aucun texte explicatif. Un tour sans
texte **ne peut pas** s'afficher comme une réponse. Voir mesure : 0 `content`.
**C'est spécifique à ce modèle** (aucun autre modèle du fournisseur n'a ce `systemPrompt`).

### 6.2 (Très probable, prouvé en partie) Le raisonnement du modèle n'est **pas affiché** par Pilot
- `~/.pi/agent/models-store.json` **ne contient pas** le fournisseur `llama-cpp` (seulement
  `huggingface` et `google`).
- Pilot lit les paliers de réflexion hors ligne dans ce fichier
  (`src-tauri/src/agents.rs`, `available_thinking_levels_for_model` → `thinking::read_available_levels`,
  puis repli sur `models.json`) : le modèle n'a pas de `thinkingLevelMap` → **liste vide** →
  aucun palier sélectionnable pour les modèles locaux.
- La session du matin a bien enregistré `thinkingLevel: "off"`, alors que le serveur, lui, émet
  `reasoning_content` (52 morceaux mesurés).
➡️ **Hypothèse (clairement étiquetée comme telle)** : raisonnement émis mais non affiché + aucun
texte de réponse = **écran totalement muet**. Je n'ai pas pu le vérifier sans exécuter une session
Pilot (interdit ici).

### 6.3 (Piste réelle mais **non prouvée**, et non spécifique au modèle) L'appel n'est jamais parti de Pilot
- `%APPDATA%/com.pilot.editor/agent-ops.log` (journal des processus pi lancés par Pilot) :
  **0 occurrence** de `gemma4-E4b`, `llama-cpp` ou `mm-local` ; le dernier `op=spawn` de la
  journée est à **06:56Z**, alors que les sessions du matin datent de **08:00Z / 08:04Z** →
  ces deux sessions **n'ont pas été lancées par Pilot** (elles viennent de `pi` en ligne de commande).
- **Aucune** session avec `model_change → gemma4-E4b-Uncensored` n'existe hors de ce fichier ;
  `~/.pi/agent/model-switch.json` et `~/.pi/agent/models.json` sont les seuls autres fichiers où
  le nom apparaît. **Ni `config.json`, ni `pilot.db`, ni le stockage de la fenêtre (WebView
  `Local Storage`) ne contiennent ce nom.**
- Dans `%APPDATA%/com.pilot.editor/pilot.db`, table `agents` (45 lignes) : **`models_pi` est vide
  pour les 45 agents** — aucun agent n'épingle ce modèle.
➡️ Si la demande a été tapée dans Pilot, le modèle a été appliqué **par le sélecteur de l'onglet**,
et le code de Pilot **n'échoue pas en silence** sur cette bascule : `src/js/agent-pi.js`
(l. 2645-2670 pour le sélecteur, l. 1695-1715 pour la resynchronisation avant envoi) affiche
« ❌ Impossible de changer de modèle » ou « Le modèle n'a pas pu être basculé ». Donc **si
l'utilisateur n'a vu aucun message, la bascule a réussi** et le silence est celui du § 6.1/6.2.

### 6.4 (Écarté) Mauvaise résolution du modèle côté Pilot
`split("/", 2)` sur `llama-cpp/gemma4-E4b-Uncensored` donne bien `provider = llama-cpp`,
`modelId = gemma4-E4b-Uncensored`. Et pi accepte ce `modelId` : la session du matin contient une
entrée `model_change` vers ce modèle. **Pas la cause.**

### 6.5 (Écarté) Contexte trop grand
`contextWindow` déclaré = **64000** = `n_ctx` du serveur ; `pi --list-models` affiche 64K.
Seul `Qwen3.8-27B` est très légèrement sur-déclaré (65536 pour 64000 servis) — sans effet ici.

### 6.6 (Écarté) Serveur absent / port fermé
Il l'était le 2026-11-04 à 03:53 (8 messages `Connection error.` dans une session de cette date),
**pas aujourd'hui** : le serveur écoute depuis 11:40:41.

---

## 7. Le problème touche-t-il **tous** les modèles de ce fournisseur ? (point décisif)

**Réponse : en partie seulement — et la distinction est nette.**

| Symptôme | Portée |
|---|---|
| Modèle déclaré, serveur joignable, nom accepté, réponse HTTP 200 | **tous** les modèles `llama-cpp` ✅ |
| Boucle d'appels `fetch_content` invalides (erreur « No URL provided ») | **tous** : observée avec `gemma4-E4b-Uncensored` **et** avec `Qwen3.8-27B` → c'est un défaut de **prompt / d'usage d'outil**, pas du modèle |
| `compat.supportsTools: false` alors que le serveur dit `true` | **tous** les modèles du fournisseur (réglage au niveau du fournisseur) |
| Paliers de réflexion indisponibles (`models-store.json` sans `llama-cpp`) | **tous** les modèles locaux |
| **Aucun texte de réponse par construction** (consigne « pas de texte ») | **ce modèle seulement** |

➡️ **Si un autre modèle du même fournisseur fonctionne dans Pilot, la cause n'est pas le
fournisseur : c'est la configuration de CE modèle (§ 4).**
➡️ **Si aucun modèle de ce fournisseur ne répond dans Pilot, la cause est le fournisseur/le
poste (§ 6.2 / 6.3), pas Gemma.**

---

## 8. Ce qu'il faudrait faire pour que ça marche (à appliquer par le propriétaire — **rien n'a été modifié ici**)

1. **Retirer (ou vider) le `systemPrompt` de l'entrée `gemma4-E4b-Uncensored`** dans
   `~/.pi/agent/models.json`. C'est la correction la plus probable et la moins risquée : le modèle
   retrouve la liberté d'écrire du texte, et pi fournit déjà ses vrais outils.
   *Si la consigne doit être conservée*, la réécrire au minimum en : (a) remplaçant `read_file` /
   `write_file` / `run_command` par les **noms réels** (`read`, `write`, `edit`, `bash`),
   (b) supprimant « sans texte explicatif » et « un seul `<tool_call>` par tour », (c) supprimant
   l'obligation de terminer par `<task_completed>`.
2. **Aligner `compat.supportsTools` sur la réalité** : le serveur annonce `supports_tools: true`
   → mettre `supportsTools: true` (ou supprimer la clé pour laisser le défaut). Sinon pi et le
   serveur continuent de se contredire, et le `systemPrompt` XML reste nécessaire — donc fragile.
3. **Rendre le raisonnement visible ou inutile** : soit ajouter l'entrée `llama-cpp` dans
   `~/.pi/agent/models-store.json` (paliers de réflexion), soit vérifier dans Pilot que
   l'affichage de la réflexion est actif pour un modèle local ; à défaut, le modèle doit écrire
   du texte dès le premier tour (point 1).
4. **Bouton de vérification côté Pilot** (déjà présent) : dans l'onglet d'agent, sélectionner
   `llama-cpp/gemma4-E4b-Uncensored`, puis **envoyer `dis bonjour en un mot`**. Attendu après
   correction : un texte apparaît. Si un message système « ❌ Impossible de changer de modèle »
   s'affiche, on est dans le § 6.3, pas dans le § 4.
5. **Vérifier dans les 3 minutes** que l'appel est bien parti : après l'envoi, `agent-ops.log`
   doit contenir un `op=spawn` (ou `op=prompt`) et une session doit apparaître dans
   `~/.pi/agent/sessions/`. **Absence de trace = l'appel n'est pas parti** (et le sujet devient
   « pourquoi Pilot n'envoie pas », pas « pourquoi le modèle ne répond pas »).
6. **Ne pas compter sur ce modèle pour générer des images** : il n'a aucun outil de génération
   d'image ; sa « génération » a produit un fichier `asiat.jpg` contenant du **texte**
   (constaté dans la session du matin). Ce n'est pas un bug de Pilot.

---

## 9. Ce qui a pu être vérifié / ce qui ne l'a pas été

**Vérifié (avec preuve)** : déclaration du fournisseur et du modèle ; absence du nom dans Pilot
(config, base d'agents, stockage de la fenêtre) ; serveur en marche, modèle chargé, identifiant
déclaré accepté, `/props` ; réponse réelle en HTTP et en ligne de commande ; `systemPrompt`
interdisant le texte ; mesure 0 `content` / 11 `tool_calls` ; boucle `fetch_content` sur deux
modèles différents ; chemins de code Pilot qui affichent les échecs de bascule ; lecture de
`models.json` par Pilot ; absence de `llama-cpp` dans `models-store.json` ; journaux
(`agent-ops.log`, `agent-stops.log`, log de repli global) sans aucune trace de ce modèle.

**Non vérifié, avec la raison** :
- **Reproduire un envoi depuis Pilot avec ce modèle** : interdit par la mission (aucun agent
  lancé, aucune configuration touchée). C'est le seul test qui trancherait entre § 6.1/6.2 et § 6.3.
- **Savoir si Pilot affiche ou non le raisonnement de ce modèle** : demande une session Pilot
  vivante ; je n'ai que des indices (palier `off`, `models-store.json` sans `llama-cpp`).
- **Le contenu exact du prompt système envoyé par Pilot** : pi ne stocke pas le message `system`
  dans la session (contenu vide dans les deux transcriptions) ; impossible de certifier que le
  `systemPrompt` du modèle a bien été concaténé à chaque tour dans Pilot.
- **Les erreurs stderr du processus pi lancé par Pilot** : `src-tauri` les garde **en mémoire**
  (`last_stderr`), aucun fichier n'est écrit → pas d'autopsie possible après coup. C'est une
  faiblesse de traçabilité à corriger un jour (hors périmètre de cette mission).

---

## 10. Rappel de méthode

Aucun fichier du projet, aucune configuration et aucun réglage de modèle n'a été modifié,
supprimé, renommé ni déplacé. Aucun agent n'a été lancé. `list_agent_sessions` n'a jamais été
appelé. Aucun secret, aucune clé, aucun jeton n'est recopié dans ce rapport.

DONE: diagnostic terminé — le modèle est déclaré, servi et répond ; le silence vient d'abord de la
consigne `systemPrompt` de CE modèle qui lui interdit d'écrire du texte (0 `content` mesuré, outils
inexistants, `supportsTools:false` contradictoire), ensuite d'un raisonnement non affiché par
Pilot, alors qu'aucune demande partie de Pilot avec ce modèle n'a laissé de trace (le seul essai
qui trancherait reste à faire côté propriétaire, § 8.4 et § 8.5) ; la boucle d'appels
`fetch_content` invalides, elle, touche **tout le fournisseur** (constatée aussi avec
`Qwen3.8-27B`). Rapport : `docs/rapports/RAPPORT-diagnostic-gemma4-e4b-llama-cpp.md`.
