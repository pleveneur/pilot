# Fiche de référence — Pilot

- **Date de vérification** : 2026-10-21, à **09:05** (heure locale de la machine) — **état final**
  de la journée, relu après les correctifs **P1 / P2 / P3** et après la mise en cohérence de la
  documentation (§5).
- **Commit examiné** : `275eb04` (`fix(file-attente): une seule identité de projet pour les files
  et les verrous`), branche `main`, **5 commits en avance** sur `origin/main` (`3c67064`).
- **Nature** : lecture seule côté code. Les seuls fichiers écrits sont de la **documentation**
  (`spec_super_agent.md`, `spec_gestion_agents.md`, `help/handbook.md` régénéré, ce document et
  `rapport-doc-finale.md`). Aucun code, aucune configuration, aucune version modifiés.
- **Méthode** : chaque affirmation est adossée à un fichier + une ligne, ou à une valeur réellement
  lue sur le disque. Quand la preuve manque, c'est écrit « non prouvé ».
- **Rapports de vérification du même jour réutilisés** (aucune duplication de travail) :
  `rapport-delai-inactivite.md`, `rapport-file-attente-pertes-doublons.md`, `rapport-relecture-file.md`,
  `rapport-relecture-finale.md` (verdict **PUBLIABLE**, 2 réserves non bloquantes), `rapport-doc-finale.md`
  (mise en cohérence de la documentation). **Un point du premier rapport est faux** et corrigé ici
  (§5, ligne C4).

> **Mise à jour du 2026-10-21 — publications de la 0.4.36 puis de la 0.4.37.** La version
> **0.4.36** a été publiée (tag `v0.4.36` = `e151a1e`), puis la version **0.4.37**
> (tag `v0.4.37` = `b1b62cb`, release en ligne, `latest.json` en 0.4.37, entrée Windows
> pointant l'**installateur NSIS signé** et non le MSI). Tout ce qui suit décrit l'état
> **avant** ces publications : les mentions « 0.4.36 non commencée », « version 0.4.35
> dans les quatre fichiers » et « 5 commits non poussés » sont donc **périmées**. Détail
> des étapes et réserve connue (aucun installateur Linux) : `rapport-publication-0.4.36.md`
> et `rapport-publication-0.4.37.md`.

---

## 0. VERDICT (à lire en premier)

| Question posée | Réponse vérifiée |
|---|---|
| Version déclarée | **0.4.35** dans les quatre fichiers de version, cohérente avec le tag `v0.4.35` (`3c67064`). **Rien n'a été publié pour 0.4.36** : aucune version n'est encore incrémentée, la préparation reste à faire. |
| Dépôt local | **5 commits non poussés** (`8aa8f0d`, `13f7552`, `9031b37`, `4cf5356`, `275eb04`) + la documentation du jour, et **6 fichiers non suivis**. Poussé : `origin/main` = `3c67064` (v0.4.35, taguée). |
| Correctifs du jour | **P1** ordre d'arrivée respecté à l'admission (`4cf5356`) ; **P2** un arrêt d'agent ne détruit plus une file de missions (`13f7552`) ; **P3** une seule identité de projet (`275eb04`). **Aucun n'est dans la version publiée.** |
| Délai d'inactivité réel par défaut | **600 000 ms = 10 min** (`agent_timeout_ms`). |
| Délai réellement configuré sur **cette** machine | **30 min** (version installée) et **20 min** (version de développement) — donc **jamais** 5 min ni 10 min sur ces deux configurations. |
| « 5 min » et « 10 min » : même réglage ? | **Non.** « 5 min » est une **valeur documentaire périmée** (encore dans la version **publiée** ; corrigée par `8aa8f0d`). « 10 min » désigne **deux mécanismes différents** : `agent_timeout_ms` (défaut) et `super_agent_auto_stop_minutes` (plafond de l'Assistant, **actif** sur ce poste). §3.3. |
| `stop_agent` (comportement **actuel**, après P2) | Arrête la session et libère le verrou du projet. La file des **délégations** est **abandonnée** (nommée + journalisée + notifiée). La file des **MISSIONS** n'est **plus jamais détruite** : elle est **conservée**, chaque mission est **nommée**, le rejeu est **armé** et jugera la disponibilité sur les **sessions vivantes**. §4. |
| Contradictions doc ↔ code | **0 encore ouverte** sur les 3 relevées : **C1** et **C2** corrigées ce jour, **C3** corrigée en `8aa8f0d`. Restent **2 ambiguïtés** de formulation (A1, A2) et **1 affirmation fausse** dans un rapport (C4). §5. |
| Limites connues restantes | **2**, écrites et publiées dans la doc (`spec_super_agent.md` § 13 + aide intégrée) : **L1** ordre d'attente pouvant changer (mission défilée remise **en queue**, sans perte ni doublon) ; **L2** file des **commandes manuelles** encore indexée par **chemin brut**. §5.4. |
| Tests | **2 091 tests front verts, 0 échec** (`npx vitest run`, 124 fichiers) sur l'arbre documentaire du jour. Aucun changement Rust : rien à relancer côté `cargo`. §9. |

---

## 1. Version et état du dépôt

| Sujet | Valeur / état | Preuve | Date |
|---|---|---|---|
| Version application | `0.4.35` | `src-tauri/tauri.conf.json:4` | 2026-10-21 09:05 |
| Version paquet npm | `0.4.35` | `package.json:4` | 2026-10-21 09:05 |
| Version crate desktop | `0.4.35` | `src-tauri/Cargo.toml:3` | 2026-10-21 09:05 |
| Version dans le verrou | `0.4.35` (package `pilot`) | `Cargo.lock:3333` (`name = "pilot"`) | 2026-10-21 09:05 |
| État de la préparation 0.4.36 | **Non commencée** : aucun fichier de version incrémenté, aucun `release-notes/v0.4.36.md` (le dernier présent est `v0.4.35.md`) | `ls release-notes` ; les 4 fichiers de version | 2026-10-21 09:05 |
| Étiquette de version | `v0.4.35` existe et pointe sur `3c67064` — **le tag ne contient aucun** des 5 commits locaux | `git rev-parse v0.4.35` = `3c67064` ; `git ls-remote --tags origin v0.4.35` | 2026-10-21 |
| Branche / amont | `main`, `origin/main` = `3c67064` | `git log --oneline origin/main..HEAD` → **5 commits** | 2026-10-21 09:05 |
| Commits non poussés | **5**, dans l'ordre : `8aa8f0d` doc du délai d'inactivité · `13f7552` **P2** (arrêt d'agent) · `9031b37` rapport de re-vérification P2 · `4cf5356` **P1** (ordre d'arrivée) · `275eb04` **P3** (identité de projet) | `git log --oneline origin/main..HEAD` | 2026-10-21 09:05 |
| Fichiers suivis **modifiés** | Documentation seule : `spec_super_agent.md`, `spec_gestion_agents.md`, `help/handbook.md` (régénéré) — **aucun fichier de code** | `git status --short` | 2026-10-21 09:05 |
| Fichiers **non suivis** | `fiche-reference-pilot.md` (ce document), `rapport-doc-finale.md`, `geminiReport.md`, `rapport-delai-inactivite.md`, `rapport-file-attente-pertes-doublons.md`, `rapport-relecture-file.md`, `rapport-relecture-finale.md` | `git status --short` | 2026-10-21 09:05 |
| Conséquence | La **version publiée** (`v0.4.35`, `3c67064`) ne contient **ni** les 3 correctifs du jour **ni** la doc corrigée (délai d'inactivité, `stop_agent`, ordre d'arrivée, limites connues). Il faudra une **0.4.36** (bump + tag + workflow) pour la livrer. | comparaison `git show v0.4.35:spec_gestion_agents.md` ↔ arbre courant | 2026-10-21 |

---

## 2. Réglages qui touchent l'exécution des agents

Deux jeux de valeurs coexistent : le **défaut du code** (ce que voit une installation neuve) et la
**valeur réellement enregistrée** dans les deux fichiers de configuration de cette machine.

Fichiers de configuration lus (lecture seule) :
- version **installée** : `C:\Users\pldistance\AppData\Roaming\com.pilot.editor\config.json`
- version de **développement** : `C:\Users\pldistance\AppData\Roaming\com.pilot.editor.dev\config.json`

| Réglage | Défaut code | Machine (installé / dev) | Où c'est défini | Preuve |
|---|---|---|---|---|
| **Délai d'inactivité d'une run d'agents** (`agent_timeout_ms`) | 600 000 ms (**10 min**) | **1 800 000 ms (30 min)** / **1 200 000 ms (20 min)** | `src-tauri/src/lib.rs` + repli front | `lib.rs:993` ; `src/js/agents-bus.js:78` ; champ `index.html:572-573` (`min=10000 max=1800000 value=600000`) ; `src/js/settings.js:1348`, `:2159` |
| **Délai d'inactivité du codeur en Mode Orchestration** (`orchestration_idle_timeout_ms`) | 120 000 ms (**2 min**) | 120 000 ms (2 min) / 120 000 ms | `lib.rs:965` ; `index.html:643` (`max=600000`) | valeurs de config |
| **Durée max d'un test/lint** (`test_timeout_ms`) | 60 000 ms | absent des configs → **défaut 60 s** | `lib.rs:987` | clé absente des deux `config.json` |
| **Plafond de tours pi par agent** (`agent_max_turns`) | 200 | **400** (installé) / **60** (dev) | `lib.rs:995` ; repli `agents-bus.js:2143` | valeurs de config |
| **Taille max du résultat renvoyé** (`agent_max_result_tokens`) | 4 000 | **256 000** (installé) / **4 000** (dev) | `lib.rs:994` ; usage `agents-bus.js:2718` | valeurs de config |
| **Profondeur d'appels** (`agent_max_call_depth`) | **3** | 3 / 3 | `lib.rs:991` ; repli `agents-bus.js:76` | valeurs de config |
| **Appels par run, tous agents confondus** (`agent_max_total_calls`) | **30** | 30 / 30 | `lib.rs:992` ; repli `agents-bus.js:77` (`DEFAULT_TOTAL_BUDGET`) | valeurs de config |
| **Appels par run et par agent** (`max_calls_per_run`, par agent du registre) | **20** pour le coordinateur, **5** pour les autres ; repli **5** si absent | dépend du registre d'agents du projet | `src-tauri/src/agents.rs:44`, `:57` ; `src/js/agents.js:384`, `:94` ; repli `agents-bus.js:1731` | 2026-10-21 |
| **Verrou de projet** (exclusivité) | une mission qui **modifie** est exclusive : elle ne démarre pas si quoi que ce soit tourne sur le projet ; les missions de **lecture** cohabitent entre elles | idem (pas un réglage, une règle) | `src/js/run-policy.js:28-38` (`canStartMission`) ; verrou `agents-bus.js:699` (`endRun`), `:3159` (`isRunInProgress`) | 2026-10-21 |
| **Réservations de fichiers** (`.pilot/reservations.json`) | réservation **explicite** seulement ; renouvellement **60 s** ; **péremption 10 min** côté porte pré-écriture | n/a (fichier par projet, absent s'il n'y a pas de réservation) | `src/js/reservations.js:153` (`RESERVATION_HEARTBEAT_MS = 60000`) ; `src-tauri/extensions/pilot-reserve-gate.ts:38` (`RESERVATION_TTL_MS = 10 * 60 * 1000`) | 2026-10-21 |
| **File d'attente par projet** (missions) | rejeu toutes les **15 s** (`armQueueReplay`), sur décision `decideMissionAdmission` (file consultée **avant** tout lancement) | idem | `src/js/super-agent.js:928` (`RUN_AGENTS_QUEUE_REPLAY_MS = 15 * 1000`), `:1021` (`armQueueReplay`), `:618` (`decideMissionAdmission`) | 2026-10-21 09:05 |
| **Filet de sécurité de run (missions)** | **15 min** sans progrès → libère le drapeau ; **repoussé** tant que la run est réellement active | idem | `super-agent.js:476` (`RUN_AGENTS_WATCHDOG_MS = 15 * 60 * 1000`), `:4576-4600` | 2026-10-21 |
| **Arrêt auto d'un agent délégué (T2)** | 10 min | **45 min**, mais **désactivé** (`agent_auto_stop_enabled = false`) | `lib.rs:954` (défaut 10) ; config installé | `anomaly.rs:613-627` |
| **Plafond « réfléchit » de l'Assistant** (`super_agent_auto_stop_minutes`) | **10 min** | **10 min**, **activé** | `lib.rs:781` (défaut = `default_agent_auto_stop_minutes()` → `:954`) ; `anomaly.rs:808-817` | config installé + dev |
| **Verrou fantôme `busy`** (`stale_busy_grace_minutes`) | 25 min | 25 min | `lib.rs:955` ; `anomaly.rs` | config |
| **Détection d'anomalie** (`anomaly_timeout_minutes`) | 30 min | 30 min | `lib.rs:953` | config |
| **Balayage des verrous orphelins** | 30 s de période, 60 s de grâce au démarrage, plancher d'inactivité 2 min | idem | `agents-bus.js:1011` (`RUN_LOCK_SWEEP_MS`), `:1014`, `:1021` (`RUN_LAUNCH_MIN_STUCK_IDLE_MS` = `:98`), confirmation à 7 s (`:107`) | 2026-10-21 |
| **File d'attente sans porteur** | 60 s de grâce | idem | `agents-bus.js:85` (`QUEUED_ORPHAN_GRACE_MS`) | 2026-10-21 |
| **Génération / mise à jour d'`AGENTS.md`** | **300 s (5 min)**, non réglable | idem | `src-tauri/src/agents_md.rs:28` (`GENERATE_TIMEOUT_SECS`) | 2026-10-21 |
| **Plafonds de coût (argent)** | **Aucun** trouvé : pas de limite monétaire, ni de budget en dollars, dans le code ni dans la configuration | — | recherche `cost` / `budget` dans `lib.rs` : seules occurrences `context_budget_tokens` (`:958`, 8 000) et `graph_budget_tokens` (`:962`, 4 000), qui bornent des **tokens de contexte**, pas une dépense | 2026-10-21 |

⚠️ **Le délai d'inactivité n'est lu qu'au démarrage du bus** : `busState.timeoutMs = config.agent_timeout_ms || DEFAULT_TIMEOUT_MS` (`agents-bus.js:1778`). Changer la valeur demande une relecture de la configuration (ouverture de l'onglet Agents / redémarrage).

---

## 3. Le délai d'inactivité en détail

### 3.1 Combien de délais distincts ?

| # | Délai | Valeur | Ce qu'il coupe **exactement** | Sort du travail déjà produit | Preuve |
|---|---|---|---|---|---|
| 1 | `agent_timeout_ms` (**le « délai d'inactivité »**) | 10 min par défaut ; 30 min ici | **la run d'agents concernée seulement** : les agents **actifs de cette run** (arrêt du processus), les **réservations de fichiers** de ses projets, et **son verrou de run**. Une autre run / un autre projet **n'est pas touché**. | **conservé** sur le disque (aucune suppression, aucun retour arrière) ; **pas rejoué** ; la mission est réglée « terminée » si du travail est détecté sur le disque, « erreur » sinon | `agents-bus.js:1683-1726` (minuteur), `:221-232` (`workOnDiskDuringRun`), `:3137-3222` (`stopAgentsRun`), `:699-725` (`endRun`) |
| 2 | `QUEUED_ORPHAN_GRACE_MS` | 60 s | **la place dans la file**, quand un groupe parallèle a encore du travail en file mais **plus aucun porteur** (aucun agent actif, aucune session ne travaille) | la file est **abandonnée** (tracée), pas rejouée | `agents-bus.js:85`, alarme `:865` |
| 3 | Balayage des verrous orphelins (`RUN_LOCK_SWEEP_MS` + plancher 2 min) | 30 s / 60 s / 2 min | **le verrou du projet** supposé fantôme | ne touche pas aux fichiers ; laisse la file en place — mais **libère le créneau**, ce qui permet à une nouvelle demande de démarrer | `agents-bus.js:98`, `:1011`, `:1014`, `:1021`, `:1060-1075` |
| 4 | Watchdog de run de l'Assistant | 15 min, **repoussé** si la run progresse | **le drapeau d'occupation** du projet **et** la file de missions du projet | la file est **abandonnée** (nommée + journalisée + notifiée), **jamais rejouée** ; les fichiers produits restent | `super-agent.js:476`, `:4576-4600`, `:640-670` |
| 5 | `stale_busy_grace_minutes` | 25 min | **l'état « occupé »** d'un agent figé (remis à `false` **sans tuer le processus**) → libère aussi l'exclusivité du projet | travail conservé ; la run est considérée en erreur | `lib.rs:955` ; `src/js/exclusivity-queue.js:104` |
| 6 | `agent_auto_stop_minutes` (T2) | 10 min par défaut, **désactivé ici** (45 min) | **le processus** d'un agent délégué bloqué | conservé | `lib.rs:954` ; `anomaly.rs:613-627` |
| 7 | `super_agent_auto_stop_minutes` | **10 min**, **actif ici** | **le processus de l'Assistant** 🧭 uniquement | conservé | `lib.rs:781` ; `anomaly.rs:808-817` |
| 8 | `orchestration_idle_timeout_ms` | 2 min | **le codeur du Mode Orchestration** (timer remis à zéro à chaque événement du modèle) | conservé ; la tentative est rejouée par l'orchestration (max 2) | `lib.rs:965` ; `spec_orchestration.md:311` |
| — | `GENERATE_TIMEOUT_SECS` | 300 s (5 min) | la **génération d'`AGENTS.md`** — autre sujet, non réglable | sans objet | `agents_md.rs:28` |

### 3.2 Ce qu'il advient du travail déjà produit (délai n° 1)

| Étape | Comportement | Preuve |
|---|---|---|
| Avant de conclure | Vérifie le **disque** (`git status`) : un agent a pu écrire sans émettre d'événement | `agents-bus.js:1698`, `:221-232` |
| Si du travail est présent | Mission réglée **`done`** avec le message « Run interrompue, mais du travail est PRÉSENT sur le disque : la mission n'est PAS un échec » | `:1699-1706` |
| Sinon | Mission réglée **`error`** | `:1707-1709` |
| Notification | Notification desktop « Agent en timeout » | `:1711-1715` |
| Arrêt | Entonnoir unique `stopAgentWithTrace({reason:"idle-timeout"})` → `stopAgentsRun({runKey})` | `:1716-1726` |
| Fichiers | **Jamais supprimés, jamais annulés** : aucun code d'arrêt ne touche au contenu | `:3137-3222` |
| Relance | **Aucune** : le timeout ne relance rien | idem |
| File du projet | **Survit** à la suppression du contexte de run (file indexée par projet) ; les demandes qui y sont portées par la run disparue **restent en file**, sont **tracées** (`queue-replay-no-owner`) et **signalées**, mais **ne sont plus relancées** | `agents-bus.js:363-367`, `:1638-1665` |

### 3.3 Réponse explicite : les 5 et 10 minutes sont-elles le même réglage ?

**Non — et il ne faut pas les confondre. Trois choses distinctes portent ces nombres :**

| Nombre | Ce que c'est | Statut | Preuve |
|---|---|---|---|
| **5 min (300 s)** | (a) ancienne valeur **documentaire** du délai d'inactivité (doc publiée `v0.4.35`, corrigée par `8aa8f0d`, non poussée) ; (b) la **vraie** valeur, toujours juste, mais d'un **autre** mécanisme : la génération d'`AGENTS.md` | (a) **périmé** ; (b) actif et sans rapport | (a) `git show v0.4.35:spec_gestion_agents.md` ; (b) `agents_md.rs:28` |
| **10 min (600 000 ms)** | (a) **défaut** de `agent_timeout_ms` — le délai d'inactivité d'une run d'agents ; (b) **plafond de l'Assistant** `super_agent_auto_stop_minutes`, **activé** sur ce poste | **deux mécanismes différents** | (a) `lib.rs:993` ; (b) `lib.rs:781` + config (`super_agent_auto_stop_enabled = true`, `super_agent_auto_stop_minutes = 10`) |
| **30 min / 20 min** | `agent_timeout_ms` **réellement configuré** (installé / dev) | actif | `com.pilot.editor\config.json` : `1800000` ; `com.pilot.editor.dev\config.json` : `1200000` |

Donc : **5 min et 10 min ne sont pas le même réglage**, et **un arrêt à 10 minutes ne peut pas venir de `agent_timeout_ms` sur cette machine** (30 min en installé, 20 min en dev). L'explication la plus probable d'un arrêt à 10 min est `super_agent_auto_stop_minutes` (le seul seuil à 10 min actif) — c'est une **déduction par élimination, pas une preuve d'occurrence** (voir §7).

---

## 4. Comportement de `stop_agent` (état **après P2**, `13f7552`)

| Sujet | Comportement réel | Preuve |
|---|---|---|
| Ce qu'il arrête | La **session** de l'agent visé (`stop_agent_session` → `AgentService.stop`) et le suivi de l'agent invisible | `src/js/super-agent.js:5409-5416` |
| Délégations en file | **Abandonnées** via `abandonQueuedDelegations` (`detected: "stop-agent"`), puis message à l'écran avec le **nombre** et les **libellés** | `super-agent.js:5420-5427` |
| File de missions du projet | **Jamais détruite** (P2) : `releaseStuckRunLock` libère le créneau, puis, si plus aucune run ne tourne, `keepQueuedRunAgentsMissions` **conserve** les missions, les **nomme**, écrit `reason=queue-kept detected=stop-agent` et **arme le rejeu** (jugé sur les **sessions vivantes**, jamais sur le verrou). Si une autre tâche tourne encore : message « N mission(s) toujours en attente » | `super-agent.js:5436-5460` ; `keepQueuedRunAgentsMissions` (`:801-834`) |
| File de l'Assistant | Même règle, sur la seule clé de l'espace Assistant | `super-agent.js:5462-5483` |
| Prévient-il **avant** ? | **Non.** L'effet précède l'annonce (message + notification + ligne de journal). Conséquence exacte : un arrêt ne **détruit plus** de mission, il peut au pire **retarder** son lancement | `super-agent.js:5444-5452` |
| Trace écrite | `<projet>/.pilot/agent-stops.log`, repli global `<app_data_dir>/agent-stops.log`. Sur ce poste : **16 lignes** (15 `stale-session-restart`, 1 `queue-abandoned`), **aucune** `queue-kept` ni `idle-timeout` | `.pilot/agent-stops.log` (relevé 2026-10-21 09:05) |
| Risque **résiduel** documenté | Un `stop_agent` peut encore **abandonner les délégations** en file : c'est **voulu** (arrêt explicite) et désormais **nommé, journalisé et annoncé**. L'ancien risque D2 (abandon des **missions** sur verrou périmé) est **supprimé** par P2 | `rapport-file-attente-pertes-doublons.md` §1 (D2) ; `rapport-relecture-finale.md` § 4 |

---

## 5. Contradictions trouvées (état final)

### 5.1 Documentation ↔ code (les **trois** sont soldées)

| # | La doc disait | Le code fait | Preuve doc | Preuve code | État |
|---|---|---|---|---|---|
| C1 | « Un `stop_agent` **annule** la file d'attente. » (sans nuance) | Il abandonne la file des **délégations** ; il **conserve** celle des **missions** et arme son rejeu | `spec_super_agent.md:589-596` (corrigé), `:1515-1530` (idem) | `super-agent.js:5420-5427` (délégations) et `:5436-5460` (missions) | **corrigée** le 2026-10-21 (`rapport-doc-finale.md` §2.1) |
| C2 | « Rejeu **garanti**… la file **ne peut plus rester bloquée** » | Depuis **P1**, l'admission consulte la file **avant** de démarrer (`decideMissionAdmission`) ; le rejeu juge la liberté sur les **sessions vivantes**. Restent **deux limites** écrites (L1, L2) | `spec_super_agent.md:597-610` (corrigé), `:1521-1531` (idem) | `decideMissionAdmission` (`super-agent.js:618`), 3 points d'appel (`:4654`, `:4732`, `:4906`) | **corrigée** le 2026-10-21 ; limites § 13 |
| C3 | « Timeout d'inactivité : **5 min par défaut** » / « 300 s (5 min, défaut) » | **600 000 ms (10 min)** | doc **publiée** `v0.4.35` | `lib.rs:993` ; `agents-bus.js:78` | **corrigée** dans `8aa8f0d` (test garde-fou `src/js/help-delai-inactivite.test.js`, vert) ; **non poussée** |

### 5.2 Rapport de vérification ↔ code

| # | Le rapport dit | Le code fait | Preuve | État |
|---|---|---|---|---|
| C4 | « Les **réservations** n'ont **aucun délai** : `src/js/reservations.js` ne contient ni TTL ni expiration » | Il y a un **battement de cœur de 60 s** et une **péremption de 10 min** côté porte pré-écriture | `rapport-delai-inactivite.md` §2.2 | `reservations.js:153` (`RESERVATION_HEARTBEAT_MS = 60000`) ; `pilot-reserve-gate.ts:38` (`RESERVATION_TTL_MS = 10 min`) ; doc correcte : `spec_orchestration_multiagents.md:62-75` | **affirmation fausse**, à corriger dans ce rapport (hors périmètre documentaire du jour : le rapport est un **instantané daté**, il n'est pas réécrit) |

### 5.3 Ambiguïtés documentaires restantes (pas des contradictions franches)

| # | Formulation | Ce qu'il faut lire | Preuve |
|---|---|---|---|
| A1 | `max_calls_per_run: 20` présenté dans un **exemple** de fiche d'agent, comme s'il s'agissait de la valeur de référence | 20 est la valeur du **coordinateur** ; les autres agents créés par Pilot sont à **5**, et le **repli** pour un agent sans valeur est **5**. Le budget **total par run** est un **autre** réglage : `agent_max_total_calls = 30` | `spec_gestion_agents.md:140` vs `agents.rs:44`, `:57` ; `agents.js:94` ; `agents-bus.js:1731`, `:77` | **ouvert** (correction non faite : hors périmètre du jour) |
| A2 | « Taille max résultat renvoyé : 4000 tokens » (sans mention du défaut) | 4 000 est le **défaut** ; la **machine installée** applique **256 000** | `spec_gestion_agents.md:407` vs `lib.rs:994` et `com.pilot.editor\config.json` | **ouvert** |
| A3 | Le mot « annulation » appliqué à une **mission** en file | Une mission n'est jamais « annulée » par un arrêt : elle est **abandonnée nommément** (chien de garde, `/file vide`) ou **conservée** (arrêt d'agent, P2). Le vocabulaire de la doc distingue désormais les deux | `spec_super_agent.md:1200-1201` (tableau des traces : `queue-abandoned` vs `queue-kept`) | **clarifié** le 2026-10-21 |

### 5.4 Limites connues déclarées (nouveau, `spec_super_agent.md` § 13)

| # | Limite | Effet pour l'utilisateur | Aucune perte ? | Preuve code | État |
|---|---|---|---|---|---|
| **L1** | Une mission **déjà sortie de file** qui ne peut pas démarrer (mission de lecture, commande manuelle ou prompt d'un autre agent en cours) repart **en queue** (`push`) au lieu de la **tête** | L'**ordre d'attente** peut changer (avec `[B, C]`, la file devient `[C, B]`) ; attente supplémentaire ≤ 1 tour de rejeu (15 s) | **Oui** : même mission, même numéro, aucun doublon (refus par `includes`) | `launchQueuedMission` (`:1053`) → `isRunInProgress` (`:4722`) → `decideMissionAdmission` (`:4732`) → `enqueueMissionForProject` (`:4741`) → `push` (`:554`) ; échec de lancement remis **en tête** (`:1066`) | **écrite**, non corrigée (aucun test ne couvre le cas) |
| **L2** | La file des **commandes manuelles** (`project-task-queue.js`) est encore indexée par le **chemin brut** : deux écritures d'un même dossier → deux files, `/file` peut ne pas voir l'autre | Des commandes peuvent sembler absentes de `/file` ; elles démarrent quand même à leur tour | **Oui** pour les demandes ; risque de **visibilité** seulement | `queueOf` (`project-task-queue.js:262-266`), lecture `:315`, abandon `:333`, sonde `:443-448` | **écrite**, non corrigée (P3 n'a pas atteint cette famille) |

Les **autres** familles (missions, délégations, exclusivité, réservations) sont bien **normalisées** :
`project-cle-unicite.test.js` (4 écritures d'un même dossier → **une** file, un ordre, une réservation).

---

## 6. Fichiers de documentation corrigés / à corriger

| Priorité | Fichier | Correction | Motif |
|---|---|---|---|
| ~~1~~ | `spec_super_agent.md` (l. 589-596 et 1516-1526) | **Fait** le 2026-10-21 : « `stop_agent` abandonne la file des **délégations** » + règle des **missions** conservées ; « rejeu » décrit via `decideMissionAdmission` (file consultée **avant**), plus d'affirmation absolue | Contradictions **C1**, **C2** |
| ~~1~~ | `spec_super_agent.md` § 13 | **Fait** : section « Limites connues » (L1, L2) + bloc d'aide `<!-- HELP:file-attente-limites -->` | Réserves de `rapport-relecture-finale.md` |
| ~~2~~ | `spec_gestion_agents.md` (l. 38, 366 → désormais 407) + `help/handbook.md` | **Fait** dans `8aa8f0d` (délai 10 min) ; **reste à pousser** | Contradiction **C3** |
| ~~2~~ | `src/js/help-delai-inactivite.test.js` | **Fait** dans `8aa8f0d` (garde-fou doc ↔ code, vert) | Empêche C3 de revenir |
| ~~2~~ | `spec_gestion_agents.md` (l. 48 + section P1) | **Fait** le 2026-10-21 : l'ordre d'arrivée est daté « à l'admission » et la **limite L1** est citée | Cohérence P1 ↔ L1 |
| 3 | `spec_gestion_agents.md` (l. 140, 407) | Préciser que 20 = coordinateur / 5 = autres / repli 5, et que 4 000 tokens est un **défaut** réglable | Ambiguïtés **A1**, **A2** |
| 3 | `rapport-delai-inactivite.md` (§2.2) | Corriger « les réservations n'ont aucun délai » (instantané daté, à ne pas réécrire : la correction vit dans `spec_orchestration_multiagents.md`) | Affirmation fausse **C4** |
| — | `README.md`, `help/overview.md` | **Rien à corriger** : aucune valeur chiffrée de timeout, aucune mention de `stop_agent` ni de file d'attente (recherche : 0 résultat) | Vérifié 2026-10-21 |
| — | `spec_orchestration_multiagents.md` | **Rien à corriger** sur les réservations (battement 60 s, péremption 10 min : exact) | Vérifié 2026-10-21 |
| — | `help/handbook.md` | **Jamais édité à la main** : régénéré par `npm run build:handbook` (43 blocs, dont le nouveau `file-attente-limites`) | Procédure projet |

---

## 7. Ce qui n'est pas prouvé

1. **Quelle configuration s'applique réellement au moment où le propriétaire observe un arrêt.** Deux fichiers existent (installé : 30 min ; dev : 20 min). Rien sur le disque ne dit laquelle des deux applications tournait.
2. **L'occurrence d'un arrêt à 10 minutes.** Le journal `.pilot/agent-stops.log` ne contient **aucune** ligne `idle-timeout` (16 lignes, du 2026-10-20T08:21 au 2026-10-21T04:27, dont 1 `queue-abandoned` et 15 `stale-session-restart`). Le journal **global** est **absent** des deux dossiers de configuration. L'attribution à `super_agent_auto_stop_minutes` reste une **déduction par élimination**.
3. **Le comportement de `stop_agent` quand des agents du projet sont encore vivants** : établi par **lecture** du code (`super-agent.js:5436-5460`) et par `rapport-relecture-finale.md`, **non rejoué** (et non rejouable sans exécuter des runs d'agents).
4. **L1 en exécution** : le rebouclage « mission défilée remise en queue » est prouvé **par lecture** (chaîne d'appels citée § 5.4). **Aucun test** ne le reproduit ; aucun journal ne l'a enregistré sur ce poste (aucune ligne `queue-replay-no-owner`).
5. **L'existence d'un plafond de coût monétaire** : aucun trouvé ; l'absence est **constatée par recherche**, pas une preuve d'impossibilité future.

---

## 8. Rapports réutilisés (aucune duplication de travail)

| Rapport | Écrit le | Ce qu'il apporte ici | Utilisé pour |
|---|---|---|---|
| `rapport-delai-inactivite.md` | 2026-10-21 07:46 | Inventaire des huit délais, mécanisme d'expiration, historique 5 min → 10 min | §3 (vérifié ligne à ligne sur le code, **sauf** sa phrase sur les réservations, corrigée en C4) |
| `rapport-file-attente-pertes-doublons.md` | 2026-10-21 07:43 | Défauts **D1** (pas de consultation de la file à l'admission) et **D2** (abandon sur verrou périmé), preuves de journal | §4, §5.1 |
| `rapport-relecture-file.md` | 2026-10-21 07:47 | Verdict **NON CONFORME** sur `3c67064` : les trois correctifs attendus n'existaient pas | §4, historique des correctifs |
| `rapport-relecture-finale.md` | 2026-10-21 (après `275eb04`) | Verdict **PUBLIABLE** + **2 réserves non bloquantes** (A et B) devenues **L1** et **L2** | §5.4, §7 |
| `rapport-doc-finale.md` | 2026-10-21 09:05 | Journal des corrections documentaires du jour (C1, C2, L1, L2, aide régénérée) | §5, §6 |
| `rapport-doc-delai-inactivite.md` | 2026-10-21 (commité en `8aa8f0d`) | Correction de la doc du délai + test garde-fou | §5.1 (C3) |

---

## 9. Vérifications exécutées (lecture seule)

| Vérification | Commande | Résultat |
|---|---|---|
| Suite front complète | `npx vitest run` | **2 091 tests verts, 0 échec** (124 fichiers de test) sur l'arbre documentaire du jour, à 09:05 |
| Garde-fou documentation ↔ code du timeout | `npx vitest run src/js/help-delai-inactivite.test.js` | **8 tests verts** (l'aide régénérée porte bien la valeur du code) |
| Aide intégrée à jour | `npm run build:handbook` | **43 blocs**, `help/handbook.md` **200 759 octets** ; zéro ancienne formulation (« annule la file d'attente », « rejeu garanti » : 0 occurrence) |
| Ancienne formulation encore présente ? | `grep -n "annule\*\* la file\|Rejeu garanti" help/handbook.md spec_super_agent.md` | **0 résultat** |
| Tests Rust | — | **non relancés** : aucun fichier Rust touché par la journée (documentation seule côté desktop) |
| État du dépôt, étiquettes, amont | `git status --short`, `git log --oneline origin/main..HEAD`, `git rev-parse` | voir §1 |
| Configuration réellement appliquée | lecture JSON des deux `config.json` | voir §2 |
| Journal des arrêts automatiques | `.pilot/agent-stops.log` | 16 lignes : 15 `stale-session-restart`, 1 `queue-abandoned`, **aucune** `idle-timeout`, aucune `queue-kept` |
| Aucun outil de listage des sessions d'agents | — | **non utilisé** (contrainte de la mission respectée) |

---

*Fiche établie le 2026-10-21 à 09:05 sur le commit `275eb04` (**5 commits** en avance sur `origin/main` ;
tag `v0.4.35` = `3c67064`, **seule version publiée** ; **0.4.36 en préparation, non commencée**).
Côté code : lecture seule, aucun fichier de code ni de configuration modifié, aucun commit, tag ni
publication pour la version. Les seuls fichiers écrits sont de la **documentation**
(`spec_super_agent.md`, `spec_gestion_agents.md`, `help/handbook.md` régénéré, cette fiche,
`rapport-doc-finale.md`).*
