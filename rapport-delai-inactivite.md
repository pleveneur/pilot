# Délai d'inactivité de Pilot — ce que fait réellement le réglage (v0.4.35)

> Rapport de VÉRIFICATION, lecture seule. Aucun fichier de code, aucune configuration,
> aucune version n'a été modifiée. Toutes les affirmations ci-dessous sont adossées à
> une preuve `fichier:ligne` ou à une valeur de configuration citée.

---

## 1. VERDICT (à lire en premier)

**Les « 5 minutes » et les « 10 minutes » désignent LE MÊME réglage : `agent_timeout_ms`.**
Ce ne sont pas deux mécanismes distincts. C'est une **valeur documentée périmée** face à
une **valeur de code à jour** :

| Source | Valeur annoncée | Nature |
|---|---|---|
| Documentation + aide intégrée | **5 min (300 000 ms)** | valeur **historique**, jamais mise à jour |
| Code (Rust + interface + front) | **10 min (600 000 ms)** | valeur **réelle par défaut** depuis le commit `31707a9` |

La documentation est fausse, le code est juste. Le passage 5 min → 10 min a été fait
dans le commit `31707a9` (« augmenter le timeout d'inactivité par défaut à 10 min,
issue #19 »), qui a modifié `index.html`, `src-tauri/src/lib.rs`, `src/js/agents-bus.js`
et `src/js/settings.js` — **mais pas les fichiers de documentation**.

**Trois précisions qui changent la réponse sur le poste du propriétaire :**

1. La valeur **réellement appliquée** sur cette machine n'est ni 5 ni 10 minutes :
   `config.json` contient `agent_timeout_ms = 1800000`, soit **30 minutes**
   (le maximum autorisé par l'interface). Si le propriétaire constate un arrêt vers
   10 minutes, ce n'est **pas** `agent_timeout_ms` qui a tiré.
2. Il existe bien **d'autres délais distincts**, et **deux d'entre eux valent 10 minutes
   par défaut** — c'est la source la plus probable de la confusion :
   `agent_auto_stop_minutes` (arrêt auto T2 d'un agent bloqué) et
   `super_agent_auto_stop_minutes` (plafond « réfléchit » de l'Assistant).
   Sur ce poste, seul le second est actif, **à 10 minutes**.
3. Il existe aussi un vrai délai de **5 minutes**, mais il concerne **un autre sujet** :
   la génération d'`AGENTS.md` par l'IA (`GENERATE_TIMEOUT_SECS = 300`). Ce n'est pas
   le même mécanisme et il n'est pas réglable.

---

## 2. Réponses numérotées

### 2.1 — Où est défini le délai d'inactivité, et quelle est sa valeur exacte ?

Trois endroits, cohérents entre eux à **600 000 ms (10 min)** :

| Endroit | Rôle | Preuve |
|---|---|---|
| `AppConfig::agent_timeout_ms` (Rust) | champ de configuration persistant | `src-tauri/src/lib.rs:591-592` |
| `default_agent_timeout_ms()` (Rust) | valeur par défaut si la clé est absente | `src-tauri/src/lib.rs:993` → `600000` |
| `DEFAULT_TIMEOUT_MS` (JS) | repli du front si la config est illisible | `src/js/agents-bus.js:78` → `600000` |
| `input type="number"` (interface) | valeur affichée par défaut | `index.html:572-573` → `value="600000"` |
| repli à l'enregistrement | si le champ est vide | `src/js/settings.js:2159` → `|| 600000` |

Valeur exacte : **600000 ms = 10 minutes**. Le champ `agent_timeout_ms` **n'est utilisé
par aucun code Rust** : il est seulement déclaré, doté d'un défaut et initialisé
(`lib.rs:591`, `:993`, `:1165`). Le minuteur est **entièrement côté JavaScript**
(`src/js/agents-bus.js:1683-1726`).

### 2.2 — Combien de délais de ce genre existent ?

**Au moins huit mécanismes d'expiration distincts.** Ils ne se substituent pas les uns
aux autres : ils couvrent des objets différents (run d'agents, codeur d'orchestration,
processus bloqué, verrou de projet, file d'attente, génération de doc).

| # | Réglage / constante | Valeur par défaut | Valeur sur ce poste | Portée exacte | Preuve |
|---|---|---|---|---|---|
| 1 | `agent_timeout_ms` | 10 min | **30 min** (`1800000`) | silence d'une **run d'agents** (bus) → la run s'arrête | `lib.rs:993`, `agents-bus.js:78`, `:1778` ; config réelle |
| 2 | `orchestration_idle_timeout_ms` | 2 min | 2 min | silence du **codeur en Mode Orchestration** (timer remis à zéro à chaque `text_delta`) | `lib.rs:430-431`, `:965` ; config réelle |
| 3 | `orchestration_test_timeout_ms` | 60 s | 60 s | durée max d'**un test/lint** (pas de l'agent) | `lib.rs:552-553`, `:987` |
| 4 | `agent_auto_stop_minutes` (T2) | **10 min** | 45 min (mais `agent_auto_stop_enabled = false`) | arrêt auto d'un **agent délégué bloqué** (processus tué) | `lib.rs:770-771`, `:954` ; `anomaly.rs:613-627` |
| 5 | `super_agent_auto_stop_minutes` | **10 min** | **10 min — ACTIF** | plafond « réfléchit » de l'**Assistant 🧭** | `lib.rs:780-781`, `:954` ; `anomaly.rs:808-817` |
| 6 | `stale_busy_grace_minutes` | 25 min | 25 min | **verrou fantôme** : `busy` remis à `false` sans tuer le process | `lib.rs:792-793`, `:955` ; `exclusivity-queue.js:104` |
| 7 | `anomaly_timeout_minutes` | 30 min | 30 min | **détection d'anomalie** (agent bloqué, notification) | `lib.rs:760-761`, `:953` |
| 8 | `QUEUED_ORPHAN_GRACE_MS` | 60 s | 60 s | **file d'attente sans porteur** (aucun agent actif) | `agents-bus.js:85` |
| — | `RUN_LOCK_SWEEP_MS` / `START_GRACE` / `MIN_IDLE` | 30 s / 60 s / 2 min | idem | balayage des **verrous orphelins** | `agents-bus.js:1011`, `:1014`, `:1021` |
| — | `RECENT_ACTIVITY_WINDOW_MS` / `STALE_BUSY_WINDOW_MS` | 2 min / 25 min | idem | seuils de la **sonde d'activité** | `exclusivity-queue.js:93`, `:104` |
| — | `watchdogConfirmDelayMs` | 7 s | 7 s | anti-faux-positif (double mesure) | `agents-bus.js:107` |
| — | `RUN_AGENTS_WATCHDOG_MS` | 15 min | 15 min | watchdog de run de l'**Assistant** | `super-agent.js:476` |
| — | `GENERATE_TIMEOUT_SECS` | **5 min** | 5 min | génération/MAJ d'`AGENTS.md` par l'IA — **autre sujet, non réglable** | `src-tauri/src/agents_md.rs:16`, `:28` |

**Les « réservations » n'ont aucun délai** : `src/js/reservations.js` ne contient ni TTL
ni expiration (recherche `TTL|ttl|EXPIR|expire` : 0 résultat). Elles sont **purgées à
l'arrêt** de la run (`agents-bus.js:3204-3214`), pas expirées par le temps.

### 2.3 — Que coupe exactement le délai quand il expire ?

Le minuteur d'inactivité (`src/js/agents-bus.js:1683-1726`) fait, **dans cet ordre** :

1. **Réarme** à chaque événement d'agent : `resetTimeout` est appelé sur chaque
   `message_update`, `tool_execution_*`, `turn_start`, `agent_end`… (`:1700`,
   `handleAgentEvent` → `rp(ctx)`). **Une lecture longue ou une compilation ne sont donc
   pas comptées comme de l'inactivité**, tant que le processus pi émet quelque chose.
2. À l'échéance : `emit("error", …)` avec le message
   « Timeout d'inactivité pour <agent>. Augmentez le timeout dans Paramètres
   (agent_timeout_ms). » (`:1692-1693`).
3. **Vérifie le disque** avant de conclure : `workOnDiskDuringRun` lit `git status`
   (`:221-232`, appel `:1698`). C'est ce qui décide du sort de la mission.
4. **Livre la mission** : `done` (travail présent sur le disque, la mission n'est **pas**
   un échec) ou `error` (aucun travail nouveau détecté) — `:1699-1709`.
5. **Notifie le bureau** (`:1711-1715`).
6. **Arrête** via l'entonnoir unique `stopAgentWithTrace({reason:"idle-timeout",
   detected:"no-event"})` → `stopAgentsRun({silent:true, runKey})` (`:1716-1726`).

Ce que `stopAgentsRun` coupe réellement (`:3137-3222`) :

* **les agents ACTIFS de CETTE run seulement** — `abort_agent_process` avec
  `expectedUid` (garde de propriété) : `:3178-3199`. Les agents d'une **autre run /
  autre projet ne sont pas touchés** (`onlyKey` filtre les clés, `:3158-3163`).
* **les réservations de fichiers** des projets de cette run : `deleteReservations`
  (`:3194-3214`).
* **le verrou de la run** (donc du projet pour cette run) via `endRun(project,
  generation)` (`:3216-3221`, définition `:699-725`) — protéger par génération, une run
  tardive ne détruit pas la nouvelle.

Ce qu'il **ne coupe pas** : la **file d'attente partagée du projet**
(`projectExclusivityQueues`, indexée par projet, elle survit à la suppression du
contexte de run — `agents-bus.js:363-367`). Conséquence importante : une demande qui
attendait dans cette file porte la clé de **sa** run propriétaire (`ownerRunKey`) ;
cette run ayant été supprimée, la demande **n'est pas relancée** — elle est
**conservée** en file, **tracée** (`queue-replay-no-owner`) et **signalée** à
l'utilisateur (`:1638-1665`). Elle n'est pas perdue, mais elle est **inerte**.

**Le travail déjà produit :**

* **conservé** — aucun code d'arrêt ne supprime, n'annule ni ne « rollback » un fichier ;
  au contraire, l'arrêt **constate** le travail sur disque via `git status` (`:221-232`).
* **pas rejoué** par ce mécanisme — le timeout n'appelle aucune relance ; il termine la
  run et rend la main.
* **la mission n'est pas perdue** : elle reçoit un rapport « run interrompue, travail
  présent sur le disque » (`:1699-1706`).

### 2.4 — Où la documentation ou l'interface annonce 5 minutes, et quelle valeur devrait être annoncée ?

| Emplacement | Texte | Preuve |
|---|---|---|
| Spec source (bloc `HELP`, origine de l'aide intégrée) | « si un agent reste silencieux trop longtemps (**5 min par défaut**), la run s'arrête » | `spec_gestion_agents.md:38` |
| Spec source, tableau des garde-fous | « Timeout d'inactivité : **300 s (5 min, défaut)**. Relevé de 120 s → 300 s… » | `spec_gestion_agents.md:366` |
| Aide intégrée **générée** (ne pas éditer à la main) | même phrase, « 5 min par défaut » | `help/handbook.md:1020` |
| Rapport antérieur déjà au courant | « annoncent un timeout d'inactivité de 5 min par défaut ; le code utilise `agent_timeout_ms` = 600000 ms (10 min) » | `target/rapport-doc-supervision-agents.md:82` |

**Ce qui devrait être annoncé : 10 minutes (600 000 ms) par défaut**, et non 5 minutes.
Correction à porter dans `spec_gestion_agents.md` (lignes 38 et 366), puis
régénération de `help/handbook.md` par `npm run build:handbook`.

⚠️ **Ne pas « corriger » `spec_agents_md.md:76`** (« Timeout : 300 s (5 min) ») : cette
mention est **juste**, elle décrit un **autre** mécanisme — la génération d'`AGENTS.md`
(`src-tauri/src/agents_md.rs:28`, `GENERATE_TIMEOUT_SECS = 300`).

Note d'interface : l'écran ne dit jamais « 5 min » ni « 10 min ». Le libellé est
« **Timeout d'inactivité (ms) :** » avec une valeur en millisecondes
(`index.html:572`), bornée entre `min="10000"` et `max="1800000"` (`:573`). L'unité en
millisecondes explique qu'un écart de valeur passe facilement inaperçu.

### 2.5 — L'utilisateur peut-il régler cette valeur, et où ?

**Oui**, à trois niveaux :

1. **Interface** : Paramètres → section Agents → champ
   **« Timeout d'inactivité (ms) »** (`index.html:572-573`), bornes 10 000 ms → 1 800 000 ms
   (10 s → 30 min). Chargé depuis la config (`src/js/settings.js:1348`), enregistré par
   `save_config` (`src/js/settings.js:2159`).
2. **Fichier de configuration** : `%APPDATA%\com.pilot.editor\config.json`, clé
   `agent_timeout_ms` (version installée) ; `com.pilot.editor.dev` pour la version de
   développement. Valeurs réelles relevées : **1800000 (30 min)** en installé,
   **1200000 (20 min)** en dev.
3. **Le délai n'est lu qu'au démarrage du bus** : `busState.timeoutMs =
   config.agent_timeout_ms || DEFAULT_TIMEOUT_MS` (`src/js/agents-bus.js:1778`). Un
   changement de valeur demande donc un rechargement de la configuration du bus
   (réouverture de session / redémarrage de l'application) pour être pris en compte.

---

## 3. PREUVES (fichier:ligne)

**Définition et valeur du délai**
- `src-tauri/src/lib.rs:591-592` — `#[serde(default = "default_agent_timeout_ms")] agent_timeout_ms: u32`
- `src-tauri/src/lib.rs:993` — `fn default_agent_timeout_ms() -> u32 { 600000 }`
- `src-tauri/src/lib.rs:1165` — initialisation `agent_timeout_ms: default_agent_timeout_ms()`
- `src/js/agents-bus.js:78` — `const DEFAULT_TIMEOUT_MS = 600000; // 10 min d'inactivité`
- `src/js/agents-bus.js:1778` — `busState.timeoutMs = busState.config.agent_timeout_ms || DEFAULT_TIMEOUT_MS;`
- `index.html:572-573` — libellé + `value="600000" min="10000" max="1800000"`
- `src/js/settings.js:1348` / `:2159` — lecture / enregistrement (repli `600000`)

**Mécanisme d'expiration**
- `src/js/agents-bus.js:1683-1726` — `resetTimeout` : réarmement, message, sondage disque,
  règlement de la mission, notification, arrêt tracé
- `src/js/agents-bus.js:221-232` — `workOnDiskDuringRun` (preuve de travail par `git status`)
- `src/js/agents-bus.js:3137-3222` — `stopAgentsRun` (portée `runKey`, `abort_agent_process`
  avec `expectedUid`, purge des réservations, `endRun`)
- `src/js/agents-bus.js:363-367` — file d'exclusivité **partagée par projet**
- `src/js/agents-bus.js:1638-1665` — demande en file sans propriétaire : **conservée**, tracée
- `src/js/agents-bus.js:699-725` — `endRun` (libération du verrou, protégée par génération)

**Autres délais (preuves du tableau §2.2)**
- `src-tauri/src/lib.rs:953` — `anomaly_timeout_minutes` = 30
- `src-tauri/src/lib.rs:954` — `default_agent_auto_stop_minutes` = **10**
- `src-tauri/src/lib.rs:955` — `stale_busy_grace_minutes` = 25
- `src-tauri/src/lib.rs:965` — `orchestration_idle_timeout_ms` = 120000
- `src-tauri/src/lib.rs:987` — `test_timeout_ms` = 60000
- `src-tauri/src/anomaly.rs:808-817` — plafond super-agent (`super_agent_auto_stop_minutes`)
- `src-tauri/src/agents_md.rs:16`,`:28` — `GENERATE_TIMEOUT_SECS: u64 = 300` (**5 min**, autre sujet)
- `src/js/agents-bus.js:85`,`:1011`,`:1014`,`:1021`,`:107` — 60 s, 30 s, 60 s, 2 min, 7 s
- `src/js/super-agent.js:476` — `RUN_AGENTS_WATCHDOG_MS = 15 * 60 * 1000`
- `src/js/exclusivity-queue.js:93`,`:104` — 2 min, 25 min

**Documentation annonçant 5 minutes**
- `spec_gestion_agents.md:38` — « 5 min par défaut »
- `spec_gestion_agents.md:366` — « 300 s (5 min, défaut) »
- `help/handbook.md:1020` — copie générée de la même phrase
- `target/rapport-doc-supervision-agents.md:82` — écart déjà constaté (non corrigé)

**Historique du changement 5 min → 10 min**
- commit `31707a9` — « fix(agents): augmenter le timeout d'inactivité par défaut à 10 min
  (issue #19) » modifiant `index.html`, `src-tauri/src/lib.rs`, `src/js/agents-bus.js`,
  `src/js/settings.js` — **et aucun fichier `.md`**
- commit `3e1a782` — « fix: agents idle timeout too short + misleading stop message (#10) »
  (passage antérieur 120 s → 300 s)

**Configuration réelle relevée (lecture seule)**
- `%APPDATA%\com.pilot.editor\config.json` :
  `agent_timeout_ms = 1800000` (30 min), `agent_auto_stop_enabled = false`,
  `agent_auto_stop_minutes = 45`, `super_agent_auto_stop_enabled = true`,
  `super_agent_auto_stop_minutes = 10`, `stale_busy_grace_minutes = 25`,
  `anomaly_timeout_minutes = 30`, `orchestration_idle_timeout_ms = 120000`
- `%APPDATA%\com.pilot.editor.dev\config.json` : `agent_timeout_ms = 1200000` (20 min)

**Journal des arrêts (preuve négative, portée limitée)**
- `.pilot/agent-stops.log` — 11 lignes, du 2026-10-20T08:21:23Z au 2026-10-20T09:25:27Z :
  10 × `stale-session-restart` + 1 × `queue-abandoned`, **aucune ligne `idle-timeout`**.
  Sur cette fenêtre, le délai d'inactivité n'a jamais été la cause écrite d'un arrêt.

---

## 4. NON PROUVÉ

- **Quel délai exact le propriétaire a « vu » à l'œuvre.** Aucune trace d'arrêt horodatée
  ne permet de rattacher son observation à un mécanisme précis : le journal
  `.pilot/agent-stops.log` ne couvre qu'une heure (2026-10-20, 08:21 → 09:25 UTC) et le
  journal global `<app_data_dir>/agent-stops.log` est **absent** sur ce poste.
  Un arrêt à ~10 minutes n'a produit aucune ligne exploitable ici.
- **L'hypothèse la plus probable pour un « arrêt à 10 minutes »** — `super_agent_auto_stop_minutes`
  = 10 min, actif sur ce poste — reste une **déduction par élimination** (c'est le seul
  seuil à 10 min activé, `agent_timeout_ms` étant à 30 min et T2 désactivé), **pas une
  preuve d'occurrence**. Pour la prouver à 100 %, il faudrait : (a) la ligne
  correspondante dans le journal d'arrêts avec son horodatage, et (b) la preuve que la
  session observée était bien celle de l'Assistant et non celle d'un agent de projet.
- **La raison pour laquelle l'interface affiche des millisecondes** (choix de conception)
  n'est documentée nulle part : non établi, sans incidence sur la question posée.

---

## 5. Correction suggérée (NON appliquée, pour mémoire)

Périmètre minimal, à faire dans une passe dédiée :

1. `spec_gestion_agents.md:38` et `:366` — remplacer « 5 min / 300 s » par
   « **10 min / 600 000 ms** » (valeur réelle de `default_agent_timeout_ms`).
2. Régénérer l'aide : `npm run build:handbook` (met à jour `help/handbook.md:1020`).
3. Optionnel (confort) : dans `index.html:572`, indiquer l'équivalence en minutes dans le
   libellé, pour rendre l'écart 5 / 10 / 30 min immédiatement lisible.
4. Test qui aurait empêché le défaut : un test unitaire (côté `src/js`) qui compare la
   valeur annoncée dans le bloc `<!-- HELP:... -->` de `spec_gestion_agents.md` et la
   valeur de `DEFAULT_TIMEOUT_MS` / `default_agent_timeout_ms()` — la doc et le code ne
   pourraient plus diverger en silence.
