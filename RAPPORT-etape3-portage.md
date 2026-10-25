# Étape 3 — routes HTTP du portage d'un projet (mode réseau multi-postes)

> Périmètre : `gds-core/src/http.rs` uniquement (routes + handlers + tests).
> `handover.rs`, les migrations et les fonctions de `db.rs` de l'étape 2 n'ont
> **pas** été modifiées dans leur logique.

---

## 1. Routes exposées et protection

| Méthode | Route | Zone | Garde en amont | Rôle minimal |
|---|---|---|---|---|
| `POST` | `/api/gds/handover/take` | `gds_routes` | `auth_middleware` | tout compte authentifié (V1) |
| `POST` | `/api/gds/handover/heartbeat` | `gds_routes` | `auth_middleware` | tout compte authentifié (V1) |
| `POST` | `/api/gds/handover/return` | `gds_routes` | `auth_middleware` | tout compte authentifié (V1) |
| `GET` | `/api/gds/handover/state` | `gds_routes` | `auth_middleware` | tout compte authentifié (V1) |
| `POST` | `/api/gds/handover/force` | `admin_routes` | `auth_middleware` **puis** `require_admin` | `admin` |

Les quatre routes du membre sont montées **dans** `gds_routes` (donc derrière le
même middleware que le reste du socle, comportement inchangé) ; la libération
forcée est montée **dans** `admin_routes`, donc derrière `require_admin`
(un non-administrateur reçoit 403 + une ligne d'audit `admin_denied`).

Les handlers **ne re-décident rien** : ils valident l'entrée, appellent
`gds_db::handover_take` / `handover_heartbeat` / `handover_return` /
`handover_force_return` / `handover_state` (étape 2) et traduisent la décision
rendue par le module pur `crate::handover`. Les codes HTTP viennent
**exclusivement** de `http_status()` / `REFUSED_STATUS` (aucun code inventé, test
structurel dédié) ; aucun handler ne peut produire un 500 sur un refus métier ni
paniquer.

Réponses (état toujours relu après écriture, donc l'échéance affichée est celle
réellement enregistrée) :

| Cas | Code | Corps |
|---|---|---|
| `take` accepté | 200 | `{ ok, action: insert \| renew \| close_then_insert, state }` |
| `take` refusé (autre poste) | 409 | `{ error, project_id, holder, until }` |
| `heartbeat` accepté | 200 | `{ ok, state }` |
| `heartbeat`/`return` refusé | 409 | `{ error, project_id, holder }` |
| `return` accepté | 200 | `{ ok, id, state }` |
| `state` lu | 200 | `{ ok, state }` |
| `force` accepté | 200 | `{ ok, id, returned_by: admin, return_reason, state }` |
| `force` refusé (non-admin) | 403 | `{ error }` (garde `require_admin`) |
| `force` sans motif / sans prise en main | 409 | `{ error, project_id }` |
| `poste_id` vide/absent, `project_id` absent | 400 | `{ error }` (refus lisible, jamais une réjection brute) |
| session sans identité GDS (`user_id == 0`) | 403 | `{ error }` + audit `handover_denied` |
| `project_id` inconnu | 404 | `{ error }` (via `project_name_by_id`, existant) |

---

## 2. Ce qui est réellement testé

**Sans base (toujours exécuté, donc en CI) — 7 tests**

- `handover_poste_id_is_trimmed_and_never_empty` : validation pure (trim, vide).
- `handover_refusal_codes_come_from_the_module` : les refus prennent le code du
  module (409 / 403), jamais une constante locale.
- `handover_routes_are_mounted_in_the_right_zone` : contrôle structurel CRLF-safe
  (routes du membre dans `gds_routes`, `force` **uniquement** dans
  `admin_routes`, `http_status()` utilisé, pas de `StatusCode::CONFLICT` en dur).
- `handover_routes_require_a_valid_session` : les 5 routes → 401 sans jeton et
  avec un jeton inconnu (appels HTTP réels sur `server_router`).
- `handover_writes_reject_an_empty_poste_id` : `take`/`heartbeat`/`return` → 400
  sur `poste_id` vide **et** absent ; `state` → 400 sans `project_id`.
- `handover_writes_refuse_a_session_without_identity` : 403 + audit.
- `handover_force_route_is_reserved_to_administrators` : `force` → 403 pour un
  rôle `dev` (`require_admin`), alors que la route du membre jumelle n'est pas
  protégée de la même façon.

**Sur base jetable (`#[ignore]`, `--include-ignored`) — 1 test par route**

- `take` : prise (200 + état réel, `poste_id` stocké trimé), **refus 409** d'un
  autre poste (porteur + échéance annoncés), renouvellement du même couple
  compte+machine (`renew`, une seule ligne ouverte), 404 projet inconnu.
- `heartbeat` : porteur → 200 et échéance repoussée ; **non-porteur → 409**
  (`pas porteur du projet`) ; projet libre → 409 (aucun porteur).
- `return` : **non-porteur → 409** (rien n'est clôturé) ; porteur → 200, projet
  libre, clôture `self` avec `sync_at` ; seconde restitution → 409.
- `state` : libre, tenu, puis ligne laissée ouverte mais échue → `expired: true`
  sans aucune clôture (la lecture n'écrit jamais) ; projet inconnu → 404.
- `force` : non-admin → 403 (rien libéré) ; admin sans motif → 409
  (`motif de libération obligatoire`) ; admin avec motif → 200, `returned_by =
  admin`, motif recopié trimé, `sync_at` NULL ; plus rien à libérer → 409 ; les
  trois tentatives sont tracées (`handover.force_return`, 1 réussite + 2 refus).

Mécanisme de base réutilisé **tel quel** depuis l'étape 2 :
`db::tests::strict_handover_test_db()` (refus bruyant sans `PILOT_GDS_TEST_URL`,
garde stricte `pilot_gds_test_*`, une base par test), plus les helpers
`handover_fixture`, `open_handover_count`, `last_closed_handover`. Aucun second
mécanisme, aucun second helper créé. Les appels passent par le **vrai routeur du
service** (`server_router`) via `tower::ServiceExt::oneshot` : middleware
d'authentification et `require_admin` réellement traversés.

---

## 3. Exécution réelle (compteurs relevés)

PostgreSQL 16 jetable, port **55433** (le conteneur du propriétaire `pilot-gds`,
port 55432, n'a **pas** été touché) :

```
docker run -d --rm --name pilot-gds-test-e3 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=pilot_gds_test_local -p 55433:5432 postgres:16-alpine
# …preuve…, puis :
docker rm -f pilot-gds-test-e3
```

Tous les compteurs ci-dessous ont été **relevés dans la session de clôture**
(conteneur créé, tests lancés, conteneur supprimé ensuite) : aucun chiffre n'est
repris d'une session antérieure.

```
$ PILOT_GDS_TEST_URL="postgres://postgres:…@127.0.0.1:55433/pilot_gds_test_local" \
  cargo test -p gds-core --lib -- --include-ignored
EXÉCUTÉ : 150 passed ; 0 failed ; 0 ignored

$ cargo test -p gds-core --lib
EXÉCUTÉ : 139 passed ; 0 failed ; 11 ignored      (les 5 nouvelles routes sont ignorées sans base)

$ cargo test -p gds-server
EXÉCUTÉ : 34 passed ; 0 failed ; 0 ignored

$ cargo build -p gds-server
EXÉCUTÉ : OK (« Finished dev profile »)

$ cargo test --manifest-path src-tauri/Cargo.toml --lib   (anti-régression desktop)
EXÉCUTÉ : 722 passed ; 0 failed ; 1 ignored
```

Les 5 tests de routes ont aussi été lancés nommément (preuve individuelle) :

```
$ PILOT_GDS_TEST_URL=… cargo test -p gds-core --lib -- --include-ignored --exact \
  --test-threads=1 \
  http::tests::handover_take_route_accepts_a_free_project_and_refuses_another_poste \
  http::tests::handover_heartbeat_route_accepts_only_the_holder \
  http::tests::handover_return_route_closes_for_the_holder_only \
  http::tests::handover_state_route_reads_without_writing \
  http::tests::handover_force_route_requires_admin_and_a_reason
EXÉCUTÉ : 5 passed ; 0 failed ; 145 filtered out
```

Aucune compilation n'introduit de nouvel avertissement (le seul avertissement
restant est celui, préexistant, de `sqlx-postgres` signalé « future version of
Rust »).

---

## 4. Écarts et points à signaler

1. **V1 = tout compte authentifié.** Comme prévu par le plan §6 b, aucune
   restriction par projet n'est codée : tout compte authentifié peut prendre,
   garder ou restituer n'importe quel projet. C'est le comportement décidé pour
   la V1 (le point est noté ici, rien de plus n'a été codé).
2. **403 pour une session sans identité GDS** (`user_id == 0`, cas du mode
   remote du poste) : la table `project_handovers.user_id` référence
   `users(id)` ; sans ce refus explicite (même forme que
   `POST /api/gds/ssh-keys`), l'insertion produirait un 500 de clé étrangère.
   C'est le seul refus ajouté au-delà du module `handover` — signalé ici.
3. **Pas de rate limiting** sur les routes du portage : l'usage est déjà borné
   par la règle du module (présence toutes les 3 min, échéance 15 min) ; aucun
   compteur de requêtes n'a été ajouté (ce serait une restriction non demandée).
4. **404 pour un `project_id` inconnu** (le plan ne fixait pas ce code) : refus
   explicite plutôt qu'un 500, en réutilisant la lecture existante
   `project_name_by_id`.
5. **Audit volontairement partiel** : `take`, `return` et `force` sont tracés
   (réussite **et** refus) ; `heartbeat` et `state` ne le sont pas (un appel
   toutes les 3 minutes par projet saturerait le tampon de 500 entrées pour des
   actions non sensibles ; le plan n'exige une trace que pour la libération
   forcée). L'action `handover.force_return` a été ajoutée à
   `audit::admin_actions()` pour apparaître dans les filtres du journal.
6. **Fichiers touchés hors `http.rs`** (minimal, aucun changement de logique) :
   - `db.rs` : **uniquement** la visibilité de quatre helpers de test de l'étape
     2 (`pub(crate)` sur `strict_handover_test_db`, `handover_fixture`,
     `open_handover_count`, `last_closed_handover`) pour les réutiliser sans en
     dupliquer un seul — aucune fonction de production modifiée ;
   - `audit.rs` : une entrée dans la liste des actions d'administration ;
   - `Cargo.toml` (gds-core) : `tower` (`util`) en dev-dependency, pour appeler
     le routeur comme un vrai client HTTP ;
   - `Cargo.lock` : une ligne (dépendance de test).
   `handover.rs`, les migrations, `src-tauri/*`, JS/CSS, workflows, specs et
   plans n'ont pas été touchés.
7. **Le poste monte aussi `gds_routes`** : les quatre routes du membre sont donc
   également servies par le routeur du desktop (socle partagé, comportement
   attendu par le plan). `admin_routes` n'étant monté que par le service
   autonome, `POST /api/gds/handover/force` n'existe que sur `gds-server`.

VERDICT : conforme — les 5 routes du portage sont montées dans la bonne zone, protégées comme prévu, sans code de statut inventé ; 150 tests socle verts sur PostgreSQL jetable (dont 5 tests de routes exécutés nommément), 139 sans base, 34 tests serveur verts, build serveur OK, 722 tests desktop verts.
