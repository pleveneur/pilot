# Rapport — fermeture des trous résiduels des règles 2, 3 et 4 (finalisation)

Date : session de finalisation (JS uniquement, aucun push ni tag).
Périmètre : `src/js/*` (aucune modification Rust), docs (`spec_super_agent.md`,
`help/handbook.md` régénéré).

---

## 1. Faits du ré-audit (ce qui était déjà sur le disque)

Le travail de la mission « trous résiduels 2-3-4 » était présent sur le disque
mais non finalisé : 11 fichiers modifiés + `src/js/agent-stop-trace-concurrency.test.js`
non suivi, aucun rapport, aucun commit. Ré-audit du diff complet, poste par poste :

| Correctif annoncé | Vérification | État |
|---|---|---|
| Classifieur `git -C` / `-c` / `--git-dir` (`loop-detection.js`) | `GIT_OPTIONS_WITH_VALUE` + `GIT_ATTACHED_OPTION` + `gitSubcommandIndex()` ; la sous-commande est lue APRÈS les options globales et leur valeur. `git -C /repo status` → lecture ; `git -C /repo commit` → mutateur. | conforme |
| Garde de lecture de l'agent invisible (`super-agent.js`) | le garde est au **point de poussée** (`handleInvisibleAgentEvent`, `tool_execution_start`) : une lecture n'entre jamais dans la fenêtre d'arrêt ; la sortie anticipée « buffer < 200 » ne court-circuite plus la détection d'**outils** (mutisme d'origine corrigé) | conforme (test renforcé, cf. §3) |
| 6 sites de mort de session tracés (`agents-bus.js`) | `correction-send-error`, `loop-process-exit`, `process-exit`, `message-error`, `model-missing` (`spawn-failed`), `run-agent-turn-error` (`run-exception`) : trace **avant** `failAgentTurn` (9 sites `failAgentTurn` au total, tous couverts) | conforme |
| 3 `stop_agent_session` de `agent-pi.js` en `session-restart` | `quality-gate-toggle`, `reconnect`, `settings-restart` : plus aucune session détruite en silence | conforme |
| Écritures sérialisées du journal (`traceWriteChain`, `agent-stop-trace.js`) | le journal est lu puis réécrit → les traces sont **chaînées** ; un échec ne casse pas la chaîne (les traces suivantes passent) | conforme |
| Abandon des files nommé + journalisé (`super-agent.js`, `project-queue-view.js`) | `/file vide` : une ligne `queue-abandoned` **par famille** (commandes, missions, délégations) avec libellés ; famille « agents » garde son chemin historique ; `stop_agent` : délégations (`abandonQueuedDelegations`) et missions (`abandonQueuedRunAgentsMissions`) nommées + journalisées + annoncées | conforme |
| Matrice de trace à **portée de bloc lexical** (`agent-stop-trace-paths.test.js`) | `bracePairs` + `isFunctionHeader` + `enclosingFunctionBlock` : la trace doit être DANS la fonction englobante du site, avant lui ; exceptions MANUELLES nommées (`R3-EXCEPTION-MANUEL`) | conforme, mais **trou réel trouvé** (cf. §2) |

### 2. Incohérence trouvée et corrigée (une seule)

**Le test de la garde de lecture de l'agent invisible ne pinçait pas le bon site.**
`regle-2-lectures-jamais-arret.test.js` extrayait le garde par
`src.indexOf(GUARD_SUPER_AGENT)` : `super-agent.js` contient ce garde **deux
fois** (chemin visible de l'Assistant, puis chemin de l'agent invisible). La
recherche tombait donc toujours sur le **premier** (chemin visible) et le test
restait **vert même si le garde disparaissait du chemin invisible** — vérifié
par mutation (voir table des preuves, ligne 2, état initial « GREEN anormal »).

Correction apportée (test uniquement, aucun code de production modifié) :

1. le garde est désormais extrait **du gestionnaire d'événements de l'agent
   invisible** (`extractFunction(SUPER_AGENT, "function handleInvisibleAgentEvent(")`)
   puis `extractStatement(INVISIBLE_HANDLER, GUARD_SUPER_AGENT)` ;
2. nouveau test de **position** : le garde apparaît **exactement une fois** dans
   ce gestionnaire et la ligne de poussée
   (`loop.toolCalls.push(buildToolLoopFingerprint(toolName, payload.args))`) est
   bien présente ;
3. le harnais (`runInvisibleLoop`) lie désormais le `loop` de production à la
   fenêtre observée (`const loop = { toolCalls: superLoopToolCalls };`) : le
   garde extrait du chemin invisible pousse dans `loop.toolCalls` (et non dans
   `superLoopToolCalls`, nom employé par le chemin visible) — sans cette liaison,
   l'extraction correcte levait `ReferenceError: loop is not defined`.

Aucun autre point du diff n'était incohérent ou cassé : rien n'a été réécrit.

---

## 3. Ce qui est fermé

- **Règle 2** : une consultation (`git -C … status`, `git -c … log`,
  `git --git-dir … status`, `read`, `ls`, `rg`, `sed -n`…) ne peut plus fonder un
  arrêt automatique, y compris via les **options globales de git** et sur le
  chemin de l'**agent invisible** de l'Assistant. L'anti-boucle d'**outils** de
  l'agent invisible n'est plus muette faute de texte streamé.
- **Règle 3** : aucune destruction de session sans ligne de journal — les
  **5 fins de session par erreur du bus**, les **3 `stop_agent_session`** de
  l'onglet agent (`session-restart`) et les arrêts déjà couverts. Le journal est
  écrit de façon **sérialisée** : deux traces concurrentes ne s'écrasent plus.
- **Règle 4** : aucun vidage muet de file — `/file vide` journalise **une ligne
  par famille** avec les libellés, `stop_agent` nomme les **délégations** et les
  **missions** abandonnées ; la clé `__assistant__` part au journal **global**
  (jamais dans un projet).
- **Contrôle lui-même** : la matrice de trace raisonne désormais en **portée
  lexicale** (fonction englobante), plus en distance dans le fichier.

---

## 4. Table des preuves de contrôle (mutation → rouge → restauration)

Chaque correctif a été **retiré temporairement**, le test correspondant relancé,
puis le fichier restauré (`sha1sum -c` : identique à l'octet avant manipulation).

| # | Correctif neutralisé | Mutation appliquée | Test relancé | Résultat obtenu | Restauration |
|---|---|---|---|---|---|
| 1 | Classifieur `git -C` | `gitSubcommandIndex(rest)` → `rest.findIndex((t) => !t.startsWith("-"))` (`loop-detection.js`) | `loop-detection.test.js` | **ROUGE** — 1 failed / 64 passed (« devrait être consultative : `git -C /repo status --short` ») | `sha1sum -c` OK |
| 2a | Garde de lecture **agent invisible** — état du test AVANT correction | `if (!isReadOnlyAgentToolCall(toolName, payload.args))` → `if (true)` dans `handleInvisibleAgentEvent` (`super-agent.js`) | `regle-2-lectures-jamais-arret.test.js` | **VERT (19 passed)** ⇒ **trou de contrôle confirmé** : le test ne pinçait pas le site invisible | `sha1sum -c` OK |
| 2b | idem, test **après** correction (§2) | même mutation | `regle-2-lectures-jamais-arret.test.js` | **ROUGE** — 5 failed / 15 passed (garde introuvable dans le gestionnaire invisible) | `sha1sum -c` OK |
| 3 | Trace `session-restart` (bascule quality-gate) | `traceAutomaticAgentStop({…})` → `void ({…})` (`agent-pi.js`, site `quality-gate-toggle`) | `agent-stop-trace-paths.test.js` | **ROUGE** — 2 failed / 17 passed (site muet + cardinalité `pi`) | `sha1sum -c` OK |
| 4 | Trace d'une fin de session du bus | `traceAutomaticAgentStop({…})` → `void ({…})` (`agents-bus.js`, site `correction-send-error`) | `agent-stop-trace-paths.test.js` | **ROUGE** — 1 failed / 18 passed (fin de session muette) | `sha1sum -c` OK |
| 5 | Sérialisation du journal | `traceWriteChain.then(() => writeAgentStopTrace(entry))` → `writeAgentStopTrace(entry)` (`agent-stop-trace.js`) | `agent-stop-trace-concurrency.test.js` | **ROUGE** — 4 failed / 4 (lignes écrasées, lectures entrelacées, chaîne cassée, rotation) | `sha1sum -c` OK |
| 6 | Abandon journalisé des 3 familles de `/file vide` | suppression des 3 `journalAbandonedFamily(…)` (`project-queue-view.js`) | `project-queue-wiring.test.js` | **ROUGE** — 1 failed / 15 passed (0 écriture de journal au lieu de 3) | `sha1sum -c` OK |
| 7 | Abandon nommé de la file de missions d'**assistant** | `abandonQueuedRunAgentsMissions(assistantKey, …)` → `Promise.resolve({count, labels: []})` (`super-agent.js`) | `verrou-par-projet.test.js` | **ROUGE** — 1 failed / 37 passed (retour au vidage muet) | `sha1sum -c` OK |
| 8 | Matrice à portée **lexicale** | `enclosingFunctionBlock` remplacé par l'ancienne logique « depuis le site précédent du même type » | `agent-stop-trace-paths.test.js` | **ROUGE** — 3 failed / 16 passed (un site muet injecté ailleurs passe pour tracé) | `sha1sum -c` OK |

Conclusion : **chaque** correctif est réellement couvert par un test qui rougit
quand on le retire. Le seul contrôle qui ne prouvait rien a été corrigé (§2).

---

## 5. Suite de tests (une seule exécution complète)

`npm test` (vitest) : **118 fichiers, 2016 tests — tous verts**, durée ≈ 6,0 s.
Avant la correction du §2 : 118 fichiers / 2015 tests verts (le test de position
du garde ajoute 1 test ⇒ 2016).

Fichiers de tests concernés par ce lot :
`loop-detection.test.js`, `regle-2-lectures-jamais-arret.test.js`,
`agent-stop-trace-paths.test.js`, `agent-stop-trace-concurrency.test.js`
(nouveau), `project-queue-wiring.test.js`, `verrou-par-projet.test.js`.

---

## 6. Contrats de tests mis à jour (et pourquoi)

| Test | Ancien contrat | Nouveau contrat | Motif |
|---|---|---|---|
| `agent-stop-trace-paths.test.js` | précédence = « une trace existe entre le site précédent du même type et ce site » | précédence **à portée de bloc lexical** (fonction englobante délimitée par comptage d'accolades), + `maxDistance` optionnel pour les grands blocs | l'ancien contrat acceptait une trace **lointaine** : un site muet injecté dans une fonction sans trace passait pour tracé (trou prouvé par mutation #8) |
| `agent-stop-trace-paths.test.js` | cardinalités `pi=2`, `sa=4`, `bus≥18` | `pi=5`, `sa=5`, `bus≥23`, + 9 `failAgentTurn` tous tracés (≤ 800 car.), + `stop_agent_session` : 3 sites (pi) et 2 sites (sa, dont 1 exception nommée) | nouvelles traces de règle 3 (destructions de session) et de règle 4 (abandon de file) |
| `agent-stop-trace-paths.test.js` | contrôle négatif : 1 site muet injecté à UNE position | contrôle négatif : 4 positions (dont une où une trace existe ailleurs dans le fichier) ; les 3 vrais sites doivent rester tracés | prouver que la nouvelle détection ne dépend pas de la position |
| `regle-2-lectures-jamais-arret.test.js` | garde cherché « quelque part dans le fichier » | garde cherché **dans `handleInvisibleAgentEvent`**, exactement 1 occurrence, + liaison `loop` ↔ fenêtre observée ; + nouveau test « garde au point de poussée » | le contrat « garde présent » était vert sans garde au bon endroit (mutation #2a) ; aucun test n'a été affaibli |
| `verrou-par-projet.test.js` | `delete runAgentsQueueByProject[assistantKey];` (vidage muet) | `abandonQueuedRunAgentsMissions(assistantKey` / `(queueKey` (chemin de production unique : nommage + journal + notification) | contrat de **règle 4** : le vidage muet est précisément ce qui est interdit |
| `agent-stop-trace-concurrency.test.js` (nouveau) | — | 5 traces en parallèle ⇒ 5 lignes ; lectures non chevauchantes ; échec d'écriture sans casser la chaîne ; rotation à ~256 Ko sans perte | sans sérialisation, des lignes d'arrêt disparaissaient du disque (violation de la règle 3) |

Aucun test existant n'a été supprimé ni affaibli : les changements sont des
**renforcements** ou des contrats devenus faux par construction (vidage muet).

---

## 7. Documentation

- `spec_super_agent.md` : table des `reason`/`detected` de la règle 3 complétée
  (`session-error`/`spawn-failed`/`run-exception`, `session-restart`,
  `queue-abandoned`/`file-vide`) ; ajout de l'**écriture sérialisée** du journal
  et de la **matrice à portée lexicale** (avec les exceptions nommées) ;
  règle 4 complétée (`/file vide` par famille, `stop_agent` nommé) ;
  blocs `<!-- HELP:loop-detection-writes -->` et
  `<!-- HELP:file-attente-identite-mission -->` mis à jour (langage
  utilisateur : `git -C`, agent en arrière-plan, journal sérialisé, familles
  abandonnées).
- `help/handbook.md` régénéré via `npm run build:handbook` (42 blocs).
- `AGENTS.md` : **aucune modification** — aucun module n'apparaît (seul un
  nouveau fichier de **test** est ajouté, et l'arborescence d'`AGENTS.md` ne
  liste pas les tests).

---

## 8. Limites restantes (assumées)

1. **Analyse de source, pas exécution** : la matrice de la règle 3 raisonne sur
   le texte du fichier, avec comptage d'accolades (pas un vrai parseur). Un
   en-tête de fonction exotique (objet littéral, méthode de classe) pourrait
   rendre `enclosingFunctionBlock` aveugle → le test rougirait (refus), il ne
   passerait pas silencieusement.
2. **Exceptions MANUELLES** : `abort_super_agent` (bouton Stop) et
   `stop_agent_session` demandé par l'Assistant ne sont pas journalisés (arrêts
   volontaires). Le marqueur `R3-EXCEPTION-MANUEL` les rend **explicites** ; leur
   suppression ferait rougir le test.
3. **Portée de la sérialisation** : la chaîne `traceWriteChain` est un état de
   module (une instance par contexte JS). Deux **processus** distincts écrivant le
   même `agent-stops.log` resteraient en concurrence — cas non atteignable dans
   Pilot aujourd'hui (le journal est écrit côté WebView uniquement).
4. **`/file vide` et notifications** : l'abandon notifie via
   `notifySuperAgentDone` ; si les notifications sont indisponibles, le message
   reste visible à l'écran et la trace disque est écrite (fail-open assumé).
5. **Aucune preuve d'exécution réelle** : les mutations prouvent la couverture
   des tests, pas le comportement d'un vrai agent pi en production ; la preuve
   « terrain » reste à faire côté application.
