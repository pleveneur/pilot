# Diagnostic — « Le compte rendu de fin de mission B n'est pas remonté »

> **Nature** : mission de diagnostic, **lecture seule** (aucun fichier du dépôt
> modifié, aucun commit, aucun test lancé sur le code). Seul ce rapport est écrit.
> **Date** : 2026-10-26, heures **locales (UTC+4)** sauf mention `UTC`.
> **Objet** : mission **#3** (`concepteur-ui`, cadrage « colonne de gauche »,
> rapport `RAPPORT-design-colonne-entrees.md` écrit à 07:25) → aucun compte rendu
> perçu par le propriétaire, qui a dû annoncer lui-même la fin. Mission **#2**
> (« compteur Travail », `RAPPORT-compteur-taches.md` à 07:17) → compte rendu
> arrivé normalement.

---

## 1. Réponse en une phrase

**Le compte rendu de la mission B n'est pas perdu : il a été écrit en base, remis
à l'Assistant, LU par lui, et l'Assistant a agi dessus 30 secondes plus tard.**
Ce qui manque, c'est **la trace visible** : Pilot n'affiche **nulle part** le
compte rendu qu'il remet. La seule surface d'affichage possible est le **texte
libre de l'Assistant dans son tour** — qu'aucun mécanisme ne garantit (un tour
d'outils, comme `run_agents`, peut se terminer sans un mot). Le propriétaire ne
peut donc ni constater l'arrivée d'un compte rendu ni en lire le contenu, sauf si
le modèle choisit d'en parler.

C'est un défaut de **restitution**, pas de transport. Il est prouvé ci-dessous.

---

## 2. Les faits, avec leurs preuves

### 2.1 Ce que dit la base durable (source de vérité)

Base : `C:\Users\pldistance\AppData\Roaming\com.pilot.editor\super-agent.db`
(les `created_at` sont en **UTC** — `datetime('now')` — soit local + 4 h).

| Preuve | Contenu | Lecture |
|---|---|---|
| `session_summaries` **#2489**, `created_at = 2026-10-26 03:29:09`, `delivered = 1` | début : `[mission #3 — agents : concepteur-ui] [Tâche run_agents terminée] Résultat de la run d'agents : === Résultat de concepteur-ui (done) === Vérifications finales terminées…` ; **2 624 caractères** | Le compte rendu de B **existe**, complet, correctement étiqueté avec SON identité de mission (RÈGLE 4). |
| `injection_logs` **#2847** | `status='delivered'`, `ok=1`, `detail='ok'` | Tentative d'injection immédiate, réputée réussie. |
| `session_summaries` #2488 (03:17:36) | `[mission #2 …]` → livré, et le propriétaire l'a bien vu | Le chemin fonctionnait 12 min plus tôt sur la MÊME machine. |
| **Aucune ligne `queued`** dans `injection_logs` entre 03:00 et 04:30 | — | Le chemin « différé / rejeu » **n'a jamais servi** dans cette plage. Il est donc hors de cause. |
| `magnus_tracabilite` **#151**, `cree_le = 2026-10-26 07:29:39` (local) : « Colonne de gauche : la découpe en lots A->E du rapport est PERIMEE (**tous les états intermédiaires débordent : 8 lignes = 316 px > 300 px même à 60 %**). Remplacer par le **lot 1 INSECABLE du rapport révisé (595 lignes)** … » | Écrit **30 s après** l'injection de #2489 | **C'est la preuve qui tranche.** Les nombres « 8 lignes / 316 px / 300 px / 60 % » et « 595 lignes » sont **mot pour mot dans le compte rendu #2489**. L'Assistant a donc **reçu, lu et exploité** ce compte rendu. |

**Conclusion factuelle : la remise a eu lieu et a été consommée.** Toute
hypothèse de « message perdu en route » est réfutée par `magnus_tracabilite` #151,
confirmée à la seconde près par `.pilot/agent-stops.log:385`
(`03:29:39.442Z reason=queue-order-respected` : l'Assistant vient de relancer une
mission dont la demande est refusée pour respecter l'ordre de la file — il a donc
bien agit sur le compte rendu).

### 2.2 Chronologie reconstituée (et pourquoi B démarre 2 min 14 s après A)

| Heure locale | Événement | Preuve |
|---|---|---|
| 07:17:03 | `run_agents` demandé alors que A tourne → **B mis en file** (« queued ») | `.pilot/agent-stops.log` : `03:17:03.445Z op=auto-stop reason=queue-order-respected … 1 mission(s) en file : #3 …` |
| 07:17:36 | **A** se termine → compte rendu #2488 injecté et consommé | `session_summaries` #2488 |
| 07:19:50 | **B** démarré (tête de file) | `agent-stops.log` : `03:19:50.284Z auto-stop reason=stale-session-restart agent=concepteur-ui` |
| 07:29:09 | **B** se termine → compte rendu #2489 injecté (`delivered=1`) | `session_summaries` #2489 |
| 07:29:39 | L'Assistant crée la mission #151 **qui cite le rapport de B** — sa demande est aussitôt mise en file (`queue-order-respected`) | `magnus_tracabilite` #151 **et** `.pilot/agent-stops.log:385` : `03:29:39.442Z op=auto-stop reason=queue-order-respected … 5 mission(s) en file` |
| 07:31:22 | Tête de file suivante (#4) démarrée | `agent-stops.log` : `03:31:22.466Z stale-session-restart agent=concepteur-ui` |

Les 2 min 14 s entre la fin de A (07:17:36) et le départ de B (07:19:50)
s'expliquent exactement par la sonde de rejeu : `RUN_AGENTS_QUEUE_REPLAY_MS = 15 s`
(`src/js/super-agent.js:1304`) mais surtout `requireIdleMs:
RUN_AGENTS_QUEUE_REPLAY_MIN_STUCK_IDLE_MS` (`src/js/super-agent.js:1344`, valeur
`2 * 60 * 1000` = `src/js/agents-bus.js:133`) → 07:17:36 + 2 min = 07:19:36, plus
un tour de sonde (≤ 15 s) = **07:19:50**. C'est une **attente**, pas une perte —
mais c'est aussi la sonde qui appelle `list_agent_sessions`
(`src/js/super-agent.js:1347`), l'appel qui gèle la file de travail 25-30 min.

---

## 3. Le trajet exact du compte rendu, étape par étape

1. **Le rapport est écrit sur disque** par l'agent : `RAPPORT-design-colonne-entrees.md` (07:25).
2. **Fin de run côté bus** : le texte agrégé est produit, puis
   `finishRunAgentsToSuperAgent(result, projectPath, ok, identity)`
   → `src/js/super-agent.js:7725`.
3. **Avis de fin** (notification + son armé + consignation) :
   `emitRunAgentsFinishNotice` → `src/js/run-agents-notify.js:117`
   (`notify` 123, `playSound("fin")` 124, `consign` 129). Ici
   `notify_super_agent_done = false` dans `config.json` → **aucune notification
   desktop** ; le son est **armé** (`armDoneSound`, `src/js/super-agent.js:7739`)
   et ne part qu'à la fin du **rendu** du compte rendu.
4. **Consignation** : `injectRunAgentsResultToSuperAgent(result, projectPath, {remember:true, identity})`
   → `src/js/super-agent.js:7686` ; le texte est étiqueté par
   `annotateMissionReport(buildRunAgentsSummary(result), identity)` (7716) →
   d'où le préfixe `[mission #3 — agents : concepteur-ui]` observé en base.
5. **Porte d'accusé de lecture** : `superAgentReportGate.deliver(...)`
   → `src/js/super-agent.js:532-543`, module `src/js/super-agent-reports.js:46`.
   `isBusy()` = `backendBusy` (déclaré `src/js/super-agent.js:543`) était **faux**
   → `defer: false`.
6. **Remise réelle** : `sendSuperAgentReport` → `src/js/super-agent.js:7556`,
   `invoke("inject_session_summary", …)` 7584.
7. **Rust** : `inject_session_summary` → `src-tauri/src/super_agent.rs:4374` ;
   mise en boîte durable `enqueue_session_summary` (4271/4393) → ligne `delivered=0`
   **écrite avant toute tentative** ; `defer=false` donc pas de sortie anticipée (4404-4414).
8. **Test de disponibilité** : `superagent_available` (`super_agent.rs:4466`) =
   `superagent_alive()` **et non** `agent_process_busy(...)`. Ici **vrai**.
9. **Envoi** : `state.agent_service.send_superagent(cmd)` (`super_agent.rs:4421`)
   → `AgentService::send` (`src-tauri/src/agent_service.rs:1898`) →
   `rpc_manager::send_command` (`src-tauri/src/rpc_manager.rs:195-206`) =
   **écriture sur stdin + flush**, rien de plus.
10. **Marquage** : `mark_session_summary_delivered` (4423) + `log_injection(... "delivered", true, "ok")` (4424).
11. **Pi consomme le prompt** et produit un tour (`agent_start` → `src/js/super-agent.js:4613`,
    rendu sur la surface 🧭, écoute du canal `rpc-event-superagent` à `src/js/super-agent.js:3340`).

**Rien, dans ces 11 étapes, n'affiche le compte rendu.** La seule chose que le
propriétaire peut voir est **l'étape 11** — c'est-à-dire le texte que le modèle a
bien voulu écrire.

---

## 4. Pourquoi le propriétaire n'a rien vu

### 4.1 Le trou structurel (prouvé, et c'est la cause retenue)

Recherche exhaustive : le texte du compte rendu injecté **n'est jamais rendu**
côté interface. `sendSuperAgentReport` (`src/js/super-agent.js:7556-7634`)
retourne sans rien ajouter à la conversation ; la seule fonction d'affichage
liée à une injection est `warnInjectionFailure`
(`src/js/super-agent.js:7524`), qui ne se déclenche **que** si
`status === "error"` (7525) — statut qui n'arrive jamais quand l'écriture sur
stdin réussit.

Donc : **un compte rendu peut être remis, lu, exploité… sans laisser la moindre
trace visible.** C'est exactement ce qui s'est produit. Et c'est structurel, pas
accidentel : avec `run_agents` non bloquant (`src/js/super-agent.js:5111-5219`,
retour `ok` immédiat), un tour de l'Assistant peut légitimement se résumer à des
appels d'outils (`db_execute`, `run_agents`) et se terminer **sans un mot** —
l'Assistant a alors « rendu compte » sans que rien ne s'affiche.

Le code dit d'ailleurs lui-même que la visibilité est **déléguée au tour du
modèle** : `src/js/super-agent.js:7574-7597` (« le compte rendu va lancer un tour
de l'Assistant dont le texte s'affiche en streaming — le son doit attendre la fin
réelle de ce rendu »), et 7591-7600 ne préparent que les **badges de projet** de
ce tour. Aucune autre trace n'est prévue : si le tour ne dit rien, il ne reste
rien, et le son armé (`armDoneSound`, 7739) ne part jamais non plus.

### 4.2 Les faiblesses qui aggravent (vraies, mais pas la cause ici)

| # | Faiblesse | Preuve | Effet |
|---|---|---|---|
| a | **Aucun accusé de lecture réel.** `delivered=1` signifie « les octets sont partis sur stdin », pas « pi a accepté le prompt ». | `rpc_manager.rs:195-206` (écriture seule) ; `super_agent.rs:4421-4424` ; et aucune poignée de main : `inject_session_summary` utilise `send_superagent` (asynchrone) alors que `send_superagent_sync_timeout` **existe déjà** (`agent_service.rs:2784`). | Si pi refuse le prompt, la ligne est marquée livrée **et perdue** — sans rejeu, sans avertissement. |
| b | **pi refuse explicitement un prompt reçu en pleine génération.** | `pi` : `dist/core/agent-session.js:1666-1668` → `throw "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp')…"` ; `dist/core/agent-session.js:1653` → refus pendant une compaction. Pilot n'envoie **jamais** `streamingBehavior` (`agent_service.rs:372-378`). | Combiné à (a) : perte **silencieuse et définitive**. Fenêtre réelle, car le drapeau d'occupation est heuristique. |
| c | **La garde `defer` du front est aveugle dans la fenêtre qu'elle vise.** | `isBusy: () => backendBusy` (`super-agent.js:532`) ; `backendBusy` n'est posé que par l'`agent_start` (4613), l'envoi local (3681) et le poll de supervision (3873). | Un compte rendu qui arrive pendant un tour **déclenché par une injection** ou par un prompt distant n'est pas différé. |
| d | **Le flag d'occupation ignore la compaction.** | `anomaly.rs:108-124` : `compaction_start` rafraîchit l'activité mais **ne pose pas `busy`** ; seul `agent_start` le pose (`anomaly.rs:282`). | Fenêtre où Pilot croit l'Assistant libre alors que pi refuse. |
| e | **Aucune réhydratation possible.** | `--no-session` pour l'assistant (`agent_service.rs:2504`, `super_agent.rs:2595`). | Un tour rendu pendant que la surface 🧭 n'est pas montée (l'écoute est créée par `createSuperAgent`, `super-agent.js:3340`) n'existe **nulle part** ensuite. |
| f | **Aucune trace du prompt injecté.** | `record_prompt`/`record_resume` sont **en mémoire** seulement (`agent_service.rs:1860-1887`). | Après coup, impossible de prouver ce qui a été écrit à pi — d'où l'absence de diagnostic côté propriétaire. |
| g | **La notification de fin de run est désactivée** chez le propriétaire. | `config.json` : `notify_super_agent_done = false` (`assistant_sound_enabled = true`). | Le seul signal « une mission est finie » ne part pas. |

### 4.3 Causes écartées (avec la preuve qui les écarte)

1. **Perte en base** — non : la ligne #2489 est là, complète (2 624 car.).
2. **File différée / rejeu** — non : aucune ligne `queued` dans `injection_logs` sur la plage.
3. **Mauvais agent / mauvaise mission (RÈGLE 4)** — non : l'étiquette `[mission #3 — agents : concepteur-ui]` est correcte.
4. **Compte rendu tronqué** — non : plafond `MAX_INJECTED_MESSAGE_CHARS = 4000` (`super_agent.rs:4176`) > 2 624 car.
5. **Assistant occupé au moment de l'injection** — non déterminant ici : même s'il l'avait été, la preuve #151 montre que le contenu est arrivé jusqu'au modèle.

---

## 5. Correction minimale

Objectif de la consigne : **un compte rendu écrit sur disque ne peut jamais
rester invisible.** Cela impose **deux** changements (le premier garantit la
visibilité, le second garantit qu'une remise ratée ne se déguise plus en
réussite).

### C1 — Afficher le compte rendu lui-même (obligatoire, ~15 lignes, front seul)

Dans `sendSuperAgentReport` (`src/js/super-agent.js:7556`), **juste avant
`return res;` (7601)**, donc après le bloc des badges (7596-7600), et **dans tous
les cas** (`delivered`, `queued`, `error`) :

```js
// INVARIANT : un compte rendu remis laisse TOUJOURS une trace visible, quel que
// soit ce que le modèle décide d'écrire (un tour d'outils peut n'avoir aucun
// texte). Sans cela, un rapport peut être remis, lu et exploité sans que le
// propriétaire puisse constater son arrivée (défaut du 2026-10-26, mission #3).
appendReportReceipt(superWarnMessagesEl, entry, res); // `superWarnMessagesEl` : super-agent.js:7522
```

avec une fonction **pure** `buildReportReceipt({identity, projectPath, summary, status, detail})`
(testable sans DOM) produisant une bulle système repliable :

> `📥 Compte rendu reçu — mission #3 (concepteur-ui) · projet pilot · 2 624 caractères · livré`
> puis le texte du compte rendu (replié, borné à ~1 200 car. + « … »).

Pourquoi c'est la bonne granularité : `superWarnMessagesEl` existe déjà
précisément pour parler à la conversation 🧭 depuis le module
(`super-agent.js:7522`, utilisé par `warnInjectionFailure`), et le nom court du
projet est **déjà calculé** deux lignes plus haut (`reportProjectName`,
`super-agent.js:7597`). Aucun changement de schéma, aucun changement Rust, aucun
risque sur la file.

### C2 — Accusé de lecture réel (obligatoire, ~10 lignes, Rust)

Dans `inject_session_summary` (`super_agent.rs:4419-4430`) et dans le rejeu
(`super_agent.rs:4516-4523`), remplacer `send_superagent(cmd)` par
`send_superagent_sync_timeout(cmd, ACK_TIMEOUT)` (`agent_service.rs:2784`,
**déjà présent**) et ne marquer `delivered=1` que si la réponse est un succès :
pi répond `{"ok":true,"disposition":"started"}` juste après le préflight
(`pi`, `dist/modes/rpc/rpc-mode.js:298-316`), ou `{"ok":false,"error":…}` pour
les refus (« already processing », compaction, modèle/clef absents). En cas
d'erreur ou de délai : **laisser `delivered=0`**, journaliser `status='error'`,
retourner `{"status":"error"}` → la porte existante affiche
`warnInjectionFailure` (`super-agent.js:7524`) **et** le rejeu Rust redélivre
plus tard (`replay_pending_superagent_summaries`, `super_agent.rs:4481`).
C'est la seule modification qui empêche la seule perte **définitive** possible.

### C3 — Durcissement d'une ligne (recommandé, non bloquant)

`Cmd["streamingBehavior"] = "followUp"` sur la commande d'injection : pi
**met en file** au lieu de **refuser** quand l'Assistant est en pleine
génération (`pi`, `agent-session.js:1668-1671`). La remise devient « différée
de quelques secondes » au lieu de « refusée ».
⚠️ À poser dans `inject_session_summary`, **pas** dans
`prompt_command_with_resume` : le test `prompt_command_with_resume_is_additive_only`
(`agent_service.rs:5623`) verrouille l'égalité exacte de la commande simple.

---

## 6. Ce que la correction garantit — et ce qu'elle ne garantit pas

**Garanti après C1** : tout compte rendu remis apparaît dans la conversation de
l'Assistant, avec son identité de mission, son projet, sa taille, le statut de
remise et son texte. Même si le modèle ne dit rien, même si le tour ne produit
aucun texte, même si la surface est recréée plus tard (la bulle est ajoutée au
moment de la remise, pas à la fin d'un rendu).

**Garanti après C2** : une remise refusée n'est plus jamais présentée comme
« livrée » ; elle reste en base (`delivered=0`), elle est signalée à l'écran et
elle est rejouée.

**Non garanti** (assumé, hors périmètre) : que l'Assistant *parle* du compte
rendu. La bulle C1 dit « voici ce que l'agent a rendu » ; elle ne remplace pas
l'analyse de l'Assistant, et ne prétend pas qu'il l'a lue. C'est la seule
répartition honnête : la trace est technique, l'interprétation reste au modèle.

---

## 7. Méthode de vérification

**V1 — reproduire l'invisibilité (avant correctif, 2 min, sans redémarrer)**
1. Onglet 🧭 ouvert, Assistant au repos.
2. Console web : `invoke("inject_session_summary", {projectPath: "<projet>", sessionId: null, summary: "[mission #Test — agents : codeur] test de restitution", defer: false})`.
3. Constat attendu **avant** C1 : `{"status":"delivered"}`, une ligne
   `injection_logs delivered/ok`… et **aucune bulle** dans la conversation
   (pi émet bien une réponse corrélée — `rpc-mode.js:306-310`, `output(success(id, "prompt", { disposition }))` — mais personne ne la lit).
4. Constat attendu **après** C1 : la bulle `📥 Compte rendu reçu — mission #Test …` apparaît immédiatement.

**V2 — reproduire le faux accusé de lecture (avant/après C2)**
1. Lancer `run_agents` sur une mission courte (l'Assistant passe en génération).
2. Pendant la génération (fenêtre de quelques secondes), injecter un compte rendu.
3. Avant C2 : `status:"delivered"` + `delivered=1` en base **alors que rien
   n'apparaît** (et, dans la sortie de pi, une ligne
   `{"type":"response","ok":false,"error":"Agent is already processing…"}`).
4. Après C2 : `status:"error"`, `delivered=0`, avertissement visible, puis
   remise automatique au `agent_settled` suivant → **une seule** bulle.

**V3 — non-régression**
```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run build:handbook   # si la spec est mise à jour (spec_super_agent.md)
```
Puis essai à l'écran par le propriétaire (un seul lot, conformément à la
méthode : `concepteur-ui` écrit, `codeur-interface` applique).

---

## 8. Anti-récidive (verrous à poser avec la correction)

| # | Verrou | Type |
|---|---|---|
| L1 | `buildReportReceipt` : test pur — pour `delivered`, `queued` **et** `error`, une ligne de reçu est produite, avec numéro de mission, projet, taille, statut, et texte borné. | test unitaire JS |
| L2 | Test DOM (jsdom) : `sendSuperAgentReport` avec `superWarnMessagesEl` monté → **une** bulle ajoutée par remise, jamais zéro. | test JS |
| L3 | Rust : réponse `{"ok":false,…}` → `delivered` **reste 0**, `injection_logs` en `error`, **puis** le rejeu la livre une seule fois. Étendre le motif des tests existants `super_agent.rs:8256+`. | test Rust |
| L4 | **Verrou statique** (motif déjà éprouvé de `scanAutomaticStopSites`, `src/js/agent-stop-funnel.js`) : interdire `send_command` (fire-and-forget) sur le chemin d'injection du super-agent — seul `send_command_register`/`wait_response` est autorisé. Empêche qu'un futur refactor réintroduise l'accusé mensonger. | test statique JS |
| L5 | Journaliser le **texte** injecté (borné) dans `injection_logs.detail` ou un fichier `.pilot/injections.log` : un jour où un compte rendu n'apparaît pas, il y aura une preuve de ce qui a été écrit à pi (aujourd'hui : rien, cf. faiblesse f). | test d'existence |

---

## 9. Constats annexes (à traiter séparément, ne bloquent pas)

1. **Rejeu de file : 2 min 14 s d'attente** entre la fin d'une mission et le
   départ de la suivante, dues à `RUN_AGENTS_QUEUE_REPLAY_MIN_STUCK_IDLE_MS`
   (2 min, `agents-bus.js:133` lu par `super-agent.js:1344`). Ce délai est
   **volontaire** (il protège une run qui vient de démarrer) mais l'attente est
   perceptible ; une libération **événementielle** sur `agent_settled` du projet
   la supprimerait.
2. **`list_agent_sessions` dans la sonde de rejeu** (`super-agent.js:1347`) :
   c'est l'appel qui gèle la file de travail 25-30 min (consigne absolue du
   propriétaire). Il est appelé **toutes les 15 s** par cette sonde — c'est un
   risque structurel, indépendant du présent défaut.
3. `notify_super_agent_done = false` : le propriétaire n'a **aucune**
   notification de fin de run. À décider (réglage), pas à corriger d'office.
4. La documentation de la porte (`src/js/super-agent-reports.js:1-31`) annonce
   déjà que `agent_process_busy` « ne passe à vrai qu'à l'`agent_start` » : le
   risque était **écrit** ; il n'était simplement pas couvert côté accusé.

---

## 10. Ce que je ne peux pas prouver (honnêteté)

- **Si l'Assistant a écrit un texte visible à 07:29** et que celui-ci n'a pas été
  rendu (surface 🧭 non montée, faiblesse e), ou s'il n'a **rien écrit** (tour
  d'outils silencieux). Les deux cas sont couverts par C1 ; les distinguer exige
  un journal des rendus, qui n'existe pas (et ne peut pas exister sans trace du
  prompt, faiblesse f). C'est **précisément** pour cela que C1 doit afficher le
  compte rendu lui-même : la question devient sans objet.
- Aucune trace disque de la conversation de l'Assistant : `--no-session`
  (`agent_service.rs:2504`). Les seules preuves du monde réel sont la base
  `super-agent.db`, `.pilot/agent-stops.log` et les mtimes de fichiers — c'est
  sur elles que repose tout ce rapport.

---

## 11. Conclusion

| Question | Réponse |
|---|---|
| Le compte rendu de B a-t-il été perdu ? | **Non.** Écrit en base (#2489), remis, **lu**, exploité (mission #151, 30 s plus tard). |
| Pourquoi le propriétaire n'a-t-il rien vu ? | Parce que **rien n'affiche un compte rendu reçu** : la seule surface est le texte libre de l'Assistant, non garanti. |
| Différence avec la mission A ? | Aucune sur le transport : A a produit un tour avec du texte, B un tour sans texte visible (ou un rendu non monté). Le défaut était là depuis le début, latent. |
| Correction minimale | **C1** (afficher le compte rendu + son statut, front seul, ~15 lignes) **+ C2** (accusé de lecture réel, Rust, ~10 lignes, `send_superagent_sync_timeout` existe déjà). **C3** recommandé (1 ligne). |
| Verrou | L1-L5, dont un verrou statique interdisant le retour du fire-and-forget sur ce chemin. |

DONE: diagnostic terminé — cause retenue : **absence de restitution visible des comptes rendus injectés** (preuve : `session_summaries` #2489 `delivered=1` + `magnus_tracabilite` #151 qui cite mot pour mot le rapport de B 30 s après l'injection, alors qu'aucun code n'affiche le compte rendu — `src/js/super-agent.js:7556-7634`, seule alerte possible `warnInjectionFailure` `:7524` réservée à `status==='error'`) ; correction minimale : **C1** bulle de reçu `📥 Compte rendu reçu — mission #N … + texte` au moment de la remise (`super-agent.js:7601`, via `superWarnMessagesEl` `:7522`) et **C2** accusé de lecture réel par `send_superagent_sync_timeout` (`agent_service.rs:2784`) avec `delivered=0` + rejeu en cas de refus (`super_agent.rs:4419-4432`, `:4516-4523`) ; vérification V1/V2 + verrous L1-L5 ; aucun fichier de code modifié, aucun commit.
