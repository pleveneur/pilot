# Rapport — texte des tâches du panneau (bas à droite)

Version : 0.4.37 (aucun changement de version). Dépôt : `G:\IA_PL\pilot`.

## 1. Cause retenue

Deux défauts se cumulaient, chacun suffisant à rendre le texte faux :

1. **Côté cœur (Rust)** — `prompt_snapshot` (`src-tauri/src/agent_service.rs`)
   ne conservait que les **80 premiers caractères** du prompt envoyé à l'agent
   (`PROMPT_SNAPSHOT_MAX_CHARS = 80`). Or un prompt de délégation commence par le
   **rôle** (« Tu es un développeur… »), puis par les blocs `=== SPÉCIALITÉ ===`,
   `=== RÔLE ===`, `=== CONTEXTE PROJET ===` : la mission réelle commence bien
   plus loin (souvent après 600 à 1 500 caractères). Le champ transmis au
   panneau ne contenait donc **jamais** la mission.
2. **Côté interface (JS)** — `shortMission` (`src/js/agent-activity.js`) affichait
   la **première ligne de contenu** du texte reçu. Quand le texte ne contenait
   que le rôle, elle retombait sur le repli « en préparation » — un libellé qui
   ne dit rien de la tâche et qui, dans la pratique, remplaçait la tâche.

Deux tests entérinaient ce comportement : la coupe à 80 caractères
(`agent_service.rs`, `send_records_last_prompt_only_for_prompt_commands`) et
l'interface (`agent-activity.test.js`, « après une ligne de RÔLE, prend la
première ligne de tâche réelle » — il supposait un saut de ligne après le rôle,
forme qui n'existe pas dans un vrai prompt).

## 2. Correction appliquée

- **Fenêtre de prompt conservée : 600 caractères** au lieu de 80, et **ancrée sur
  la mission** : si le prompt dépasse la fenêtre, l'extrait conservé démarre sur
  `## Objectif`, `Objectif :`, `=== MISSION ===` ou `Tâche :` (le premier
  marqueur présent), de sorte que la mission soit **toujours dans le champ**.
  Le prompt entier n'est jamais stocké ; la coupe est signalée par « … ».
- **Extraction de la phrase à afficher** : `shortMission` privilégie désormais la
  section **« Objectif »** de la demande (ligne `Objectif : …` si elle existe),
  en sautant le préambule de rôle, les bandeaux `=== … ===`, les en-têtes
  mécaniques (`## Contexte`, `## Objectif`, `## Consignes`…) et les lignes
  `Rôle :` / `Capacités :` de la spécialité. La phrase est **plafonnée à
  120 caractères** et coupée **proprement** (sur un mot) avec « … ».
- **Repli honnête** : plus jamais « en préparation ». Sans résumé utilisable, la
  ligne affiche **« mission non communiquée »** (et « (demande non précisée) »
  pour un texte vide) ; le rôle n'est jamais affiché comme mission.
- **Panneau : deux groupes explicites et numérotés** — « En cours (n) » et
  « En attente (n) », chaque ligne portant son **rang**, l'**agent** et le
  **projet**. Le propriétaire voit l'ordre de la file.

## 3. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src-tauri/src/agent_service.rs` | fenêtre de prompt 80 → 600, ancrée sur la mission ; test corrigé |
| `src/js/agent-activity.js` | `shortMission` (section Objectif, 120 car., repli honnête), `clipMission`, `renderMissionsPanelHtml` (2 groupes numérotés) |
| `src/js/agent-activity.test.js` | tests corrigés + test sur un VRAI prompt (forme produite par `buildAgentPrompt`) |
| `src/js/super-agent.js` | le volet « En cours » du panneau utilise `renderMissionsPanelHtml` |
| `src/css/style.css` | styles des groupes (rang, titre « En attente ») |
| `docs/rapport-correction-texte-taches-panneau.md` | ce rapport |

## 4. Résultat des tests (mesuré)

| Suite | Commande | Résultat |
|---|---|---|
| Rust, ciblé | `cargo test --manifest-path src-tauri/Cargo.toml --lib prompt_snapshot` | **2 passés** |
| Rust, module agent | `cargo test --manifest-path src-tauri/Cargo.toml --lib agent_service` | **50 passés** |
| Rust, suite complète | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **656 passés, 1 ignoré** |
| JS ciblé | `npx vitest run src/js/agent-activity.test.js` | **PASS (86) FAIL (0)** |
| JS suite complète | `npx vitest run` | **PASS (2151) FAIL (0)** |

Vérification réelle : avec la fenêtre de 600 caractères produite par le cœur
(prompt de 1 267 caractères, fenêtre ancrée sur `## Objectif`), la phrase
affichée est « faire que la ligne d indication dise en UNE PHRASE COURTE la
tache reelle, et que le panneau distingue clairement ce… » — la tâche, plus le
rôle ni « en préparation ».

## 5. Ce qui reste (si arrêt)

Rien d'ouvert sur le périmètre demandé. Ne sont **pas** touchés, comme demandé :
le texte du prompt envoyé au modèle, la file d'attente, les verrous de projet,
l'agent jetable et l'étiquette de projet.
