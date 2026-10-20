# Rapport — anomalie « agent bloqué » pendant un outil long + verrou de contrat `list_agent_sessions`

Date : session courante · Périmètre : **Rust uniquement** (`src-tauri/src/anomaly.rs`,
`src-tauri/src/agent_service.rs`) + doc (`spec_anomaly.md`, `help/handbook.md` régénéré).
Aucun fichier JS touché · `npm test` non nécessaire.

---

## Correctif 1 — règle 2 : un outil long n'est plus une anomalie

### Trou constaté

La condition inline du moniteur (anciennement ~681-686) :

```rust
if anomaly_enabled && entry.busy && !entry.blocked_reported
    && !awaiting_user_suspends(entry, now) && idle_secs > anomaly_timeout_secs
```

ne consultait **pas** `entry.tool_in_progress`. Un `cargo test` / build silencieux
de 40 min n'émet aucun `tool_execution_update` → déclenchement de
« agent bloqué » + agent de diagnostic automatique + alerte Telegram, alors que
l'agent travaillait. C'est exactement ce que la règle 2 interdit.

### Correctif

- **Nouvelle fonction pure** `should_report_anomaly(entry, anomaly_enabled,
  anomaly_timeout_secs, now) -> bool` (`anomaly.rs:468`), même style et même
  documentation que `should_auto_stop_on_progress` (§392) et
  `should_report_silent_session` (§428). Exemption commentée :
  `if entry.tool_in_progress { return false; }` — un outil en cours est du
  travail qui avance ; un agent réellement figé reste alerté.
- **Moniteur câblé sur ce prédicat** (`anomaly.rs:725`). Tous les autres cas
  sont **inchangés** : activation (`anomaly_enabled`), `busy`,
  `blocked_reported`, attente utilisateur (`awaiting_user_suspends`) et seuil
  (`idle_secs > anomaly_timeout_secs`, seuil par défaut 30 min). Aucun seuil
  modifié. Le scope du moniteur reste identique (le super-agent n'était pas
  exclu de cette alerte avant le correctif : il ne l'est toujours pas).

---

## Correctif 2 — règle 5 : verrou de contrat de forme sur `list_agent_sessions`

- Extraction de la construction de l'entrée JSON dans une fonction **pure**
  `session_entry_json(...)` (`agent_service.rs:3295`), appelée par
  `list_agent_sessions`. Contenu **identique** à l'ancien `json!` inline :
  clés de base `project`, `agent`, `mode`, `state`, `alive`, `visible`, `active`
  puis champs d'activité optionnels `busy`, `toolInProgress`, `isWorking`.
- **Test** `session_entry_json_keeps_frontend_contract_keys` (`agent_service.rs:4558`) :
  vérifie la présence des 10 clés consommées par le JS
  (`agents-bus.js`, `exclusivity-queue.js`, `dashboard.js`), leurs valeurs, et
  l'absence des champs d'activité quand aucune activité n'est connue. Aucun
  processus lancé. Un renommage Rust qui libérerait un agent vivant en silence
  (lecture JS fail-open) fait donc échouer un test.

---

## Vérifications (résultats chiffrés)

| Commande | Résultat |
|---|---|
| `cargo test --manifest-path src-tauri/Cargo.toml --lib anomaly` | **29 passed**, 620 filtered out, 0 failed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib session_entry_json` | **1 passed**, 648 filtered out, 0 failed |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` (suite complète) | **648 passed**, 1 ignored, **0 failed** |

### Preuve que le test du correctif 1 protège réellement l'exemption

1. Exemption retirée (`if entry.tool_in_progress && false`) puis
   `cargo test --lib should_report_anomaly` :
   **FAILED — 0 passed, 1 failed**, panique
   `anomaly::tests::should_report_anomaly_suspends_while_tool_in_progress`
   à `src-tauri\src\anomaly.rs:1610` :
   `opération d'outil en cours → aucune alerte d'anomalie`.
2. Exemption remise en place → `cargo test --lib should_report_anomaly` :
   **1 passed, 648 filtered out, 0 failed** ; suite complète **648 passed,
   0 failed**.

---

## Ce qui n'a pas changé

- Seuils (`anomaly_timeout_minutes` 30, `agent_auto_stop_minutes` 10,
  `stale_busy_grace_minutes` 25, plafond super-agent) : **inchangés**.
- `should_auto_stop`, `should_auto_stop_on_progress`, `should_report_silent_session`,
  `should_release_stale_busy` : **inchangés**.
- Aucun réglage d'interface, aucun fichier JS, `npm test` non requis.

## Documentation

- `spec_anomaly.md` (bloc `<!-- HELP:anomaly -->`) : la puce « Aucune fausse
  alerte » précise désormais qu'une opération longue en cours suspend l'alerte
  « agent bloqué » **et** l'arrêt automatique ; doublon obsolète de cette puce
  supprimé.
- `help/handbook.md` régénéré (`npm run build:handbook`) : 42 blocs.
