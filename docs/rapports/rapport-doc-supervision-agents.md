# Rapport — mise à jour de la documentation « supervision des agents »

Mission : documentation seule (aucun fichier de code ni de test modifié).
Commits de référence : `77bce48`, `2bc627f`, `f8cb864`, `5f8254d`, `c8ad14c`.

## Comportement réellement vérifié dans le code (avant d'écrire)

| Point | Vérifié dans |
|---|---|
| Un outil EN COURS (`tool_in_progress`) exempte l'alerte d'anomalie | `src-tauri/src/anomaly.rs` (`should_report_silent_session`) |
| Un outil EN COURS exempte l'arrêt automatique T2 | `anomaly.rs` → `should_auto_stop_on_progress` (renvoie `false` si `tool_in_progress`) |
| Un outil EN COURS exempte la libération du créneau « occupé périmé » | `anomaly.rs` → `should_release_stale_busy` (`false` si `tool_in_progress`) |
| La sonde JS conclut « au travail » sans borne de temps pendant un outil | `src/js/exclusivity-queue.js` → `isSessionWorking` (`toolInProgress === true` → vrai, aucune fenêtre) |
| La sonde Rust conclut « occupé » sans borne de temps pendant un outil | `src-tauri/src/rpc.rs` → `SessionActivity.tool_in_progress` + `project_activity_is_busy` |
| La fenêtre de 25 min ne vise que l'état « occupé sans outil et sans nouvelle » | `anomaly.rs` (`stale_busy_grace_minutes`, défaut 25) + `STALE_BUSY_WINDOW_MS` (JS) |
| Le filet « processus mort » (issue #87) reste seul juge des cas figés | `anomaly.rs` → `has_dead_agent_process` |
| Le délai d'inactivité d'interface est un garde-fou distinct (10 min, `agents-bus.js`), reset à chaque événement d'agent | `agents-bus.js` (`DEFAULT_TIMEOUT_MS` = 600000, `resetTimeout`) ; réglage `agent_timeout_ms` par défaut 600000 dans `lib.rs` |
| Les arrêts de TOUR / manuels de l'onglet agent portent chacun un marqueur nommé `R3-EXCEPTION-MANUEL` (11 sites) | `src/js/agent-pi.js` + `target/rapport-correction3-marqueurs-arrets-onglet-agent.md` |

## Fichiers modifiés

### 1. `spec_anomaly.md`

**a) Bloc d'aide `<!-- HELP:anomaly -->` — paragraphe « Opération longue en cours »** (visible dans l'aide intégrée)

- Avant : « … cette protection est **bornée à 25 minutes** d'absence totale d'activité (au-delà, le process est considéré comme figé ; le délai d'inactivité côté interface peut alors mettre fin à la run sans tuer l'agent). »
- Après : « … l'agent est considéré comme en train de travailler — **un agent qui travaille n'est jamais arrêté au bout de 25 minutes, ni même au bout d'une heure**. L'alerte « agent bloqué » comme l'arrêt automatique (T2) sont suspendus, et son créneau de run n'est ni libéré ni pris par une autre demande. Les fenêtres de temps (25 minutes) ne concernent qu'un agent **sans aucun outil en cours et sans nouvelle** : c'est celui-là, réellement figé, qui est signalé et arrêté. »

**b) Bloc d'aide `<!-- HELP:anomaly -->` — paragraphe « Verrou de run fantôme (busy-stale) »**

- Avant : « … reste marqué actif (process pi figé) sans activité depuis **25 minutes** … »
- Après : « … reste marqué actif (process pi figé) **sans aucun outil en cours** et sans activité depuis **25 minutes** … Un agent dont un outil tourne n'est jamais concerné, quelle que soit la durée de l'opération. »

**c) § 2.3 — paragraphe « Nuance — une opération longue et silencieuse n'est pas protégée partout »**

- Avant : affirmait que la pause ne valait que pour T2, et qu'au bout de 25 min le filet busy-stale libérait quand même le créneau (donc « une opération longue n'est jamais coupée » était jugé inexact).
- Après : « **Nuance — le seul plafond restant est l'inactivité, jamais le travail** » : les quatre garde-fous (anomalie, T2, busy-stale, session muette) et les deux sondes (`isSessionWorking`, `project_activity_is_busy`) partagent la même exemption, jamais bornée par le temps ; la fenêtre de 25 min ne vise qu'un agent sans outil et sans nouvelle ; le délai d'inactivité d'interface reste un garde-fou distinct, et le disque est vérifié avant tout verdict d'échec.

**d) § 2.4 — nouveau paragraphe d'ouverture « Une opération d'outil EN COURS exclut la libération »**

- Ajout (absente auparavant) : `should_release_stale_busy` renvoie `false` tant que `tool_in_progress` est posé ; sans cette exemption le créneau d'un agent vivant était libéré, son tour mis en échec et **une seconde mission pouvait démarrer** sur le même projet ; le filet « processus mort » reste le seul juge des cas réellement figés.
- Formulation de l'introduction du filet ajustée en conséquence (« Le même moniteur implémente ce filet AUTORITAIRE … »).

**e) § 2.4 ter — angle mort n° 1**

- Avant : « … traité comme du travail, **borné** par la fenêtre busy-stale (25 min : process figé). »
- Après : « … traité comme du travail, **sans aucune borne de durée** … Seule la **mort** de la session lève ce constat. » + mention du pendant côté moteur (`SessionActivity.tool_in_progress`, `project_activity_is_busy`), sans quoi le projet était déclaré « libre » au bout de 25 minutes.

**f) § 5 — bullet « Correctif « opération longue » couvert par les tests »**

- Avant : ne citait que `should_auto_stop_on_progress`.
- Après : cite aussi `should_release_stale_busy` et les deux sondes (`isSessionWorking`, `project_activity_is_busy`), « sans borne de temps ».

**g) § 5 — bullet « Ne casse pas … »**

- « … ni le filet busy-stale (25 min, sans kill) » → « … (25 min, sans kill, **jamais pendant un outil en cours**) ».

### 2. `spec_multiprojects.md` — § 7 « Indicateur d'activité par projet », sous-bullet « Fenêtre de grâce anti-flicker »

- Avant : un projet reste occupé « tant que `busy` OU qu'une activité RPC récente (15 s) — voir `make_project_activity_observer` ».
- Après : « tant que `busy` (non périmé) OU qu'une activité RPC récente OU qu'un **outil est en cours** (`SessionActivity.tool_in_progress`, posé sur `tool_execution_start`, levé sur `tool_execution_end` et à l'arrêt) — voir l'observateur combiné (`anomaly::make_observer`, qui remplace l'ancien `make_project_activity_observer`) et `get_project_agent_states`. Un build ou une campagne de tests silencieuse garde donc la pastille allumée, **sans borne de temps** … `reset_project_activity` recule `updated` et efface `tool_in_progress`. »
- Raison : la pastille serait passée « en attente » pendant un outil long, et la fonction citée n'existe plus.

### 3. `spec_super_agent.md` — Règle 3, bullet « Verrou anti-régression »

- Avant : les arrêts de TOUR de l'onglet agent « sont **comptés et documentés** mais non tracés ».
- Après : ils ne sont pas tracés mais « **chacun d'eux porte son propre marqueur nommé** (`R3-EXCEPTION-MANUEL`, commentaire accolé à l'appel, disant de quel arrêt il s'agit) : onze sites à ce jour, au lieu d'un simple compteur. La règle est donc : **tout arrêt de ce fichier est soit tracé avec son motif, soit déclaré manuel par son marqueur** — un site muet fait échouer le contrôle, et un marqueur retiré aussi (le nombre de marqueurs est épinglé séparément du nombre de sites). »

### 4. `help/handbook.md` (GÉNÉRÉ — jamais édité à la main)

Régénéré par `npm run build:handbook` : seules les réécritures du bloc `HELP:anomaly` et du bloc Règle 3 (`super-agent-tracabilite`) y apparaissent (21 insertions / 13 suppressions). Aucune autre section du handbook n'a changé.

## Fichiers vérifiés et NON modifiés

- `spec_pilot.md`, `spec_gds.md` : aucune occurrence de la fenêtre de 25 min ni d'affirmation sur l'agent « qui travaille » devenue fausse → pas touchés.
- `spec_dashboard.md` (§ Supervision des agents P8) : déjà à jour (`toolInProgress` exposé par `get_agent_supervision`, `isAgentWorking` / `isWorkingWithoutTab`) → pas touché.
- `spec_gestion_agents.md` (l. 37 « Chaque arrêt automatique laisse une trace ») : reste exact (il ne parle que des arrêts **automatiques**) → pas touché.
- `spec_super_agent.md` (l. ~457, « outil long et silencieux ne disparaît jamais ») : reste exact → pas touché.

## Doutes / observations consignées (hors périmètre, non modifiées)

1. `spec_gestion_agents.md` et le bloc d'aide « Suivre et arrêter » annoncent un **timeout d'inactivité de 5 min par défaut** ; le code utilise `agent_timeout_ms` = **600000 ms (10 min)** par défaut (`lib.rs`, `settings.js`). Cette inexactitude est **antérieure** aux commits de cette série et n'a pas été introduite par eux : non corrigée ici pour rester strictement dans le périmètre (« corriger ce qui est *devenu* faux »), à traiter dans une passe dédiée.
2. Le délai d'inactivité d'interface (`agents-bus.js`) reste un plafond de **silence** : il est remis à zéro à chaque événement d'agent (dont les mises à jour d'exécution d'outil), et un déclenchement vérifie désormais le disque avant tout verdict d'échec. La documentation ne prétend donc pas qu'il est supprimé pendant un outil : elle indique seulement qu'il est un garde-fou distinct, qui ne conclut jamais à l'échec sans vérifier le travail écrit.

## Vérifications

- `npm test` → **120 fichiers, 2052 tests, tous verts** (dont les contrôles d'ancres documentaires et de contenu de l'aide).
- `npm run build` → **succès** (avertissements Vite préexistants sur les chunks).
- `npm run build:handbook` → 42 blocs, handbook régénéré.
- Aucun fichier de code ou de test modifié (`git status` : `spec_anomaly.md`, `spec_multiprojects.md`, `spec_super_agent.md`, `help/handbook.md` uniquement).
