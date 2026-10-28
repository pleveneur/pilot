# Rapport — Étape 2 : le portage en base (`gds-core/src/db.rs`)

> Chantier **mode réseau multi-postes** de Pilot. Plan de référence :
> `PLAN-mode-reseau-multipostes.md` (§6 a, §6 b, §7 étapes 1-2, décisions A1/A2
> et §11 D1→D7). Relecture : `RAPPORT-relecture-plan-reseau.md`.
> **Aucune décision ferme du §11 n'a été rouverte**, aucune spec, aucun plan,
> `plan_dev.md` ni `release.yml` n'ont été touchés.

## 0. Constat fait sur le disque AVANT d'écrire (écart avec la consigne)

| Point de la consigne | Réalité vérifiée |
|---|---|
| « committer l'étape 1 telle quelle » | **Déjà commitée** : `35bee91` — `feat(gds): portage d'un projet — migration 0008 et règles pures` (4 fichiers : `gds-core/migrations/0008_project_handover.sql`, `gds-core/src/handover.rs`, `gds-core/src/lib.rs`, `RAPPORT-etape1-portage.md`). `origin/main` est resté à `5a230eb` : **rien n'a été poussé**. |
| Défaut bloquant dans l'étape 1 ? | **Aucun**. `cargo test -p gds-core --lib` : **132 passed, 0 failed** (relevé avant toute modification). Le module pur ne lit ni horloge ni base, la migration est en LF, la table et l'index sont conformes au plan. Je n'ai donc **rien refait** : ni refonte, ni renommage, ni reformatage, ni `amend`, **aucun commit no-op**. |
| Base de test | Aucun binaire `psql`/`postgres` local. J'ai lancé le conteneur **jetable** prévu par `docs/gds-server-setup.md` §11 (`postgres:16`, port `55433`, base `pilot_gds_test_local`), puis l'ai **arrêté et supprimé**. |

## 1. Ce qui a été ajouté (et rien d'autre)

Tout est dans **`gds-core/src/db.rs`**, dans une section délimitée
« Portage d'un projet — la prise en main EN BASE ». **Aucune route HTTP, aucun
`http.rs`, aucun `gds-server/*`, aucun `src-tauri/*`, aucun JS/CSS, aucune autre
migration, aucun nouveau job CI.**

Imports ajoutés : `crate::handover`, `sqlx::postgres::PgRow`,
`sqlx::{Postgres, Transaction}`.

### Fonctions publiques (signatures exactes)

```rust
pub async fn handover_active_row(pool: &PgPool, project_id: i64)
    -> Result<Option<handover::HandoverRow>, String>;

pub async fn handover_take(pool: &PgPool, project_id: i64, user_id: i64, poste_id: &str)
    -> Result<handover::TakeDecision, String>;

pub async fn handover_heartbeat(pool: &PgPool, project_id: i64, user_id: i64, poste_id: &str)
    -> Result<handover::HeartbeatDecision, String>;

pub async fn handover_return(pool: &PgPool, project_id: i64, user_id: i64, poste_id: &str)
    -> Result<handover::ReturnDecision, String>;

pub async fn handover_force_return(pool: &PgPool, project_id: i64, role: &str, reason: &str)
    -> Result<handover::ForceReturnDecision, String>;

pub async fn handover_state(pool: &PgPool, project_id: i64)
    -> Result<HandoverState, String>;

pub struct HandoverState {          // sérialisable (route de l'étape 3)
    pub project_id: i64,
    pub open_row_id: Option<i64>,     // ligne ouverte, même expirée
    pub holder: Option<handover::Holder>, // Some seulement si ouverte ET valide
    pub taken_at: Option<DateTime<Utc>>,
    pub heartbeat_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
    pub expired: bool,
}
impl HandoverState { pub fn is_free(&self) -> bool; pub fn is_held(&self) -> bool; }
```

Fonctions privées : `handover_open_row_tx` (`… FOR UPDATE`),
`handover_insert_tx`, `handover_renew_tx`, `handover_close_open_tx`,
`handover_close_by_id_tx`, `handover_row_from_pg`, `handover_is_active_key_violation`,
`handover_take_conflict_outcome`. Constantes : `PG_UNIQUE_VIOLATION = "23505"`,
`HANDOVER_ACTIVE_INDEX = "project_handovers_active_key"`, `HANDOVER_COLUMNS`.

### Règles appliquées, une par une (aucune n'a été redécidée ici)

- **`take` — une seule transaction.** Ligne ouverte lue avec `FOR UPDATE`, puis
  `handover::take` **décide** ; le code ne fait que recopier sa décision :
  `Take` → insertion ; `Renew` → mise à jour de la ligne du **même**
  `(user_id, poste_id)` (`heartbeat_at`, `expires_at`), **même si l'échéance est
  passée** ; `Replace` → clôture de la ligne expirée (`returned_at`,
  `returned_by = 'expiration'`, `return_reason = handover::EXPIRATION_REASON`,
  `sync_at` **NULL**) **puis** insertion, dans la **même** transaction ;
  `Refused` → rien n'est écrit.
- **`heartbeat`** — `expires_at = now + 15 min` (`handover::HANDOVER_TTL_MINUTES`)
  et `heartbeat_at` mis à jour **seulement** si la ligne ouverte est celle du
  couple `(user_id, poste_id)` ; un non-porteur est refusé ; un porteur expiré
  est refusé **et** la ligne expirée est clôturée (écriture = moment de la
  clôture paresseuse).
- **`return`** — clôture avec `returned_by = 'self'` et **`sync_at = now()`** ;
  refus si l'appelant n'est pas le porteur ; une ligne déjà clôturée n'est jamais
  re-clôturée (aucune double clôture possible).
- **`force_return`** — **`admin` seul** (via `handover::force_return` →
  `roles::is_admin`), **motif obligatoire non vide**, `returned_by = 'admin'`,
  **`sync_at` laissé à NULL** (arbitrage de la mission, appliqué tel quel).
  L'écriture du journal d'audit `handover.force_return` **reste à l'étape 3**
  (route HTTP), comme l'annonce le module `handover` : le socle ne journalise pas.
- **Lecture d'état** — `handover_state` : libre/tenu, par qui, jusqu'à quand,
  expiré ou non. Évaluation **paresseuse** de `expires_at < now()`
  (`handover::is_expired`) et **zéro écriture** : une lecture ne clôture jamais.
  **Aucun job planifié, aucun balayage, aucun `DELETE`.**

## 2. Comment l'exclusivité est prouvée DANS LE CODE

1. **La base tranche, pas le code** : l'index unique partiel
   `project_handovers_active_key … WHERE returned_at IS NULL` (migration 0008)
   interdit deux lignes actives pour un projet.
2. **Aucune confiance dans « lire puis écrire »** : l'insertion est faite sans
   filet et un échec est **rattrapé**. `handover_is_active_key_violation` ne
   reconnaît que **SQLSTATE `23505` + contrainte
   `project_handovers_active_key`** (pas « n'importe quelle erreur base »).
3. **Rattrapage = refus ordinaire** : `handover_take_conflict_outcome` relit la
   ligne gagnante et renvoie le **refus déjà défini** par `crate::handover`
   (`TakeDecision::Refused { holder, until }`) — **même forme, même code, aucun
   code inventé, aucune panique, jamais un 500 trompeur**. Toute autre erreur est
   une vraie erreur technique (remontée telle quelle).
4. **La transaction ne laisse rien à moitié** : un échec d'écriture sort de la
   fonction sans `commit`, la transaction est annulée au `Drop` — pas de ligne
   clôturée suivie d'une insertion manquée.
5. Le verrou `FOR UPDATE` sérialise les écritures d'un projet **déjà tenu** ; pour
   un projet **libre** (aucune ligne à verrouiller), c'est l'index qui tranche —
   d'où les deux preuves ci-dessous.

## 3. Tests ajoutés (6, tous `#[ignore]`, tous honnêtes)

`#[ignore = "exige PostgreSQL (PILOT_GDS_TEST_URL) — docs/gds-server-setup.md §11"]`,
donc `cargo test -p gds-core --lib` reste **vert sans base**. **Aucun saut
silencieux** : la garde `strict_handover_test_db()` **échoue** avec le mode
d'emploi si `PILOT_GDS_TEST_URL` manque (décision D3 du plan §7).

| Test | Ce qu'il prouve réellement |
|---|---|
| `handover_two_concurrent_takes_leave_exactly_one_holder` | Deux prises **simultanées** (deux tâches tokio, comptes et postes différents) sur un projet libre : **exactement une** réussit, l'autre est un **refus** (jamais une erreur), **une seule** ligne ouverte, et le refus annonce le porteur et l'échéance réels. |
| `handover_take_rescues_a_lost_race_into_a_clean_refusal` | Course **déterministe** sur l'index : une session tient une insertion **non validée**, la prise publique est **réellement bloquée sur l'index** (prouvé par `pg_stat_activity`, `wait_event_type = 'Lock'`), puis la validation déclenche `23505` → **le chemin de rattrapage est exercé de bout en bout** et rend un refus propre. |
| `handover_active_index_is_enforced_by_the_database` | Preuve « index à nu » : deux `INSERT` directs, **hors de nos fonctions** → la base refuse le second avec `project_handovers_active_key` ; puis le rattrapage de cette erreur exacte rend le refus attendu. |
| `handover_take_closes_the_expired_row_then_reinserts` | Reprise après expiration : l'état est **expiré mais pas encore clôturé** (une lecture n'écrit pas) ; la prise suivante donne `Replace` (clôture `expiration` + insertion **même transaction**), **une** ligne ouverte, valeurs relues en base (`returned_by='expiration'`, motif = constante, `sync_at` NULL), **historique conservé** (2 lignes, aucune suppression). |
| `handover_return_frees_the_project_for_the_next_poste` | Non-porteur : `heartbeat` **et** `return` refusés sans toucher la ligne ; porteur : clôture `self` + `sync_at` non NULL ; **pas de double clôture** ; puis **reprise par un autre poste** et porteur affiché correct. |
| `handover_heartbeat_and_admin_force_return` | Présence repousse l'échéance du porteur seul ; libération forcée refusée au `dev` **et** sans motif (aucune clôture dans ces cas) ; acceptée à l'`admin` avec motif → `returned_by='admin'`, motif conservé, **`sync_at` NULL**, projet libre ensuite. |

## 4. Résultats RÉELS (base présente)

Conteneur jetable : `docker run … postgres:16` (port `55433`, base
`pilot_gds_test_local`), `PILOT_GDS_TEST_URL` exportée, puis conteneur
**arrêté et supprimé** (aucune base résiduelle : chaque test crée et supprime sa
propre base `pilot_gds_test_*`).

```
$ cargo test -p gds-core --lib                       # A) sans base
132 passed ; 6 ignored ; 0 failed                    # 1.19 s

$ PILOT_GDS_TEST_URL=… cargo test -p gds-core --lib -- --include-ignored
138 passed ; 0 failed ; 0 ignored                    # 2.24 s   (132 + 6)

$ cargo test -p gds-server                           # C)
34 passed ; 0 failed ; 0 ignored                     # 0.54 s

$ … -- --include-ignored handover_                   # stabilité, 6 exécutions
6 passed ; 0 failed (0.63 s / 0.66 s / 0.67 s /     # (5 des 6 tests avant
6 passed ; 0 failed (0.68 s …)                      # l'ajout du dernier)

$ cargo test -p gds-core --lib -- --include-ignored handover_   # SANS la variable
test result: FAILED. 0 passed; 6 failed              # « REFUS: … PILOT_GDS_TEST_URL … »
```

Autrement dit : **la base était présente**, les 6 tests ont **réellement** tourné,
et privés de base ils **échouent bruyamment** au lieu de passer pour verts.

Ce que la sonde (temporaire, retirée) a montré et qui est dit honnêtement : dans
`handover_two_concurrent_takes_…`, le perdant a toujours été départagé par la
**lecture** de la ligne déjà validée (jamais par `23505`) — l'ordre d'exécution
réel des deux tâches fait que la seconde voit le plus souvent la ligne gagnante.
C'est pourquoi le chemin **`23505` + rattrapage** est prouvé **déterministe** par
les deux autres tests, et non laissé au hasard de l'ordonnanceur.

## 5. CI (un seul ajout, strictement encadré)

`.github/workflows/gds-server-image.yml`, **job `tests` uniquement** :
`cargo test -p gds-core --lib` → `cargo test -p gds-core --lib -- --include-ignored`
(+ commentaire expliquant pourquoi). La base jetable du job était déjà en place
(décision A1). **Aucun autre job, aucun autre workflow touché** : `release.yml`
est intact (vérifié par `git status`).

## 6. Écarts, doutes, points signalés (non corrigés de mon propre chef)

1. **Étape 1 déjà commitée** (§0) : la consigne supposait un commit à créer ;
   il existait (`35bee91`). Rien n'a été recommité — **pas de commit no-op**, pas
   de `--amend`. Si le propriétaire voulait un commit unique regroupant les deux
   étapes, c'est un `squash` volontaire, **jamais** décidé par moi.
2. **`force_return` n'écrit pas l'audit** : `handover.force_return` dépend d'une
   identité de requête et d'un `audit_gds` qui appartiennent à la route (étape 3).
   Le socle ne journalise rien — dit dans le code et ici, pour que l'étape 3 ne
   l'oublie pas.
3. **`return` ne publie pas** : `sync_at` est **écrit** (preuve que la restitution
   volontaire a eu lieu), mais publication du code et poussée d'avancement sont
   l'affaire du poste (étape 4). Le socle ne fait aucun appel réseau sortant.
4. **Codes de refus** : j'ai réutilisé **uniquement** ceux de `handover`
   (`RefusalReason`, `ForceRefusalReason`) et je n'ai **pas** fixé de statut HTTP —
   c'est déjà `handover::http_status()` (409/403/200), utilisé par l'étape 3.
   Le doute signalé à l'étape 1 (§7.6 : 409 vs 403 pour « pas porteur ») reste
   ouvert, **sans effet ici** (aucune route).
5. **Tests `#[ignore]`** : choix imposé par la consigne (le `cargo test --lib` du
   poste reste vert sans PostgreSQL). Corollaire : un développeur qui lance
   `--include-ignored` **sans** base voit 6 échecs explicites — c'est voulu.
6. **Base de test locale** : le conteneur jetable de `docs/gds-server-setup.md` §11
   était arrêté/supprimé en fin de parcours ; aucune base `pilot_gds_test_*`
   résiduelle n'a été laissée.

## 7. Ce qui n'a PAS été touché

`gds-core/src/http.rs`, `gds-server/*`, `src-tauri/*`, tout JS/CSS,
`PLAN-mode-reseau-multipostes.md`, `plan_dev.md`, toutes les specs,
`release.yml`, les autres workflows. Aucune route, aucun job planifié, aucune
suppression de ligne d'historique, aucun `push`, aucun tag, aucune version.

---

VERDICT : étape 2 livrée et vérifiée — prise en main, présence, restitution et
libération forcée **en base**, exclusivité tenue par l'index unique partiel et
prouvée par trois tests (deux prises simultanées, course déterministe sur
`23505` avec rattrapage en refus propre, index vérifié à nu) ; étape 1 déjà
commitée (`35bee91`) et laissée intacte ; `cargo test -p gds-core --lib` vert
sans base (132 passed, 6 ignored) et **138 passed** avec base réelle
(`--include-ignored`) ; `cargo test -p gds-server` **34 passed** ; CI limitée au
job `tests` du workflow manuel de l'image serveur.
