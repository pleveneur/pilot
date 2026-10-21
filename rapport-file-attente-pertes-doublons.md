# Rapport — file d'attente par projet : pourquoi une demande en file peut être perdue ou doublée

- Date du rapport : **2026-10-21T03:43Z**
- Périmètre : **lecture seule** (aucun code modifié, aucun commit, aucun tag, aucune version, aucune publication).
- Version examinée sur disque : `HEAD = 3c67064` (`0.4.35`) ; version **réellement chargée** pendant les incidents : `0.4.33` (voir §2.3, c'est un point de preuve, pas une hypothèse).
- Seul livrable : ce fichier.

---

## 1. Verdict

**Oui, une demande mise en file d'attente par projet peut être perdue ou doublée, et ce ne sont pas deux fois le même défaut.**

1. **Défaut D1 — la file n'est jamais consultée à l'admission.** Les trois points d'entrée d'une demande (`run_agents` ×2 gardes, `run_assistant_agents`) décident « démarrer tout de suite » ou « mettre en file » en regardant **uniquement le verrou de run / l'agent occupé**, jamais le contenu de la file du projet. Dès que le verrou paraît libre, **une demande qui arrive passe devant les missions déjà en file** : c'est exactement le symptôme « le lancement suivant a démarré directement à sa place ». Preuve code : `src/js/super-agent.js:4475-4500`, `:4525-4560`, `:4700-4720` — aucune occurrence de `runAgentsQueueByProject[...].length` dans ces décisions. Preuve journal : lancements directs à `08:45:07.569Z`, `09:15:07.118Z`, `09:21:05.828Z`, `09:25:28.314Z` (`.pilot/agent-stops.log` + `agent-ops.log`).
2. **Défaut D2 — un arrêt d'agent détruit une file non vide sur la foi d'un verrou de run périmé.** `stop_agent` (et « tout arrêter ») vide la file des missions dès que `isRunInProgress(queueKey)` renvoie `false`, même quand des agents du projet sont **encore vivants**. Preuve journal **horodatée et nominative** : `2026-10-20T09:25:10.347Z op=auto-stop reason=queue-abandoned detected=stop-agent project=G:\IA_PL\pilot detail=#14 « ARBITRAGE RENDU : OUI, corrige. Tu as eu raison de ne pas publier… »` — alors que la session `codeur` n°13, lancée à `09:21:05.828Z`, n'a été arrêtée qu'à `09:25:27.480Z`. Preuve code : `src/js/super-agent.js:5231-5240`.
3. **Trancher par incident**
   - **Incident 1 (08:45Z)** → **D1** (dépassement). La mission n'a **pas** été détruite à 08:45 : aucune trace d'abandon n'existe à cette heure, et aucune autre mission que `#14` ne restait en file à 09:25:10 (§5.1). Le « disparu sans trace » se décompose donc en : *dépassée par un lancement direct* (prouvé par le journal) et *plus jamais visible/rejouée* (cause secondaire la plus probable : D3, clé de projet non normalisée — **non prouvé** pour cet incident).
   - **Incident 2 (09:15Z)** → **D1 puis D2**. À `09:15:07.118Z` le `codeur` démarre directement (D1) ; la file survit ; puis à `09:25:10.347Z` la mission **#14** est **détruite** par un arrêt d'agent (D2) ; `18 s` plus tard `09:25:28.314Z` le lancement suivant démarre (`codeur` n°14). C'est la perte **prouvée**.
   - **Contre-exemple (`cadb9d2`, commit de 08:54:26Z)** : une demande mise en file la même matinée a bien abouti → la file **fonctionne** quand aucun lancement direct ni aucun arrêt n'interfère. Cohérent avec D1/D2.
4. **Réponse à la question posée** : **deux défauts distincts** — (i) un défaut **d'ordre à l'admission** (D1, présent dans les deux incidents : c'est lui qui fait « démarrer à sa place ») et (ii) un défaut de **destruction d'une file en attente** (D2, responsable de la perte réelle, prouvé dans l'incident 2). S'y ajoute un troisième défaut **latent** (D3, clé de projet brute) qui suffirait à rendre une file invisible et jamais rejouée.
5. **Le « sans trace » est partiellement inexact** : depuis `a352227`/`d96643c` (v0.4.33), l'abandon de file **est** journalisé (`queue-abandoned`) et annoncé à l'écran (« 📋 N mission(s) en attente annulée(s)… », `super-agent.js:5239-5240`). Le manque réel, c'est qu'**il n'y a aucune demande de confirmation avant de détruire** — et que cette trace n'existait pas encore pour le chemin `/file vide` en v0.4.33 (corrigé par `5f8254d`, 08:39Z).

---

## 2. Faits établis (journal, horodatés)

### 2.1 Ce qui a tourné (`agent-ops.log`, app_data) — une seule instance

| Heure (Z) | Événement | Session |
|---|---|---|
| 08:12:40.718 | `spawn auditeur-regles` — démarrage de l'unique instance de la matinée (`current=1`) | 1 |
| 08:15:51.691 | `spawn codeur` | 2 |
| 08:21:24.352 | `spawn codeur` | 3 |
| 08:30:26.959 | `spawn codeur-interface` | 4 |
| 08:37:12.663 | `spawn codeur` | 5 |
| 08:42:09.915 | `spawn codeur` | 6 |
| **08:45:07.569** | **`spawn documenteur` — lancement DIRECT (incident 1)** | 7 |
| 08:51:44.852 / 08:56:41.149 / 09:01:28.107 / 09:06:57.899 | `spawn codeur` (relances en chaîne) | 8→11 |
| **09:15:07.118** | **`spawn codeur` — lancement DIRECT (incident 2)** | 12 |
| 09:21:05.828 | `spawn codeur` | 13 |
| 09:25:10.026 | `propriete-ok … agent=documenteur current=Some(7)` (arrêt) | 7 |
| **09:25:10.347** | **`queue-abandoned detected=stop-agent` — mission #14 détruite** | — |
| 09:25:10.893 | `propriete-ok … agent=codeur-interface current=Some(4)` (arrêt) | 4 |
| 09:25:27.480 | `propriete-ok … agent=codeur current=Some(13)` (arrêt) | 13 |
| **09:25:28.314** | **`spawn codeur` — « le lancement suivant »** | 14 |

Le compteur de sessions monte de **1 à 15 sans remise à zéro** : une **seule** instance du backend a servi toute la fenêtre 08:12 → 10:25 (§ preuve 2.3).

### 2.2 Journal des arrêts automatiques (`.pilot/agent-stops.log`)

- 9 lignes `reason=stale-session-restart detected=fresh-context agent=codeur` : `08:21:23.452`, `08:37:11.764`, `08:42:09.012`, `08:51:43.989`, `08:56:40.304`, `09:01:27.125`, `09:06:56.981`, `09:15:05.291`, `09:21:04.982`, plus `09:25:27.320`.
- **Une seule** ligne d'abandon de file :
  `2026-10-20T09:25:10.347Z op=auto-stop reason=queue-abandoned detected=stop-agent agent=none project=G:\IA_PL\pilot uid=none detail=#14 « ARBITRAGE RENDU : OUI, corrige. Tu as eu raison de ne pas publier. Voici la mission bornée. CONTEXTE : tu as prouvé l... »`
- **Aucune** ligne `queue-abandoned` à 08:45 ni à 09:15 → **aucun abandon de file n'a eu lieu à ces deux instants** (voir §4.2 pour la démonstration).

### 2.3 Preuve que le code chargé à 08:45 et 09:15 est le même qu'à 09:25 (et lequel)

- La ligne de `09:25:10.347Z` porte le détail `#14 « … »` **sans** le préfixe `N mission(s) en file :` : or ce préfixe a été introduit par `5f8254d` (« une file vidée journalise toujours son abandon », commit du **2026-10-20 08:39:52Z**), `src/js/super-agent.js:583`.
- Donc le frontend chargé à `09:25:10Z` est **antérieur** à `08:39:52Z` → il n'a **pas** été rechargé (ni HMR, ni redémarrage) entre le démarrage de l'instance (`08:12:40Z`) et `09:25:27Z`.
- Conséquence : **le code en vigueur à 08:45:07Z et à 09:15:05Z est exactement celui de 09:25:10Z**, c'est-à-dire la version `0.4.33` (commit de bump `d7fe1ef`, 06:21Z), qui contient `a352227` (identité de mission), `8d0b90b` (`stale-session-restart`) et `d96643c` (abandon de file **tracé**), mais **pas** `5f8254d`.
- Corollaire important : l'hypothèse « la file a été perdue par un rechargement de page / un redémarrage » est **exclue** pour ces deux incidents (elle reste un risque réel, §4.6).

---

## 3. Comment la file fonctionne réellement (4 familles distinctes)

| Famille | Structure | Alimentée par | Vidée / rejouée par |
|---|---|---|---|
| Missions de l'assistant | `runAgentsQueueByProject[projet]` (`super-agent.js:464`) | `enqueueMissionForProject` (`:521`), `run_agents` / `run_assistant_agents` | `replayQueuedMissionForProject` (`:833`) + sonde `armQueueReplay` (`:863`, 15 s), `settleRun`, `abandonQueuedRunAgentsMissions` (`:636`) |
| Délégations (#66) | `delegationState(projet).queue` | `delegate_to_coder` | sonde de rejeu 15 s, `abandonQueuedDelegations` |
| Exclusivité par spécialité | `exclusivityQueue[projet\u{1f}agentId]` (`exclusivity-queue.js:19`) | demandes agent→agent | `dequeueExclusivity` en fin de tâche |
| Commandes manuelles | `project-task-queue.js` | commandes utilisateur | exécution FIFO par projet |

Toutes ces files sont **purement en mémoire** (objets de module JS). Aucune persistance disque, aucune reprise au démarrage.

---

## 4. Causes classées, de la plus probable à la moins probable

### 4.1 C1 — Dépassement : l'admission ignore la file — **PROUVÉ (code + journal)**

- `src/js/super-agent.js:4475-4500` (`launchOrQueue`, outil `run_agents`) : la décision est `if (isRunInProgress(target, { nature }) || busyManual) { …mettre en file… } else { …launchRun()… }`. Aucune lecture de `runAgentsQueueByProject[target]`.
- `src/js/super-agent.js:4525-4560` (`startRun`, `run_agents`) : idem (`blockedByBus`, `blockedByFlag`), toujours pas de test « la file est-elle non vide ? ».
- `src/js/super-agent.js:4700-4720` (`startRun`, `run_assistant_agents`) : idem.
- Conséquence : **ordre FIFO non garanti**. Le verrou de run peut être libre (run précédente terminée, agent encore parqué, ou verrou libéré par `releaseStuckRunLock` — `super-agent.js:4479`, `:4537`, `:4706`, `:5229` ; `agents-bus.js:790/825`) alors que des missions attendent → la nouvelle demande part devant.
- Journal : lancements directs à 08:45:07, 09:15:07, 09:21:05, 09:25:28 (§2.1).

### 4.2 C2 — Destruction d'une file non vide par un arrêt d'agent — **PROUVÉ (code + journal)**

- `src/js/super-agent.js:5231-5240` : `const stillRunning = isRunInProgress(queueKey); const waitingMissions = (runAgentsQueueByProject[queueKey] || []).length; if (!stillRunning) { … if (waitingMissions > 0) { await abandonQueuedRunAgentsMissions(queueKey, { detected: "stop-agent" }); … } }`.
- `isRunInProgress` (`agents-bus.js:3101`) ne lit que **les contextes de run du bus**, pas les processus vivants : un verrou déjà relâché (fin de run, relance `stale-session-restart`, agent parqué) rend « projet libre » alors que des agents tournent encore.
- Preuve journal : `09:25:10.347Z` → file détruite (mission #14) alors que la session `codeur` n°13 (lancée `09:21:05.828Z`) n'a été arrêtée qu'à `09:25:27.480Z`.
- Origine du comportement (assumé et documenté) : `86b339c` (2026-09-28) « arrêter un agent libère la file de missions du projet » pour ne plus laisser une mission bloquée derrière un verrou mort ; puis `a352227` / `d96643c` / `66941b2` l'ont **tracé et nommé**. Le choix produit « vider » n'a jamais été remis en cause → c'est la perte définitive.

### 4.3 C3 — L'abandon n'était **pas** la cause à 08:45 et 09:15 — **PROUVÉ (élimination)**

En v0.4.33, tous les chemins de vidage **sauf un** écrivent une trace (énumération exhaustive sur `66941b2:src/js/super-agent.js`) :

| Ligne (v0.4.33) | Chemin | Tracé ? |
|---|---|---|
| `:538-549` | `abandonProjectMissionQueue` (commande `/file vide`) | **NON** (corrigé par `5f8254d`, 08:39Z, postérieur) |
| `:564-585` | `abandonQueuedRunAgentsMissions` (watchdog, arrêt) | oui (`queue-abandoned`) |
| `:762` / `:4307-4312` / `:4590-4595` | file vide (`delete`) | sans objet |
| `:4503` | watchdog de run | oui |
| `:5129-5140` / `:5153-5161` | `stop_agent` (projet + espace assistant) | oui |

Or le code en vigueur à 08:45 est celui de 09:25 (§2.3), et aucune trace n'existe à 08:45/09:15. **Donc ni le watchdog, ni `stop_agent`, ni « tout arrêter » n'ont détruit la mission à ces heures.** Seul `/file vide` (action manuelle) aurait pu le faire sans trace — **non prouvé**, et cela supposerait une action volontaire que le demandeur n'a pas décrite.

### 4.4 C4 — Clé de projet = chaîne brute : file invisible, jamais rejouée — **PROUVÉ (code), non prouvé pour ces incidents**

- `super-agent.js:4276` : `const targetProject = (info.project && String(info.project).trim()) || null;` puis `:4328` : `const target = targetProject || window._pilotProjectPath || ".";` → la clé de file est **la chaîne telle que le modèle l'a écrite** (séparateurs `\` ou `/`, casse, barre finale).
- Aucune normalisation ailleurs : `agents-bus.js:322` `runKey(project) { return project || "."; }`, `exclusivity-queue.js:19` (`${project}\u{1f}${agentId}`), `exclusivity-queue.js:247` `isProjectWorking` → comparaison stricte `s.project === project`.
- Le projet sait pourtant qu'un chemin peut s'écrire autrement : `src/js/super-agent-context.js` normalise explicitement (séparateurs, casse, barre finale) pour retrouver un projet suivi.
- Effet : une mission rangée sous `G:/IA_PL/pilot` n'apparaît pas dans `/file` pour `G:\IA_PL\pilot`, n'est pas vidée par l'arrêt qui cible l'autre clé, et n'est rejouée que si la sonde de **sa** clé la juge lançable → **disparition sans trace** possible. Aucun journal ne permet de vérifier la clé employée ce matin-là → **non prouvé**.

### 4.5 C5 — Refus de double empilement : écarte une entrée — **non prouvé, improbable**

`mission-identity.js:104-118` : une entrée dont l'identifiant de mission est déjà présent est **retirée de la file** (`queue.splice`). C'est voulu (anti-doublon), et l'interface annonce « ℹ️ Cette demande (mission #N) est déjà en file ». Un faux positif (même identité réutilisée) ferait disparaître une demande **valide** sans trace disque. Rien dans le journal ne l'indique ; l'annonce écran serait visible.

### 4.6 C6 — File en mémoire, non persistée — **réel mais EXCLU pour ces deux incidents**

`runAgentsQueueByProject` est un objet de module (`super-agent.js:464`) ; un rechargement de page ou un redémarrage de Pilot efface **toutes** les files d'un coup, sans trace. C'est **exclu** ici : une seule instance a tourné (compteur de sessions continu, §2.3). Reste un risque avéré pour tout redémarrage (mise à jour, fermeture).

### 4.7 C7 — Garde de propriété Rust (`check_session_ownership`) — **hors périmètre, exclu**

`src-tauri/src/agent_service.rs:353-362` n'autorise un arrêt que par le lanceur (`op=propriete-ok` / `propriete-refusee`). Aucun `propriete-refusee` dans la fenêtre, et cette garde concerne les **arrêts d'agents**, pas la file. **Hors périmètre** (§7).

---

## 5. Verdict par incident

### 5.1 Incident 1 — 2026-10-20 08:45Z sur `pilot`

- Fait : `08:45:07.569Z` → `spawn documenteur` (session 7), alors que la session `codeur` n°6 tournait depuis `08:42:09.915Z` et qu'une mission venait d'être acceptée en file (`queued:true`, déclaré par le demandeur).
- **Cause la plus probable : C1 (dépassement).** Un lancement direct est parti pendant que la file n'était pas vide : c'est exactement le comportement codé (§4.1) et exactement ce que décrit le demandeur (« le lancement suivant a démarré directement à sa place »).
- **La mission n'a pas été détruite** à cet instant : aucune trace `queue-abandoned` (§4.3) et, à `09:25:10Z`, la file ne contenait **qu'une** mission (`#14`).
- Cause secondaire la plus probable du « disparue » (visibilité/rejeu) : **C4** (clé brute) — **non prouvé**.
- Statut global : **cause probable, partiellement prouvée** (mécanisme prouvé par le code et le journal ; identité exacte de la mission et clé de file **non prouvées** — aucune trace disque de la mise en file, la file n'étant pas persistée).

### 5.2 Incident 2 — 2026-10-20 09:15Z (mission « corriger le test MCP Linux »)

- Faits : `09:15:05.291Z` arrêt `stale-session-restart` de la session 11 → `09:15:07.118Z` `spawn codeur` n°12 (**lancement direct**, C1) ; `09:21:05.828Z` `spawn codeur` n°13 ; puis `09:25:10.347Z` **destruction de la file** avec la seule mission `#14` dont le texte commence par « ARBITRAGE RENDU : OUI, corrige. Tu as eu raison de ne pas publier. » — c'est-à-dire une **mission de correction refusant la publication**, cohérente avec « corriger le test MCP Linux » décrit par le demandeur ; enfin `09:25:28.314Z` `spawn codeur` n°14 = **le lancement suivant** (la publication).
- **Cause la plus probable : C2 (destruction par arrêt d'agent), précédée de C1** (les relances directes de 09:15:07 puis 09:21:05 passaient devant la file).
- Statut : **prouvé** pour la destruction (trace horodatée + code) ; **très probable mais non prouvé** pour l'identification exacte du texte de `#14` (le libellé est tronqué à ~160 caractères et le transcript de la session n'est pas sur disque).

### 5.3 Contre-exemple — `cadb9d2` (commit de 08:54:26Z)

Une demande mise en file dans la même matinée a **abouti** (commit livré). Cela confirme que la file fonctionne **quand aucun lancement direct et aucun arrêt n'interviennent** : ce n'est pas la file elle-même qui est cassée, mais (i) l'ordre d'admission et (ii) la survie à un arrêt.

---

## 6. Correction minimale proposée (NON écrite — proposition seule)

Classée par rapport bénéfice/risque. **Aucun fichier n'a été modifié.**

**P2 d'abord — ne plus détruire une file non vide (C2, perte définitive).**
- Fichiers : `src/js/super-agent.js` (`stop_agent`, `:5188-5245`) ; `src-tauri/extensions/pilot-assistant-actions.ts` (`stop_agent`, `:311-338`) si l'on veut une confirmation côté outil.
- Comportement attendu : si `waitingMissions > 0`, `stop_agent` **ne vide pas** la file ; il arrête l'agent, conserve les missions (visibles dans `/file`) et les **rejoue** dès que le projet est libre. À défaut, demander une confirmation explicite (`ask_confirm`, déjà disponible via `pilot-choices`) avant tout abandon. Et décider « projet libre » sur les **sessions réellement vivantes** (même sonde que `isRunStillActive`, `super-agent.js:802-820`) et non sur le seul `isRunInProgress`.
- Test de non-régression à écrire : `src/js/file-attente-arret-conserve.test.js` (même style que `verrou-par-projet.test.js` / `regle-4-file-jamais-perdue.test.js`) : `stop_agent` avec 1 mission en file et une session encore vivante → **0 abandon**, la mission reste dans `getProjectMissionQueue(projet)` et est rejouée à la libération ; variante : abandon seulement si l'utilisateur confirme (alors annoncé + journalisé).

**P1 — FIFO strict à l'admission (C1, « démarré à sa place »).**
- Fichier : `src/js/super-agent.js`, les 3 sites `:4475-4500`, `:4525-4560`, `:4700-4720`.
- Comportement attendu : si `getProjectMissionQueue(target).length > 0`, la nouvelle demande **s'empile** (`enqueueMissionForProject` + `armQueueReplay`) au lieu de démarrer — la file d'un projet est servie dans l'ordre d'arrivée.
- Test : `src/js/file-attente-fifo-admission.test.js` : mission A mise en file (projet occupé) → libération du verrou → soumission de B **avant** le rejeu → B ne démarre pas, A démarre, puis B (ordre `[A, B]`).

**P3 — clé de projet normalisée partout (C4, file invisible).**
- Fichiers : `src/js/super-agent.js` (`:4276`/`:4328`, `:5231`), `src/js/agents-bus.js` (`runKey`, `:322`), `src/js/exclusivity-queue.js` (`:19`, `:247`).
- Comportement attendu : `G:/IA_PL/pilot`, `G:\IA_PL\pilot\` et `g:\ia_pl\PILOT` désignent la même file (une seule fonction `normalizeProjectKey`, alignée sur ce que fait déjà `super-agent-context.js`).
- Test : `src/js/file-attente-cle-projet.test.js` : mise en file sous une écriture, lecture/abandon/rejeu sous l'autre → une seule entrée, jamais d'orpheline.

**Ordre conseillé** : P2 (perte définitive, petit périmètre) → P1 (ordre) → P3 (robustesse). Documentation à mettre à jour avec la correction : `spec_super_agent.md` (§ file d'attente) + bloc `<!-- HELP:* -->` correspondant, puis `npm run build:handbook`.

---

## 7. Ce qui n'est **pas** prouvé (à ne pas présenter comme acquis)

1. **L'identité exacte des missions en file à 08:45 et 09:15** : la file vit en mémoire et **rien ne journalise la mise en file** ; aucun transcript d'agent du 2026-10-20 entre 08:12Z et 09:35Z n'est présent sur disque (`~/.pi/agent/sessions`, `agent/sessions/` : seul un fichier du 2026-10-20 à 03:28Z existe).
2. **La clé de projet utilisée par l'assistant ce matin-là** (C4) : non retrouvable (aucune trace de la clé de file, `magnus_taches` ne contient aucune ligne du 2026-10-20, `~/.pilot/super-agent.db` fait 0 octet ; le suivi réel de la journée est dans `session-memory.json`).
3. **Le contenu exact de la mission `#14`** : libellé tronqué à ~160 caractères dans la trace ; rapprochement avec « corriger le test MCP Linux » **très probable, non prouvé**.
4. **L'heure exacte 08:45 pour l'incident 1** : la seule trace voisine est le `spawn documenteur` de `08:45:07.569Z` ; aucune entrée de journal ne porte la mise en file elle-même.
5. **La nature (lecture/écriture) de l'agent `documenteur`** en vigueur ce matin-là : le registre d'agents n'est pas sur disque à cet état → le caractère « anormal » de sa cohabitation avec `codeur` n'est pas tranché. Le dépassement de file (C1), lui, ne dépend pas de cette nature.

---

## 8. Hors périmètre — signalé, non traité

Conformément à la mission, ces points **croisent** le sujet mais n'ont pas été traités : **lancement d'agent** (`releaseStuckRunLock`, relances `stale-session-restart` / « contexte vierge », garde de propriété `check_session_ownership`, `op=abort`), **estimation préalable / « devis »** (`reservations.js`, plan-maker), **plan-maker** et **prompt de l'assistant** (`super_agent_prompt`, `update_my_prompt`). Aucun outil de listage des sessions d'agents (`list_agent_sessions`) n'a été utilisé pour ce rapport.

---

## 9. Méthode (traçabilité)

- Code lu (jamais modifié) : `src/js/super-agent.js`, `agents-bus.js`, `exclusivity-queue.js`, `project-task-queue.js`, `project-queue-view.js`, `run-policy.js`, `mission-identity.js`, `run-agents-notify.js`, `loop-detection.js`, `super-agent-context.js` ; `src-tauri/extensions/pilot-assistant-actions.ts`, `pilot-assistant-db.ts` ; `src-tauri/src/agent_service.rs` ; `src-tauri/src/super_agent.rs` (vérification : **aucune file de missions côté Rust**, seul un `enqueue_session_summary` persistant existe).
- Journaux : `.pilot/agent-stops.log`, `~/AppData/Roaming/com.pilot.editor/agent-ops.log`, `~/AppData/Roaming/com.pilot.editor/session-memory.json`, bases `super-agent.db` (lecture seule).
- Git : `git log --since/--until 2026-10-20` (+0400 → Z), `git show 66941b2:src/js/super-agent.js`, `git log -S "POINT E" | "family}(s) en file" | "queue-abandoned"`.
- Versions : code vigueur des incidents = `0.4.33` (§2.3) ; état du dépôt examiné = `3c67064` (`0.4.35`).
