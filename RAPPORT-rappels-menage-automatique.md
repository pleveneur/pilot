# Rapport — ménage automatique des rappels de l'Assistant

> Statut : **terminé**. Ce rapport a été écrit AVANT l'analyse et complété au fil
> du travail (étapes 0 → 5 de la mission). Il reste lisible à tout moment.

---

## 0. Cadre

- Version : Pilot 0.4.45.
- Problème : **325 rappels programmés** accumulés dans l'Assistant, beaucoup
  désactivés ou périmés. Le commit `d26717e` a corrigé la **rafale** (987
  relances échues injectées en une seconde), mais **le tas reste** : rien ne
  purge jamais les rappels devenus inutiles.
- Demande du propriétaire (accord explicite) : « il faut faire quelque chose pour
  que ces rappels se purgent automatiquement au fur et à mesure quand ils ne
  sont plus utiles ».
- Livrable : un **ménage automatique** (au plus une fois par jour) + un bouton
  **« Supprimer les rappels inutiles »**, la décision étant écrite à **un seul
  endroit** (module pur `src/js/super-agent-schedule-cleanup.js`).

---

## 1. Faits établis (preuves `fichier:ligne`)

> Les références de cette section décrivent l'**état AVANT modification** : la
> lecture a été faite avant d'écrire une seule ligne. Depuis, `super_agent.rs` a
> grossi de ~466 lignes (ajouts, aucun déplacement) — les numéros cités restent
> donc lisibles en soustrayant les ajouts, et les références **après** modification
> sont données aux § 2 et 4.

### 1.1 Où vivent les rappels

| Fait | Preuve |
|---|---|
| Table `assistant_schedules` : `id`, `name` (UNIQUE), `prompt`, `every` (secondes), `enabled` (0/1), `last_run_at` (NULL = jamais exécuté), `created_at`, `updated_at` | `src-tauri/src/super_agent.rs:101-110` |
| Base : `~/.pilot/super-agent.db` | `spec_super_agent.md:1334` |
| **Aucune** colonne « une seule fois » (tout rappel est périodique), **aucune** colonne d'historique d'exécution | schéma ci-dessus (`:101-110`) ; aucun `ALTER TABLE assistant_schedules` ailleurs (`ensure_column` n'était utilisé que pour `tasks` / `session_summaries`, `:171-190`) |

### 1.2 Création

| Fait | Preuve |
|---|---|
| `schedule_insert(conn, name, prompt, every)` : valide nom/prompt non vides, `every >= 60 s`, **plafond de 20 rappels ACTIFS** (`COUNT(*) WHERE enabled = 1`), puis `INSERT … created_at = datetime('now')` | `src-tauri/src/super_agent.rs:1058-1108` (plafond `:1078-1090`) |
| Message de refus actuel : « schedule : maximum 20 planifications atteint » (sans liste de candidats) | `src-tauri/src/super_agent.rs:1086-1089` |
| Commande Tauri `super_agent_schedule_create` (fréquence par défaut = réglage « Fréquence des rappels de surveillance ») | `src-tauri/src/super_agent.rs:1248-1270` |
| Outil de l'Assistant `schedule_create` (sentinel `PILOT_ASSISTANT_SCHEDULE::`, dispatch côté `super-agent.js`) | `src-tauri/extensions/pilot-assistant-schedule.ts:44-76` ; `src/js/super-agent.js:5715-5751` |

### 1.3 Lecture / livraison

| Fait | Preuve |
|---|---|
| Échéance = `datetime(COALESCE(last_run_at, created_at), '+every seconds')` | `src-tauri/src/super_agent.rs:1199-1228` (`schedule_due`), `:1161-1193` (`schedule_next_fire_at` / `schedule_next_fire`) |
| Le tick ne marque **plus** `last_run_at` : marquage différé après **livraison effective** | `src-tauri/src/super_agent.rs:1218-1228` (commentaire) ; `:1230-1238` (`schedule_mark_done`) |
| Ticker frontend toutes les 10 s, injection `[⏰ Rappel programmé] …` puis `super_agent_schedule_mark_done` | `src/js/super-agent.js:3957-3990` (tick), `:4000-4020` (injection + marquage) |
| Correctif `d26717e` : **une seule relance par passe** + pas d'injection au démarrage tant que le propriétaire n'a pas écrit (`ownerEngagedThisSession`) | `src/js/super-agent-schedule.js:28-70` (`planDueReminderInjections`) ; `src/js/super-agent.js:3972-3980`, `:3982-4008` |

### 1.4 Activation / désactivation / suppression

| Fait | Preuve |
|---|---|
| `schedule_set_enabled` : `UPDATE … SET enabled = ?, updated_at = datetime('now')` (ne supprime pas) | `src-tauri/src/super_agent.rs:1121-1130` ; commande `:1281-1287` |
| `schedule_delete` : `DELETE FROM assistant_schedules WHERE id = ?` | `src-tauri/src/super_agent.rs:1111-1118` ; commande `:1273-1279` |
| Outils `schedule_set_enabled` / `schedule_delete` / `schedule_list` de l'Assistant | `src-tauri/extensions/pilot-assistant-schedule.ts:99-157` |

### 1.5 Journal existant (à réutiliser, ne pas en créer un second)

| Fait | Preuve |
|---|---|
| Table journal `injection_logs (id, project_id, status, ok, detail, created_at)` — journal d'audit de l'Assistant, exporté avec le suivi | `src-tauri/src/super_agent.rs:89-98` (schéma), `:4073-4078` (`log_injection`), `:5811-5837` (export) |

### 1.6 Écran des rappels (là où va le bouton)

| Fait | Preuve |
|---|---|
| Réglage « Fréquence des rappels de surveillance » + compteur « n sur 20 rappels de surveillance actifs » | `index.html:1006-1018` ; `src/js/settings.js:226-258` (compteur), `:674-675`, `:1532-1534` (rafraîchissement) |
| Aucun autre écran de gestion des rappels n'existe (aucune liste éditable) | aucune occurrence de liste de rappels dans `src/js/` hors `settings.js` |

### 1.7 Ce que `d26717e` a déjà changé (à ne pas casser)

`planDueReminderInjections` (`super-agent-schedule.js:28-70`) : (1) pas
d'injection au démarrage sans réglage/engagement du propriétaire, (2) **une
seule** relance par passe, les autres restant **dues** (jamais marquées). Le
ménage ajouté ici est **orthogonal** : il ne décide jamais d'injecter, il ne
touche pas `ownerEngagedThisSession` ni `pendingReminderIds`. Il ne modifie pas
non plus la référence d'échéance.

---

## 2. Décisions de conception (application des règles tranchées)

### 2.1 Où vit la décision

**Un seul endroit** : `src/js/super-agent-schedule-cleanup.js` (module pur, aucune
I/O, aucune dépendance Tauri).

| Élément | Rôle | Preuve |
|---|---|---|
| `classifyScheduleCleanupItem(rappel, now)` | classe **un** rappel : `delete` / `disable` / `keep` + motif + date de référence | `:101-165` |
| `classifyScheduleCleanup({schedules, now, lastCleanupAt, enforceDailyGuard})` | construit le **plan** (`run`, `delete[]`, `disable[]`, `keep[]`, `skippedReason`) et applique la limite journalière | `:184-214` |
| `scheduleCapReached` | miroir du plafond (20 actifs) | `:222-226` |
| `formatCleanupCandidate`, `cleanupConfirmationText` | libellé d'une ligne + texte annoncé **avant** action (le **nombre** d'abord) | `:229-269` |
| `cleanupApplyPayload` | charge utile minimale `{deletions, disables}` = `{id, name, reason}` | `:274-281` |

Seuils constants (mêmes valeurs pour les deux déclencheurs) :
`CLEANUP_DISABLED_STALE_DAYS = 30` (`:44`), `CLEANUP_ONE_SHOT_GRACE_DAYS = 30`
(`:46`), `CLEANUP_STERILE_RUNS = 20` (`:48`), `CLEANUP_MAX_ACTIVE = 20` (`:50`),
`CLEANUP_MIN_INTERVAL_MS = 24 h` (`:52`).

### 2.2 Les six règles, telles qu'implémentées

1. **Désactivé + périmé** : référence = `last_run_at` s'il existe, sinon
   `created_at` (rappel jamais exécuté) ; écart > 30 j → `delete`
   (`super-agent-schedule-cleanup.js:143-150`).
2. **Rappel unique déjà consommé** : échéance FIXE = `created_at + every` ;
   dépassée de > 30 j → `delete` (`:126-141`). Testée **avant** la règle 1 (un
   unique livré est désactivé automatiquement, il serait sinon classé
   « désactivé périmé »).
3. **Périodique stérile** : actif, `sterile_runs >= 20` → `disable` (**jamais**
   `delete`, le rappel reste réactivable) (`:157-161`).
4. **Plafond 20** : la création reste refusée au-delà de 20 actifs, mais le refus
   devient **actionnable** — `schedule_cap_message` liste les candidats, du plus
   ancien au plus récent, et indique les deux gestes possibles (suppression
   ciblée, ou bouton des Paramètres) : `super_agent.rs:1153-1186`, appelé par
   `schedule_insert_with` (`:1094-1145`).
5. **Au plus un ménage par jour** : `assistant_meta.schedule_cleanup_at`
   (`super_agent.rs:116`, clé `:1041`), garde appliquée par
   `classifyScheduleCleanup` (`:190-200`) **et** datée par le backend après
   application (`schedule_cleanup_apply`, `:1406-1467`). Chaque rappel traité
   écrit **une ligne** dans `injection_logs` (statut `menage-rappel`, `:1044`) via
   le `log_injection` existant : aucun second journal.
6. **Garde-fous** : un rappel actif récent, un unique à échéance future jamais
   exécuté, et tout rappel inclassable (id/nom/date/fréquence inexploitables,
   `enabled` ambigu) sont `keep`, avec un motif explicite (« conservé par
   précaution ») — `:102-127`, `:152-164`.

### 2.3 Mesure de l'utilité d'un rappel (pour la règle 3)

Deux colonnes **additives** (aucune donnée existante modifiée, défauts `0`) :
`assistant_schedules.one_shot` et `assistant_schedules.sterile_runs`
(`super_agent.rs`, `ensure_column`).

- `schedule_note_run(conn, id, detected)` : `sterile_runs = 0` si une détection a
  eu lieu, sinon `+1` (`:1325-1335`).
- Côté front, la sonde est posée **uniquement** autour d'une injection de rappel
  (`super-agent.js:3983`, `:4023`) : chaque appel d'outil du tour déclenché compte
  comme une détection (`:4361`), et si le tour ne se termine pas proprement
  (`shouldFinalizeOnAgentEnd` faux, relance technique) **rien n'est compté**
  (`:4456-4457`) — « en cas de doute, on garde ».
- `schedule_mark_done` désactive désormais un rappel unique à sa livraison
  (`enabled = CASE WHEN one_shot = 1 THEN 0 ELSE enabled END`) : un unique ne se
  relance plus indéfiniment, et les périodiques gardent leur comportement
  (aucune régression sur `d26717e`).

### 2.4 Ce qui n'est **pas** touché (non-régression `d26717e`)

`planDueReminderInjections`, `ownerEngagedThisSession`, `pendingReminderIds`, la
référence d'échéance (`COALESCE(last_run_at, created_at)`), le rythme du tick
(10 s) et la règle « une seule relance par passe » sont **inchangés**. Le ménage
ne décide jamais d'injecter : il ne lit que l'état des rappels.

---

## 3. Le geste manuel

- **Emplacement** : Paramètres ⚙️ → onglet **Assistant**, sous le compteur
  « n sur 20 rappels de surveillance actifs » — c'est le seul écran des rappels
  qui existe (cf. § 1.6). Bouton
  `index.html:1020` + ligne de compte rendu `:1021`.
- **Mêmes règles** : `runScheduleCleanup` (`settings.js:323-…`) appelle
  `super_agent_schedule_cleanup_state`, puis `classifyScheduleCleanup` avec
  `enforceDailyGuard: false` (geste immédiat du propriétaire : mêmes règles de
  **contenu**, sans attendre les 24 h). Le **nombre** est annoncé avant toute
action (§ 3.1), puis `super_agent_schedule_cleanup_apply` reçoit **le plan déjà
décidé** — le backend n'invente aucun motif.
- **Aucun second chemin d'écriture** : le ménage automatique
  (`super-agent.js:4068` `maybeAutoCleanupSchedules`) et le bouton utilisent la
  **même** commande `super_agent_schedule_cleanup_apply`.
- **Plafond côté Paramètres** : `SCHEDULE_MAX_ACTIVE` n'est plus recopié, il est
  **importé** de `CLEANUP_MAX_ACTIVE` (`settings.js:242`).

### 3.1 Annonce du nombre avant confirmation

`confirmScheduleCleanupDialog` (`settings.js:279-…`) remplace `window.confirm`,
**inopérant dans la WebView2 de Tauri 2** (il renvoie toujours `false` sans rien
afficher) : c'est un dialogue `modal-overlay` / `modal-dialog` comme le reste de
Pilot, dont le corps est inséré en `textContent` (les noms de rappels viennent de
la base : aucun HTML interprété). Le titre porte le **nombre**
(« Rappels inutiles : 12 ») et le corps reprend `cleanupConfirmationText` :
« 12 rappels seront supprimés : … » puis la liste « — nom : motif », du plus
ancien au plus récent. Annuler ne modifie **rien**.

---

## 4. Preuves de test

### 4.1 Tests ajoutés

- `src/js/super-agent-schedule-cleanup.test.js` : **31 tests**, sur des cas
  réels (date de référence fixe `2026-03-01T12:00:00Z`, aucune dépendance à
  l'heure d'exécution) :
  - lecture des dates SQLite (`datetime('now')` = UTC, ISO, nombre, `Date`) et
    refus des valeurs illisibles ;
  - règles 1, 2, 3 avec seuils exacts (29 j conservé / 31 j supprimé ; 19
    exécutions stériles conservé / 20 désactivé ; unique futur conservé) ;
  - garde-fous (rappel actif récent, jamais exécuté récent, **10 formes
    d'inclassables**) ;
  - règle 5 (rien si < 24 h, action si > 24 h, premier ménage, geste manuel
    immédiat) ;
  - règle 4 (plafond 20, désactivés non comptés, **constante vérifiée contre
    `SCHEDULE_MAX` de `super_agent.rs`**) ;
  - ordre « du plus ancien au plus récent », libellés, annonce du **nombre**,
    forme de la charge utile (`id/name/reason` uniquement) ;
  - **verrous de branchement** : le ménage automatique et le bouton utilisent la
    même décision, le bouton existe dans l'écran des rappels, les trois commandes
    sont enregistrées dans `lib.rs`, et **aucune** table de journal parallèle
    n'existe.
- `src-tauri/src/super_agent.rs` (`mod tests`) : **6 tests** ajoutés —
  `schedule_cap_message_lists_candidates_oldest_first_and_only_counts_active`,
  `schedule_one_shot_is_consumed_and_auto_disabled_after_delivery`,
  `schedule_note_run_counts_sterile_runs_and_resets_on_detection`,
  `schedule_cleanup_state_exposes_the_fields_the_decision_needs`,
  `schedule_cleanup_apply_journals_every_item_once_in_the_existing_log`,
  `schedule_cleanup_meta_store_is_idempotent`.

### 4.2 Test de neutralisation / restauration (exigé)

**Test choisi** : « seuil exact : 29 jours conservé, 31 jours supprimé »
(`super-agent-schedule-cleanup.test.js`), c'est-à-dire la règle 1 elle-même.

**Neutralisation** : `CLEANUP_DISABLED_STALE_DAYS` passé de `30` à `3000`
(`super-agent-schedule-cleanup.js:44`, une seule ligne, aucun autre changement).
Résultat mesuré : **6 tests en échec sur 31** (`PASS (25) FAIL (6)`), nommément :
1. `seuil exact : 29 jours conservé, 31 jours supprimé (aucune décision « au hasard »)`
2. `agit dès que le dernier ménage a plus de 24 h`
3. `le geste MANUEL n'attend pas 24 h (mêmes règles de contenu, sans la limite de fréquence)`
4. `ordonne les suppressions du plus ancien au plus récent`
5. `annonce le nombre de rappels supprimés ET de rappels désactivés`
6. `la charge utile d'application ne transporte que id/nom/motif (aucune autre décision)`

**Restauration** (`30`) : **31/31 verts** (`PASS (31) FAIL (0)`). Les tests
échouent donc bien **sans** le correctif et passent **avec**.

### 4.3 Résultats des suites complètes (chiffres réels)

| Suite | Commande | Résultat |
|---|---|---|
| Frontend | `npm test` | **159 fichiers, 2731 tests passés, 0 échec** (dont 31 pour le ménage) |
| Rust (desktop) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **714 passés, 1 ignoré, 0 échec** (dont 21 tests `schedule*`) |
| Build front | `npm run build` | ✅ (avertissements de découpage de chunks préexistants, aucune erreur) |
| Aide intégrée | `npm run build:handbook` | ✅ 45 blocs, 248 605 octets — **rejoué en fin de tâche** : sortie identique (idempotent) |

---

## 5. Tests, documentation, commit

### 5.1 Documentation mise à jour

| Fichier | Contenu |
|---|---|
| `spec_super_agent.md` | nouvelle section **« Ménage des rappels inutiles (automatique + bouton) »** (6 règles, garde-fous, journal, stockage) ; garde-fou du plafond renvoyant vers elle ; section Paramètres : compteur + bouton |
| `help/handbook.md` | **régénéré** par `npm run build:handbook` (45 blocs, 248 605 octets) — la nouvelle section est dans le bloc `super-agent`, donc dans l'aide ❓ |
| `README.md` | une puce dans « Paramètres (modale ⚙️) » : le bouton et l'annonce du nombre avant confirmation |

### 5.2 Commit

Un **seul** commit local, `feat(rappels): menage automatique des rappels inutiles et plafond de 20`,
couvrant :

- le module de décision + ses tests (`src/js/super-agent-schedule-cleanup.js`,
  `src/js/super-agent-schedule-cleanup.test.js`) ;
- ses branchements (`src/js/super-agent.js`, `src/js/settings.js`, `index.html`) ;
- le backend (`src-tauri/src/super_agent.rs`, `src-tauri/src/lib.rs`) ;
- l'outil de l'extension (`src-tauri/extensions/pilot-assistant-schedule.ts`) ;
- la documentation (`spec_super_agent.md`, `help/handbook.md` régénéré,
  `README.md`) ;
- ce rapport.

Aucun bump de version, aucun tag, aucune publication, aucune exécution de
l'application. Les autres rapports du dépôt ne sont pas modifiés.

### 5.3 Ce qui reste ouvert (honnêteté)

- Le compteur « n sur 20 » des Paramètres ne liste pas les rappels : le bouton
  annonce le nombre et les noms **dans la confirmation**, il n'ajoute pas de vue
  de gestion (hors périmètre de cette micro-tâche).
- L'utilité d'un rappel est mesurée par « le tour déclenché appelle au moins un
  outil ». Un rappel qui répond en texte seul sans outil sera compté stérile :
  c'est pourquoi la règle 3 **désactive** (réactivable) au lieu de supprimer.
- Aucun test n'a été exécuté dans l'application elle-même (interdiction de la
  lancer) : les preuves sont celles des suites de tests et du build.
