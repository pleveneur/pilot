# Rapport — verrou du relais des questions d'agent depuis l'onglet chat

**Date** : 2026-11-13
**Livrable** : `src/js/agent-question-relais-onglet-chat.test.js` (nouveau)
**Code métier modifié** : aucun (voir § 4 — mutation temporaire annulée, `git diff` vide)

---

## 1. Le trou de couverture

Une question d'agent (`extension_ui_request` émis par l'extension `pilot-choices.ts`)
remonte par **trois** voies :

| Voie | Verrou existant |
|---|---|
| agents d'arrière-plan (bus d'agents) | `src/js/agents-bus-questions-relais.test.js` |
| surface de secours quand l'onglet 🧭 est fermé | `src/js/agent-question-surface.test.js` |
| **agent de l'ONGLET CHAT** (`agent-pi.js`) | **AUCUN** ← le trou |

Dans `src/js/agent-pi.js`, branche `case "extension_ui_request"` : si l'onglet 🧭
Assistant est **ouvert** (`window._pilotSuperAgentOpen`), qu'**aucune
orchestration** ne tourne, que l'onglet est **actif** (`isSuperAgentActiveTab()`)
et que la demande est **relayable** (`isRelayableAgentChoice`), l'évènement
`AGENT_RELAY_EVENT` est émis avec `{ payload, agentId, projectPath }` puis un
`break` empêche la peinture inline ; sinon `handleExtensionUiRequest(payload,
messagesEl, state)` peint les boutons dans l'onglet de l'agent.

Supprimer le `break`, inverser/neutraliser le test d'onglet actif, ou recopier
une liste de types dans la branche ne faisait tomber **aucun** test : la question
pouvait devenir invisible, ou être **peinte deux fois** (relais + peinture
inline) avec deux réponses concurrentes possibles.

## 2. Ce que le test tient (13 cas)

Lecture de source (environnement `node`, sans jsdom — même méthode que les autres
verrous de branchement du dépôt), **toute lecture normalisée en LF**
(`.replace(/\r\n/g, "\n")`, quality-gate § 3.4) et **tout découpage protégé** par
`source-slice.js` (`sliceSource` / `sliceFrom`) : une ancre qui disparaît lève au
lieu de rendre un fragment vide (inventaire de `source-slice.test.js` satisfait,
0 découpage non protégé dans le nouveau fichier).

1. **Source unique de la décision** — `isRelayableAgentChoice` n'est *définie*
   qu'à un seul endroit du dépôt (`agent-choice-relay.js`, balayage de
   `src/js/*.js` hors tests) ; la branche l'appelle exactement une fois.
2. **Aucune liste recopiée** — la branche ne teste aucun des trois types
   (`method === "select"|"confirm"|"input"`, ni `["select", …].includes`) et ne
   filtre aucune porte interne elle-même (`isInternalAgentGate`,
   `EDIT_GATE_SENTINEL`, `ASSISTANT_ACTION_SENTINEL`, `SCREEN_GATE_SENTINEL`
   absents).
3. **Les quatre conditions ensemble** — toutes présentes dans le *même* bloc
   conditionnel, avec **trois `&&` et aucun `||`** (un `||` suffirait à relayer
   sans l'onglet actif).
4. **Le sens de « onglet actif »** — le helper contient bien
   `window._pilotTabs?.getActiveTab?.()?.mode === "superagent"` et retombe sur
   `return false` (un helper vidé rendrait la condition toujours vraie).
5. **Les trois informations du retour** — `detail: { payload, agentId:
   state.agentId || "default", projectPath: window._pilotProjectPath || null }`,
   avec l'évènement **partagé** (`AGENT_RELAY_EVENT`) et **aucun nom d'évènement
   en dur** dans la branche.
6. **Le `break` anti-double-surface** — présent **une seule fois**, **après**
   l'émission, et il **referme** le bloc ; la peinture inline est **hors** de ce
   bloc et n'y apparaît jamais ; elle est appelée **exactement une fois** dans la
   branche.
7. **Repli intact** — `handleExtensionUiRequest(payload, messagesEl, state)` est
   bien présent, après le bloc du relais, et la branche se termine par un
   `break;` (aucune chute dans le `case` suivant). Les `notify` (mise à jour du
   sélecteur de modèle) restent traités **avant** la décision de relais.

Aucun doublon avec les deux verrous voisins : ni le bus, ni la surface de
secours, ni la décision pure du module de relais ne sont re-testés ici.

## 3. Preuve par mutation (rouge puis vert)

Sauvegarde byte-exacte du source avant mutation (`md5sum` identique avant/après :
`25ca14aa9f9b454e9c1f09bbef59e0fe`), restauration après chaque essai.

| Mutation temporaire de `agent-pi.js` | Résultat du test |
|---|---|
| **(1)** retirer le `break;` du bloc de relais | **ROUGE** — `PASS (8) FAIL (5)`, exit 1 : `SourceSliceError: ancre de fin absente : break;` (×2), `AssertionError: ancre absente : break;` (×2), `SourceSliceError: ancre de début absente : break;` |
| **(2)** remplacer `&& isSuperAgentActiveTab()` par `&& true` | **ROUGE** — `PASS (12) FAIL (1)`, exit 1 : `AssertionError: expected '      if (\n        window._pilotSupe…' to contain 'isSuperAgentActiveTab()'` |
| **(3)** remplacer `&& isRelayableAgentChoice(payload)` par `&& ["select", "confirm", "input"].includes(payload.method)` | **ROUGE** — `PASS (11) FAIL (2)`, exit 1 : `expected +0 to be 1` (appel à la source unique) + `expected '…' to contain 'isRelayableAgentChoice(payload)'` |
| **(0)** source d'origine, aucun changement | **VERT** — `PASS (13) FAIL (0)`, exit 0 |

Contrôle final après restauration :

```
$ md5sum src/js/agent-pi.js /tmp/agent-pi.backup.js
25ca14aa9f9b454e9c1f09bbef59e0fe *src/js/agent-pi.js
25ca14aa9f9b454e9c1f09bbef59e0fe */tmp/agent-pi.backup.js
$ git status --short src/js/agent-pi.js    # → rien
$ git diff --stat -- src/js/agent-pi.js    # → rien (vide)
```

## 4. Vérifications exécutées

```
npx vitest run src/js/agent-question-relais-onglet-chat.test.js \
               src/js/agents-bus-questions-relais.test.js \
               src/js/agent-question-surface.test.js \
               src/js/sentinelle-jamais-affichee-brute.test.js
→ PASS (65) FAIL (0)

npx vitest run src/js/source-slice.test.js
→ PASS (19) FAIL (0)   (inventaire : 0 découpage non protégé ajouté)
```

`git status --short` : seul `src/js/agent-question-relais-onglet-chat.test.js`
est ajouté par cette mission (les autres entrées modifiées du worktree — `AGENTS.md`,
`spec_*.md`, `help/handbook.md`, `src/js/agent-activity.js`, `src/js/super-agent.js`
et ses tests — appartiennent à la mission « occupé fantôme » en cours, qui n'a
**pas** été touchée).

## 5. Ce qui reste HORS de portée d'un test de source (dit sans le maquiller)

- **Le comportement à l'exécution n'est pas exercé.** Ce verrou prouve la forme du
  branchement, pas que l'évènement atteint réellement la conversation de
  l'assistant, ni que `super-agent.js` route la réponse vers la bonne session
  (`respondAgentRelay` → `send_agent_command_to`). `handleRpcEvent` n'est pas
  exporté et l'environnement de test est `node` (sans jsdom) : instancier
  `createAgentPi` pour un bout-en-bout serait un autre chantier.
- **Un second mécanisme de décision sous un autre NOM** resterait invisible : le
  test vérifie qu'`isRelayableAgentChoice` n'est définie qu'une fois, pas qu'aucun
  autre module n'introduit une décision parallèle différemment nommée.
- **L'ordre d'arrivée des globals** (`window._pilotSuperAgentOpen`,
  `window._pilotProjectPath`, posés par `super-agent.js`) n'est pas couvert : le
  test lit la référence, pas la valeur au moment du tour.
- **Les cas de non-relais fonctionnels** (une porte interne reste dans l'onglet de
  l'agent, une orchestration en cours n'est jamais relayée) sont tenus côté
  décision pure (`agent-choice-relay.js`) et côté bus ; ils ne sont pas
  re-démontrés ici à l'exécution.
