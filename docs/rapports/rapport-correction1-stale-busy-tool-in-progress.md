# Rapport — CORRECTION 1 : un outil long ne libère plus le créneau d'un agent vivant

Date : 2026-10-20 · Base : v0.4.33 (commit `56c96df`) · Périmètre : `src-tauri/src/anomaly.rs` uniquement

## 1. Cause (vérifiée dans le code)

Le moniteur d'anomalies (`src-tauri/src/anomaly.rs`, boucle de surveillance) applique
trois garde-fous voisins sur la même entrée `AgentAnomalyState` :

| Garde-fou | Zone | Exemption `tool_in_progress` AVANT |
|---|---|---|
| `should_report_silent_session` (session muette) | ~l.428 | ✅ oui |
| `should_report_anomaly` (alerte « agent bloqué ») | ~l.468 | ✅ oui |
| `should_auto_stop_on_progress` (arrêt auto T2) | ~l.400 | ✅ oui |
| **`should_release_stale_busy` (verrou fantôme)** | **~l.502** | ❌ **NON** |

Conséquence réelle : un `cargo test`, un build ou une installation **silencieuse de
plus de 25 min** (`STALE_BUSY_GRACE`, `src-tauri/src/lib.rs`) fait basculer
`should_release_stale_busy` à `true` alors que l'agent travaille. Le moniteur émet
alors `agent-stale-busy-released`, que `src/js/agents-bus.js` (`failAgentTurn`)
interprète comme une **fin de tour en échec** + **libération du créneau** : l'agent
est déclaré en échec et le projet redevient lançable — un second lancement (ou la
file d'attente) pouvait donc démarrer **sur le même projet pendant que l'agent
travaillait encore**.

C'est le comportement le plus grave relevé par l'audit : les trois autres garde-fous
avaient déjà été corrigés (règle 2 / passage 3 du lot 1), celui-ci avait été oublié.

## 2. Correctif appliqué (geste unique, borné)

`src-tauri/src/anomaly.rs` — `should_release_stale_busy` :

```rust
pub(crate) fn should_release_stale_busy(entry: &AgentAnomalyState, grace_minutes: u32, now: Instant) -> bool {
    if !entry.busy || awaiting_user_suspends(entry, now) {
        return false;
    }
    // Outil en cours (build, série de tests, longue analyse) = travail qui
    // avance : aucun événement n'est émis entre `tool_execution_start` et
    // `tool_execution_end`. Ne jamais libérer le créneau pendant ce temps.
    if entry.tool_in_progress {
        return false;
    }
    let idle_secs = now.duration_since(entry.last_activity).as_secs();
    idle_secs > (grace_minutes.max(1) as u64) * 60
}
```

Style identique à l'exemption déjà en place dans `should_report_anomaly` /
`should_auto_stop_on_progress`. Doc-comment de la fonction complété (cause + « le
filet processus mort reste le seul juge des cas réellement figés »).

Rien d'autre n'a été modifié : ni le seuil de grâce (25 min), ni les réglages, ni
l'interface (`agents-bus.js`), ni un autre garde-fou.

### Effet de bord volontaire et correct
`should_release_stale_busy` sert aussi de brique à `busy_entry_is_exclusive`
→ `project_has_working_agent` (portes Rust : dépôt inter-projets, admission RPC,
serveur web distant). Un agent exécutant un outil long est désormais compté comme
**travail réel en cours** : une seconde demande sur le projet est **refusée ou mise
en file** au lieu de démarrer en parallèle. C'est exactement la conséquence
attendue de la correction (avant : le verrou fantôme « libérait » le projet pendant
le build).

## 3. Filet de sécurité « processus mort » : NON affaibli (vérifié)

Deux filets **indépendants** de `should_release_stale_busy` couvrent les cas
réellement figés, et aucun des deux ne consulte cette fonction :

1. **Purge « busy ∧ process mort » (bug #152)** — dans la boucle du moniteur, les
   candidats sont collectés par `if entry.busy && !is_super { stale_busy.push(...) }`
   puis filtrés par `state.agent_service.has_dead_agent_process(...)`. Comme l'entrée
   reste désormais `busy = true` quand un outil est en cours, elle **entre bien dans
   la liste des candidats** : la purge sur process mort peut donc se déclencher
   immédiatement (avant le correctif, l'entrée avait déjà été remise à `busy = false`
   par le verrou fantôme et échappait à ce filtre). Le filet est donc **renforcé**,
   jamais contourné.
2. **Purge des états d'exécution fantômes (issue #87)** —
   `purge_ghost_running_states_app` inspecte la base (`proc_state='Running'`) et la
   vivacité réelle (`agent_alive`) ; totalement indépendante des décisions pures
   ci-dessus.

De plus `tool_in_progress` est remis à `false` par tous les chemins normaux d'arrêt
(`agent_settled`, `agent_end` sans relance, `process_exit`, `stop()` — couvert par
`stop_clears_anomaly_busy_for_couple`), donc un process mort ne peut pas laisser un
`tool_in_progress` bloquant indéfiniment.

## 4. Test ajouté (anti-vacuité) et preuve de neutralisation

`src-tauri/src/anomaly.rs` → `mod tests` :
`should_release_stale_busy_does_not_fire_during_long_tool`
(fixture complète : `busy: true`, `awaiting_user: false`, `last_activity` à −3600 s,
grâce 25 min)

- `tool_in_progress: true` → `assert!(!should_release_stale_busy(...))`
- **contre-preuve** `tool_in_progress: false` sur la **même** entrée →
  `assert!(should_release_stale_busy(...))`

Preuve que le test rougit sur la production neutralisée (exemption retirée
temporairement, puis restaurée depuis une copie de sauvegarde) :

```
---- anomaly::tests::should_release_stale_busy_does_not_fire_during_long_tool stdout ----
thread '...' panicked at src-tauri\src\anomaly.rs:1678:9:
opération d'outil en cours → le créneau d'un agent vivant n'est pas libéré
test result: FAILED. 1 passed; 1 failed; 0 ignored; ... 648 filtered out
```

Le test voisin `should_release_stale_busy_guards_busy_and_grace` passe dans les deux
états (il utilise `tool_in_progress: false`) : la contre-preuve n'est pas un doublon.

## 5. Preuves de test (après restauration du correctif)

```
cargo test --manifest-path src-tauri/Cargo.toml --lib anomaly
  → 30 passed, 620 filtered out (0.62s)

cargo test --manifest-path src-tauri/Cargo.toml --lib
  → 649 passed, 1 ignored, 0 failed (10.48s)
```

Aucun fichier JS touché ⇒ `npx vitest run` non requis pour cette correction
(aucun changement d'interface, aucun helper frontend modifié).

## 6. Avertissements de compilation : inchangés

| | Avant correctif | Après correctif |
|---|---|---|
| Nombre de lignes `warning:` | 1 | 1 |
| Détail | `sqlx-postgres v0.8.0` — future-incompatibilité (pré-existante, hors périmètre) | identique |

**Aucun nouvel avertissement** (ni rustc, ni clippy : `cargo test --lib` compile le
crate complet avec les mêmes options).

## 7. Points notés, NON codés (hors périmètre de cette micro-tâche)

1. **Côté interface (`src/js/exclusivity-queue.js`, `isSessionWorking`, ~l.155-167)** :
   la branche `toolInProgress === true` est **toujours bornée** par
   `isBusyStale(..., STALE_BUSY_WINDOW_MS = 25 min)`. Une session dont l'outil
   tourne depuis plus de 25 min sans événement est donc encore considérée « non
   travaillante » par cette sonde JS (`super-agent.js` l'utilise). Même famille de
   défaut que la correction 1, mais côté frontend : à traiter dans une correction
   dédiée si l'audit le confirme.
2. **`rpc.rs::project_activity_is_busy`** (~l.279) applique sa propre péremption
   (`busy && age <= stale_grace`) sans notion d'outil en cours (la structure
   `SessionActivity` ne porte pas `tool_in_progress`). Impact moindre (pastille
   d'activité / admission), mais c'est une seconde source de vérité sur le
   vieillissement d'un `busy`.
3. **Documentation à ajuster** (hors périmètre demandé, non modifiée ici) :
   `spec_anomaly.md` § « Opération longue en cours » dit encore que la protection du
   créneau « est **bornée à 25 minutes** d'absence totale d'activité ». Après ce
   correctif, un outil en cours n'est plus libéré par le moniteur Rust ; la phrase
   devra être précisée (+ `npm run build:handbook`) — à faire dans une tâche doc
   dédiée pour ne pas élargir ce commit.
4. `should_auto_stop` (plafond « réfléchit » du super-agent, ~l.370) n'a **pas**
   d'exemption `tool_in_progress` ; non touché (l'Assistant est hors scope T2 et
   dispose d'un plafond dédié).

## 8. Commit

Un commit unique, portant uniquement `src-tauri/src/anomaly.rs`.
`git push` / tag / publication : **non effectués** (interdits par la consigne).

> Note : le présent rapport est écrit sous `target/` (répertoire ignoré par Git) à la
> demande de la consigne ; il n'est donc pas versionné.
