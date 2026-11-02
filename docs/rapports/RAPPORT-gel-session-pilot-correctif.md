# Correctif — le gel de session Pilot (cause n° 1) et la boucle du suivi du travail

**Nature** : correction de code (mission bornée, 2 points). Aucune nouvelle
fonctionnalité, aucun réglage, aucune commande Tauri ajoutée ou retirée.
**Diagnostic d'origine** : `docs/rapports/RAPPORT-gel-session-pilot.md` (§ 4.1 et
§ 4.4), conservé tel quel et committé avec ce correctif.
**Baseline** : `d1f57bf` (v0.6.7). **Un seul commit local**, `fix(perf): …`.
**Version, tag, publication** : inchangés (`0.6.7`), rien n'est publié.

---

## 1. La cause, en une phrase

Une commande Tauri déclarée `pub fn` (et non `pub async fn`) s'exécute sur le
**thread principal**, celui qui peint l'interface : dès qu'elle attend une
réponse de `pi`, la fenêtre entière se fige — curseur, saisie, boutons compris.
Le chemin chaud de l'agent en comptait **quatre**, dont trois sur des attentes
longues (8 s, 30 s, jusqu'à ≈ 76 s au pire).

## 2. Point 1 — les trois commandes chaudes ne bloquent plus le thread principal

Toutes prennent le motif **déjà en place dans `agents.rs`** (le seul motif du
projet pour ce cas) : la commande devient `pub async fn`, elle **sort du
`&AppState` ce dont elle a besoin** (`Arc<AgentService>` cloné + chaîne
`project`), puis exécute le travail bloquant dans
`tauri::async_runtime::spawn_blocking`. Le cœur métier reste **synchrone et
inchangé**, il est simplement déplacé dans une fonction `do_…_in(agent_service,
…)` appelable depuis une closure `'static`.

| Commande | Attente maximum | Avant | Après |
|---|---|---|---|
| `get_agent_state` | 8 s (`get_state`) | `pub fn`, thread principal | `pub async fn` → `spawn_blocking` (`do_get_agent_state_in`) |
| `get_agent_messages` | 30 s (`get_messages`) | `pub fn`, thread principal | `pub async fn` → `spawn_blocking` (`do_get_agent_messages_in`) |
| `purge_agent_conversation_to` | ≈ 76 s (`get_messages` 8 s + `get_state` 8 s + `new_session` 30 s + `set_model` 30 s) | `pub fn`, thread principal | `pub async fn` → `spawn_blocking` (`do_purge_agent_conversation_to`) |

Ce qui est **strictement identique** : le nom des commandes, leurs paramètres,
leur forme de retour (`Value` / `bool` / `Result<_, String>`), les délais, les
messages d'erreur, l'ordre des commandes RPC envoyées à `pi`, et le fait que
`purge_agent_conversation_to` renvoie `false` quand la conversation est déjà
vierge (aucun `new_session` superflu).

**Pourquoi le thread principal ne peut plus attendre `pi`** : dans les trois cas,
la totalité des appels `send_command_sync*` est désormais exécutée **dans la
closure `spawn_blocking`** ; la commande elle-même ne fait, sur le thread
principal, que deux lectures en mémoire (verrou `active_project`, clone d'`Arc`)
puis un `await` — c'est-à-dire **rend la main à la boucle d'événements**
immédiatement. Un `pi` muet occupe donc un thread du pool bloquant, jamais le
thread qui peint.

**Appelants vérifiés un par un** (aucun n'est cassé) :

- `src-tauri/src/lib.rs` : enregistrement `generate_handler!` (`rpc::get_agent_state`,
  `rpc::get_agent_messages`, `rpc::purge_agent_conversation_to`) — inchangé ;
- `src-tauri/src/web_server.rs:329` et `:351` : appellent les **helpers
  synchrones** `do_get_agent_state` / `do_get_agent_messages`, qui restent
  exportés et **délèguent** aux nouvelles fonctions `_in` : comportement du mode
  distant identique (le serveur web n'est pas le thread principal de Tauri, il
  est hors du périmètre de cette mission) ;
- `src/js/super-agent.js` (`invoke("purge_agent_conversation_to", …)`),
  `src/js/agent-pi.js` (`get_agent_state` dans `waitForPiReady` et au démarrage
  d'un tour), `src/js/inline-complete.js` : `invoke` est asynchrone côté JS, la
  signature ne change pas — **aucune modification côté écran** n'a été nécessaire.

## 3. Point 2 — la boucle du suivi du travail utilise la sonde légère

`src/js/agent-activity.js` (store partagé : cercle en haut à droite, liste des
agents, point qui respire), deux défauts corrigés :

1. **La boucle de 2 s payait la sonde lourde.** Elle appelait
   `get_agent_supervision` (commande **synchrone** côté Rust, qui lit la base
   **par session** sous verrou) toutes les 2 s **et** à chaque push
   `agent-state-changed` — précisément pendant qu'un agent travaille, donc au
   pire moment. Elle utilise maintenant `agent_activity_probe`, la sonde LÉGÈRE
   prévue pour les boucles (lecture mémoire seule : projet, agent, vivacité,
   activité), celle que le bus d'agents utilise déjà.
2. **Aucune garde de réentrance.** Deux passes pouvaient être en vol en même
   temps (un push tombant pendant une sonde). Il n'y a plus qu'**une seule sonde
   en vol** ; une demande arrivée entre-temps est **coalescée** et rejouée une
   fois, jamais empilée.

**Comportement perçu inchangé** (c'est le point délicat) : la sonde légère ne
porte pas les champs d'affichage (nom, état, onglet ouvert). Le store garde donc
la **supervision complète de référence** et la redemande exactement quand ses
champs manquent vraiment — première passe, **changement d'ensemble des sessions**
(démarrage, arrêt, mort d'un processus) et **push `agent-state-changed`** — puis
il **fusionne** l'activité de la sonde légère par-dessus (`mergeProbeActivity` :
vivacité, outil en cours, dernière activité). Conséquences : une session qui
travaille apparaît toujours comme travaillante et respire ; une session au repos
sans onglet reste filtrée comme avant ; une sonde légère en panne ne change rien
à l'affichage connu (aucune mise à jour inventée).

Trois fonctions **pures** portent les décisions et sont testées seules :
`probeSessionsSignature`, `planActivityRefresh`, `mergeProbeActivity`.

## 4. Ce qui reste (hors de cette mission)

- **Point 3 du diagnostic** — « une question d'agent n'a pas de surface de
  réponse » : **non traité**, mission séparée ; rien ici ne le bloque (le relais
  des questions reste tel quel).
- `get_session_stats` est encore `pub fn` **synchrone** (`send_command_sync`,
  30 s) : hors du périmètre borné de cette mission, non modifiée.

## 5. Tests

Deux nouveaux garde-fous.

1. `src/js/agent-activity-sonde-legere.test.js` (8 tests) — le point 2. Il
   **échoue sans le correctif** : avec la garde de réentrance désactivée, la
   sonde est lancée **5 fois** au lieu de 2 sur le même scénario (vérifié en
   neutralisant `if (refreshInFlight)`).
2. `src/js/commandes-agent-non-bloquantes.test.js` (4 tests) — le point 1. Il
   exige, sur le source de `src-tauri/src/rpc.rs`, que les trois commandes
   chaudes soient `pub async fn`, contiennent `tauri::async_runtime::spawn_blocking`
   et **plus aucun** `send_command_sync` / `with_active_session` dans leur corps
   (signe d'une attente de `pi` sur le thread principal), et que les helpers
   synchrones du mode distant existent toujours.

| Exigence | Test qui la tient |
|---|---|
| le poll de 2 s n'appelle que la sonde légère | « le poll de 2 s n'appelle QUE `agent_activity_probe` » (compte les deux commandes séparément) |
| l'activité de la sonde légère est bien appliquée | « l'activité vue par la sonde légère est appliquée entre deux supervisions » (`working: true` puis `false`) |
| les champs d'affichage ne sont pas perdus | « un CHANGEMENT D'ENSEMBLE des sessions redemande la supervision complète » |
| une seule sonde en vol | « GARDE DE RÉENTRANCE » (échoue sans la garde) |
| pas d'affichage inventé en cas de panne | « sonde légère indisponible : la dernière supervision connue est conservée » |
| décisions pures | `planActivityRefresh`, `mergeProbeActivity` (entrée non mutée), `probeSessionsSignature` |
| aucune attente de `pi` sur le thread principal | « `get_agent_state` / `get_agent_messages` / `purge_agent_conversation_to` est async et déporte son attente de pi dans spawn_blocking » |

Résultats d'exécution :

- `npm test` → **278 fichiers / 5086 tests passés, 0 échec** (baseline 5074 +
  12 nouveaux) ; **aucun test existant modifié, affaibli ou supprimé**.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **819 passés,
  0 échec, 1 ignoré** (identique à la baseline).
- `cargo check --manifest-path src-tauri/Cargo.toml` → OK (aucun nouvel
  avertissement).

## 6. Fichiers touchés

- `src-tauri/src/rpc.rs` — trois commandes converties en `async` +
  `spawn_blocking`, avec leurs cœurs synchrones `do_…_in` (`get_agent_state`,
  `get_agent_messages`, `purge_agent_conversation_to`) ; `purge_target_agent_session`
  prend désormais le service d'agents (appelable en closure `'static`).
- `src/js/agent-activity.js` — store partagé : sonde légère dans la boucle,
  garde de réentrance, fusion de l'activité, trois fonctions pures exportées.
- `src/js/agent-activity-sonde-legere.test.js` — nouveau garde-fou du point 2.
- `src/js/commandes-agent-non-bloquantes.test.js` — nouveau garde-fou du point 1.
- `docs/rapports/RAPPORT-gel-session-pilot.md` — diagnostic d'origine (committé).
- `spec_pilot.md` § 2 (Agent Pi) — la règle technique : aucune attente de `pi`
  sur le thread principal, sonde légère pour la boucle, une seule sonde en vol.

Rien d'autre n'a été touché : aucun renommage, aucun nettoyage opportuniste,
aucun test existant modifié, affaibli ou supprimé.

Commit : `fix(perf): la boucle du suivi et les commandes agent ne bloquent plus l'ui`
(single commit local — hash exact : `git log -1 --format=%H`).
