# Chantier #13 — Schedule assistant : tests unitaires

Statut : **implémenté et stable**. Le backend Rust compile, les 9 tests Rust
passent, et les tests JS du ticker sont écrits et verts. Commit :
`feat(super-agent): schedule tool (deferred + periodic reminders)`.

## Périmètre (garde-fous demandés)

1. `every` >= 60 s (borne minimale anti-spam)
2. max 20 planifications en parallèle
3. 1 exécution (fire) max par planification et par tick (`last_run_at` marqué
   atomiquement à l'émission)
4. session super-agent morte = pas de tick (super_agent_schedule_tick côté
   frontend)

## Où se trouve la logique

| Garde-fou | Couche | Fichier | Fonction |
|---|---|---|---|
| every >= 60 s | Rust | `src-tauri/src/super_agent.rs` | `schedule_insert` (const `SCHEDULE_MIN_EVERY_SECS`) |
| max 20 | Rust | id. | `schedule_insert` (const `SCHEDULE_MAX`, `SELECT COUNT(*)`) |
| 1 fire/tick | Rust | id. | `schedule_due_and_mark` (`UPDATE last_run_at = now`) |
| session morte = pas de tick | JS | `src/js/super-agent.js` | `shouldScheduleTick` (super-agent-schedule.js) + ticker 10 s |

Les fonctions pures Rust sont `pub(crate)` : elles ne sont **pas** accessibles
depuis un test d'intégration externe (`src-tauri/tests/`). Les tester dans un
fichier séparé nécessiterait de les passer `pub` → modification du code métier,
interdite par la mission. Les tests vivent donc inline dans le module `tests`
de `super_agent.rs`.

## Tests déjà présents (écrits par le codeur, `super_agent.rs` module `tests`)

Helper `mem_conn()` : `Connection::open_in_memory()` + `init_db`.

| Test | Garde-fou couvert | Assertion clé |
|---|---|---|
| `schedule_rejects_every_below_60` | every >= 60 | `every=59` → erreur contenant `">= 60"` ; `every=60` accepté |
| `schedule_rejects_empty_name_or_prompt_and_duplicate_name` | nom/prompt non vides, unicité du nom | `"  "` et `"  "` (prompt) rejetés ; 2e `même nom` → erreur (UNIQUE) |
| `schedule_caps_at_20` | max 20 | 20 inserts OK, le 21e → erreur `"maximum 20 planifications atteint"` |
| `schedule_due_marks_and_returns_at_most_once_per_tick` | 1 fire/tick | 1er tick → 1 due ; 2e tick immédiat → 0 ; +61 s → 1 à nouveau ; date antérieure → 0 |
| `schedule_delete_and_list` | delete/list | delete renvoie `true` puis `false` ; list reflète l'état |

Ces 5 tests couvrent intégralement les garde-fous 1, 2 et 3. Le garde-fou 4
(session morte) relève du frontend et n'est pas encore testable.

## Résolution du blocage de compilation

Le guillemet fermant manquant dans la chaîne SQL de `init_db` (signalé dans une
version antérieure de ce fichier) a été rétabli : le code compile et les tests
Rust passent.

## Tests JS (écrits, `src/js/super-agent-schedule.test.js`)

Les fonctions pures de décision côté client vivent dans
`src/js/super-agent-schedule.js` (module sans dépendances Tauri/DOM, testable) :

1. **`shouldScheduleTick(open)`** : renvoie `false` si l'onglet 🧭 est fermé
   (session morte) → garde-fou 4. `true` seulement si ouvert.
2. **`parseScheduleEvery(value)`** : validation miroir de la borne Rust
   (`every` < 60 → rejeté, non-entier/NaN → rejeté, >= 60 → accepté).

Le ticker lui-même (`scheduleTick` + `setInterval` 10 s) vit dans
`super-agent.js`, démarre dans `createSuperAgent` et est nettoyé dans le
`unlisten` (pas de fuite). Il n'injecte que si `window._pilotSuperAgentOpen`.

## Décision

- Backend Rust réutilisé tel quel (table `assistant_schedules` + commandes
  `super_agent_schedule_*` déjà présentes et testées).
- Extension `pilot-assistant-schedule.ts` (schedule_create/list/delete) ajoutée
  et enregistrée dans `spawn_superagent_session`.
- Ticker frontend + prompt système + doc (spec_super_agent.md, plan_dev.md,
  handbook) mis à jour.