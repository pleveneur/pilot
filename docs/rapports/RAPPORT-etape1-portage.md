# Rapport — étape 1 du chantier « mode réseau multi-postes » (portage d'un projet)

> Périmètre livré : table `project_handovers` (migration 0008) + règles **pures**
> du portage (`gds-core/src/handover.rs`) + déclaration du module dans
> `gds-core/src/lib.rs`. **Aucune** requête SQL, **aucune** route, **aucun** code
> desktop ou front (étapes 2 à 9 non commencées).
> Référence : `PLAN-mode-reseau-multipostes.md` §3 (réglages), §6 a (schéma),
> §6 b (règles), §7 étape 1.

## 1. Fichiers livrés

| Fichier | Nature |
|---|---|
| `gds-core/migrations/0008_project_handover.sql` | nouveau — table + index unique partiel, **LF** |
| `gds-core/src/handover.rs` | nouveau — règles pures + 20 tests sans base |
| `gds-core/src/lib.rs` | modifié — `pub mod handover;` (+ commentaire), aucune autre ligne touchée |

`git status` ne montre que ces trois fichiers (plus les `RAPPORT-*.md` /
`docs/proposition-*.md` déjà non suivis avant la tâche, laissés hors périmètre).

## 2. Schéma retenu (migration `0008_project_handover.sql`)

Conforme à §6 a, à la lettre :

- `project_handovers(id BIGSERIAL PK, project_id BIGINT NOT NULL REFERENCES projects(id),
  user_id BIGINT NOT NULL REFERENCES users(id), poste_id TEXT NOT NULL,
  taken_at/heartbeat_at/expires_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ NULL, returned_by TEXT NULL CHECK (…IN ('self','expiration','admin')),
  return_reason TEXT NULL, sync_at TIMESTAMPTZ NULL)` ;
- `CHECK (returned_by <> 'admin' OR (return_reason IS NOT NULL AND btrim(return_reason) <> ''))`
  nommé `project_handovers_admin_reason_check` (motif obligatoire pour `admin`) ;
- index unique **partiel** `project_handovers_active_key ON project_handovers(project_id)
  WHERE returned_at IS NULL` → l'exclusivité est garantie par la base ;
- clôture, jamais suppression (`returned_at` renseigné) → historique conservé ;
- en-tête commenté en français, style de `0001_init.sql` / `0007_drop_project_locks.sql` ;
- **aucun** index supplémentaire, **aucune** colonne ajoutée au schéma du plan.

`0009`, `project_info`, garde d'écriture : **non créés** (étapes 6 et suivantes).

## 3. API des règles pures (`gds-core/src/handover.rs`)

Aucune I/O, aucune connexion, aucun réseau, **aucune lecture d'horloge** : `now:
DateTime<Utc>` est toujours un paramètre. `use chrono::{DateTime, TimeDelta, Utc}`
+ `use crate::roles` (matrice des rôles, module pur).

### Constantes

```rust
pub const HANDOVER_TTL_MINUTES: i64 = 15;          // réglage 1 (§3)
pub const HANDOVER_HEARTBEAT_MINUTES: i64 = 3;     // réglage 2 (§3)
pub const EXPIRATION_REASON: &str = "portage expiré après 15 minutes sans présence";
pub const REFUSED_STATUS: u16 = 409;
```

### Types

```rust
pub enum ReturnedBy { SelfReturn /* "self" */, Expiration /* "expiration" */, Admin /* "admin" */ }
impl ReturnedBy { pub const ALL: [ReturnedBy; 3]; pub fn as_str(self) -> &'static str;
                  pub fn parse(value: &str) -> Option<ReturnedBy> }

pub struct HandoverRow { id, project_id, user_id, poste_id,
                         taken_at, heartbeat_at, expires_at,
                         returned_at: Option<…>, returned_by: Option<ReturnedBy>,
                         return_reason: Option<String>, sync_at: Option<…> }
impl HandoverRow { pub fn is_open(&self) -> bool }

pub struct Holder    { user_id: i64, poste_id: String }
pub struct Closure   { returned_at, returned_by: ReturnedBy,
                       return_reason: Option<String>, sync_at: Option<…> }
pub struct NewHandover { project_id, user_id, poste_id, taken_at, heartbeat_at, expires_at }
pub struct Renewal     { id, heartbeat_at, expires_at }

pub enum RefusalReason { NotHolder, Expired }            // as_str()
pub enum TakeDecision   { Take { row }, Renew { renewal },
                          Replace { close, row }, Refused { holder, until } }
pub enum HeartbeatDecision { Accepted { renewal },
                             Refused { reason, holder: Option<Holder>, close: Option<Closure> } }
pub enum ReturnDecision { Closed { id, closure },
                          Refused { reason, holder: Option<Holder>, close: Option<Closure> } }
pub enum ForceRefusalReason { NotAdmin, ReasonMissing, NoActiveHolder }   // as_str()
pub enum ForceReturnDecision { Closed { id, closure }, Refused { reason } }
```

`TakeDecision` / `HeartbeatDecision` / `ReturnDecision` / `ForceReturnDecision`
exposent `http_status()` (200 / 409 / 403) et, pour `TakeDecision`, `action()`
(`insert`, `renew`, `close_then_insert`, `refuse`).

### Fonctions

```rust
pub fn is_expired(row: &HandoverRow, now: DateTime<Utc>) -> bool   // expires_at < now
pub fn is_active(row: &HandoverRow, now: DateTime<Utc>) -> bool    // ouverte ET non expirée
pub fn is_holder(row: &HandoverRow, user_id: i64, poste_id: &str) -> bool
pub fn holder_of(row: &HandoverRow) -> Holder
pub fn expiration_closure(now: DateTime<Utc>) -> Closure
pub fn take(project_id: i64, user_id: i64, poste_id: &str,
            active: Option<&HandoverRow>, now: DateTime<Utc>) -> TakeDecision
pub fn heartbeat(active: Option<&HandoverRow>, user_id: i64, poste_id: &str,
                 now: DateTime<Utc>) -> HeartbeatDecision
pub fn return_project(active: Option<&HandoverRow>, user_id: i64, poste_id: &str,
                      now: DateTime<Utc>) -> ReturnDecision
pub fn force_return(active: Option<&HandoverRow>, role: &str, reason: &str,
                    now: DateTime<Utc>) -> ForceReturnDecision
```

Décisions, sans rien réécrire en base :

| Règle | Résultat |
|---|---|
| `take`, projet libre | `Take { row }`, échéance `now + 15 min` |
| `take`, même `user_id` + même `poste_id` | `Renew { renewal }` — **même `id`**, `heartbeat_at = now`, `expires_at = now + 15 min` |
| `take`, autre porteur non expiré | `Refused { holder, until }` — 409 + porteur + échéance |
| `take`, porteur expiré | `Replace { close, row }` — clôture `returned_at = now`, `returned_by = 'expiration'`, `return_reason = EXPIRATION_REASON`, `sync_at = NULL`, **puis** insertion |
| `heartbeat`, non-porteur | `Refused { NotHolder, holder, close: None }` |
| `heartbeat`, porteur expiré | `Refused { Expired, holder, close: Some(clôture d'expiration) }` |
| `heartbeat`, porteur actif | `Accepted { renewal }`, `expires_at = now + 15 min` (à partir du `now` fourni) |
| `return`, porteur actif | `Closed { id, closure }` : `returned_by = 'self'`, `sync_at = Some(now)` |
| `return`, non-porteur / rejoué | `Refused { NotHolder }` (aucune double clôture) |
| `return`, porteur expiré | `Refused { Expired, close: Some(expiration) }` |
| `force_return`, non-admin | `Refused { NotAdmin }` (403) |
| `force_return`, motif vide/espaces | `Refused { ReasonMissing }` |
| `force_return`, admin + motif | `Closed { id, closure }` : `returned_by = 'admin'`, motif recadré (`trim`) |

## 4. Tests (dans `handover.rs`, `#[cfg(test)]`, **sans base**)

Aucune variable d'environnement, aucune base : `Utc.with_ymd_and_hms(2026,1,1,9,0,0)`
sert d'origine, tout est décalé en minutes.

| Test | Ce qu'il prouve |
|---|---|
| `settings_match_the_owner_decisions` | 15 min, 3 min, motif d'expiration exact, 409 |
| `returned_by_matches_the_sql_check` | `self/expiration/admin` identiques au `CHECK` SQL, `parse` refuse le reste |
| `expiration_boundaries_are_strictly_before_expires_at` | juste avant `t(14)` actif ; **exactement à** `t(15)` actif (`expires_at < now` strict) ; `t(16)` expiré ; ligne clôturée jamais active |
| `take_on_a_free_project_inserts_one_row_for_fifteen_minutes` | PRISE : une ligne, `expires_at = now + 15 min` |
| `take_with_same_user_and_poste_renews_without_a_second_row` | RENOUVELLEMENT : même `id`, aucune seconde ligne |
| `take_by_another_user_on_a_live_hold_is_refused_with_holder_and_deadline` | REFUS 409 avec porteur (`user_id`, `poste_id`) et échéance |
| `take_by_another_user_after_expiry_replaces_the_expired_row` | REPRISE + valeurs de clôture exactes (`expiration`, motif figé, `sync_at = None`) |
| `take_ignores_a_closed_row_and_inserts_a_new_one` | une ligne clôturée n'est jamais un porteur en place |
| `heartbeat_by_the_active_holder_pushes_the_deadline_by_fifteen_minutes` | `expires_at = now + 15` (pas `expires_at + 15`) |
| `heartbeat_by_a_non_holder_is_refused` | autre compte, **autre machine du même compte**, projet libre → refus `NotHolder` |
| `heartbeat_by_an_expired_holder_is_refused_and_closes_the_row` | refus « expiré » + clôture paresseuse exacte |
| `return_by_the_active_holder_closes_the_row_and_sets_sync_at` | clôture `self` + `sync_at = now`, aucun motif imposé |
| `return_by_a_non_holder_is_refused` | refus avec le porteur réel |
| `return_replayed_is_refused_without_any_second_closure` | rejeu (projet libre **ou** ligne déjà clôturée) → refus, aucune double clôture |
| `return_by_an_expired_holder_is_refused_and_closes_with_expiration` | restitution trop tardive → refus + clôture d'expiration |
| `force_return_requires_an_admin_role` | `dev`, `standard`, vide, inconnu → `NotAdmin` (403) |
| `force_return_requires_a_non_empty_reason` | `""`, `"   "`, `"\n\t "` → `ReasonMissing` |
| `force_return_by_an_admin_closes_the_row_with_admin_and_the_reason` | `returned_by = 'admin'`, motif recadré, `sync_at = None` |
| `force_return_without_an_active_hold_is_refused` | aucune prise ouverte (ou ligne clôturée) → `NoActiveHolder` |
| `full_lifecycle_from_take_to_return` | prise → présence (échéance à 18) → reprise par B après expiration → restitution par B |

## 5. Commandes lancées et résultats exacts

```
$ cargo test -p gds-core --lib            # PILOT_GDS_TEST_URL absente (vérifié : '')
test result: ok. 132 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.18s

$ ./target/debug/deps/gds_core-*.exe handover
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 112 filtered out

$ cargo test -p gds-core --lib embedded_migration
test result: ok. 2 passed; ...                     # embedded_migrations_are_lf + versions triées

$ cargo build -p gds-server
Finished `dev` profile [unoptimized + debuginfo] target(s) in 6.82s

$ cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test: 722 passed, 1 ignored (1 suite, 10.98s)
```

Non lancé, volontairement : `npm test` (aucun fichier JS touché).

### 5 bis. Migration réellement embarquée

`gds_core::db::embedded_migration_versions()` (appelée depuis un binaire jetable
hors dépôt, supprimé ensuite) :

```
versions = [1, 2, 3, 4, 5, 6, 7, 8]
```

`db.rs` n'a **pas** été modifié : `sqlx::migrate!()` embarque le nouveau fichier
seul. Aucun test ne fige le nombre de migrations (vérifié : seul
`format_migration_versions(&[1, 2, 7])` cite des versions, en littéral d'entrée).

### 5 bis. Validation SQL sur une base réelle (jetable)

PostgreSQL 16 en conteneur jetable (`docker run --rm postgres:16-bookworm`),
`0001_init.sql` puis `0008_project_handover.sql` appliqués avec
`ON_ERROR_STOP=1` → **OK**, structure relue (`\d project_handovers`) conforme :
index partiel `UNIQUE btree (project_id) WHERE returned_at IS NULL`, deux `CHECK`
(`returned_by` + motif admin). Comportement vérifié :

| Cas | Résultat attendu | Obtenu |
|---|---|---|
| 1re prise | insérée | `INSERT 0 1` |
| 2e prise active du même projet | refusée par l'index | `duplicate key … project_handovers_active_key` |
| clôture `expiration` puis nouvelle prise | acceptée | `UPDATE 1` + `INSERT 0 1` |
| `returned_by = 'Autre'` | refusé | `violates check constraint project_handovers_returned_by_check` |
| `returned_by = 'admin'` sans motif | refusé | `violates … project_handovers_admin_reason_check` |
| `returned_by = 'admin'`, motif `'   '` | refusé | idem |
| `returned_by = 'admin'` + motif | accepté | `UPDATE 1` |
| `returned_by = 'self'` + `sync_at` | accepté | `UPDATE 1` (testé puis annulé) |

Conteneur arrêté et supprimé ensuite (`docker ps` → 0).

Suite rejouée **avec** `PILOT_GDS_TEST_URL` pointant sur ce conteneur :
`132 passed, 0 failed` (2.09 s), bases de test créées puis supprimées par les
tests, aucune base résiduelle.

## 6. Fins de ligne de la migration

```
$ file gds-core/migrations/0008_project_handover.sql
gds-core/migrations/0008_project_handover.sql: Unicode text, UTF-8 text
$ python -c "…d.count(b'\r')…"   → CR count: 0   LF count: 45
```

Aucun CR : `db::tests::embedded_migrations_are_lf` passe (exécuté ci-dessus).

## 7. Écarts, doutes et points à trancher (signalés, non corrigés seuls)

1. **`sync_at` d'une libération forcée** — le plan impose `sync_at` pour la
   restitution (`return`) et ne dit rien de `force_return`. Choix retenu :
   `sync_at = NULL` (aucune restitution volontaire n'a eu lieu, donc aucune
   poussée d'état d'avancement n'est attestée). Si le propriétaire veut que la
   ligne forcée porte aussi `sync_at = now`, c'est une ligne à changer dans
   `force_return` — à trancher à l'étape 2/3.
2. **Motif de la restitution par expiration** — `EXPIRATION_REASON` est une
   constante figée, écrite mot pour mot comme le plan. Toute reformulation du
   plan devra passer par cette constante (une seule source).
3. **`is_expired` ignore `returned_at`** — c'est la comparaison littérale
   `expires_at < now()` du plan ; les appelants doivent combiner avec
   `is_open()` / `is_active()` (fait partout dans le module). Documenté dans le
   code pour éviter un usage ambigu à l'étape 2.
4. **Renouvellement d'un porteur déjà expiré** — `take` par le **même**
   `user_id` + `poste_id` renouvelle, même si l'échéance est passée (idempotence
   « même machine »), au lieu de clôturer puis réinsérer. Le plan ne tranche pas
   ce cas précis ; aucun doublon n'est créé dans les deux lectures, mais c'est
   signalé.
5. **`http_status()` dans un module « pur »** — ajouté pour que l'étape 3 ne
   réinvente pas les codes (409 / 403 / 200). Retournable à volonté, sans effet
   de bord.
6. **`REFUSED_STATUS = 409`** pour un `heartbeat` / `return` hors portage : le
   plan ne fixe que le 409 du `take`. Choisi par cohérence ; une route de
   l'étape 3 peut préférer 403 pour « pas porteur » — à confirmer alors.
7. **Contrainte d'unicité non testée en concurrence réelle** : l'index partiel a
   été vérifié en séquentiel (deuxième prise refusée). Le test concurrent exigé
   par le plan (§7, décision D3) reste celui de l'**étape 2**, avec
   `PILOT_GDS_TEST_URL`.

## 8. Ce qui n'a pas été touché

`gds-core/src/db.rs`, `gds-core/src/http.rs`, `gds-server/*`, `src-tauri/*`,
tout fichier JS/CSS, toute spec et le plan. Aucune requête SQL, aucune route,
aucune transaction, aucun job planifié, aucune horloge lue.
