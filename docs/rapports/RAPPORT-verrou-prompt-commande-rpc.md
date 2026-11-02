# Rapport — Verrou du `prompt` sur le chemin de commande RPC arbitraire

> Micro-tâche : terminer le travail non commité de `src-tauri/src/agents.rs`,
> fermer le trou restant dans `src-tauri/src/rpc.rs`, prouver la garde sur les
> **deux** chemins. Aucune version changée, aucun tag, aucun `--force`.

## 1. Ce qui a été fait

### 1.1 Un point de passage unique, qui porte la garde

`src-tauri/src/agents.rs` :

| Élément | Rôle |
|---|---|
| `command_is_prompt(&Value)` | pur : vrai seulement pour `{"type":"prompt"}` (seule commande de **lancement**) |
| `command_launch_refusal(agent_id, command, busy)` | **décision PURE** : `prompt` + agent occupé ⇒ refus nommé ; tout le reste ⇒ autorisé, même occupé |
| `busy_agent_refusal(agent_id)` | message de refus, **un seul exemplaire** pour toutes les portes (texte inchangé, donc le test existant `prompt_gate_refuses_while_agent_process_is_busy` reste valable) |
| `ensure_agent_not_busy(..)` | inchangé dans son rôle (prompt **direct**) ; utilise désormais `busy_agent_refusal` |
| `ensure_command_launch_allowed(..)` | la garde du diff initial, resserrée : `agent_process_busy` n'est interrogé **que** pour un `prompt` (aucun verrou pris pour une réponse à une question, un `abort`…) |
| `send_command_to_agent(state, project, agent_id, command)` | **point de passage unique** de l'envoi d'une commande à un agent : la garde est ici, avant l'écriture |

### 1.2 Le trou est fermé sur le second chemin

- `agents.rs` → `do_send_agent_process_command` appelle `send_command_to_agent`
  (plus d'écriture directe dans `agent_service.send`).
- `rpc.rs` → `send_agent_command_to` (ligne 642, **le chemin resté ouvert**) appelle
  désormais `crate::agents::send_command_to_agent` et non plus
  `state.agent_service.send(&project, &agent_id, command)`.

Résultat : aucune des deux entrées qui acceptent une commande **arbitraire** ne
peut envoyer un `prompt` en contournant la garde. Réutilisation stricte de
`ensure_agent_not_busy` / `ensure_command_launch_allowed` : **aucun second
mécanisme, aucune nouvelle politique, aucun nouvel état, aucun nouveau message**.

### 1.3 Le chemin de `super-agent.js:6732` est-il couvert ? OUI

`src/js/super-agent.js:6732` envoie
`{ type: "prompt", message: request }` via `invoke("send_agent_command_to", …)`
pour `delegate_to_coder`. C'est exactement la fonction modifiée dans `rpc.rs` :
la délégation de l'Assistant passe maintenant la porte du verrou.

L'autre appel (`super-agent.js:7360`, `respondAgentRelay`) envoie un
`extension_ui_response` : il **n'est pas filtré** (vérifié par test), la réponse
à une question d'agent en pleine exécution continue donc de fonctionner.

## 2. Tests

Trois tests Rust ajoutés dans `agents.rs::tests` :

1. `command_is_prompt_only_for_prompt_commands` — `prompt` reconnu ;
   `extension_ui_response`, `abort`, `get_state`, `set_model`, `new_session`,
   `{}`, `{"type":42}`, `null` non reconnus comme lancement.
2. `prompt_is_refused_only_when_the_agent_is_already_busy` — **cœur de la garde**,
   les 4 combinaisons : prompt+occupé ⇒ `Err` nommant l'agent ; prompt+libre ⇒
   `Ok` ; `extension_ui_response`/`abort`/`get_state`/`set_model`/`new_session`
   +occupé ⇒ `Ok`.
3. `both_arbitrary_command_entries_go_through_the_launch_gate` — **câblage** :
   lit le source (`include_str!`, fins de ligne normalisées — qualité-gate § 3.4)
   et vérifie que (a) la garde précède l'envoi dans `send_command_to_agent`,
   (b) `do_send_agent_process_command` passe par le point de passage et n'écrit
   pas en direct, (c) `send_agent_command_to` (rpc.rs) idem.

### 2.1 Deux sabotages exigés (et deux de plus) — rouge observé, puis vert

| # | Sabotage appliqué | Test | Résultat observé |
|---|---|---|---|
| A | `command_launch_refusal` rendu inopérant (`if false && …`) | `prompt_is_refused_only_when_the_agent_is_already_busy` | 🔴 `panicked … un prompt vers un agent occupé doit être refusé: ()` |
| B | garde retirée du point de passage unique (`send_command_to_agent` envoie sans garde) | `both_arbitrary_command_entries_go_through_the_launch_gate` | 🔴 `la garde a disparu du point de passage unique : pub(crate) fn send_command_to_agent(…)` |
| C | `rpc.rs` remis à `state.agent_service.send(&project, &agent_id, command)` | idem | 🔴 `cette entrée ne doit pas envoyer en direct (contournement de la porte)` |
| D | `agents.rs` : `do_send_agent_process_command` court-circuité vers `.send(` | idem | 🔴 `cette entrée doit passer par la porte` |

Les quatre sabotages ont ensuite été **annulés** (fichiers restaurés à
l'identique, vérifié par `git diff`) et la suite complète est repassée au vert :
les tests ne passent donc pas « aussi bien sans la garde ».

### 2.2 Suites complètes — comptes réels (état final, après annulation des sabotages)

| Suite | Résultat |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **789 passés, 1 ignoré, 0 échec** (27,13 s ; `pilot v0.6.1` recompilé) — 786 avant la tâche, donc **+3 tests** |
| `npm test` | **195 fichiers de test, 3465 tests passés, 0 échec** (21,11 s) |

Aucun avertissement nouveau (seul le rappel préexistant `sqlx-postgres v0.8.0`).

## 3. Point 3 de la mission — un usage légitime est-il cassé ? NON

Vérifié en lisant, pas supposé :

- La délégation de l'Assistant **sonde déjà** l'occupation avant d'envoyer
  (`super-agent.js` : `const busy = ds.busy || isTerrainReserved() || await
  isProjectAgentBusy(projectPath)`) : si l'agent travaille, la demande est **mise
  en file** et rejouée à la fin de la tâche. La garde Rust ne fait donc que
  doubler, côté socle, une politique déjà tenue côté interface.
- Le rejeu de la file (`flushDelegationQueue`, à `agent_end`) s'exécute quand
  l'observateur RPC a déjà remis `busy` à `false` : la garde ne bloque pas les
  relances légitimes (même politique busy-stale que le frontend).
- `agent_process_busy` est **plus étroit** que la sonde du frontend : il ne
  compte que les sessions `AgentProcess` (agents délégués). Un agent que
  l'utilisateur pilote dans son onglet (session principale) n'est pas concerné :
  aucune délégation légitime n'est nouvellement refusée.
- Les commandes qui ne lancent rien ne sont pas filtrées (prouvé par test) :
  répondre à une question d'agent occupé reste possible — c'était le risque
  principal, il est écarté.
- Seul écart résiduel théorique : une course où le frontend conclut « libre »
  juste avant que le socle voie « occupé » produirait un **échec explicite**
  (« Échec de la transmission de la demande à l'agent »), jamais un double
  tour silencieux. C'est le comportement voulu par la mission (refus honnête
  plutôt que seconde exécution concurrente) ; aucune perte silencieuse.

### Observation hors périmètre (non corrigée, à décider)

`group_assistant.rs::send_group_assistant_command` accepte lui aussi une
commande **arbitraire** (`send_group_assistant(command)`) sans garde. C'est une
**troisième** entrée du même genre, mais elle vise une session distincte
(`GROUP_ASSISTANT_ID`, projet `""`, assistant de groupe GDS) — un sujet différent
de « même couple (projet, agent) ». Je ne l'ai pas touchée : hors du périmètre
demandé. À traiter séparément si le propriétaire le souhaite.

## 4. Commit et push

- Branche vérifiée : **`main`** (`git branch --show-current` → `main`, pas d'autre branche).
- **Commit local unique** : `44ac90c1702ec808c3f0f17f49a4c33c7328fc81`
  (`fix(agents): fermer le verrou du prompt sur le chemin de commande RPC arbitraire`)
  — contient **exactement** 2 fichiers : `src-tauri/src/agents.rs` (+192/−6) et
  `src-tauri/src/rpc.rs` (+12/−3), ajoutés un par un par leur chemin exact.
- **Push** : `git push origin main` → `origin/main` = `44ac90c` (vérifié par
  `git rev-parse origin/main`). Aucun tag, aucune version modifiée
  (toujours `0.6.1`), aucun `--force`.

## 5. Ce que cette tâche n'a PAS fait

- Aucune modification hors des deux fichiers autorisés (le présent rapport n'est
  pas committé, comme les autres `RAPPORT-*.md`).
- Aucune correction du troisième chemin (`group_assistant.rs`), hors périmètre.
- Aucun test d'intégration bout-en-bout avec un vrai processus `pi` : la
  précondition « agent occupé » exige une session vivante du registre privé
  `agent_service` (impossible à créer depuis `agents.rs`/`rpc.rs`). L'effectivité
  du refus reste prouvée par `prompt_gate_refuses_while_agent_process_is_busy`
  (qui exerce le refus réel de `ensure_agent_not_busy`, même garde), la décision
  pure testée ici, et le câblage vérifié des deux entrées.
