# Rapport — Démarrage de Pilot : l'assistant semble bloqué et un travail long se déclenche seul

> Statut : **TERMINÉ** — diagnostic tranché, correction minimale appliquée, test qui mord, suites vertes.
> Version installée concernée : 0.4.45 · Base de suivi observée : `%APPDATA%\com.pilot.editor\super-agent.db`
> Toutes les affirmations ci-dessous portent leur preuve `fichier:ligne` (ou la ligne de base de données lue en lecture seule).

---

## 1. Symptôme constaté

À l'ouverture de Pilot, sans aucune demande de l'utilisateur :

1. l'onglet 🧭 Assistant s'ouvre (comportement voulu) mais **la conversation ne répond pas** — le message tapé est refusé ;
2. **un travail long démarre tout seul** : missions de publication / reprise de chantier lancées par l'assistant ;
3. le panneau « tâches en cours » affiche un **extrait de règles** au lieu d'une description de tâche.

Chronologie réelle relevée sur la machine (fuseau local, 2026-10-24) :

| Heure | Fait | Preuve |
|---|---|---|
| 17:43:40 | **deux** relances programmées sont livrées **dans la même seconde** (987 `veille_des_risques`, 988 `reprise_chantiers_en_attente`) | `assistant_schedules.last_run_at` = `2026-10-24 17:43:40` pour les deux |
| 17:44:57 | l'assistant lance l'agent `publieur` | `.pilot/agent-ops.log` : `2026-10-24T17:44:57 op=spawn agent=publieur` || 17:45:30 | une remise est **différée** « assistant occupé — sera rejoué » | `injection_logs` id 2563 |
| 17:45:43 | « Publication 0.4.45 annulée sur décision du propriétaire » — mission `publieur` arrêtée, run libérée par le watchdog | `magnus_journal` id 1425 |
| 17:52:04 / 18:00:18 | spawns `codeur`, puis `testeur` | `.pilot/agent-ops.log` |
| 17:51:52 → 18:54:43 | 4 injections supplémentaires « ok » | `injection_logs` id 2564→2568 |

Aucune action de l'utilisateur n'est à l'origine des faits de 17:43:40 à 18:00:18 : il avait seulement **ouvert Pilot**.

---

## 2. Faits établis (preuve `fichier:ligne`)

### 2.1 Démarrage côté assistant — y a-t-il un appel bloquant ?

**Non : aucun appel bloquant n'a été trouvé au démarrage.** Ce qui suit est la chaîne exacte.

- Ouverture automatique de l'onglet 🧭 : `src/js/main.js:1012` — `if (cfg.super_agent_open === true || cfg.super_agent_start_on_launch !== false)`, puis `tabs.openFile(...)` l.1013 et `switchToSuperAgent()` l.1017. Sur la machine, **les deux indicateurs sont vrais** (`config.json` : `super_agent_open = true`, `super_agent_start_on_launch = true`) : l'onglet s'ouvre donc à **chaque** démarrage.
- Création de l'onglet : `src/js/tabs.js:808` `await createSuperAgent(tab.wrapper)` → `src/js/super-agent.js:2642` `createSuperAgent()` commence par `await refreshSuperAgentConfig()` (un `invoke("get_super_agent_config")`, lecture de config locale, sans I/O réseau).
- Vérification de version de `pi` : `src/js/main.js:367` `runPiStartupCheck()` — **promesse non attendue**, plafonnée à 20 s (`src/js/pi-update.js:26` `PI_STARTUP_CHECK_TIMEOUT_MS = 20_000`) et qui **rend toujours le terrain** (`src/js/pi-update.js:211`).
- Sondes backend : `get_backend_info` (`src-tauri/src/lib.rs:1811`) et `extension_gate_supported` (`src-tauri/src/lib.rs:1782`) sont `async` **et** déportent la sonde dans `tauri::async_runtime::spawn_blocking` → le thread principal n'est pas bloqué. Vérifié dans les macros Tauri : une commande `async fn` s'exécute sur le runtime async (`ExecutionContext::Async`, branche `"async"` de `tauri-macros-2.6.3/src/command/wrapper.rs`), seul `ExecutionContext::Blocking` utiliserait le thread principal.
- Mesures réelles sur la machine : `pi --version` = **0,274 s** ; `https://pi.dev/api/latest-version` = **HTTP 200 en 0,722 s**. La garde de démarrage n'est donc pas une source de latence ici.

**Conclusion 2.1** : ni le démarrage, ni la garde de version de `pi` n'expliquent le blocage. Le blocage est **en aval**, dans l'admission des messages de l'assistant.

Où le message de l'utilisateur est refusé : `src/js/super-agent.js:3622` dans `send()` —
`if (!canAssistantReflect())` → message système « … Votre message est conservé dans le champ : renvoyez-le dès que la vérification est terminée » puis `return`.
`canAssistantReflect()` = `!isTerrainReserved()` (`src/js/run-policy.js:82`), qui recouvre l'état du terrain **et** la garde P0-1 `backendBusy` (`src/js/super-agent.js:535`). L'utilisateur voit donc un assistant qui « ne répond pas » alors qu'il est en réalité **déjà occupé** par un travail qu'il n'a pas demandé.

### 2.2 Taille réelle du prompt système — assistant vs agent de projet

Mesures faites sur la machine (pas des estimations) :

| Élément | Taille | Preuve |
|---|---|---|
| Textes **fixes** du prompt assistant (rôle + outils + résilience + AGENTS.md + supervision + schedule + voix) | **5 532 caractères** (plafond 5 550) | `src-tauri/src/super_agent.rs:534` `SUPER_AGENT_FIXED_PROMPT_BUDGET = 5550` ; mesuré par le test `super_agent_fixed_prompt_stays_under_budget` (`super_agent.rs:7938-7952`, sortie : `5532 caracteres`) |
| Prompt **personnalisé** de l'assistant (`super_agent_prompt`, préférences durables) | **8 405 caractères** | `config.json` (champ `super_agent_prompt`) |
| Assemblage | rôle + contexte projet + projets connus + agents disponibles + textes fixes + prompt perso + mémoire utilisateur + personnalité + mémoire de session + guidelines | `super_agent.rs:689-720` `assemble_super_agent_system_prompt` |
| Rôle d'un **agent de projet** (ordre de grandeur) | `Reviewer` 119 car · `Testeur` 163 · `Codeur` 186 · `Publieur` 1 695 · `Designer d'interface` 2 017 | table `agents` de `pilot.db` (colonne `role`) |

Le point décisif n'est pas le total mais **où** il est envoyé : `super_agent.rs:787`
`let full_message = format!("{}\n\n{}", full_system, message);` puis l.788
`{"type":"prompt","message": full_message}`. **Le prompt système complet voyage donc comme un message utilisateur, à chaque tour**, et il est en outre ce que le service enregistre comme « mission en cours » de la session (voir 2.4).

**Conclusion 2.2** : le prompt de l'assistant est structurellement ~30 fois plus lourd que le rôle d'un agent de projet (5 532 fixes + 8 405 personnalisés ≈ 14 000 caractères, hors contexte/mémoire). Chaque tour déclenché **automatiquement** coûte donc ce prix, et surtout **occupe l'assistant** — d'où la non-réponse aux messages de l'utilisateur.

### 2.3 Rejeu automatique au démarrage

Trois mécanismes de rejeu existent. Un seul était actif le jour du constat.

1. **File des résumés de sessions** — `src-tauri/src/super_agent.rs:4097` `replay_pending_superagent_summaries`, borné à 3 par appel (`SUPER_AGENT_REPLAY_MAX_PER_CALL`), espacé de 150 ms, garde `REPLAY_IN_FLIGHT`. **Écarté** : la table `session_summaries` ne contient **aucune** ligne `delivered = 0` (0 en attente, 1 984 au total).
2. **Mission interrompue / file des commandes** — pas de trace d'une mission en file au moment du lancement ; les traces relevées (`agent-ops.log`) sont des **conséquences** (spawns), pas des rejeux.
3. **Relances programmées (planifications échues)** — `src/js/super-agent.js:3880` `startScheduleTicker()` (appelé à la création de l'onglet, donc **au démarrage**), tick toutes les `SCHEDULE_TICK_INTERVAL_MS = 10000` (`super-agent.js:3962`, `setInterval` l.4030), qui appelle `invoke("super_agent_schedule_tick")` (`super-agent.js:3982`) → `src-tauri/src/super_agent.rs:1317` → `schedule_due` (`super_agent.rs:1199`) : `SELECT id, name, prompt, every … WHERE enabled = 1 AND datetime(COALESCE(last_run_at, created_at), '+' || CAST(every AS TEXT) || ' seconds') <= ?1 ORDER BY id`.

**Aucun plafond** n'est appliqué à `schedule_due` : **toutes** les relances échues sont renvoyées. Côté JS, la boucle les livrait **toutes, à la suite**, dans la même passe (avant correction : `for (const d of due) { … await invoke("send_super_agent_command", …) }`), chacune ouvrant un **vrai tour de génération** de l'assistant ; le marquage `last_run_at` n'a lieu qu'après livraison (`super_agent.rs:1230` `schedule_mark_done`), donc un rappel non livré reste dû et re-part au tick suivant.

Ce mécanisme est aussi celui qui **viole une promesse documentée**. Le réglage existe :
- libellé et infobulle : `index.html:1003-1004` — case `setting-superagent-auto-check-startup`, « **Désactivé par défaut : l'Assistant ne lance pas automatiquement un rappel dû au démarrage**, sauf si vous validez ce comportement » ;
- propagé jusqu'au front : `src-tauri/src/super_agent.rs:1491` (`"super_agent_auto_check_startup": cfg.super_agent_auto_check_startup`), `src/js/super-agent.js:1616` (`configCache = await invoke("get_super_agent_config")`), défaut `false` (`lib.rs:1216`, `super-agent.js:481`) ;
- **et pourtant lu par personne** dans la décision d'injection : l'ancien commentaire du tick disait explicitement l'inverse — « le réglage `super_agent_auto_check_startup` ne gouverne QUE le lancement automatique à l'ouverture de session (**géré ailleurs**), pas le tick périodique » — alors que le « ailleurs » n'existe pas (`super-agent.js`, `super_agent.rs` : aucune autre lecture du champ dans une décision).

Sur la machine : `super_agent_auto_check_startup = false`, et **deux relances dues ont néanmoins été livrées à 17:43:40**, suivies du lancement de `publieur` à 17:44:57. La promesse « aucun rappel dû au démarrage » n'était pas tenue.

### 2.4 Panneau « tâches en cours » — pourquoi un extrait de règles

Chaîne complète, prouvée :

1. le message envoyé au moteur contient **tout** le prompt système : `super_agent.rs:787` ;
2. le service **enregistre ce message** comme « mission en cours » de la session : `src-tauri/src/agent_service.rs:411` `prompt_snapshot(command)` → tronqué à `PROMPT_SNAPSHOT_MAX_CHARS = 600` (`agent_service.rs:306`), avec ancrage sur `MISSION_ANCHORS = ["## Objectif", "Objectif :", "=== MISSION ===", "Tâche :"]` (`agent_service.rs:312`, appliqué l.428-433) ;
3. or le bloc de règles de l'assistant **contient littéralement `## Objectif`** : `super_agent.rs:492` `SUPER_AGENT_RESILIENCE_PROMPT` — « L'enveloppe « ## Contexte/**## Objectif**/## Consignes/## Ce qu'il ne faut PAS faire » est ajoutée MÉCANIQUEMENT par Pilot … » ;
4. l'ancre se déclenche donc **dans les règles**, et la fenêtre de 600 caractères démarre là → le panneau reçoit un **extrait de règles** ;
5. `record_prompt` (`agent_service.rs:1822-1826`) le stocke, `list_agent_sessions` l'expose en champ `prompt` (`agent_service.rs:2412-2426`), `get_agent_supervision` le recopie (`src-tauri/src/dashboard.rs:1298`), et l'interface l'affiche : `src/js/agent-activity.js:359` `resolveMissionLabel(resume, prompt)` → `:594` `buildRunningMissions` → `:664` `renderMissionsPanelHtml`.

Le repli sur le résumé court (`resume`, `agent_service.rs:321`, fourni par les délégations) n'existe **pas** pour l'assistant : `do_send_super_agent_prompt` n'en joint aucun (`super_agent.rs:788`). Le panneau n'a donc, pour la ligne de l'assistant, **rien d'autre à montrer que les règles**.

### 2.5 Boucles d'attente / re-prompt au démarrage

- **Pas de boucle d'attente côté assistant** : le garde-fou anti-boucle existe (`src/js/super-agent.js:4010-4070` `maybeDetectSuperAgentLoop`, arrêt par `abort_super_agent` + trace), et la règle « anti-attente » est dans le prompt (`SUPER_AGENT_NO_WAIT_PROMPT`, `super_agent.rs:512`).
- **Pas de re-prompt réseau** : le seul rejeu automatique est celui des résumés (2.3, à 0) et les relances (2.3, la cause).
- En revanche, il existe bien une **boucle de ré-occupation** : un rappel reste « dû » tant qu'il n'est pas livré (`super_agent.rs:1199` + `:1230`), et le tick repasse **toutes les 10 s** (`super-agent.js:3962`). Quand plusieurs rappels sont échus, la boucle livrait N tours de génération consécutifs, entretenant `backendBusy` — donc le refus des messages de l'utilisateur (`super-agent.js:3622`). La boucle est bornée, mais elle **dure assez longtemps** pour que l'utilisateur conclue « l'assistant ne répond pas ».

---

## 3. Causes candidates classées

| # | Cause | Verdict | Preuve |
|---|---|---|---|
| 1 | Garde de version `pi` bloquante au démarrage | **écartée** | `pi --version` 0,274 s ; endpoint HTTP 200 en 0,722 s ; promesse non attendue `main.js:367` ; terrain toujours rendu `pi-update.js:211` |
| 2 | Commande Tauri synchrone gelant l'UI | **écartée** | `async fn` exécutées sur le runtime async (`tauri-macros …/wrapper.rs`) ; sondes déjà en `spawn_blocking` (`lib.rs:1782`, `:1811`) |
| 3 | Rejeu des résumés de sessions en attente | **écartée** | 0 ligne `delivered = 0` dans `session_summaries` ; rejeu borné à 3/appel (`super_agent.rs:4097`) |
| 4 | Prompt venu de l'accès web distant | **écartée** | `web_audit.jsonl` s'arrête au `2026-08-25 09:24:39` |
| 5 | Panneau montrant des règles | **confirmée** (défaut d'affichage, secondaire) | § 2.4 |
| 6 | Taille du prompt assistant | **facteur aggravant** | § 2.2 (5 532 + 8 405 car à chaque tour) |
| 7 | **Rafale de relances échues injectées au démarrage, en violation du réglage « points à faire à l'ouverture »** | **CAUSE DOMINANTE** | § 2.3 : deux relances livrées à 17:43:40, `publieur` lancé 77 s plus tard, assistant occupé à 17:45:30 |

---

## 4. Cause dominante tranchée

**La cause dominante est le lancement automatique, au démarrage de Pilot, de toutes les relances programmées échues — alors que le réglage « Vérifier les points à faire à l'ouverture de la session (relances programmées) » est désactivé.**

Chaîne exacte, du premier maillon au symptôme :

```
main.js:1012 (super_agent_start_on_launch = true)
  → tabs.js:808 createSuperAgent
    → super-agent.js:3880 startScheduleTicker   (ticker 10 s, super-agent.js:3962)
      → super_agent_schedule_tick (super_agent.rs:1317)
        → schedule_due (super_agent.rs:1199) : AUCUN plafond, AUCUNE lecture du réglage
          → 2 relances dues livrées dans la même passe (17:43:40)
            → 2 tours de génération réels de l'assistant (prompt complet : super_agent.rs:787)
              → l'assistant délègue (spawn publieur 17:44:57) et reste occupé
                → backendBusy (super-agent.js:535) → canAssistantReflect() faux (run-policy.js:82)
                  → send() refuse le message de l'utilisateur (super-agent.js:3622)
                    → symptôme : « l'assistant ne répond pas » + « travail long non demandé »
```

Le caractère **non demandé** est établi par la confrontation réglage/promesse : réglage à `false` sur la machine, infobulle qui promet « l'Assistant ne lance pas automatiquement un rappel dû au démarrage », et pourtant deux livraisons automatiques à l'ouverture.

---

## 5. Correction minimale appliquée

**Une seule règle, écrite à un seul endroit**, plus son branchement dans le ticker. Aucune autre logique n'a été modifiée (ni l'admission `run-policy.js`, ni la garde de version `pi`, ni la base, ni Rust).

1. `src/js/super-agent-schedule.js` — nouvelle fonction **pure** `planDueReminderInjections({due, pendingIds, backendBusy, autoCheckStartup, ownerEngaged})` :
   - **règle 1** — un rappel dû n'est **pas** injecté au démarrage si le réglage `super_agent_auto_check_startup` est désactivé (`autoCheckStartup !== true`) **et** que le propriétaire n'a pas lui-même écrit dans la session (`ownerEngaged !== true`). Le rappel **reste dû** : rien n'est perdu, rien n'est marqué, il partira dès le premier message de l'utilisateur — ou immédiatement si le réglage est activé ;
   - **règle 2** — **au plus une relance par passe** : plusieurs rappels échus ensemble ne partent plus à la suite ; les suivants restent dus et partent aux passes suivantes (10 s) ;
   - les gardes historiques sont conservées : `backendBusy` (assistant occupé) et `pendingIds` (injection déjà en vol, issue #135).
2. `src/js/super-agent.js` :
   - import de la fonction (l.52) ;
   - état `ownerEngagedThisSession` (l.3980), **remis à `false` à chaque ouverture de session** dans `startScheduleTicker()` (l.4029) et **posé à `true`** quand le propriétaire envoie son propre message dans `send()` (l.3652) ;
   - `scheduleTick()` (l.3982-4008) décide désormais via `planDueReminderInjections(...)` et n'itère plus la liste brute renvoyée par Rust.
3. `spec_super_agent.md` — la section « Programmer des relances » dit maintenant exactement ce que fait le code (au plus une relance par passe ; rappel dû retenu jusqu'au premier message du propriétaire quand le réglage est désactivé) et nomme le lieu unique de la décision.

Portée : **aucune** écriture en base, **aucun** changement de schéma, **aucun** changement de protocole RPC, **aucun** changement du comportement des agents de projet. Le comportement voulu par le propriétaire (réglage activé) et le comportement historique hors démarrage (onglet ouvert, conversation en cours) sont inchangés : après le premier message, le tick repart exactement comme avant.

---

## 6. Test ajouté et preuve qu'il mord

Tests ajoutés dans `src/js/super-agent-schedule.test.js` :

- **5 tests purs** sur `planDueReminderInjections` : réglage désactivé + propriétaire silencieux → `toInject = []` et les deux rappels **retenus** (`held`) ; réglage activé → la relance part ; propriétaire engagé → la relance part ; deux rappels échus → **une seule** injection, l'autre retenu ; gardes historiques (`backendBusy`, `pendingIds`) respectées ; réponse vide/malformée tolérée.
- **3 tests de branchement** lisant `src/js/super-agent.js` (lecture normalisée CRLF, cf. quality-gate § 3.4) : le tick décide bien via `planDueReminderInjections` avec `configCache.super_agent_auto_check_startup`, il n'itère plus `for (const d of due)`, et l'engagement du propriétaire est remis à zéro à l'ouverture puis posé à l'envoi.

**Preuve que le test mord — deux neutralisations, restaurations vérifiées :**

| Neutralisation (temporaire) | Résultat | Restauration |
|---|---|---|
| Remplacer `for (const d of toInject)` par `for (const d of due)` dans `super-agent.js` (retour au comportement fautif, décision pure laissée intacte) | **1 test en échec** sur 30 — `le tick n'itère plus la liste brute due` | fichier restauré, 30/30 verts |
| Neutraliser la décision pure (`startupAllowed = true` et `toInject: eligible`) dans `super-agent-schedule.js` | **4 tests en échec** sur 30 — les 4 tests de la règle de démarrage/une-relance-par-passe | fichier restauré, 30/30 verts |

Les deux variantes sont volontairement testées : la première prouve que le **branchement** ne peut pas régresser silencieusement (la fonction pure restant verte), la seconde prouve que la **règle elle-même** est verrouillée.

---

## 7. Chiffres réels des deux suites de tests

| Suite | Commande | Résultat |
|---|---|---|
| Frontend (Vitest) | `npm test` | **157 fichiers / 2 685 tests — 2 685 réussis, 0 échec** (9,6 s) |
| Rust (desktop, lib) | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **699 réussis, 1 ignoré, 0 échec** (10,6 s) |

Aucun test existant n'a été modifié ni supprimé. Aucune publication, aucun tag, aucun bump de version, aucune installation, l'application n'a pas été lancée (conformément aux consignes).

---

## 8. Ce qui reste incertain

- **Le panneau « tâches en cours » affiche encore l'extrait de règles** pour la ligne de l'assistant (défaut prouvé au § 2.4). Ce n'est pas la cause du blocage et la consigne était **une** correction minimale : le correctif naturel — mais non appliqué ici — est de joindre à l'envoi de l'assistant un résumé court (`pilotResume`, déjà supporté par `agent_service.rs:321`) au lieu de laisser le panneau déduire une mission du prompt, ou d'exclure la ligne de l'assistant de la liste des « missions ».
- **L'ampleur exacte du retard accumulé** avant 17:43:40 n'est pas reconstituable : `last_run_at` a été écrasé par la livraison du jour. Ce qui est certain, c'est que les deux rappels étaient dus **et** qu'ils ont été livrés dans la même seconde.
- Le lien entre la relance `veille_des_risques` / `reprise_chantiers_en_attente` et la **décision** de publier 0.4.45 appartient au raisonnement de l'assistant (non déterministe). La correction supprime la **déclencheuse** (le rappel automatique non demandé), pas la capacité de l'assistant à proposer une publication quand on le lui demande.
- Le comportement du watchdog qui a libéré la run à 17:45:43 (`magnus_journal` id 1425, « inactivité 11 s ») n'a pas été analysé : il a fonctionné (aucun geste irréversible, selon le journal) et sort du périmètre du symptôme.
