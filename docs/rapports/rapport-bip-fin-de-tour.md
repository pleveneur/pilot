# Rapport — le bip de notification sonne trop tôt

Mission : le son de l'assistant doit partir à la **fin réelle du tour** (tout affiché),
jamais sur un événement intermédiaire. Diagnostic d'abord (ce document, écrit AVANT
toute modification), correction ensuite.

---

## 1. Où le son est-il déclenché ?

### Côté cœur Rust : aucun déclenchement

Le cœur **ne décide pas du moment**. Il expose une seule commande :

| Lieu | Rôle |
|---|---|
| `src-tauri/src/lib.rs:1877` | `ASSISTANT_NOTIFY_SCRIPT` = `include_str!("../assets/notify.ps1")` (script embarqué) |
| `src-tauri/src/lib.rs:1886` | `ensure_assistant_notify_script` : installe le script s'il est absent, **jamais écrasé** |
| `src-tauri/src/lib.rs:1913` | `play_assistant_sound(sound_type, volume)` : lance PowerShell en **fire-and-forget** (`cmd.spawn()`, `CREATE_NO_WINDOW`) |
| `src-tauri/src/lib.rs:3313` | enregistrement de la commande Tauri |
| `src-tauri/assets/notify.ps1` | synthèse WAV + `PlaySync()` — **le son lui-même** (fréquence, volume : hors sujet ici) |

Recherche exhaustive : `grep -rn "play_assistant_sound"` → uniquement `settings.js:1427`
(test de volume dans les Paramètres) et `desktop-notify.js:225`. **Aucun** événement
Rust (agent_end, arrêt, file, Telegram, watcher) n'invoque le script. Le cœur est donc
hors de cause : c'est l'**interface** qui choisit le moment. Pas de test Rust à ajouter.

### Côté interface : 5 sites, 3 familles

| # | Site | Déclencheur | Son |
|---|---|---|---|
| 1 | `src/js/super-agent.js:6254` (`sendSuperAgentReport`) | un compte rendu de tâche **déléguée** est remis à l'Assistant | `fin` **armé** (différé) |
| 2 | `src/js/super-agent.js:6407` (`playSound: armDoneSound`, via `run-agents-notify.js:121`) | **fin d'une run d'agents** délégués | `fin` **armé** (différé) |
| 3 | `src/js/super-agent.js:4082`, `4108`, `5008` (`handleSuperAgentExtensionUiRequest`) | l'Assistant **pose une question** (confirm / select / input non-sentinelle) | `attention` joué immédiatement |
| 4 | `src/js/super-agent.js:3895` (déconnexion après grâce) | anomalie de suivi (connexion perdue) | `point` immédiat |
| 5 | `src/js/agents-bus.js` → `notifyAgentDone` (P7) | arrêt automatique d'agent | notification (pas de son) |

Le lecteur différé `src/js/sound-deferred.js` porte les cas 1 et 2 : `arm()` pose le
son, `activity(source)` signale « du texte arrive », `idle(source)` signale « rendu au
repos ». Le repos est signalé par :

- `src/js/super-agent.js:1187` `flushSuperRenderThenSoundIdle()` → double
  `requestAnimationFrame` puis `markSoundRenderIdle("superagent")` ; appelé **une fois**
  dans le bloc `agent_end` (`super-agent.js:3856`) ;
- `src/js/agent-pi.js:6326` `flushAgentRenderThenSoundIdle()` → `markSoundRenderIdle("agent")` ;
  appelé dans `agent_end` (`agent-pi.js:6506`) **après** la garde `isTerminalAgentEnd`
  (`agent-pi.js:6480`).

---

## 2. Pourquoi le son peut partir trop tôt — cause par cause

### Cause A (retée) — le délai de sécurité joue le son **au milieu d'un tour**

`src/js/sound-deferred.js:91-97` :

```js
function restartSafety() {
  clearSafety();
  safetyTimer = schedule(() => {
    safetyTimer = null;
    if (armed) emit();          // ← aucune vérification des surfaces actives
  }, safetyMs);                 // ← safetyMs = 12 000 ms
}
```

`activity()` (`sound-deferred.js:120-124`) **repousse** ce délai mais ne l'annule pas, et
le rappel ne regarde **pas** `activeSources` : après **12 s sans nouveau delta**, le son
part, *même si une surface est encore marquée en écriture*.

Or un tour d'agent comporte des **étapes silencieuses** : appel d'outil long (build,
série de tests, `npm test`, `cargo build`, `run_agents`…), attente du premier token d'un
modèle lent, réflexion non streamée. Pendant ces silences, aucun `text_delta` /
`thinking_delta` n'arrive → le minuteur échoue → **bip alors que l'agent travaille
encore, et que la suite du message n'est pas affichée**. C'est exactement le symptôme
décrit. Le test `sound-deferred.test.js` « chaque écriture repousse le délai de
sécurité (jamais de son pendant le flux) » **entérine ce comportement** (il vérifie que
le son part 100 ms après la dernière activité *alors que la surface est toujours
active*).

### Cause B — le son armé est consommé par un tour qui n'est **pas** celui du sujet

`sendSuperAgentReport` arme le son **avant** l'injection et sans regarder `opts.defer`
(`super-agent.js:6251-6261`). Or la porte (`super-agent-reports.js:66-72`) pose
`defer: true` quand l'Assistant est **occupé** : le compte rendu est alors écrit en base
mais **pas affiché**. Le son reste armé et part **à la fin du tour en cours** (celui de
l'utilisateur, sans rapport), puis le **rejeu** Rust livre le compte rendu (`super-agent.js:2844`,
et la sonde de 2 s `super-agent.js:3339`) → l'Assistant **repart en réflexion** juste après
le bip. Même schéma pour `emitRunAgentsFinishNotice` (`run-agents-notify.js:121`) : le son
est armé à la fin de la run, la consignation pouvant être différée.

### Cause C — un `agent_end` **non terminal** est traité comme la fin du tour

L'onglet agent est protégé : `agent-pi.js:6480` `if (!isTerminalAgentEnd(payload)) break;`.
Le chat de l'Assistant **ne l'est pas** : `super-agent.js:3835` entre directement dans le
bloc `agent_end` et appelle `flushSuperRenderThenSoundIdle()` (`super-agent.js:3856`).
Or `agent_end` n'est pas forcément terminal : `willRetry: true` (erreur transitoire,
troncature, compaction, continuation) puis **reprise** — fait déjà constaté et corrigé
pour les agents délégués (`spec_super_agent.md` F5, `agent-hardening.js:31-34`
`shouldFinalizeOnAgentEnd`). Sur la reprise, le bip vient de partir et l'Assistant
**reprend sa réflexion**.

### Cause D (écartée) — côté Rust / script

`notify.ps1` ne fait que jouer un WAV (`PlaySync()`), appelé une seule fois par
invocation. Aucun doublon possible au niveau du script ; `CREATE_NO_WINDOW` et le
`spawn` détaché n'introduisent pas d'avance de déclenchement.

### Cause E (écartée) — le son « question posée »

`attention` (`super-agent.js:4082/4108/5008`) part **au moment où la question est
affichée** : la demande `extension_ui_request` arrive quand le modèle est **suspendu**
en attente de la réponse. C'est bien un « besoin de moi » réel ; aucun correctif de
moment n'est nécessaire (les variantes sentinelles — actions assistant, DB, mémoire,
run_agents — sortent avant l'appel, donc sans son).

---

## 3. Cause la plus probable (tranchée)

**A, puis B, puis C** — par ordre de fréquence :

1. **A** explique le cas quotidien (« le son part, et il réfléchit encore ») : tout tour
   contenant une étape silencieuse de plus de 12 s (appel d'outil) fait sonner le bip
   au milieu du tour.
2. **B** explique le cas « le son part juste avant que l'Assistant reparte » : compte
   rendu différé (Assistant occupé) → bip à la fin du tour courant, puis rejeu et
   nouvelle réflexion.
3. **C** explique les cas de reprise (retry / compaction) où le bip précède une reprise.

Aucune de ces causes n'est côté cœur : la correction est donc **entièrement dans
l'interface** (et testable en JS).

---

## 4. Correction appliquée

Principe retenu, appliqué aux DEUX côtés du lecteur différé : **« la fin, pas le milieu »**.
Aucune fréquence, aucun volume, aucun réglage utilisateur n'a été touché : seul le
MOMENT du son change.

### 4.1 `src/js/sound-deferred.js` — deux règles (cœur du correctif)

| Règle | Où | Ce qu'elle empêche |
|---|---|---|
| **R1 — le silence n'est pas une fin de tour** | `restartSafety()` `:120-140` | Le minuteur de sécurité ne joue plus le son s'il reste **une seule** surface en écriture : il se replanifie. Un appel d'outil de 10 min, une réflexion non streamée ou un modèle lent ne peuvent plus faire sonner le bip au milieu du tour. |
| **R2 — le son appartient au tour qui AFFICHE le sujet** | phases `arm()` `:147`, `activity()` `:161`, `idle()` `:172-186` | Un son armé alors qu'un tour écrit déjà (`awaitRunEnd`) n'est **pas** joué à la fin de ce tour : il attend la première écriture d'un tour **postérieur** (`awaitRunStart`) puis son repos. Couvre la remise **différée** d'un compte rendu (Assistant occupé) et la fin de run d'agents : plus de bip juste avant que l'Assistant reparte réfléchir. |

Conservé tel quel : un seul son par fin de mission (`arm()` ignoré si déjà armé),
fenêtre anti-doublon `coalesceMs = 1 500`, remise à zéro par `reset()` aux
interruptions (arrêt manuel, échec de processus, annulation de run), fail-open si
l'émetteur est absent ou lève.

### 4.2 Le tour est « occupé » dès son DÉBUT, pas à son premier mot

| Fichier | Changement |
|---|---|
| `src/js/super-agent.js:3843` | `noteSoundRenderActivity("superagent")` sur `agent_start` |
| `src/js/agent-pi.js:6438` | `noteSoundRenderActivity("agent")` sur `agent_start` |

Sans cela, la fenêtre entre le lancement d'un tour et son premier delta (modèle
lent) laissait la surface « au repos » : un compte rendu arrivant pendant ce
silence était armé en phase `awaitIdle` et le bip partait à la fin du tour en
cours (cause B).

### 4.3 Un `agent_end` non terminal ne clôt plus le tour (cause C)

`src/js/super-agent.js:1187-1196` : `flushSuperRenderThenSoundIdle(event)` refuse
désormais de déclarer le rendu au repos quand `shouldFinalizeOnAgentEnd(event)`
est faux (`willRetry: true` → reprise). Même garde que l'onglet agent
(`agent-pi.js:6480`, `isTerminalAgentEnd`).

### 4.4 Ce qui n'a PAS été touché

- **Aucun changement Rust** : le cœur ne décide pas du moment (§1) ; `notify.ps1`,
  la fréquence, le volume et la commande `play_assistant_sound` sont intacts.
- **Son « attention » (question posée)** : inchangé — il part quand la question
  s'affiche, c'est-à-dire quand le modèle est **suspendu** (vraie attente de vous).
- **Son « point » (anomalie)** et notifications desktop/Telegram : inchangés.
- **Aucun réglage** ajouté, retiré ou modifié ; le son reste désactivé par défaut.
- **Lancement/file/arrêts d'agents** : pas touchés.

---

## 5. Preuves

### 5.1 Tests ajoutés / durcis — `src/js/sound-deferred.test.js`

| Test | Ce qu'il prouve |
|---|---|
| « un long silence au milieu du tour (outil long, réflexion muette) ne joue AUCUN son » | 10 s + 5 s de silence pendant que la surface écrit → **0 son** ; `idle()` (fin réelle) → **1 son** |
| « un signal de fin pendant un tour en cours ne sonne ni à sa fin ni au silence suivant » | remise différée : phase `awaitRunEnd`, `idle()` du tour en cours → **0 son**, silence prolongé → **0 son**, puis tour du compte rendu → **1 son** |
| « un tour relancé (agent_end non terminal) ne sonne pas ; la fin réelle sonne une fois » | reprise en cours de tour → **0 son** avant la fin réelle |
| « chaque écriture repousse le délai de sécurité » (durci) | l'échéance qui tombe **pendant** l'écriture ne sonne pas (ancien comportement : elle sonnait) |
| « fin de tour d'un autre onglet : un seul son, jamais de doublon » | pas de double bip |
| 2 tests de branchement (lecture de source, CRLF normalisé) | `agent_start` marque la surface occupée dans les deux chats ; garde `shouldFinalizeOnAgentEnd` + appel avec `payload` |

### 5.2 Non-vacuité (obligatoire, fait avant de committer)

Fix neutralisé volontairement (minuteur qui joue sans vérifier les surfaces,
armement sans phase, `agent_start` sans activité, garde terminal retirée)
→ `sound-deferred.test.js` : **6 FAIL** (les 4 règles de moment + les 2 gardes de
branchement), dont les 3 nouvelles preuves. Fix restauré → **21 PASS / 0 FAIL**.
Aucun test ne passe donc « à vide ».

### 5.3 Suites complètes

| Commande | Résultat |
|---|---|
| `npm test` | **120 fichiers, 2062 tests PASS** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **651 PASS, 1 ignoré** |
| `npm run build` | OK — **aucun avertissement nouveau** (seuls les avertissements préexistants : imports dynamiques de `sidebar.js` / `search-panel.js`, taille de chunk) |
| `npm run build:handbook` | handbook régénéré (bloc `super-agent`) |

### 5.4 Documentation

`spec_super_agent.md` (§ Notifications natives, § Son de notification, bloc
`<!-- HELP:super-agent -->`) : le son « fin » est **armé** à la fin de run et joué
à la fin réelle de l'affichage ; **jamais au milieu d'un tour** (un silence n'est
pas une fin de tour) ; un compte rendu différé sonne à la fin du tour qui
l'affiche. `help/handbook.md` régénéré en conséquence.

---

## 6. Verdict

Cause retenue : **A** (délai de sécurité qui joue le son pendant une étape muette
du tour), puis **B** (son armé consommé par le tour en cours alors que le sujet
n'était pas encore affiché), puis **C** (`agent_end` non terminal traité comme la
fin du tour). Les trois sont corrigées côté interface, sans toucher au son
lui-même ni au cœur Rust.

