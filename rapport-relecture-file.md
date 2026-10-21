# Rapport de relecture — corrections P2 / P1 / P3 de la file d'attente et du verrou

- **Date** : 2026-10-20
- **Dépôt examiné** : `3c67064` (`chore: bump version to 0.4.35`), branche `main`
- **Nature** : relecture en **lecture seule**. Aucune ligne de code modifiée, aucun commit, aucun tag, aucune publication. Seul ce fichier a été écrit.
- **Outil de listage des sessions d'agents** : **non utilisé** (interdit par la mission).

---

## 0. Verdict

| Défaut | Correctif attendu | Verdict |
|---|---|---|
| **P2** — un arrêt d'agent vide une file non vide sur verrou périmé | `rapport-p2-file-conservee.md` | **NON CONFORME** |
| **P1** — la file n'est pas consultée à l'admission (dépassement) | `rapport-p1-ordre-arrivee.md` | **NON CONFORME** |
| **P3** — clé de projet comparée en chaîne brute | `rapport-p3-cle-projet.md` | **NON CONFORME** |

**Verdict général : NON CONFORME.**

**Motif** : les trois corrections **n'existent pas**. Ce n'est pas un désaccord sur la qualité d'un correctif, c'est l'absence de correctif. Les trois défauts décrits par `rapport-file-attente-pertes-doublons.md` sont **intacts**, aux mêmes lignes, dans le code en vigueur.

---

## 1. Preuve de l'absence des corrections (et non de leur insuffisance)

Vérifications faites, dans cet ordre :

1. **Les trois rapports annoncés sont absents du disque** :
   `rapport-p2-file-conservee.md`, `rapport-p1-ordre-arrivee.md`, `rapport-p3-cle-projet.md` → aucun des trois n'existe (recherche par nom et par motif `*p1*` / `*p2*` / `*p3*` à la racine : zéro résultat).
2. **Aucun commit correspondant** : `git log --all --oneline` s'arrête à `3c67064`. Les 20 derniers commits ne contiennent aucun correctif de file d'attente (les plus récents sur le sujet sont `5f8254d`, `d96643c`, `66941b2`, tous **antérieurs** au diagnostic et traités par lui).
3. **Dernier commit touchant le fichier central** : `git log -- src/js/super-agent.js` → `3e2b362` (`fix(sound)`), soit un commit **sans rapport** avec la file. Le fichier n'a pas été touché depuis le diagnostic.
4. **Arbre de travail propre côté code** : `git status --short` ne signale **que deux fichiers non suivis**, tous deux des rapports Markdown (`geminiReport.md`, `rapport-file-attente-pertes-doublons.md`). Aucun fichier de `src/js/` modifié.
5. **Aucune branche ne porte ce travail** : `git log main..<branche>` est vide pour les branches examinées (`correctifs-lot1`, `verrou-par-projet`, `fix/defaut-b-purge-busy`, `gds-refonte-l1`). Aucun stash.

> Une correction « en file mais pas encore exécutée » produirait exactement cet état. **Non prouvé** : je n'ai pas cherché l'état de la file de missions en mémoire (interdiction d'utiliser `list_agent_sessions`). Ce qui est **prouvé**, c'est qu'à l'instant de cette relecture **aucun correctif n'est écrit dans le code**.
>
> Observation factuelle : pendant cette relecture, un fichier non suivi de plus est apparu à la racine (`rapport-delai-inactivite.md`) — d'autres agents travaillent donc bien en parallèle. Les trois missions de correction P1/P2/P3, elles, n'ont produit **ni rapport, ni commit, ni modification**.

---

## 2. P2 — destruction d'une file non vide par un arrêt d'agent

### 2.1 Le comportement fautif est toujours là — preuve `fichier:ligne`

`src/js/super-agent.js`, branche `action === "stop_agent"` :

- `:5228` — `const queueKey = (info.project && String(info.project).trim()) || window._pilotProjectPath || ".";` → clé = **chaîne brute** (voir aussi P3).
- `:5230` — `const stillRunning = isRunInProgress(queueKey);` → la décision « le projet est-il libre ? » repose **uniquement** sur l'état du bus.
- `:5231` — `const waitingMissions = (runAgentsQueueByProject[queueKey] || []).length;`
- `:5237-5242` — si `!stillRunning` **et** `waitingMissions > 0` :
  `const abandoned = await abandonQueuedRunAgentsMissions(queueKey, { detected: "stop-agent" });` puis `delete runAgentsQueueByProject[queueKey];`

**Le défaut est donc littéralement en place** : file non vide + verrou de bus jugé libre → **la file est détruite**.

### 2.2 Le mécanisme de la perte est intact

`isRunInProgress` (`src/js/agents-bus.js:3101-3118`) ne lit que `busState.runs` (contextes de run du bus). Il **ne sonde pas les processus vivants**. Un verrou déjà relâché (run précédente terminée, `releaseStuckRunLock` appelé juste avant à `:5229`, agent parqué, relance `stale-session-restart`) rend « projet libre » alors que des agents tournent encore → `:5237` s'ouvre → file détruite.

C'est exactement la chaîne prouvée au journal le 2026-10-20 à `09:25:10.347Z` (`.pilot/agent-stops.log` : `op=auto-stop reason=queue-abandoned detected=stop-agent project=G:\IA_PL\pilot detail=#14 …`), et **rien n'a changé** depuis.

### 2.3 Le même trou existe pour la file d'assistant

`src/js/super-agent.js:5259-5266` : même schéma sur `assistantKey = ASSISTANT_SPACE` (`releaseStuckRunLock` → `isRunInProgress` → `abandonQueuedRunAgentsMissions(assistantKey, …)`). Même verdict.

### 2.4 La sonde correcte existe déjà dans le fichier et n'est pas utilisée ici

`src/js/super-agent.js:802-820` — `isRunStillActive(runProject)` : appelle `releaseStuckRunLock` puis `isRunInProgress` **puis** interroge `list_agent_sessions` pour savoir si un agent travaille réellement. C'est la sonde que le rejeu de file utilise (`:837`). `stop_agent:5230` utilise `isRunInProgress` seul : **l'écart est visible dans le même fichier**, ce qui rend le correctif de P2 peu risqué (réutiliser `isRunStillActive`).

### 2.5 Test de non-régression

- Le test nommé par le diagnostic (`src/js/file-attente-arret-conserve.test.js`) **n'existe pas**.
- Il n'existe **aucun** test qui vérifie « arrêt d'agent avec file non vide et agent vivant → 0 abandon ».
- Conséquence : la vérification demandée (« le test échoue-t-il si l'on remet l'ancien comportement ? ») est **sans objet** — il n'y a pas de test. Je n'ai rien modifié pour l'éprouver.

### 2.6 Régression inverse — point **critique** pour le codeur de P2

Le comportement fautif est **verrouillé par un test existant** :

- `src/js/verrou-par-projet.test.js:613-626`, describe « **POINT C — l'arrêt d'un agent libère la file de missions du projet** », avec le commentaire explicite : *« la branche stop_agent libère le créneau et vide la file de missions »*. Assertions :
  `expect(branch).toContain("abandonQueuedRunAgentsMissions(queueKey");` (`:625`) et `expect(branch).toContain("mission(s) en attente annulée(s)");` (`:626`).
- `src/js/verrou-par-projet.test.js:607-609`, « POINT F », verrouille de même `abandonQueuedRunAgentsMissions(assistantKey` et « mission(s) d'assistant en attente annulée(s) ».

➡️ **Un correctif P2 qui conserve la file fera échouer trois tests existants.** Ces tests devront être **réécrits explicitement** (avec justification dans le message de commit), et **non supprimés** : la couverture « la file n'est jamais vidée en silence » doit survivre, seul le déclencheur change. Si le codeur les neutralise sans les remplacer, la non-régression est perdue.

---

## 3. P1 — la file n'est pas consultée à l'admission

### 3.1 Le comportement fautif est toujours là — preuve `fichier:ligne`

Trois sites d'admission, tous **muets sur l'état de la file** :

| Site | Ligne | Condition d'admission |
|---|---|---|
| `run_agents` → `launchOrQueue` | `src/js/super-agent.js:4486` | `if (isRunInProgress(target, { nature: missionNature }) || busyManual) { …enfiler… }` |
| `run_agents` → `startRun` | `src/js/super-agent.js:4542-4543` | `const blockedByBus = isRunInProgress(target, { nature: missionNature }); if (runAgentsInFlightByProject[target] && !isRunInProgress(target)) {…}` |
| `run_assistant_agents` → `startRun` | `src/js/super-agent.js:4707-4710` | `if (runAgentsInFlightByProject[target] \|\| isRunInProgress(target)) { …enfiler… }` |

Aucun de ces trois sites ne lit `runAgentsQueueByProject[target].length` (ou `getProjectMissionQueue`, `:541`). **Or la file peut être non vide alors que le verrou est libre** (run terminée, verrou libéré par `releaseStuckRunLock` appelé juste avant à `:4479` et `:4536`, agent parqué) → la nouvelle demande démarre **directement**, devant les missions déjà en attente.

C'est le défaut C1 du diagnostic, **à l'identique**.

### 3.2 Test de non-régression

- `src/js/file-attente-fifo-admission.test.js` **n'existe pas**.
- Aucun test existant n'impose l'ordre `[A, B]` dans le scénario « A en file → verrou libéré → B soumise avant le rejeu ». **Sans objet** donc.

### 3.3 Cas limite que la correction P1 devra couvrir (défaut de conception à éviter)

Une correction réduite à « si la file n'est pas vide, enfiler » **reste trouée** sur le cas « deux demandes simultanées » :

- `replayQueuedMissionForProject` retire la mission de la file par `queue.shift()` (`:845`), puis `launchQueuedMission` marque `runAgentsInFlightByProject[target] = true` **de façon synchrone** (`:896`) — bon point.
- **Mais** `launchOrQueue` (`:4486`) ne consulte **pas** `runAgentsInFlightByProject[target]` ; il ne consulte que le bus. Entre le `shift` (`:845`) et l'inscription effective de la run dans le bus, la file est **vide** et le bus **encore libre** → une demande concurrente passerait devant la mission en cours de lancement.
- Autrement dit : **le test P1 doit inclure la fenêtre de course** (mission en cours de lancement, file déjà vidée), pas seulement « file non vide ». Sinon on remplace une perte d'ordre par une autre.

---

## 4. P3 — clé de projet comparée en chaîne brute

### 4.1 Le comportement fautif est toujours là — preuve `fichier:ligne`

- `src/js/super-agent.js:4276` — `const targetProject = (info.project && String(info.project).trim()) || null;` → `trim()` seulement, **aucune normalisation** (séparateurs, casse, barre finale).
- `src/js/super-agent.js:4328` — `const target = targetProject || window._pilotProjectPath || ".";` → cette valeur sert de **clé de file** (`enqueueMissionForProject`, `:521-523`).
- `src/js/super-agent.js:5228` — `const queueKey = (info.project && String(info.project).trim()) || …` → même clé brute à l'arrêt (donc l'arrêt peut **ne pas** voir la file rangée sous l'autre écriture).
- `src/js/agents-bus.js:322-324` — `function runKey(project) { return project || "."; }` → comparaison stricte, aucun normalisation.
- `src/js/exclusivity-queue.js:19-20` — `return \`${project}\u{1f}${agentId}\`;` → clé brute.
- `src/js/exclusivity-queue.js:247-248` — `(sessions || []).some((s) => s && s.project === project && …)` → **égalité stricte** sur le chemin.

**Aucune fonction `normalizeProjectKey`** n'existe dans `src/` (recherche exhaustive : zéro occurrence).

### 4.2 L'incohérence est démontrable dans le dépôt

Le projet **sait déjà** normaliser un chemin de projet, mais **seulement** pour retrouver un projet suivi :

- `src/js/super-agent-context.js:38-44` — `export function normalizeProjectPath(path)` : `trim()`, `\` → `/`, suppression des `/` finaux, `toLowerCase()`.

Cette fonction n'est **pas** utilisée par la file (`super-agent.js`), ni par le bus (`agents-bus.js`), ni par la file d'exclusivité (`exclusivity-queue.js`). Le même projet peut donc être **deux clés distinctes** selon l'écriture du modèle → file invisible, non rejouée, non vidée par l'arrêt : **perte sans trace**.

### 4.3 Test de non-régression

- `src/js/file-attente-cle-projet.test.js` **n'existe pas**. Aucun test n'exerce `G:/IA_PL/pilot`, `G:\IA_PL\pilot\` et `g:\ia_pl\PILOT` comme une seule clé. **Sans objet.**

### 4.4 Risque de régression à surveiller pour le codeur de P3

Normaliser **modifie des clés d'index** utilisées par : les files de missions (`runAgentsQueueByProject`), les verrous de run (`agents-bus.js`), les files d'exclusivité (`exclusivity-queue.js`), et les comparaisons avec `session.project` **venu de Rust** (`list_agent_sessions`). Si la normalisation n'est appliquée qu'à l'écriture et pas à la lecture (ou l'inverse), on crée une **file orpheline** — pire que le défaut actuel. Les deux côtés de chaque comparaison doivent passer par la même fonction, y compris la valeur renvoyée par Rust. À vérifier explicitement dans le correctif ; **non vérifiable ici**, il n'y a rien à vérifier.

---

## 5. Recherche de régressions — état constaté

Comme **aucun code n'a changé**, il ne peut pas y avoir de régression *introduite*. Ce qui suit décrit donc l'état de référence que les correctifs devront préserver (et non des régressions constatées).

| Cas limite | Comportement actuel | Évaluation |
|---|---|---|
| **File vide** | `getProjectMissionQueue` retourne `[]` (`:541-543`) ; `replayQueuedMissionForProject` sort tôt (`:836`) ; `armQueueReplay` est un no-op réarmé (`:863-874`) | sain — à ne pas casser |
| **Arrêt sans file** | `waitingMissions === 0` → simple `delete` (`:5243`) + message « toujours en attente » seulement si `stillRunning` (`:5245-5246`) | sain |
| **Arrêt avec file, agent réellement mort** | abandon **tracé, nommé, notifié** (`:5239-5240`, journal `agent-stops.log`) | sain **comme filet**, à conserver : ce n'est pas ce chemin qui est fautif, c'est sa **condition de déclenchement** (`:5230`) |
| **Arrêt avec file, agent encore vivant** | **file détruite** | **défaut P2, non corrigé** |
| **Deux demandes simultanées** | fenêtre de course entre `shift` (`:845`) / `inFlight` (`:896`) et inscription au bus, non couverte par `launchOrQueue` (`:4486`) | **défaut P1, non corrigé** (+ angle mort à couvrir par le test) |
| **Deux écritures du même chemin de projet** | deux clés distinctes (`:4328`, `:5228`, `agents-bus.js:322`, `exclusivity-queue.js:19/247`) | **défaut P3, non corrigé** |
| **Rejeu après lancement en échec** | mission remise **en tête** de file, sans doublon (`:897-908`) | sain — à préserver |
| **Double empilement** | `stampQueuedMission` refuse le doublon et **retire** l'entrée (`mission-identity.js`) | comportement voulu ; faux positif possible (C5 du diagnostic), **non prouvé** — hors périmètre des trois correctifs |

---

## 6. Suite de tests — résultat exact

Commande : `npx vitest run` (équivalent `npm test`), à la racine du projet, sur `3c67064`, **sans aucune modification préalable**.

```
Test Files  120 passed (120)
     Tests  2062 passed (2062)
  Duration  15.00s
```

- **Aucun échec.** La base est verte **avec les trois défauts en place** : c'est la démonstration que **la suite existante ne protège pas** ces trois comportements. Un correctif qui n'ajoute pas de test dédié passera donc inaperçu — et une régression non plus.
- Un `stderr` isolé (`TypeError: Cannot read properties of undefined (reading 'metadata')` dans `agent-activity-assistant-tab.test.js`, via `@tauri-apps/api`) apparaît **sans faire échouer** le test concerné (2/2 passés). Bruit de mock Tauri, **sans lien** avec ce sujet ; signalé pour mémoire, non imputable aux corrections.
- **Côté Rust** : non lancé. Justification — le diagnostic (§9) établit qu'il n'existe **aucune file de missions côté Rust** (seul `enqueue_session_summary` persistant) et aucun des trois défauts ne touche du code Rust ; je n'ai modifié aucun fichier de code. Une compilation `cargo test` n'apporterait aucune information sur P1/P2/P3 ; je ne la présente pas comme faite.

---

## 7. Ce qui reste à corriger, classé par gravité

### 🔴 Bloquant — perte de travail

1. **P2 — `stop_agent` détruit une file non vide** (`src/js/super-agent.js:5230` + `:5237-5242`, et `:5260-5266` pour l'assistant).
   *Attendu* : ne plus décider « projet libre » sur `isRunInProgress` seul → utiliser la sonde des sessions vivantes (`isRunStillActive`, `:802-820`) ; **ne jamais** abandonner une file quand un agent vit encore ; si un abandon est réellement nécessaire, conserver la trace + le nommage actuels.
   *Test manquant* : `src/js/file-attente-arret-conserve.test.js` (arrêt avec 1 mission en file et session vivante → 0 abandon, mission toujours dans `getProjectMissionQueue`, rejouée à la libération).
   *Dépendance obligatoire* : réécrire `verrou-par-projet.test.js` § POINT C (`:613-626`) et § POINT F (`:607-609`), qui **exigent aujourd'hui** l'abandon.

2. **P1 — dépassement de file à l'admission** (`src/js/super-agent.js:4486`, `:4542-4543`, `:4707-4710`).
   *Attendu* : les trois sites consultent la file **avant** de lancer (file non vide → empilement + `armQueueReplay`, jamais de lancement direct), **et** couvrent la fenêtre de course du lancement en cours (`runAgentsInFlightByProject`, `:896`).
   *Test manquant* : `src/js/file-attente-fifo-admission.test.js` (A en file → verrou libéré → B soumise avant rejeu → ordre `[A, B]`), **plus** un cas « B soumise pendant le lancement de A ».

### 🟠 Grave — perte sans trace, conditions d'écriture

3. **P3 — clé de projet non normalisée** (`super-agent.js:4276`, `:4328`, `:5228` ; `agents-bus.js:322` ; `exclusivity-queue.js:19`, `:247`).
   *Attendu* : une fonction unique (réutiliser `normalizeProjectPath`, `super-agent-context.js:38-44`), appliquée **des deux côtés** de chaque comparaison, y compris aux `project` renvoyés par Rust.
   *Test manquant* : `src/js/file-attente-cle-projet.test.js`.

### 🟡 À ne pas perdre en corrigeant

4. **Ne pas casser** : rejeu réarmé tant que la file n'est pas vide (`:871`), remise **en tête** sur échec de lancement (`:903-906`), abandon **tracé/nommé/notifié** (`:5239-5240`), refus du double empilement (`mission-identity.js`).
5. **Documentation** : `spec_super_agent.md` (§ file d'attente) et le bloc `<!-- HELP:* -->` correspondant devront suivre, puis `npm run build:handbook`.

### ⚪ Hors périmètre de ces trois correctifs (rappel du diagnostic, toujours ouvert)

6. **C6** — `runAgentsQueueByProject` est un objet de module (`:464`) : la file est **entièrement perdue** à tout rechargement/redémarrage, sans trace. Non traité par P1/P2/P3, et **aggravant** : même avec P1/P2/P3 corrects, une mise à jour de Pilot perd les missions en attente.
7. **C5** — refus de double empilement : un faux positif retirerait une demande valide (annoncé à l'écran, **non prouvé**).

---

## 8. Ce qui n'est **pas** prouvé dans ce rapport

1. **L'état de la file de missions en mémoire à l'instant de la relecture** : non consultable sans `list_agent_sessions`, outil interdit. Je ne peux donc pas dire si les trois missions de correction attendent encore.
2. **Les rapports P1/P2/P3 n'existant pas, je n'ai pu confronter aucun correctif à sa justification.** Tout ce qui précède porte sur le **code**, pas sur des rapports.
3. **Le comportement à l'exécution** : mes conclusions sur P1/P2/P3 viennent de la **lecture du code** (les lignes citées) et de la **suite de tests** (verte, donc muette sur ces défauts). Je n'ai pas instrumenté l'application ; rien n'a été modifié pour éprouver les tests manquants.
4. **L'absence de correctif dans une branche non listée ou un travail non commité hors `src/js/`** : vérifié pour les branches connues, les stash et l'arbre de travail ; **non prouvé** de façon exhaustive pour une copie de travail externe au dépôt.

---

## 9. Méthode

- **Lu** (jamais modifié) : `rapport-file-attente-pertes-doublons.md`, `src/js/super-agent.js` (`:460-560`, `:600-660`, `:800-950`, `:4270-4340`, `:4470-4550`, `:4596-4615`, `:4698-4730`, `:5195-5270`), `src/js/agents-bus.js` (`:318-340`, `:3095-3118`), `src/js/exclusivity-queue.js` (`:15-25`, `:243-252`), `src/js/super-agent-context.js` (`:38-69`), `src/js/verrou-par-projet.test.js` (`:575-632`), `src/js/file-attente-regle-4.test.js` (repérages).
- **Git** : `log --all --oneline`, `log -5 -- src/js/super-agent.js`, `log -1 --format`, `status --short`, `main..<branche>`, `stash list`.
- **Journal** : `.pilot/agent-stops.log` (dernière entrée `2026-10-20T09:25:27.320Z`).
- **Tests** : `npx vitest run` → 120 fichiers / 2062 tests / 0 échec.
- **Aucune** écriture de code, **aucun** commit, **aucun** tag, **aucune** publication, **aucun** changement de version. Seul fichier écrit : ce rapport.
- **Traçabilité de l'arbre de travail** : au début de la relecture, `git status` ne signalait que `geminiReport.md` et `rapport-file-attente-pertes-doublons.md` (non suivis). Pendant la relecture, **d'autres agents ont écrit** : apparition de `rapport-delai-inactivite.md` et modification de `spec_gestion_agents.md` (timeout d'inactivité 300 s → 600 s, 2 lignes). Ce n'est **pas** mon fait, c'est hors du périmètre P1/P2/P3, et **aucun fichier de code** (`src/js/`, `src-tauri/`) n'a été touché. Les preuves `fichier:ligne` de ce rapport portent donc sur `src/js/super-agent.js`, `agents-bus.js`, `exclusivity-queue.js`, `super-agent-context.js`, **inchangés** depuis `3c67064`.
