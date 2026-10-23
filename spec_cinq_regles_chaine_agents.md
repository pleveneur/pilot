# Spec — Les cinq règles de solidité de la chaîne d'agents

> **Source unique.** Ce document est LE point d'entrée pour les cinq règles qui
> rendent la chaîne d'agents de Pilot fiable. On le cite ; on ne recopie pas son
> contenu ailleurs. Les rapports de mission restent la trace des corrections
> (ils ne sont **pas** réécrits) : voir § « Rapports d'origine ».
>
> **Vérification.** Contenu contrôlé sur l'arbre de travail le **2026-10-23**
> (Pilot 0.4.41) : chaque fichier de test cité a été ouvert et chaque nom de cas
> recopié tel qu'il est écrit. Les écarts constatés avec le relevé d'origine sont
> dits au § « Écarts constatés » — c'est la partie la plus importante.

## Tableau des cinq règles

| # | Règle | Ce qu'elle protège (une phrase) | Test qui la tient |
|---|---|---|---|
| 1 | L'agent lancé est **exactement** l'agent demandé | Aucun agent auxiliaire ne prend la place de la mission, et un agent inconnu est refusé avant tout lancement | `src/js/agent-inconnu-refus.test.js`, `src/js/super-agent-refus-avant-lancement.test.js`, `src/js/agent-demande-exact.test.js` |
| 2 | Une compilation ou une lecture longue **n'est pas** de l'inactivité | Une consultation (lire, chercher, `git status`, `cargo test`) n'est jamais comptée comme une boucle et n'arrête jamais un agent | `src/js/regle-2-lectures-jamais-arret.test.js` + Rust `anomaly.rs` (`should_report_anomaly`) |
| 3 | Aucune session ne disparaît sans **trace écrite** | Toute fin de session non demandée laisse une ligne de motif dans `.pilot/agent-stops.log` | `src/js/agent-stop-trace-paths.test.js`, `src/js/agent-stop-trace-concurrency.test.js`, `src/js/agent-stop-funnel.test.js` |
| 4 | Une demande mise en file **ne se perd jamais** | Une demande en attente est rejouée avec son propre texte et ses propres agents, ou abandonnée en le disant | `src/js/regle-4-file-jamais-perdue.test.js`, `src/js/file-attente-*.test.js` (6 fichiers) |
| 5 | Un projet n'est **jamais** laissé verrouillé | Un verrou de run orphelin est levé automatiquement, sans redémarrage de Pilot | `src/js/verrou-orphelin.test.js`, `src/js/verrou-par-projet.test.js`, + Rust `agent_service.rs` / `rpc.rs` |

## Règle 1 — l'agent lancé est exactement l'agent demandé

Ce qui a été retiré : l'**estimation préalable** que chaque lancement déclenchait
(un agent `plan-maker` prenait le créneau de run et la mission demandée ne
démarrait jamais). `agent-demande-exact.test.js` verrouille ce retrait
(« n'appelle plus l'estimation préalable et ne lance plus d'agent auxiliaire »,
« ne fabrique plus d'accusé « en préparation » : le lancement rend le verdict
réel ») et le refus explicite d'un identifiant inconnu, avec la liste des agents
disponibles.

La preuve **d'exécution** — celle qui compte — est ailleurs :
`agent-inconnu-refus.test.js` fait tourner le bus d'agents et exige que
« ne démarre AUCUN processus et ne se replie jamais sur un agent du registre »,
que « démarre exactement l'agent valide demandé, et lui seul reçoit la mission »,
et qu'« une mission sur le codeur démarre le codeur en PREMIER et sans
planificateur ». `super-agent-refus-avant-lancement.test.js` complète en
**extrayant puis exécutant** le garde de `super-agent.js` : l'erreur est émise et
la branche **retourne** (un lancement sentinelle ne doit jamais être atteint).

## Règle 2 — une compilation ou une lecture longue n'est pas de l'inactivité

Une seule décision est partagée par les trois chemins d'arrêt automatique
(`agent-pi.js`, `agents-bus.js`, `super-agent.js`) :
`isReadOnlyAgentToolCall` dans `loop-detection.js`. Une répétition de lecture ou
de consultation (`read`, `rg`, `ls`, `git status|diff|log`, `sed -n`, `cargo
test`…) n'entre **jamais** dans la fenêtre anti-boucle ; une répétition
d'**écriture** reste détectée. `regle-2-lectures-jamais-arret.test.js` le prouve
par l'exemple (« 15 consultations `git status --short` identiques : AUCUN
arrêt »), et vérifie que la classification n'est **pas dupliquée** sur un site.

Côté Rust, le moniteur d'anomalies refuse de signaler un agent qui a une
**opération d'outil en cours** (`should_report_anomaly`, `src-tauri/src/anomaly.rs`) :
test `should_report_anomaly_suspends_while_tool_in_progress`, motivé par le cas
« un build silencieux de 40 min n'émet aucun `tool_execution_update` ».

## Règle 3 — aucune session ne disparaît sans trace écrite

Deux modules, un seul journal : `agent-stop-trace.js` écrit la ligne
(`<projet>/.pilot/agent-stops.log`, avec repli global et échec rendu visible) et
`agent-stop-funnel.js` est **l'entonnoir unique** des arrêts automatiques du bus
(`stopAgentWithTrace({reason, detected, agentId, projectPath, uid, stop})` :
tracer, attendre la trace, puis arrêter).

`agent-stop-trace-paths.test.js` est une **matrice de source** à portée lexicale
(une trace doit être dans la fonction englobante du site, avant lui) : elle
épingle le nombre de traces par fichier et refuse tout site terminal muet ;
`agent-stop-trace-concurrency.test.js` prouve qu'aucune ligne n'est écrasée quand
les traces sont concurrentes ; `agent-stop-funnel.test.js` prouve que le site
d'arrêt est **dans la même instruction** que l'appel d'entonnoir, et qu'un motif
manquant est dit au lieu d'être avalé.

## Règle 4 — une demande mise en file ne se perd jamais

La file survit à la run qui l'a remplie (elle n'est plus dans le contexte de run),
le rejeu prend la **tête** de file et non la dernière entrée, et chaque demande
porte son identité (`mission-identity.js` : `[mission #7 · agents : codeur]`).
`regle-4-file-jamais-perdue.test.js` vérifie les deux côtés : une demande que
plus aucune run ne porte est **listée comme orpheline**, et un abandon
(`abandonProjectExclusivityQueues`, `stopAgentsRun` global) est **journalisé et
notifié** — « l'abandon d'orphelines PRÉVIENT l'utilisateur (notify), jamais un
silence ».

Les six fichiers `file-attente-*.test.js` (fifo-admission, fenetre-rejeu,
identite-demande, regle-4, retrait-mission, arret-conserve) couvrent l'admission,
la fenêtre de rejeu, l'identité de la demande et le retrait ciblé d'une mission.

## Règle 5 — un projet n'est jamais laissé verrouillé

Le verrou est **en mémoire** (aucun fichier `.pilot/`) : un redémarrage de Pilot le
libère, mais ce n'est pas une raison d'attendre. `verrou-orphelin.test.js` couvre
le balayage périodique (« le balayage périodique libère le verrou et la mission
suivante peut démarrer »), la levée **ciblée** tentée avant le refus d'une
commande manuelle, et les cas où il ne faut **pas** libérer (agent réellement au
travail, demande encore en file, run plus jeune que la grâce de démarrage).
`verrou-par-projet.test.js` couvre l'exclusivité lecture/écriture par projet et
le drainage de la file au moment de la libération.

Côté Rust, le verrou n'est déclaré occupé que si une **session est réellement
vivante** : `project_has_alive_session` (`agent_service.rs`, tests
`project_has_alive_session_false_sans_session`, `…_false_pour_session_morte`,
`…_vraie_pour_session_vivante`) et `project_busy_with_liveness` (`rpc.rs`, test
`project_busy_with_liveness_requires_a_live_session`).

## Ce que ces règles ne couvrent pas

Repris de `RAPPORT-trous-residuels-2-3-4.md` § 8 (limites assumées) et des
sections « Limites assumées » des autres rapports :

1. **Analyse de source, pas exécution** : la matrice de la règle 3 raisonne sur le
   texte des fichiers (comptage d'accolades, pas un vrai parseur). Un en-tête de
   fonction exotique rendrait la détection aveugle — le test rougirait (refus),
   il ne passerait pas silencieusement.
2. **Aucune preuve d'exécution réelle** : les mutations prouvent que les tests
   rougissent quand on retire le correctif, **pas** le comportement d'un vrai
   agent pi en production. La preuve « terrain » reste à faire côté application.
3. **Arrêts volontaires** : `abort_super_agent` (bouton Stop) et
   `stop_agent_session` demandé par l'Assistant ne sont pas journalisés. Le
   marqueur `R3-EXCEPTION-MANUEL` les rend explicites ; le retirer fait rougir le
   test.
4. **Arrêts de tour** : les arrêts de tour ne produisent pas de ligne de journal
   (ce ne sont pas des fins de session), mais la cardinalité épinglée empêche
   d'en ajouter un nouveau sans y penser.
5. **Portée de la sérialisation** : `traceWriteChain` est un état de module. Deux
   **processus** distincts écrivant le même journal resteraient en concurrence —
   cas non atteignable aujourd'hui (écriture côté WebView uniquement).
6. **Règle 2, périmètre** : les outils de suivi de l'Assistant (`db_query`, …)
   gardent leur protection d'origine (une requête identique répétée *est* une
   boucle) ; la règle vise les consultations **du projet**. Les autres filets
   (inactivité, plafond de tours, moniteur Rust) restent en place.
7. **Règle 4, périmètre** : Pilot ne relance **jamais seul** une mission
   orpheline — il l'abandonne **en le disant**. La détection Rust des tâches
   bloquées (`anomaly.rs`) n'est pas concernée.
8. **Règle 5, périmètre** : la levée reste bornée par les fenêtres de grâce et
   par la fenêtre « busy-stale » (25 min). Un agent vivant mais bloqué n'est
   libéré qu'après cette fenêtre — choix assumé (mieux vaut attendre que tuer un
   travail en cours).

## Écarts constatés (honnêteté de la vérification)

- **Un fichier de test annoncé sous un mauvais nom** : le relevé parlait des
  « tests de `agent-stop-trace.js` et `agent-stop-funnel.js` ». Il n'existe **pas**
  de `agent-stop-trace.test.js`. La couverture réelle est
  `agent-stop-trace-paths.test.js` (matrice des chemins),
  `agent-stop-trace-concurrency.test.js` (écritures concurrentes) et
  `agent-stop-funnel.test.js` (entonnoir). La règle **est** verrouillée, mais par
  ces trois-là.
- **Un test plus probant, absent du relevé** : pour la règle 1, la seule preuve
  d'**exécution** est `agent-inconnu-refus.test.js` (le bus démarre réellement
  l'agent demandé). Les deux fichiers cités d'origine (`agent-demande-exact`,
  `super-agent-refus-avant-lancement`) restent valides, mais l'un lit surtout le
  source et l'autre exécute un garde extrait.
- **Deux preuves Rust absentes du relevé** : `should_report_anomaly_suspends_while_tool_in_progress`
  (`anomaly.rs`, règle 2) et `project_has_alive_session` /
  `project_busy_with_liveness` (`agent_service.rs`, `rpc.rs`, règle 5) ne sont pas
  dans la liste d'origine et sont pourtant nécessaires : sans elles, les règles 2
  et 5 ne sont tenues que côté JavaScript.
- **Aucune règle sans test** : après vérification, les cinq règles ont au moins un
  test qui rougit quand le correctif est neutralisé (mutations documentées dans
  les rapports). Le point faible n'est donc pas la couverture, c'est la **preuve
  terrain** (limite 2 ci-dessus).
- **Règle 1, ce qui n'est pas prouvé** : les tests prouvent qu'un identifiant
  inconnu ne démarre rien et qu'un agent auxiliaire ne prend pas la place ; ils ne
  prouvent pas, par une exécution de bout en bout, que la session démarrée pour un
  identifiant *connu* est bien celle de cet identifiant et pas une session
  homonyme d'un autre projet.

## Rapports d'origine (à citer, pas à recopier)

| Règle(s) | Rapport |
|---|---|
| 1, 2, 4 | `RAPPORT-verrous-regles-1-4-2.md` |
| 2, 3, 4 | `RAPPORT-verrous-2-3-4-reels.md`, `RAPPORT-trous-residuels-2-3-4.md` |
| 3 | `RAPPORT-trace-arrets-tous-chemins.md`, `RAPPORT-entonnoir-arrets.md` |
| 4 | `RAPPORT-regle-4-file-identite.md` |
| 5 | `RAPPORT-380-verrou.md` |
| Transverse | `RAPPORT-boucle-lectures-jamais-arret.md`, `RAPPORT-boucle-faux-positif.md`, `RAPPORT-anomalie-outil-long.md` |

## Vérifier soi-même

```bash
# Les cinq règles, côté frontend
npx vitest run src/js/agent-demande-exact.test.js src/js/agent-inconnu-refus.test.js \
  src/js/super-agent-refus-avant-lancement.test.js \
  src/js/regle-2-lectures-jamais-arret.test.js \
  src/js/agent-stop-trace-paths.test.js src/js/agent-stop-trace-concurrency.test.js \
  src/js/agent-stop-funnel.test.js \
  src/js/regle-4-file-jamais-perdue.test.js src/js/file-attente-*.test.js \
  src/js/verrou-orphelin.test.js src/js/verrou-par-projet.test.js

# Règles 2 et 5, côté Rust
cargo test --manifest-path src-tauri/Cargo.toml --lib should_report_anomaly
cargo test --manifest-path src-tauri/Cargo.toml --lib project_has_alive_session
cargo test --manifest-path src-tauri/Cargo.toml --lib project_busy_with_liveness
```
