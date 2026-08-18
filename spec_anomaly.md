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
## Aide utilisateur — Détection d'anomalies

Pilot surveille en arrière-plan l'activité de ses agents (codeur, agents du
registre, reviewer, assistant). Si un agent est **actif mais sans progression**
depuis un certain temps (seuil par défaut : **30 minutes**), Pilot vous en
avertit.

- **Notification** : une alerte s'affiche (bandeau + notification native) quand
  un agent est détecté comme bloqué.
- **Agent de diagnostic** : le bandeau propose un bouton **🔍 Diagnostiquer**.
  Il lance un agent dédié qui **analyse la situation** (lit les fichiers
  concernés) et **propose des évolutions** pour débloquer ou prévenir ce type de
  blocage. L'agent de diagnostic **ne fait aucune action automatique** : vous
  validez vous-même les évolutions proposées.
- **Réglages** : dans **Paramètres ⚙️ → Agent**, vous pouvez activer/désactiver
  la **Détection d'anomalies** et régler le **seuil de blocage** (en minutes).
  Désactivée par défaut ? Non — **activée par défaut**, seuil 30 min.
- **Aucune fausse alerte** : un agent qui progresse (événements RPC réguliers)
  n'est jamais signalé. Seul un agent actif **sans aucun événement** depuis le
  seuil déclenche l'alerte, une seule fois par blocage (réarmé à la prochaine
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
  `project\u{1f}agent` → `AgentAnomalyState { last_activity, last_event, busy, blocked_reported }`.

`agent_start` → `busy=true` (et réarme `blocked_reported`) ; `agent_settled` →
`busy=false`. Tout événement d'activité (`ACTIVITY_EVENTS`) rafraîchit
`last_activity`/`last_event`.

### 2.2 Moniteur (`anomaly::start_monitor`)

Thread arrière-plan (démarré au setup) : toutes les 30 s, il vérifie la map.
Un agent est signalé **bloqué** si `busy` ET `now - last_activity > seuil` ET
pas déjà signalé. Il émet alors l'événement `agent-anomaly`
(`{ project, agent, lastEvent, idleMinutes }`) — une seule fois par blocage
(`blocked_reported`), réarmé au prochain `agent_start`/`agent_settled`.

Respecte le réglage `anomaly_detection_enabled` (défaut activé) et
`anomaly_timeout_minutes` (défaut 30).

### 2.3 Agent de diagnostic (`anomaly::start_diagnostic_agent`)

Commande Tauri : lance un processus agent dédié (`diagnostic`, canal
`rpc-event-agents`) et lui envoie un prompt d'analyse. Le prompt décrit
l'anomalie (projet, agent, dernier événement, inactivité) et **interdit toute
action automatique** : l'agent PROPOSE des évolutions, validées par
l'utilisateur.

## 3. Frontend (`src/js/anomaly.js`)

- Écoute `agent-anomaly` → affiche un **bandeau d'alerte persistant** + envoie
  une **notification desktop** (`notifyAnomaly`).
- Bouton **🔍 Diagnostiquer** → `invoke("start_diagnostic_agent", …)`.
- Écoute `rpc-event-agents` (agent_id `diagnostic`) → affiche la sortie de
  l'agent de diagnostic dans une **modale**.

## 4. Fichiers concernés

| Fichier | Rôle |
|---|---|
| `src-tauri/src/anomaly.rs` | Observateur combiné, moniteur, commande diagnostic, tests |
| `src-tauri/src/lib.rs` | `mod anomaly`, config (`anomaly_detection_enabled`, `anomaly_timeout_minutes`), état `agent_anomaly`, setup, commande |
| `src-tauri/src/agent_service.rs` | Observateur branché sur les 4 spawn (session, agent process, reviewer, super-agent) |
| `src-tauri/src/rpc.rs` | Suppression de l'ancien `make_project_activity_observer` (remplacé par l'observateur combiné) |
| `src/js/anomaly.js` | Bandeau d'alerte, notification, modale de diagnostic |
| `src/js/desktop-notify.js` | `notifyAnomaly` |
| `src/js/main.js` | `initAnomalyDetection` |
| `src/js/settings.js` + `index.html` | Réglages (activation + seuil) |
| `src/css/style.css` | Styles bandeau + modale |

## 5. Vérifications

- `cargo test --lib` passe (anti-régression, dont 3 tests `anomaly`).
- `npm run build` (vite) passe.
- Test manuel : simuler un agent bloqué → l'alerte se déclenche après le seuil,
  la notification apparaît, l'agent de diagnostic propose des évolutions.
- **Ne casse pas** la surveillance existante (pastille d'activité par projet) ni
  ne déclenche d'action automatique non validée.
