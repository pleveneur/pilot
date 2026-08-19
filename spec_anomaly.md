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

**Arrêt automatique des agents délégués (T2)** : un agent **délégué** (lancé via
run_agents, ex. par l'Assistant 🧭) **bloqué** — actif mais **sans progression**
depuis le seuil dédié (défaut : **10 minutes**) — est **arrêté automatiquement**.
Un outil qui démarre sans se terminer au-delà du seuil est considéré bloqué.

- **Notification** : un bandeau + une notification native indiquent que l'agent
  a été arrêté (agent + raison). Le créneau de ce spécialiste est libéré : un
  agent en file d'attente sur le même rôle peut prendre le relais.
- **Diagnostic automatique** : après l'arrêt, un **agent de diagnostic est lancé
  automatiquement** pour **proposer** des évolutions (lecture seule, validation
  utilisateur requise — aucune action automatique).
- **Scope restreint** : seuls les agents délégués sont arrêtés ; le chat
  principal, le reviewer et l'Assistant ne sont jamais arrêtés automatiquement.
- **Réglages** : dans **Paramètres ⚙️ → Agent**, vous pouvez activer/désactiver
  la **Détection d'anomalies** (seuil 30 min) et l'**Arrêt auto des agents
  délégués bloqués** (seuil 10 min). Activés par défaut.
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
  `project\u{1f}agent` → `AgentAnomalyState { last_activity, last_event, busy, blocked_reported, auto_stopped_reported }`.

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

### 2.3 Arrêt automatique des agents délégués bloqués (T2)

Le même moniteur implémente l'arrêt AUTOMATIQUE (`should_auto_stop`) : un agent
`busy` sans progression depuis le seuil **dédié** `agent_auto_stop_minutes`
(défaut **10 min**, distinct de `anomaly_timeout_minutes` 30) et non déjà
arrêté (`auto_stopped_reported`, réarmé à chaque `agent_start`) est candidat.

**Scope restreint** : ne vise QUE les agents délégués `AgentProcess` (run_agents),
filtrés par `agent_service.agent_process_alive(project, agent)`. Le chat
principal, le reviewer (`orch-reviewer`, mode MainSession) et le super-agent ne
sont **jamais** arrêtés automatiquement.

À l'arrêt, le moniteur :

1. **arrête réellement** la session (`agent_service.stop`) → le processus pi est
   tué et la session libérée du registre ;
2. émet l'événement **`agent-auto-stopped`** (`{ agent, project, reason,
   idleMinutes }`) → l'UI (anomaly.js) informe l'utilisateur et le bus d'agents
   (agents-bus.js) **libère le créneau d'exclusivité** (la file d'attente,
   `launchNextQueued`) pour qu'un agent en attente prenne le relais (T5) ;
3. **PROPOSE automatiquement le diagnostic** en appelant
   `do_start_diagnostic_agent` (réutilise l'existant, aucune nouvelle logique).

Respecte le réglage `agent_auto_stop_enabled` (défaut activé) et
`agent_auto_stop_minutes` (défaut 10). Un outil qui démarre sans
`tool_execution_end` depuis le seuil est considéré bloqué (scénario visé).

### 2.4 Agent de diagnostic (`anomaly::start_diagnostic_agent`)

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
| `src-tauri/src/agent_service.rs` | Observateur branché sur les 4 spawn ; `stop` réel + `agent_process_alive` (scope T2) |
| `src-tauri/src/rpc.rs` | Suppression de l'ancien `make_project_activity_observer` (remplacé par l'observateur combiné) |
| `src/js/anomaly.js` | Bandeau d'alerte, notification, arrêt auto (événement `agent-auto-stopped`), modale de diagnostic |
| `src/js/agents-bus.js` | Libération du créneau d'exclusivité à l'arrêt auto (T5) |
| `src/js/super-agent.js` | Notification assistant (message ⏱️ d'arrêt auto) |
| `src/js/desktop-notify.js` | `notifyAnomaly` |
| `src/js/main.js` | `initAnomalyDetection` |
| `src/js/settings.js` + `index.html` | Réglages (activation + seuils) |
| `src/css/style.css` | Styles bandeau + modale |

## 5. Vérifications

- `cargo test --lib` passe (anti-régression, dont tests `anomaly` + `should_auto_stop`).
- `npm run build` (vite) passe.
- `npm test` (vitest) passe (agents-bus : aucune régression).
- Test manuel : simuler un agent délégué bloqué (seuil auto-stop réduit à 1 min)
  → après le seuil, l'agent est arrêté, l'événement UI + bandeau apparaissent,
  la file d'exclusivité est libérée (un agent en attente prend le relais) et
  l'agent de diagnostic est lancé automatiquement.
- **Ne casse pas** la surveillance existante (pastille d'activité par projet), ni
  le bouton manuel « 🔍 Diagnostiquer », ni la file d'attente d'exclusivité.
- **Ne casse pas** la surveillance existante (pastille d'activité par projet) ni
  ne déclenche d'action automatique non validée.
