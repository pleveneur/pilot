# Rapport — gel de session Pilot (diagnostic, sans correction)

Date : 2026-11-15 · Projet : `G:\IA_PL\pilot` (v0.6.7) · Base : `35a04fc`
Nature : **diagnostic seul**. Aucun fichier de code n'a été modifié, aucun commit,
aucun tag, aucune version touchée.

---

## 1. Demande

L'application se **fige après l'appel d'un agent** et n'en sort qu'avec un
**redémarrage manuel**. Le défaut a été vu sur un **second poste**, où il est
**plus fréquent**, et un plantage a eu lieu pendant une demande sur un projet
(VoiceStudio). Hypothèse de départ à confirmer ou écarter : *une question posée
à l'utilisateur par un agent ne serait jamais affichée, l'attente devenant
infinie et figeant la file et l'interface.*

## 2. Méthode

Lecture ciblée du code, du niveau qui **gèle** vers le haut : boucle RPC
(`rpc_manager.rs`), propriétaire des sessions (`agent_service.rs`), commandes
Tauri (`pub fn` = synchrone, `pub async fn` = hors thread principal), bus
d'agents et relais des questions, extensions pi, filets automatiques
(`anomaly.rs`). **Chaque affirmation ci-dessous porte son fichier:ligne.** Ce
qui n'a pas pu être prouvé depuis le dépôt est signalé comme tel (§ 8).

## 3. Les deux niveaux de gel (ne pas les confondre)

| Niveau | Ce qui est bloqué | Symptôme perçu |
|---|---|---|
| **(a) `pi` bloqué** | l'agent n'émet plus jamais `agent_end` ; sa session reste « occupée » | la demande suivante est **mise en file** et ne part jamais ; le projet reste « en cours » |
| **(b) thread principal Tauri bloqué** | la boucle d'événements de la fenêtre (donc la WebView) | **l'interface ne peint plus, ne répond plus** ; seul un redémarrage rend la main |

Le symptôme rapporté (« il faut redémarrer ») est celui de **(b)**. Le défaut
**(a)** en est le **déclencheur** : c'est lui qui fait que les attentes de (b)
vont jusqu'à leur terme au lieu de revenir en quelques millisecondes.

---

## 4. Cause n° 1 (identifiée) — des commandes **synchrones** sur le thread
principal attendent `pi`, qui est justement occupé

Tauri exécute une commande déclarée `pub fn` **sur le thread principal** ; seule
une commande `pub async fn` est déportée. Le projet le dit lui-même, noir sur
blanc, dans le commentaire de la conversion déjà faite ailleurs :

> `src-tauri/src/agents.rs:537-542` — « `new_session` est une commande RPC
> **synchrone** qui attend la réponse du processus pi (jusqu'à 30 s […])
> Exécutée sur le main thread en `pub fn`, elle **gelait l'UI** pendant tout le
> handshake. Déportée dans `spawn_blocking` pour libérer le main thread ».

Le motif a donc **déjà été corrigé deux fois** (`new_agent_process_session`,
`set_agent_process_model` : `agents.rs:544`, `agents.rs:576`) — mais il subsiste
sur tout le **chemin chaud des agents** :

| Commande (toutes `pub fn` = thread principal) | Attente bornée | Preuve |
|---|---|---|
| `get_agent_state` | **8 s** si pi ne répond pas | `rpc.rs:673-677` |
| `get_agent_messages` | **30 s** (`send_command_sync` par défaut) | `rpc.rs:1035-1039` + `rpc_manager.rs:203-207` |
| `purge_agent_conversation_to` | **8 s + 8 s + 30 s + 30 s ≈ 76 s** (pire cas) | `rpc.rs:963`, `:984`, `:1014`, `:1019`, `:1029` |
| `get_agent_supervision` | accès **base de données par session** (`get_agent`) sous verrou | `dashboard.rs:1263` → `agent_service.rs:2361`, `:2378`, `:2384` |
| `get_project_agent_states` | prend `projects.lock()` | `rpc.rs:339` |

Le commentaire de `rpc_manager.rs:200-202` nomme lui-même la conséquence :
« *pour ne pas bloquer l'UI 30 s si pi est mort/bloqué* ». La borne existe,
**mais elle est consommée en entier** dès que pi est muet.

### 4.1 Fréquence réelle d'appel (c'est là que le gel se produit)

- `agent-pi.js:1678` — **avant chaque envoi de prompt**, `confirmActiveModel()`
  appelle `get_agent_state` (8 s de gel possible à chaque message).
- `agent-pi.js:8711-8724` — `waitForPiReady` **boucle** sur `get_agent_state`,
  jusqu'à 10 s, avec 400 ms entre deux essais : chaque tour peut bloquer le
  thread principal 8 s ; la boucle est appelée après un (re)démarrage de pi.
- `agent-activity.js:946` + `:968` — `get_agent_supervision` (la sonde
  **lourde**, avec accès DB) est appelée **toutes les 2 s** *et* à chaque
  événement `agent-state-changed`, **sans aucune garde de réentrance** (`refresh`
  n'est pas débouncé ; deux refresh peuvent se chevaucher).
- `super-agent.js:7544` et `dashboard.js:380` — même sonde lourde, en plus.
  Le socle possède pourtant la sonde **légère** prévue pour les boucles, et le
  dit : « **SEUL appel autorisé dans une boucle** » (`agent_service.rs:4475-4483`,
  `agent_activity_probe`).
- `super-agent.js:10421` — `purge_agent_conversation_to` est appelée **avant
  chaque délégation** (`delegate_to_coder`), jusqu'à 76 s de gel possible.

**Conclusion du § 4** : pendant qu'un agent travaille (donc pendant que `pi` est
occupé), chaque interaction de l'utilisateur déclenche des commandes qui
**attendent** sur le thread principal ; le poll 2 s s'y ajoute. Cumulé, le thread
principal passe son temps à attendre : plus rien n'est peint, l'interface paraît
morte, et **aucun bouton (même ⏹ Arrêter) ne répond** → redémarrage.

---

## 5. Cause n° 2 (identifiée) — une question d'agent qui n'a **aucune surface**
de réponse laisse `pi` en attente (le déclencheur du § 4)

Une extension qui appelle `ctx.ui.select/confirm/input` en mode RPC émet un
`extension_ui_request` et **pi attend la réponse sans limite** — le projet
l'écrit : `src-tauri/extensions/pilot-choices.ts:40-46`. Depuis le correctif du
défaut « la question expire sans prévenir », ces dialogues **n'ont plus aucune
échéance** : `HUMAN_DIALOG_NO_DEADLINE = Object.freeze({})`
(`pilot-choices.ts:60`, utilisé `:78`, `:128`, `:171`, `:216`). C'est un bon
correctif côté humain — mais il transforme toute question non rendue en attente
**illimitée**.

### 5.1 Le chemin d'une question d'un agent lancé par l'assistant

1. l'agent émet `extension_ui_request` → le bus le reçoit
   (`agents-bus.js:3068`, `handleExtensionUiRequest`) ;
2. s'il s'agit d'une question utilisateur, le bus **ne répond pas** (décision
   assumée, `agents-bus.js:3053-3071`) : il émet l'événement DOM
   `pilot-agent-relay-request` (`agents-bus.js:3128-3132`) ;
3. **le seul écouteur de cet événement est l'onglet 🧭** :
   `super-agent.js:7463`, et il est **retiré à la fermeture de l'onglet**
   (`super-agent.js:7669`) ;
4. si l'onglet 🧭 est fermé (ou la question arrive pour une porte interne, § 5.2),
   `window.dispatchEvent` n'a **aucun auditeur** : la question n'est affichée
   nulle part et **aucune réponse ne peut être produite**. Le bus le documente
   lui-même : « *Si aucun écouteur n'est présent […], la question reste EN
   ATTENTE* » (`agents-bus.js:3118-3119`).

L'agent du bus, lui, **ne peut plus avancer** : `pi` est bloqué sur la question,
donc `agent_end` n'arrive jamais, donc l'agent reste `busy`.

### 5.2 Les portes internes ne sont **jamais** rendues dans le bus

`isRelayableAgentChoice` exclut explicitement les portes internes (diff review,
action assistant, contrôle d'écran) et `editor` : `agent-choice-relay.js:47-69`.
Le bus, pour ces messages, se contente d'une notification et **ne répond pas** :

> `agents-bus.js:3097-3106` — « Porte INTERNE (le bus n'a pas de surface pour
> l'afficher) […] on ne répond PLUS à sa place. »

Il n'existe donc, pour ces portes : ni affichage, ni réponse, ni repli. Le seul
écran qui sait les traiter est l'onglet de l'agent (sentinelle
`PILOT_EDIT_GATE::`, `agent-pi.js:8901`), qui n'est pas actif quand la mission
tourne en arrière-plan. Note : la porte d'écriture n'est **pas** un défaut par défaut
(`confirm_file_edits: false`, `lib.rs:1207`), mais une fois activée par
l'utilisateur, elle bloque chaque `write`/`edit` de **600 s**
(`pilot-edit-gate.ts:43`), porte après porte.

### 5.3 Le filet annoncé ne débloque pas la question — il la **borne**

Le commentaire du bus affirme : « *la limite de 45 min déjà en place côté Rust
(`anomaly::AWAITING_USER_MAX_SUSPEND_SECS`) **empêche le gel de la file*** »
(`agents-bus.js:3069-3071`). **C'est inexact**, et c'est le cœur du diagnostic :

- `awaiting_user_suspends` (`anomaly.rs:399-404`) ne fait que **désarmer les
  filets automatiques** pendant 45 min (`anomaly.rs:488`, `:509`, `:548`, `:585`,
  `:630`) ; au-delà, les filets **reprennent la main** (`anomaly.rs:2284-2306`)
  mais **personne ne répond à la question** : pi reste bloqué jusqu'à ce qu'on
  le tue.
- Pour un agent lancé dans un **onglet** (hors bus), il n'existe **aucun**
  watchdog JS d'inactivité (seul le mode Orchestration en a un :
  `agent-pi.js:3534-3537`), et l'arrêt automatique Rust est **suspendu 45 min**
  par l'attente elle-même (`awaiting_user`) : le tour reste « en réflexion »
  jusqu'à **≈ 45 minutes**, en consommant les attentes du § 4 à chaque geste.
- Pour un agent du **bus**, le timeout d'inactivité JS (`agents-bus.js:2035-2050`,
  réglage `agent_timeout_ms`, défaut 600 000 ms : `lib.rs:1053`, `:2137`) arrête
  la run au bout de 10 min — donc le bus se débloque, mais **au prix de 10 min
  de file bloquée** pendant lesquelles chaque interaction de l'utilisateur gèle.
- Si l'utilisateur a désactivé l'arrêt automatique (`agent_auto_stop_enabled`,
  `lib.rs:816`/`:1264`), le § 4 n'a **plus aucune borne** : gel définitif.

---

## 6. Ce qui rend le défaut **plus fréquent sur un poste**

Tout ce qui augmente le **nombre d'appels synchrones par unité de temps** et le
**temps d'attente de `pi`** :

1. **Plus d'agents / plus de sessions** ⇒ `get_agent_supervision` fait un accès
   base **par session** (`agent_service.rs:2378`, `:2384`) toutes les 2 s ⇒ le
   thread principal est de plus en plus souvent occupé.
2. **Plus d'onglets ouverts** (onglet agent, tableau de bord, 🧭) ⇒ plusieurs
   consommateurs de la même sonde lourde (`agent-pi.js:1091`,
   `super-agent.js:7544`, `dashboard.js:380`).
3. **Un agent qui attend une question** (§ 5) ⇒ chaque `get_agent_state` et
   chaque `purge_agent_conversation_to` **consomme son timeout plein** (8 s à
   76 s) au lieu de quelques millisecondes.
4. **Modes Assistant seul / Vocal** ne changent pas la cause, mais gardent
   l'utilisateur devant un écran qui ne peint plus : le gel est plus visible.
5. **Projet volumineux** (VoiceStudio) ⇒ `git.rs:870/921/1088`,
   `dashboard.rs:889`, `code_check.rs:201/322` sont aussi des `pub fn`
   synchrones : lancés pendant une session d'agents, ils ajoutent leurs propres
   secondes de gel du thread principal.

---

## 7. Hypothèses **écartées** (avec leur preuve)

| Hypothèse | Verdict | Preuve |
|---|---|---|
| « la question expire au bout de 30 min, sans prévenir » (défaut A du diag antérieur) | **écartée** : les dialogues humains n'ont plus d'échéance | `pilot-choices.ts:60` (`HUMAN_DIALOG_NO_DEADLINE`), garde `src/js/extensions-ui-timeout.test.js:52` |
| « le bus répond à la place de l'utilisateur » (ancien comportement) | **écartée** : supprimé, aucune réponse inventée | `agents-bus.js:3053-3065` |
| « le verrou de run du projet reste fantôme à vie » | **écartée** : balayage périodique + grâce de démarrage | `agents-bus.js:1017`, `:981`, `:1246`, `RUN_LOCK_SWEEP_START_GRACE_MS` |
| « l'admission des missions ignore une session en attente » | **écartée** : `busy` périmé après `stale_grace`, et vivacité exigée | `rpc.rs:299-318` (`project_activity_is_busy`, `project_busy_with_liveness`) |
| « le mutex `sessions` est tenu pendant toute l'attente » | **écartée** : relâché avant `wait_response` (correctif v0.4.30) | `rpc_manager.rs:218-230`, `agent_service.rs:1989` |
| « l'ordre d'envoi d'un message à un agent gèle l'UI » | **écartée** : l'envoi est une simple écriture | `agents.rs:495-498` → `agent_service.send` |

## 8. Ce qui n'est **pas** prouvé ici

- Que `pi` accepte encore les commandes `get_messages` / `new_session` **pendant**
  qu'il attend une `extension_ui_response`. Le binaire `pi` n'est pas dans le
  dépôt (aucun `node_modules/@earendil-works/pi-coding-agent`), donc non
  vérifiable ici. Le fait que `pi` soit bloqué est en revanche écrit par le
  projet lui-même (`pilot-choices.ts:40-43`, `pilot-edit-gate.ts:47-49`).
- La **durée exacte** des accès base de `get_agent_supervision` sur la machine du
  propriétaire (aucune mesure instrumentée dans ce diagnostic).
- Le **plantage** observé pendant la demande sur VoiceStudio : il s'agit d'un
  arrêt de processus, pas d'un gel ; aucun élément du dépôt ne relie ce
  plantage au gel décrit ici. À traiter séparément (journal `stderr` de `pi`,
  `.pilot/agent-stops.log` du projet).

## 9. Correctif minimal proposé (non appliqué)

1. **Sortir du thread principal** les cinq commandes du § 4 : les passer en
   `pub async fn` + `spawn_blocking` (motif **déjà en place** et éprouvé,
   `agents.rs:544-560`). C'est la correction qui supprime le gel de
   l'interface ; elle ne change aucun comportement fonctionnel.
2. **Remplacer la sonde lourde par la sonde légère** dans les boucles et sur les
   événements : `agent_activity_probe` (`agent_service.rs:4482`) là où
   `get_agent_supervision` est appelé toutes les 2 s ou à chaque
   `agent-state-changed`, et ajouter une **garde de réentrance** au refresh
   (`agent-activity.js:944-956`). Réservir `get_agent_supervision` aux
   affichages ponctuels.
3. **Donner une surface aux questions non relayables** (`editor`, portes
   internes du bus) : soit les relayer comme les autres, soit — au minimum —
   les faire apparaître dans une barre unique et les laisser annulables
   explicitement, avec un **délai d'abandon visible** par l'utilisateur (jamais
   silencieux). Et corriger le commentaire inexact `agents-bus.js:3069-3071`
   (45 min **borne** le gel, il ne le débloque pas).

Ordre conseillé : (1) d'abord — il rend l'application utilisable même quand un
agent attend ; (2) ensuite — il réduit la charge ; (3) enfin — il supprime la
cause déclenchante.

VERDICT : cause identifiée
