# Spécification — Détection d'anomalies des agents

> **Statut : ✅ Implémenté (tâche 8).**
> Composant : surveillance arrière-plan des agents (codeur, agents du registre,
> reviewer, super-agent) — **sans LLM**.
>
> Objectif : détecter automatiquement un agent **bloqué** (actif mais sans
> progression depuis un seuil) et notifier l'utilisateur, qui peut lancer un
> **agent de diagnostic** dédié. L'agent de diagnostic **PROPOSE** des
> évolutions — **aucune action automatique** : c'est l'utilisateur qui valide.

<!-- HELP:anomaly -->
## Aide utilisateur — Détection d'anomalies et arrêt auto des agents bloqués

Pilot surveille en arrière-plan l'activité de ses agents (codeur, agents du
registre, reviewer, assistant).

**Détection d'anomalies** : si un agent est **actif mais sans progression**
depuis un certain temps (seuil par défaut : **30 minutes**), Pilot vous en
avertit (bandeau + notification native). Le bandeau propose un bouton
**🔍 Diagnostiquer** qui lance un agent d'analyse **sans action automatique** :
il propose des évolutions que vous validez vous-même.

**Arrêt automatique des agents bloqués (T2)** : un agent **bloqué** — actif mais
**sans progression** depuis le seuil dédié (défaut : **10 minutes**) — est
**arrêté automatiquement**. Cela concerne les **agents délégués** (lancés via
run_agents, ex. par l'Assistant 🧭) **et l'agent standard** du projet (session
principale), pour qu'un process figé ne bloque plus Pilot. Le reviewer et
l'Assistant ne sont **jamais** arrêtés automatiquement.

**Opération longue en cours** (un outil démarré qui tourne encore : longue
construction, longue série de tests, longue analyse) : tant qu'un outil
s'exécute, l'agent est considéré comme en train de travailler et **l'arrêt
automatique (T2) ne le coupe pas**. Attention : cela ne protège pas une opération
**totalement silencieuse** (aucun événement pendant plus de **10 minutes**) du
délai d'inactivité côté interface, qui met fin à la run **sans tuer l'agent** ;
et au bout de **25 minutes** d'absence d'activité, le filet « occupé périmé »
(ci-dessous) libère le créneau **sans tuer l'agent**. Seul un agent
**réellement figé** (aucun outil en cours, plus aucune progression) est arrêté
par T2.

**Question posée à l'utilisateur** : quand un agent attend votre réponse (choix,
confirmation, saisie), cette attente n'est pas un blocage. L'arrêt automatique
(T2) est **mis en pause** tant que la réponse n'est pas donnée, même très
longtemps.

**Verrou de run fantôme (busy-stale)** : si un agent reste marqué actif (process
pi figé) sans activité depuis **25 minutes**, Pilot libère son créneau
(notification 🧹 avec la raison) pour que les demandes en file reprennent — sans
réinitialiser son processus. Aucun réglage utilisateur.

- **Notification** : un bandeau + une notification native indiquent que l'agent
  a été arrêté (agent + raison). Le créneau de ce spécialiste est libéré : un
  agent en file d'attente sur le même rôle peut prendre le relais.
- **Diagnostic automatique** : après l'arrêt, un **agent de diagnostic est lancé
  automatiquement** pour **proposer** des évolutions (lecture seule, validation
  utilisateur requise — aucune action automatique).
- **Scope restreint** : sont arrêtés automatiquement les agents **délégués** ET
  l'**agent standard** du projet (session principale) ; le reviewer et
  l'Assistant ne sont **jamais** arrêtés automatiquement. Le filet « occupé
  périmé » libère le créneau **sans tuer l'agent**.
- **Réglages** : dans **Paramètres ⚙️ → Agent**, vous pouvez activer/désactiver
  la **Détection d'anomalies** (seuil 30 min) et l'**Arrêt auto des agents
  bloqués (délégués + standard)** (seuil 10 min). Activés par
  défaut.
- **Aucune fausse alerte** : un agent qui progresse (événements RPC réguliers)
  n'est jamais signalé ni arrêté. Un agent actif **sans aucun événement** depuis
  le seuil déclenche l'alerte (une fois par blocage, réarmé à la prochaine
  exécution).
<!-- /HELP:anomaly -->

---

## 1. Problème

Les agents de Pilot (codeur, agents du registre) peuvent se bloquer en boucle
d'outils ou rester actifs sans progression. Sans surveillance automatique, on
s'en aperçoit trop tard. La détection doit tourner **en arrière-plan, sans
dépendre d'un LLM**, et ne pas déclencher de fausses alertes.

## 2. Solution — surveillance arrière-plan (Rust, sans LLM)

### 2.1 Observateur combiné (`anomaly::make_observer`)

Branché sur chaque session RPC (session principale, agents multi-rôles,
reviewer, super-agent), il met à jour **deux** maps :

- la map d'activité par projet (issue #13, pastille « travaille en
  arrière-plan ») — comportement identique à l'ancien `make_project_activity_observer` ;
- la map de surveillance d'anomalie par agent, clé composite
  `project\u{1f}agent` → `AgentAnomalyState { last_activity, last_progress, last_event, busy, blocked_reported, auto_stopped_reported, awaiting_user, tool_in_progress }`.

`agent_start` → `busy=true` (et réarme `blocked_reported` + `auto_stopped_reported`) ;
`agent_settled` → `busy=false`. Tout événement d'activité (`ACTIVITY_EVENTS`)
rafraîchit `last_activity`/`last_event`.

### 2.2 Moniteur (`anomaly::start_monitor`)

Thread arrière-plan (démarré au setup) : toutes les 30 s, il vérifie la map.
Un agent est signalé **bloqué** si `busy` ET `now - last_activity > seuil` ET
pas déjà signalé. Il émet alors l'événement `agent-anomaly`
(`{ project, agent, lastEvent, idleMinutes }`) — une seule fois par blocage
(`blocked_reported`), réarmé au prochain `agent_start`/`agent_settled`.

Respecte le réglage `anomaly_detection_enabled` (défaut activé) et
`anomaly_timeout_minutes` (défaut 30).

### 2.3 Arrêt automatique des agents bloqués (T2)

Le même moniteur implémente l'arrêt AUTOMATIQUE (`should_auto_stop`) : un agent
`busy` sans progression depuis le seuil **dédié** `agent_auto_stop_minutes`
(défaut **10 min**, distinct de `anomaly_timeout_minutes` 30) et non déjà
arrêté (`auto_stopped_reported`, réarmé à chaque `agent_start`) est candidat.
Respecte le réglage `agent_auto_stop_enabled` (défaut activé) et
`agent_auto_stop_minutes` (défaut 10).

**Scope** : vise les agents délégués `AgentProcess` (run_agents) ET, depuis le
bug #81, l'**agent standard** (`MainSession`, chat principal) — un process pi
standard figé vivant ne doit plus bloquer Pilot. Le routage se fait via
`auto_stop_target` : `agent_process_alive(project, agent)` → agent délégué ;
sinon `main_session_alive(project, agent)` → agent standard ; sinon rien. Le
reviewer (`orch-reviewer`, mode MainSession) et le super-agent ne sont **jamais**
arrêtés automatiquement (le super-agent a son plafond dédié, tâche #141).

À l'arrêt, le moniteur :

1. **arrête réellement** la session (`agent_service.stop`) → le processus pi est
   tué et la session libérée du registre ;
2. émet l'événement **`agent-auto-stopped`** (`{ agent, project, reason,
   idleMinutes }`) → l'UI (anomaly.js) informe l'utilisateur et le bus d'agents
   (agents-bus.js) **libère le créneau d'exclusivité** (la file d'attente,
   `launchNextQueued`) pour qu'un agent en attente prenne le relais (T5). Pour
   l'agent standard, le `reason` dédié (« Agent standard arrêté automatiquement… »)
   permet à super-agent.js de **libérer `delegationBusy` et flusher la file de
   délégation** (la prochaine demande en attente est transmise à un agent
   redémarré) et à agent-pi.js de mettre à jour l'UI (statut « Arrêté ») ;
3. **PROPOSE automatiquement le diagnostic** en appelant
   `do_start_diagnostic_agent` (réutilise l'existant, aucune nouvelle logique).

**Pause pendant une attente de réponse utilisateur** : une question posée par
l'agent (choix, confirmation, saisie — événement `extension_ui_request`) n'est
pas un blocage mais un état légitime (nuit, réunion…). L'observateur pose alors
le marqueur `awaiting_user` : tant qu'il est posé, l'arrêt automatique T2, le
plafond « réfléchit » de l'Assistant et la libération du créneau « run fantôme »
sont **suspendus**, quelle que soit la durée de l'attente. Le marqueur est levé
dès le premier événement d'activité suivant (la réponse a été traitée) ou sur
tout événement de cycle de vie (`agent_start`/`agent_end`/`agent_settled`) / mort
du process (anti-fuite).

**Passage 3 du lot 1 — un travail long qui avance n'est plus coupé** :
l'observateur suit un marqueur `tool_in_progress` (posé sur
`tool_execution_start`, levé sur `tool_execution_end` — et sur toute fin de tour
/ mort du process, anti-fuite). Tant qu'une opération d'outil est EN COURS,
`should_auto_stop_on_progress` renvoie `false` : un long build, une longue série
de tests ou une longue analyse (aucun événement entre le start et le end de
l'outil) n'est plus arrêté à tort au bout du seuil. Un agent **réellement figé**
(aucun outil en cours, plus aucune progression) est toujours arrêté exactement
comme avant : le seuil, le réglage d'activation et la proposition de diagnostic
restent inchangés.

**Nuance — une opération longue et silencieuse n'est pas protégée partout** :
cette pause ne concerne que **l'arrêt automatique du moteur (T2)**. Une opération
longue qui n'émet **aucun** événement pendant plus de **10 minutes** reste
exposée au **délai d'inactivité côté interface** (`agent_timeout_ms`, défaut
10 min, agents-bus.js) qui termine la run **sans tuer l'agent** ; et au bout de
**25 minutes** d'absence d'activité, le filet « occupé périmé » (busy-stale,
§2.4) **libère le créneau mais ne tue pas l'agent**. Il est donc inexact de dire
qu'une opération longue « n'est jamais coupée » : elle ne l'est jamais **par
l'arrêt automatique T2** tant que l'outil tourne, mais elle reste soumise aux
garde-fous d'inactivité décrits ci-dessus.

### 2.4 Verrou de run fantôme — filet busy-stale (STALE_BUSY_GRACE)

Le même moniteur implémente un filet AUTORITAIRE (`should_release_stale_busy`)
INDÉPENDANT de l'arrêt auto T2 : un process pi **figé** (vivant, ni settled ni
exit) laisse `busy` à true sans jamais l'effacer. Dès qu'une entrée non-super
reste `busy` avec une dernière activité plus ancienne que
dur `stale_busy_grace_minutes` (défaut **25 min**, aligné sur la fenêtre busy-stale
JS `STALE_BUSY_WINDOW_MS`), le moniteur :

1. **repasser `busy` à false** et **réarme** `blocked_reported`/
   `auto_stopped_reported` dans la map d'anomalie (sans toucher au registre ni à
   la session réelle) ;
2. émet l'événement **`agent-stale-busy-released`** (`{ agent, project,
   idleMinutes }`) → agents-bus.js termine le tour (`failAgentTurn`) : libère le
   créneau d'exclusivité + la file (`launchNextQueued`) — **sans tuer le process**
   (le kill relève de T2) ;
3. corrige aussi les sessions `busy` vivantes mais inactives quand
   `agent_auto_stop_enabled=false` (`agent_process_busy` est activé pour la file
   d'attente même si l'arrêt auto est désactivé) ;
4. **n'agit jamais** sur le super-agent (plafond dédié, tâche #141) ni sur la
   session principale via simple inactivité (un seul repassage de la marque busy
   de la map d'anomalie, pas de `stop`).

Ce filet est la cause racine du **verrou de run fantôme** côté frontend :
`isSessionWorking`/`isAgentActiveOnProject` (exclusivity-queue.js) traitent une
session busy-stale comme NON-travailleuse ; le watchdog `releaseStuckRunLock`
(agents-bus.js) et le pré-check `run_agents` (super-agent.js) drainent alors les
files d'exclusivité/de délégation au lieu de laisser les demandes derrière un
fantôme. Le champ `stale_busy_grace_minutes` est préservé dans settings.js
(aucune UI dédiée).

### 2.5 Agent de diagnostic (`anomaly::start_diagnostic_agent`)

Commande Tauri : lance un processus agent dédié (`diagnostic`, canal
`rpc-event-agents`) et lui envoie un prompt d'analyse. Le prompt décrit
l'anomalie (projet, agent, dernier événement, inactivité) et **interdit toute
action automatique** : l'agent PROPOSE des évolutions, validées par
l'utilisateur. Son corps est extrait dans `do_start_diagnostic_agent`, réutilisé
par le moniteur pour PROPOSER automatiquement le diagnostic après un arrêt auto
(T2).

## 3. Frontend (`src/js/anomaly.js`)

- Écoute `agent-anomaly` → affiche un **bandeau d'alerte persistant** + envoie
  une **notification desktop** (`notifyAnomaly`).
- Bouton **🔍 Diagnostiquer** → `invoke("start_diagnostic_agent", …)`.
- Écoute `agent-auto-stopped` (T2) → bandeau + notification « agent arrêté
  automatiquement » + ouvre la **modale de diagnostic** (déjà lancé par le
  moniteur Rust).
- Écoute `rpc-event-agents` (agent_id `diagnostic`) → affiche la sortie de
  l'agent de diagnostic dans une **modale**.

Le bus d'agents (`src/js/agents-bus.js`) écoute aussi `agent-auto-stopped` : il
**libère le créneau d'exclusivité** (file d'attente, `launchNextQueued`) en
terminant le tour de l'agent via `failAgentTurn`, pour qu'un agent en attente
prenne le relais (T5). L'Assistant (`super-agent.js`) est informé via le
callback de notification du bus (message ⏱️).

## 4. Fichiers concernés

| Fichier | Rôle |
|---|---|
| `src-tauri/src/anomaly.rs` | Observateur combiné, moniteur, arrêt auto, commande diagnostic, tests |
| `src-tauri/src/lib.rs` | `mod anomaly`, config (`anomaly_detection_enabled`, `anomaly_timeout_minutes`, `agent_auto_stop_enabled`, `agent_auto_stop_minutes`), état `agent_anomaly`, setup, commande |
| `src-tauri/src/agent_service.rs` | Observateur branché sur les 4 spawn ; `stop` réel + `agent_process_alive` (scope T2) + `main_session_alive` (bug #81) |
| `src-tauri/src/rpc.rs` | Suppression de l'ancien `make_project_activity_observer` (remplacé par l'observateur combiné) |
| `src/js/anomaly.js` | Bandeau d'alerte, notification, arrêt auto (événement `agent-auto-stopped`), modale de diagnostic |
| `src/js/agents-bus.js` | Libération du créneau d'exclusivité à l'arrêt auto (T5) |
| `src/js/super-agent.js` | Notification assistant (message ⏱️ d'arrêt auto) |
| `src/js/desktop-notify.js` | `notifyAnomaly` |
| `src/js/main.js` | `initAnomalyDetection` |
| `src/js/settings.js` + `index.html` | Réglages (activation + seuils) |
| `src/css/style.css` | Styles bandeau + modale |

## 5. Vérifications

- `cargo test --lib` passe (anti-régression, dont tests `anomaly` :
  `should_auto_stop`, `should_auto_stop_on_progress` — marqueur `tool_in_progress`
  — et `awaiting_user_suspends_auto_stop_and_stale_release`).
- `npm run build` (vite) passe.
- `npm test` (vitest) passe (agents-bus : aucune régression).
- Correctif « opération longue » couvert par les tests : tant qu'un outil est EN
  COURS (`tool_in_progress`), `should_auto_stop_on_progress` renvoie `false` ;
  un agent figé (aucun outil, plus de progression) est arrêté comme avant.
- Pause « attente de réponse utilisateur » couverte par les tests : tant que
  `awaiting_user` est posé, l'arrêt T2, le plafond de l'Assistant et la
  libération du créneau fantôme ne se déclenchent pas ; dès que le marqueur est
  levé (réponse traitée ou fin de tour), l'arrêt redevient déclenchable au-delà
  du seuil (aucune régression du filet de sécurité).
- Test manuel : simuler un agent bloqué (seuil auto-stop réduit à 1 min) → après
  le seuil, l'agent est arrêté, l'événement UI + bandeau apparaissent, la file
  d'exclusivité est libérée (un agent en attente prend le relais) et l'agent de
  diagnostic est lancé automatiquement.
- **Ne casse pas** la surveillance existante (pastille d'activité par projet), ni
  le bouton manuel « 🔍 Diagnostiquer », ni la file d'attente d'exclusivité, ni
  le filet busy-stale (25 min, sans kill).
