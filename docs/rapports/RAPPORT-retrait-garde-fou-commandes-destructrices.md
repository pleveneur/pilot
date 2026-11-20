# Rapport — retrait du « garde-fou des commandes destructrices » de Pilot

- **Date** : 2026-11-21 (horloge du poste).
- **Décision qui motive le retrait** (propriétaire, 2026-11-21, elle prime sur
  toute demande antérieure) : **AUCUNE modification n'est apportée à Pilot** pour
  ce modèle de langage local ; tout ce qui doit être fait le sera dans une
  **couche séparée, hors de Pilot**. Le garde-fou a pourtant été enregistré dans
  le dépôt : il devait donc être **annulé**.
- **Ce qui a été fait, en une phrase** : le commit qui l'avait introduit est
  **défait par un nouveau commit d'annulation** (le passé n'est pas réécrit,
  aucun commit n'est supprimé), les fichiers qu'il avait créés sont retirés, et
  les deux suites de tests tournent comme avant.

---

## 1. Le commit annulé

| Contrôle | Résultat |
|---|---|
| Commit recherché | `0f58085` — « feat: garde-fou des commandes destructrices (accord obligatoire, fail-closed) » |
| Était-il déjà là avant ? | **Non.** Aucune occurrence de `bash-guard`, `destructive-command`, `PILOT_BASH_GATE` dans son parent `1c0b181` (`git grep` sur `0f58085^` : **rien**). Le fichier `src/js/destructive-command.js` n'a **qu'un seul** commit dans tout l'historique : `0f58085`. Ce n'est donc **pas** une fonction du logiciel : le retrait est légitime (le point d'arrêt prévu par la consigne ne s'applique pas). |
| Était-il poussé ? | **Non.** `origin/main` est à `4eea00f` ; le commit était **local seulement**. Rien n'a été publié, rien n'a été poussé. |
| Méthode d'annulation | `git revert --no-commit 0f58085` → nouveau commit d'annulation. **Aucune réécriture d'historique, aucun commit supprimé.** |

## 2. Ce qui a été retiré

Fichiers **supprimés** (créés par ce seul commit, sans aucun autre appelant) :

- `src/js/destructive-command.js` — décision pure du garde-fou (662 lignes) ;
- `src-tauri/extensions/pilot-bash-guard.ts` — la porte `tool_call` (74 lignes) ;
- `src/js/commande-destructrice.test.js` — verrou de la décision ;
- `src/js/porte-commandes-destructrices.test.js` — verrou de la porte ;
- `docs/rapports/RAPPORT-garde-fou-commandes-destructrices.md` — son rapport.

Branchements **défaits** (retour exact à l'état d'avant) :

- `src-tauri/src/agent_service.rs` : la fonction `write_bash_guard_extension` et
  ses **cinq** points d'appel (chat du projet, agents multi-rôles, assistant,
  assistant de groupe, agents lancés par l'assistant) ;
- `src/js/agent-pi.js` : import du cœur, `handleBashGateConfirm`, branche
  `BASH_GATE_SENTINEL` dans `handleExtensionUiRequest` ;
- `src/js/super-agent.js` : import du cœur et branche `BASH_GATE_SENTINEL` dans
  `handleSuperAgentExtensionUiRequest` ;
- `src/js/machine-sentinel.js` : ré-export de `BASH_GATE_SENTINEL`, phrase
  `BASH_GATE_SENTENCE`, cas correspondant dans `sentinelSentenceFor` ;
- `vitest.config.js` : l'alias `./destructive-command.js` (créé pour la seule
  porte supprimée) ;
- `help/overview.md` (bloc `<!-- HELP:commandes-dangereuses -->`), `README.md` et
  `spec_pilot.md` : les passages qui annonçaient la protection, et
  `help/handbook.md` (généré) : bloc `HELP-TOPIC:commandes-dangereuses`.

## 3. Ce qui a été GARDÉ, et pourquoi

Le commit annulé contenait **une correction sans rapport avec lui** :
`agentAnswerConfirmedRoot` (`src/js/agent-question-surface.js`) et son
application aux **trois transports** de réponse de Pilot (`renderInlineConfirm`
de `agent-pi.js`, `respondSuperAgent` et `respondAgentRelay` de
`super-agent.js`).

Elle corrige un défaut **antérieur** au garde-fou : dans pi 1.6.0, une demande
`confirm` n'est résolue **que** par le champ `confirmed` **à la racine** de la
réponse (`value` n'est lu que par `select`/`input`), si bien que l'accord donné
dans **toute** confirmation de Pilot (porte pré-écriture, contrôle de l'écran,
choix d'un agent relayé) était relu comme un **refus**.

L'annuler aurait touché **une autre fonction du logiciel** — ce que la consigne
interdit (« aucune autre fonction du logiciel n'a été touchée »). La correction a
donc été **réappliquée à l'identique, seule**, avec son verrou
(`src/js/confirmation-transmise-a-pi.test.js`, texte d'en-tête réécrit pour ne
plus mentionner le garde-fou). Elle ne crée aucun fichier, ne charge aucune
extension, ne se branche sur aucune commande : elle ne porte **rien** du
garde-fou.

## 4. Vérifications

| Contrôle | Résultat |
|---|---|
| Recherche de traces (`destructive-command`, `PILOT_BASH_GATE`, `bash-guard`, `planShellToolCall`, `BASH_GATE`, « commandes destructrices ») dans le code, les configs, les specs, les workflows | **aucune** occurrence, hors le présent rapport et le compte rendu antérieur `RAPPORT-nettoyage-garde-fou-annule.md` (document d'archive, non exécuté) |
| `write_bash_guard_extension` dans `src-tauri/src/` | **plus aucune** occurrence |
| Marqueurs de conflit laissés par le revert | **aucun** (seule correspondance trouvée : le texte `>>>>>>> REPLACE` du format SEARCH/REPLACE, sans rapport) |
| `npx vitest run` (front) | **6137 tests — 0 échec** (les 97 tests du garde-fou ont disparu **avec** lui ; aucune autre perte) |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (Rust) | **990 tests — 0 échec**, 3 ignorés (991 avant : −1, le test `write_bash_guard_extension_ecrit_porte_et_coeur`, retiré avec la fonction qu'il vérifiait) |
| `npm run build:handbook` | handbook **cohérent** avec ses sources (bloc des commandes dangereuses retiré, 50 blocs) |
| `git diff 1c0b181 -- <fichiers touchés>` | les fichiers **reviennent à leur état d'avant** `0f58085`, à l'exception de la correction du § 3 |

**Fichiers non touchés** : les quatre rapports non suivis d'autres missions
(banc d'essai gemma4-E4b ×2, blocage du mode dev, étude de rangement) sont
restés en place, intacts.

## 5. Confirmation explicite

**Il ne reste plus rien de ce garde-fou dans Pilot.** Plus une ligne de la
décision (`destructive-command.js`), plus une ligne de la porte
(`pilot-bash-guard.ts`), plus un seul branchement dans les quatre fichiers qui
l'affichaient, plus une seule écriture d'extension dans les cinq chemins de
session de `agent_service.rs`, plus un seul de ses tests, plus un seul mot dans
`README.md`, `spec_pilot.md`, `help/overview.md`, `help/handbook.md`, plus un
seul alias dans `vitest.config.js`. L'historique, lui, garde le commit annulé :
c'est voulu (on défait, on ne réécrit pas).

- **Rien n'a été publié, rien n'a été poussé, aucun réglage de modèle n'a été
  modifié.**
