# Rapport — indicateur « travail en cours » collé + mise à jour jamais ouverte

> Lecture seule. Version visée : 0.4.43 installée, 0.4.44 détectée mais jamais proposée.
> Preuves : `fichier:ligne` (LF normalisé). Aucun fichier de code modifié.

## A. Chaîne exacte (un événement de fin manque → fenêtre de mise à jour muette)

1. `anomaly.rs:331` — `tool_execution_start` pose `tool_in_progress = true` (et `busy = true` depuis `agent_start`, `anomaly.rs:270`).
   Le `tool_execution_end` attendu n'arrive jamais (tool tué avec le tour, réponse d'outil perdue, `agent_end` avec `willRetry:true` sans reprise réelle — `anomaly.rs:293` conserve alors **busy ET tool_in_progress**).
2. **Aucun filet ne referme** : l'exemption `tool_in_progress` court-circuite les TROIS garde-fous —
   `should_auto_stop_on_progress` `anomaly.rs:422`, `should_report_anomaly` `anomaly.rs:497`, `should_release_stale_busy` `anomaly.rs:534`. Les seules sorties restantes sont un **nouvel** événement (`anomaly.rs:276/298`) ou la **mort du process** (`anomaly.rs:237-253`). Process vivant et muet → état **définitif**.
3. `agent_service.rs:2333-2363` recopie l'entrée d'anomalie telle quelle ; `agent_service.rs:3852` `isWorking = alive && (busy || tool_in_progress || idle<120)` → `true` à vie.
4. `dashboard.rs:1349-1355` → `state = "running"` (`busy` + `last_event ∉ {agent_settled, agent_end}`) ; `dashboard.rs:1384` recopie `toolInProgress` **sans aucune garde**.
5. `agent-activity.js:143` `working = busy || toolInProgress || isWorking` → `:233 anyBusy` → `:710 currentActivityBusy` → `:929 dot.classList.toggle("breathing", busy)` = **le cercle du haut à droite respire**.
6. `main.js:279` la sonde de la fenêtre réservée lit **la même liste** : `snap.list.some(isAgentWorking)` → `true`.
7. `updater.js:238` `isWorkRunning()` → `true` (fail-closed `:244`) ; `updater.js:309` puis `:314` (double lecture) → `announceWaiting` `:255` → `setWaitingNotice` `:273-280` = **rappel collant** « ⬆ Mise à jour v0.4.44 en attente… », retour `false` → **aucune modale**.
8. Le rappel n'est effacé qu'en cas de succès (`updater.js:321`). Le réexamen de `main.js:301-303` (10 s) retombe sur le même verdict, indéfiniment.

**Conséquence** : un seul drapeau (une session vivante marquée occupée) produit à la fois le cercle qui respire et le blocage de la mise à jour. Ce ne sont pas deux bugs.

## B. Candidats, du plus au moins probable

| Candidat | Ce qui devrait éteindre le drapeau | Ce qui peut manquer |
|---|---|---|
| **Agent de projet / jetable `eph-` mort en pleine opération d'outil** | `tool_execution_end`, puis `agent_end`/`agent_settled` | l'`end` d'outil **et** le tour de fin ; `tool_in_progress` gèle les 3 filets → éternel |
| **Assistant (Magnus)** | idem | exclu par les faits : il répond, donc ses tours se terminent ; seul un `run_agents`/`ask_*` jamais rendu le figerait (il ne répondrait plus) |
| **Agent au repos, simplement listé** | `busy=false` dès `agent_end` | ne peut pas produire le symptôme : `state` serait `idle` |
| **Session morte sans `agent_settled`** | — | **écartée** : `alive=false` ⇒ `state="stopped"` (`dashboard.rs:1324`) et `isWorking=false` (`agent_service.rs:3852`) |
| **Run bloquée dans le bus** | `runState` ≠ `running` (restitution, watchdog) | ne peut **pas** expliquer le cercle (celui-ci ne lit que les sessions) ; peut seulement s'ajouter au blocage via `main.js:283` |
| **Réponse d'outil relayée perdue** (question répondue vers une session relancée) | `tool_execution_end` côté pi | même impasse : `tool_in_progress` reste vrai |

## C. Cause la plus probable ici + argument décisif

**Une session vivante reste `busy=true` avec `tool_in_progress=true` parce que son `tool_execution_end` est perdu.**

Argument décisif : c'est le **seul** état du code qui survit à tous les délais. `busy` seul est libéré à 25 min (`anomaly.rs:527-539`) ; `awaiting_user` est plafonné à 45 min (`anomaly.rs:372-384`) ; une session morte est purgée (`anomaly.rs:237-253`). Seul `tool_in_progress` (`anomaly.rs:422/497/534`) n'a **aucune borne** — cherché dans tout `src-tauri` : il n'est remis à `false` que par un événement, un arrêt explicite (`agent_service.rs:760`) ou un reset d'activité (`rpc.rs:252`). Le rappel qui « ne part jamais » est donc la signature exacte de cette exemption, pas d'un retard.

**Symptôme 3 (zone de saisie éteinte)** : par construction elle suit le **même** `anyBusy` (`super-agent.js:3097-3102`), sauf une exception — `hasPendingQuestion()` force l'extinction (`super-agent.js:414-417`, `:3078-3093`). Deux lectures, à trancher par une seule observation :
- une **barre de question** est visible dans l'onglet 🧭 → une question relayée est restée dans `pendingQuestions` (aucun retrait quand l'agent demandeur meurt : seuls `:1854` après réponse et `:3935` à la fermeture) → symptôme 3 permanent, cohérent ;
- aucune question visible → l'état JS est correct et le signal est **imperceptible** : le CSS (`style.css:4152-4163`) n'anime qu'un dégradé radial à 10 %→35 % d'accent, cycle 1 s. À classer « affichage », indépendant du blocage.

## D. Correction MINIMALE proposée (non implémentée)

1. **Borner l'exemption d'outil** — `anomaly.rs`, `should_release_stale_busy` (`:527`) : mémoriser l'instant du `tool_execution_start` (`tool_started_at`) et n'exempter que si l'outil tourne depuis moins d'un plafond dur (ex. 60 min) ; au-delà, libérer `busy` comme un outil perdu et **tracer** le motif (règle 3, `.pilot/agent-stops.log`). Attendu : le cercle s'éteint, `isWorkRunning()` repasse à `false`, la modale s'ouvre au réexamen suivant (≤ 10 s).
2. **Rendre le blocage visible** — `updater.js:273`, `setWaitingNotice` : afficher **qui** bloque et depuis quand (agent + projet + « en attente depuis … », données déjà présentes dans la liste de `main.js:279`). Aucune interruption de travail, mais l'utilisateur voit la cause au lieu d'un rappel muet.
3. **Fermer la fuite du FIFO** — `super-agent.js` : retirer de `pendingQuestions` toute question dont la session demandeuse n'existe plus (écoute de l'arrêt d'agent), pour que la zone de saisie ne reste jamais éteinte pour une question morte.

**Preuves attendues** : `anomaly.rs:1730` (`should_release_stale_busy_does_not_fire_during_long_tool`) doit **rester vert** (un vrai build de 20 min n'est jamais libéré) + **nouveau test** `should_release_stale_busy_fires_when_tool_never_ends` (outil ouvert au-delà du plafond → `true`) ; `updater.js` a déjà ses tests de sonde — ajouter « un drapeau libéré ⇒ l'écran s'affiche au réexamen ≤ 10 s ».

## E. Déjà correct — ne pas toucher

- **Priorité de la mise à jour** : `isUpdateWaitingForGround` (`updater.js:371-378`) et le correctif `a61051a` (« une mise à jour en attente passe avant la relance automatique ») : c'est ce qui empêche la file d'agents de reprendre le terrain dans la même foulée. À conserver tel quel.
- **Double lecture avant affichage** (`updater.js:309/314`) et **sonde fail-closed** (`:238-246`) : jamais d'écran de mise à jour au milieu d'un travail, jamais de coupure sur erreur de sonde.
- **Aucun agent réellement au travail ne doit être interrompu** : les exemptions `tool_in_progress` de `anomaly.rs:422/497/534` restent la règle (pas de faux « agent bloqué » pendant un `cargo test` de 40 min) — seule leur **durée** devient bornée.
- **Filets existants** : `agent_end`/`agent_settled` → `busy=false` + `tool_in_progress=false` (`anomaly.rs:218-229`, `:281-299`), purge sur mort du process (`:237-253`), `clear_anomaly_busy` (`agent_service.rs:742-762`), `reset_project_activity` (`rpc.rs:244-258`), arrêt manuel toujours possible (R3-EXCEPTION-MANUEL).
- **Sémantique du cercle** : `anyBusy = busy || toolInProgress || isWorking` (`agent-activity.js:254-262`) est voulue (un outil long silencieux doit faire respirer le point) : ne pas la « corriger ».

## Vérification en 30 s (sans lancer d'agent, sans lister de session)

Cliquer le cercle → onglet « Agents » : nom de l'agent, état et « en cours depuis … ». Si une ligne affiche `running` depuis plusieurs heures alors qu'aucun travail n'est lancé, c'est la session à libérer : son `toolInProgress` est le coupable. Dans le même temps, le rappel ⬆ doit porter exactement la même ancienneté.
