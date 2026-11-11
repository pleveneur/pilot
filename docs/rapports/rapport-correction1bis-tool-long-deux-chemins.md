# CORRECTION 1 bis — « outil long = agent cru figé » : les deux chemins jumeaux

Suite de la correction 1 (`77bce48`, `should_release_stale_busy` exempte
`tool_in_progress`). Le même symptôme subsistait par deux autres chemins, tous
deux **corrigés ici**, avec test et contre-preuve chacun.

---

## 1. Interface — `isSessionWorking` ne borne plus un outil en cours à 25 min

**Fichier** : `src/js/exclusivity-queue.js` (fonction `isSessionWorking`, seule
retouche du module).

**Avant** (bug) :

```js
if (session.busy === true || session.toolInProgress === true) {
  if (isBusyStale({ ...session, busy: true }, now, staleWindowMs)) return false;
  return true;
}
```

La branche `toolInProgress` passait par le MÊME test de péremption que `busy` :
un outil silencieux de plus de 25 min rendait la session « non travaillante »
(retour `false` immédiat). Conséquences : verrou de run libéré et tour mis en
échec alors que le build / la campagne de tests tournait encore.

**Après** :

```js
if (!session || session.alive !== true) return false;
if (session.toolInProgress === true) return true;   // aucun plafond de durée
if (session.busy === true) { /* busy-stale inchangé */ }
```

- Un outil en cours = la session travaille, **sans plafond** (le borner était le
  bug). Seuls la mort de la session (`alive !== true`) et le filet « processus
  mort » (`has_dead_agent_process`) lèvent ce verrou.
- **Rien d'autre n'a changé** dans le module : `isBusyStale`,
  `isAgentActiveOnProject`, `classifyExclusivitySession`, `isAnyAgentWorking`,
  `isProjectWorking`, les fenêtres et les clés de file sont intacts.

**Test** (`src/js/exclusivity-queue.test.js`) — un test + une contre-preuve :

1. `CORRECTION 1 bis : outil en cours depuis PLUS de la fenêtre busy-stale →
   TOUJOURS un travail (aucun plafond)` : outil en cours à 26 min → `true`,
   à 3 h → `true`, et sans aucune donnée d'activité → `true`.
2. `CORRECTION 1 bis — contre-preuve : sans outil en cours, le busy-stale reste
   libéré` : `busy` vieux de 26 min sans outil → `false` (comportement conservé),
   session au repos → `false`.

Le test `mission 310 : outil « en cours » depuis plus de la fenêtre busy-stale →
PAS de verrou` **verrouillait l'ancien comportement** : il a été retourné (c'est
exactement la règle corrigée), la contre-preuve couvrant la non-régression.

**Anti-vacuité** : production neutralisée (retour à l'ancienne condition
`busy === true || toolInProgress === true`) → `1 failed | 47 passed`, le test
« plus de la fenêtre busy-stale » rougit. Production restaurée.

---

## 2. Rust — `project_activity_is_busy` connaît `tool_in_progress`

**Fichiers** : `src-tauri/src/rpc.rs` (lecture), `src-tauri/src/lib.rs` (champ,
1 seul endroit), `src-tauri/src/anomaly.rs` (l'unique ÉCRIVAIN de la map).

**Avant** : `SessionActivity` ne portait que `busy` + `updated`, et
`project_activity_is_busy` = `(busy && age <= stale_grace) || age < grace`. Un
outil silencieux de plus de `stale_grace` (25 min) ⇒ `busy` périmé et `updated`
vieux ⇒ **projet conclu « libre »** alors que l'agent travaillait (`get_project_
agent_states` et donc la pastille / la file d'attente et la porte d'admission).

**Après** :

- `SessionActivity` gagne `tool_in_progress: bool` (doc du champ incluse).
- `anomaly::make_observer` — **seul écrivain** de la map d'activité par projet —
  propage l'état, avec les mêmes règles anti-fuite que
  `AgentAnomalyState::tool_in_progress` : posé sur `tool_execution_start`, levé
  sur `tool_execution_end`, levé sur fin de tour (`agent_settled` / `agent_end`
  sans `willRetry`) et levé sur mort du process (`process_exit`/`process_error`).
  Un événement fondateur `tool_execution_start` pose déjà l'indicateur.
- `project_activity_is_busy` : `if a.tool_in_progress { return true; }` **avant**
  toute borne de temps — jamais « libre » pendant un outil, même après des
  heures (exactement la règle de `should_release_stale_busy`, correction 1).
- `reset_project_activity` (arrêt / fermeture) efface aussi `tool_in_progress` :
  sans cela un `tool_execution_end` perdu au moment d'un arrêt figerait le projet
  « occupé » à vie, l'indicateur étant désormais autoritaire.

**Signature** : `project_activity_is_busy` est **inchangée** (elle lit une entrée
`SessionActivity`) ; la map est partagée et alimentée par l'observateur branché
sur toutes les sessions (agent principal, agents délégués via
`agent_service`, reviewer, assistant). Aucun appelant n'a donc à fournir un
paramètre supplémentaire, et **aucun défaut silencieux** n'est introduit.

**Tests** (`src-tauri/src/rpc.rs`, `src-tauri/src/anomaly.rs`) :

1. `project_activity_busy_during_long_tool_is_never_free` — outil en cours
   + activité vieille de 1 h → occupé ; outil en cours avec `busy=false` vieux de
   6 h → occupé. **Contre-preuve** : mêmes entrées **sans** outil en cours →
   libérées (busy périmé et session au repos), comportement d'aujourd'hui
   conservé.
2. `observer_propagates_tool_in_progress_to_project_activity` — **test de
   branchement** : sans lui, le correctif serait mort en production (champ
   toujours `false`). Vérifie posé/levé aux 5 transitions, anti-fuite comprise.

`activity()` (fixture existante) délègue à la nouvelle `activity_with_tool()`,
les 7 tests voisins restent verts.

**Anti-vacuité** : (a) `if a.tool_in_progress` neutralisé →
`project_activity_busy_during_long_tool_is_never_free` rougit ; (b) `entry.
tool_in_progress = true` de la map d'activité neutralisé →
`observer_propagates_tool_in_progress_to_project_activity` rougit. Production
restaurée dans les deux cas.

---

## Vérifications

| Commande | Résultat |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **651 passed, 1 ignored** (650 avant ; +1 test de branchement) |
| `npx vitest run src/js/exclusivity-queue.test.js` | 48 passed |
| `npx vitest run` (suite complète interface — module partagé) | **2027 passed, 0 failed** |
| `cargo build --lib` | 17 avertissements, **tous préexistants** (aucun ne concerne `tool_in_progress` / `SessionActivity`) |

Points vérifiés manuellement (quality-gate §3) :

- `isSessionWorking` relue en entier ; seules la garde `alive`, la nouvelle
  branche `toolInProgress` et la branche `busy` (inchangée) subsistent ; syntaxe OK.
- Cartographie des appelants : `isSessionWorking` ← `classifyExclusivitySession`,
  `isAnyAgentWorking`, `isProjectWorking` (aucune signature changée).
- `SessionActivity` : 1 constructeur hors tests (`anomaly::make_observer`), 1
  constructeur de test (`rpc::tests::activity_with_tool`), 1 reset
  (`rpc::reset_project_activity`) — tous mis à jour, compilation sans erreur.
- `dashboard.rs` lit `a.busy || âge < grâce` : il n'utilise pas encore
  `tool_in_progress`. **Hors périmètre** (simple métrique d'affichage, ce n'est
  pas une conclusion « libre » bloquant une admission) — signalé ici pour une
  mission ultérieure.

---

## Observation hors périmètre (non modifiée)

`anomaly::busy_entry_is_exclusive` exige `entry.busy` **et** ne regarde pas
`entry.tool_in_progress`. Une session à `busy=false` avec un outil en cours
n'est donc pas « exclusive » pour le verrou par projet côté Rust
(`project_has_working_agent`). En pratique `busy=false` + outil en cours est rare
(l'outil tourne dans un tour, et un `agent_end` avec relance conserve `busy`) ;
**non touché** conformément au périmètre borné de cette mission, à traiter avec
la liste d'audit restante.

---

*Aucune publication, aucun tag, aucun push. Documentation (`spec_anomaly.md`,
handbook) volontairement non modifiée : mission dédiée.*
