# Rapport — verrous des règles 1, 4 et 2 (audit indépendant)

**Mission** : fermer les 3 derniers points FRAGILES de l'audit « verrous règles
1-4-2 » par des **tests** — aucun fichier de production modifié.
**Périmètre** : `G:\IA_PL\pilot` — branche `main`, commit **local uniquement**
(aucun push, aucun tag).

---

## 0. Résultat en une ligne

Les 3 règles sont désormais **verrouillées par des tests qui échouent si la
règle est violée**, preuve d'échec obtenue en cassant temporairement la
production puis en la restaurant (`git checkout`, `git status` propre).
Suite complète **verte** : **113 fichiers / 1941 tests / 0 échec**
(avant : 111 fichiers / 1923 tests — soit **+2 fichiers, +18 tests**).

Aucune ligne de production n'a été modifiée (fichiers touchés : 1 test existant
complété + 2 nouveaux fichiers de test).

| Règle | Fichier de test | Tests ajoutés | Échec prouvé en cassant |
|---|---|---|---|
| 1 — refus d'agent inconnu | `src/js/super-agent-refus-avant-lancement.test.js` (nouveau) | 8 | retrait du `return;` → **2 échecs** |
| 4 — identité de la demande rejouée | `src/js/file-attente-identite-demande.test.js` (nouveau) | 6 | `shift`→`pop` → **1** ; libellé vidé → **4** ; texte vide côté `agent-pi` → **1** |
| 2 — lectures exclues du comptage de boucle | `src/js/agents-bus.test.js` (bloc ajouté) | 4 | retrait du `return;` de la branche « lecture » → **2 échecs** |

---

## 1. RÈGLE 1 — le refus d'un agent inconnu arrête la mission AVANT tout lancement

### Ce qui était fragile

La production émet bien un refus explicite quand un agent demandé n'existe pas
(`unknownAgentsError(...)`, deux points d'entrée : `RUN_AGENTS_SENTINEL` et
`RUN_ASSISTANT_AGENTS_SENTINEL`), mais **le `return;` qui suit n'était couvert
par aucun test** : le contrat n'était verrouillé que sur le **texte** de
l'erreur (`agent-demande-exact.test.js`). Si ce `return;` disparaissait, le refus
s'affichait **et** la mission partait quand même — sur des agents que
l'utilisateur n'avait pas demandés.

### Ce que le test fait (sans recopier la production)

`src/js/super-agent-refus-avant-lancement.test.js` **extrait le garde tel qu'il
est écrit dans `super-agent.js`** (délimitation par comptage d'accolades), puis
l'**exécute** :

```
garde extrait  +  launch("lancement de la mission")   ← sentinelle ajoutée par le test
```

`id`, `missing`, `registry`, `respondSuperAgent`, `unknownAgentsError` sont
passés en paramètres ; `unknownAgentsError` est **la fonction réelle** importée
du module. Le sentinelle matérialise « la suite de la branche » (le lancement).

### Assertions (les 8 tests)

1. **Les deux** points d'entrée portent le garde (2 blocs trouvés).
2. Pour chaque garde : l'erreur est émise **une fois**, nomme l'agent inconnu
   (`isError === false`), **et le lancement sentinelle n'est jamais atteint**.
3. Pour chaque garde : le `return;` est bien la **dernière instruction** du garde.
4. **Témoin anti-test-vide** : avec `missing = []`, le garde est **inerte** et le
   lancement sentinelle a bien lieu — preuve que le harnais atteint réellement le
   sentinelle (un garde vide ne peut donc pas faire passer les tests ci-dessus).
5. **Position dans la branche** : chaque garde est situé **avant** le code de
   lancement de sa branche (`const launchMission = () => launchOrQueue();` pour
   `run_agents`, `const startRun = async () => {` pour `run_assistant_agents`) —
   un garde déplacé après le lancement laisserait partir la mission.
6. Le message de refus reste **actionnable** (liste les agents disponibles).

### Preuve d'échec (mutation temporaire)

Mutation : suppression du `return;` du **premier** garde dans `src/js/super-agent.js`.

```
PASS (6) FAIL (2)
1. garde 1 : l'erreur est émise puis la branche RETOURNE (aucun lancement)
   AssertionError: le refus doit interrompre la branche AVANT tout lancement:
   expected [ 'lancement de la mission' ] to deeply equal []
2. garde 1 : le retour est bien la DERNIÈRE instruction du garde
   AssertionError: expected 'if (missing.length > 0) { await respo…'
   to match /respondSuperAgent\([^;]*; return; \}$/
```

Restauration : `git checkout -- src/js/super-agent.js` → `PASS (8) FAIL (0)`,
`git status` propre (aucune modification de production).

---

## 2. RÈGLE 4 — identité de la demande rejouée depuis la file d'attente

### Ce qui était fragile

Deux demandes mises en file (A puis B) : quand une demande redémarre, c'est
**son** texte qui doit partir — jamais celui de la précédente. Deux mécanismes
portent cette identité, aucun n'était verrouillé de bout en bout :

| Mécanisme | Production | Risque si on le casse |
|---|---|---|
| Missions de l'assistant | `runAgentsQueueByProject[target].push({ launch: … })` + `.at(-1).label = task` (3 sites) | mission sans libellé, ou libellé d'une autre demande |
| Rejeu | `replayQueuedMissionForProject` : `queue.shift()` | la **dernière** demande repart à la place de la tête → A rejouée / B perdue |
| Commandes manuelles | `agent-pi.js` : `queueRefusedCommand = (text) => … inputEl.value = text;` | la zone de saisie reçoit le texte d'une autre demande |

### Ce que le test fait

`src/js/file-attente-identite-demande.test.js` :

- **4a-1 (source + exécution)** : les **3 snippets de mise en file** sont
  **extraits de la production** et **exécutés** sur une file réelle. Chaque
  snippet doit poser `at(-1).label = task` et un lanceur
  (`{ launch: launchMission }` ou `{ launch: () => startRun() }`).
  Exécution : **A puis B** → libellés `[A, B]` ; rejeu de la tête → A part
  (pas B), il reste **B avec le libellé de B** ; rejeu suivant → B part
  (jamais A une deuxième fois).
- **4a-2 (rejeu RÉEL)** : `replayQueuedMissionForProject` (fonction de
  production) sur une file A,B construite par le snippet de production :
  passe 1 → `{replayed:true, reason:"launched"}` et `launched === [A]`,
  `getProjectMissionQueue` renvoie `[label de B]` ; passe 2 → `launched === [A,B]`
  puis file vide.
- **4a-3 (admission occupée)** : `{replayed:false, reason:"busy"}` → **rien**
  n'est lancé et la file reste `[A, B]` intacte (l'ordre n'est pas consommé).
- **4b (`agent-pi.js`)** : dans la fenêtre exacte de `queueRefusedCommand`, le
  lanceur de file contient **exactement** `inputEl.value = text;` — donc le
  **paramètre** de la commande refusée (chaque appel crée sa fermeture), et
  l'entrée de file porte `label: text`.

### Preuves d'échec (3 mutations temporaires)

**Mutation A — `queue.shift()` → `queue.pop()`** (rejeu de la demande
*précédente* au lieu de la tête) :

```
PASS (5) FAIL (1)
1. rejeu RÉEL : la tête de file part, B garde son libellé
   AssertionError: expected [ Array(1) ] to deeply equal [ 'Demande A : corriger le parser' ]
```

**Mutation B — libellé du 1er site vidé** (`at(-1).label = ""`) :

```
PASS (2) FAIL (4)
1. les 3 sites de mise en file posent le libellé de LEUR demande
   AssertionError: un site de mise en file ne pose plus le libellé de sa demande:
   expected [ …(2) ] to have a length of 3 but got 2
   (+ les 3 tests d'exécution/rejeu échouent : libellés [A,""] au lieu de [A,B])
```

**Mutation C — `agent-pi.js` : `inputEl.value = "";`** dans le lanceur de file :

```
PASS (5) FAIL (1)
1. le texte envoyé au démarrage est le PARAMÈTRE `text` de la commande refusée
   AssertionError: le lanceur doit réinjecter le texte de SA demande:
   expected [ 'inputEl.value = "";' ] to deeply equal [ 'inputEl.value = text;' ]
```

Restauration après chaque mutation (`git checkout -- <fichier>`), `git status`
propre, tests re-verts.

---

## 3. RÈGLE 2 — les outils de LECTURE sont exclus du comptage de boucle

### Ce qui était fragile

`agents-bus.js` exclut les outils de **lecture pure**
(`AGENT_READ_ONLY_TOOLS` : `read`, `search`, `grep`, `list`, `ls`, `find`,
`glob`, `read_project_file`, `search_project`) du comptage principal
(`toolCallsByAgent`, seuil `detectRepeatedActions` = **5** sur fenêtre 20) et les
suit dans `readOnlyToolCallsByAgent` avec un seuil plus élevé (**8** sur 20).
Aucun test n'exerçait ce chemin : retirer l'exclusion rendait l'exploration
légitime (relire un fichier, refaire une recherche) **punissable d'un arrêt
d'agent** — c'est exactement le faux positif P0-2.

### Ce que le test fait (4 tests, dans `src/js/agents-bus.test.js`)

Le bloc pousse de vrais événements `tool_execution_start` dans
`handleAgentEvent` (aucun test du fichier ne le faisait), avec une **horloge
virtuelle** (`Date.now` avançant de 600 ms par appel) pour franchir le throttle
de détection (`AGENT_LOOP_CHECK_INTERVAL_MS = 500 ms`) sans ralentir la suite.

1. **6 lectures identiques** → `readOnlyToolCallsByAgent` = 6,
   `toolCallsByAgent` = **vide** (exclusion du comptage principal),
   **aucun** `abort_agent_process` / `stop_agent_process`,
   `loopCorrectionPending` faux, run toujours `running`.
2. **7 + 7 lectures identiques (deux fichiers)** → **aucun arrêt** : sous le
   seuil 8 des lectures, mais **au-dessus** du seuil 5 par défaut — preuve que
   le seuil dédié est appliqué **et** que les lectures ne comptent pas dans
   l'historique principal.
3. **9 lectures strictement identiques** → la boucle **soutenue** est détectée :
   `abort_agent_process` émis avec le bon `agentId`, `loopCorrectionPending`
   vrai — la protection **ne neutralise pas** le détecteur.
4. **5 `bash` identiques** (outil qui modifie) → toujours comptées dans
   l'historique principal et **détectées** : l'exclusion est bien limitée aux
   lectures.

### Preuve d'échec (mutation temporaire)

Mutation : suppression du `return;` de la branche `if (AGENT_READ_ONLY_TOOLS.has(toolName))`
(les lectures retombent dans l'historique principal).

```
PASS (2) FAIL (2)
1. 6 lectures identiques : aucun arrêt, et les lectures restent HORS de l'historique principal
   AssertionError: expected [ …(6) ] to deeply equal []
2. seuil PLUS ÉLEVÉ pour les lectures : 7 + 7 lectures identiques (deux fichiers) ne coupent rien
   AssertionError: expected [ [ 'abort_agent_process', …(1) ] ] to deeply equal []
```

Restauration : `git checkout -- src/js/agents-bus.js` → `PASS (4) FAIL (0)`.

---

## 4. Anti-régression — suite complète

```
npm test
 Test Files  113 passed (113)
      Tests  1941 passed (1941)
   Duration  ~6 s
```

Avant la mission : **111 fichiers / 1923 tests, 0 échec**.
Delta : **+2 fichiers** (`super-agent-refus-avant-lancement.test.js`,
`file-attente-identite-demande.test.js`) et **+18 tests**
(8 + 6 + 4), **aucun test existant modifié ou supprimé**.

Vérifications de propreté :

- `git status --porcelain` : uniquement les 3 fichiers de test (1 modifié,
  2 nouveaux) — **aucun fichier de production modifié**, aucun artefact
  temporaire (`.vitest-base.json` supprimé).
- Fins de ligne : toutes les lectures de source des nouveaux tests passent par
  `.replace(/\r\n/g, "\n")` (piège CI Windows, AGENTS.md § Fins de ligne).
- Aucune nouvelle dépendance, aucun changement de configuration.

---

## 5. Portée / limites (transparence)

- **Règle 1** : le garde est exécuté **hors de sa fonction d'origine**, avec les
  identifiants libres passés en paramètres. Il n'est donc pas prouvé
  « bout en bout » que `run_agents` ne *lance* rien ; ce qui est prouvé est
  exactement l'invariant demandé : *la branche retourne avant tout appel de
  lancement*, vérifié sur **le texte réel de la production** (extraction +
  exécution + position dans la branche). Un refactor qui changerait le nom de la
  variable `missing` casserait le test — c'est voulu (il faut alors relire le
  garde).
- **Règle 4** : l'identité de la demande est prouvée par (a) l'exécution des
  snippets de mise en file **extraits de la production**, (b) l'exécution du
  **vrai** `replayQueuedMissionForProject`, (c) une vérification de source pour
  `agent-pi.js` (la fermeture `queueRefusedCommand` n'est pas exportée : elle ne
  peut pas être exécutée isolément).
- **Règle 2** : les tests passent par `handleAgentEvent` (chemin réel du bus) ;
  l'horloge `Date.now` est espionnée pour franchir le throttle, ce qui ne change
  aucun comportement testé.

---

## 6. Commit

Un seul commit local, message :

```
test(regles): verrouiller règles 1-4-2 (refus avant lancement, identité file, lectures hors boucle)
```

Aucun push, aucun tag.
