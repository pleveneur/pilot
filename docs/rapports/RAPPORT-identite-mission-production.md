# RAPPORT — identité de mission issue de la PRODUCTION (FAIL #8 de la vérification finale)

Date : 2026-10-20 · Portée : JS uniquement (aucun Rust, aucun push/tag).

## Défaut visé (FAIL #8)

Les tests de la RÈGLE 4 (`src/js/file-attente-regle-4.test.js`,
`src/js/file-attente-identite-demande.test.js`) **fabriquaient eux-mêmes**
l'identité de mission (`makeMissionIdentity(nextMissionId(), agentIds)`) avant de
la passer à la production. Conséquence : `missionIdentity = null` écrit dans la
production (branche de lancement) **laissait les tests VERTS** — la preuve ne
portait plus sur le code livré.

## Correctif

1. **Point UNIQUE d'allocation en production** — `super-agent.js` :
   ```js
   export function allocateMissionIdentity(agentIds) {
     return makeMissionIdentity(nextMissionId(), agentIds);
   }
   ```
   Les DEUX branches de lancement l'appellent désormais
   (`const missionIdentity = allocateMissionIdentity(agentIds);`) :
   `run_agents` et `run_assistant_agents`. Plus aucune occurrence de
   `makeMissionIdentity(nextMissionId()` hors de cette fonction (invariant testé).

2. **Chemin de fin de run EXPORTÉ** — `finishRunAgentsToSuperAgent` est exportée
   (c'est le seul chemin de production d'un compte rendu de fin de run :
   `emitRunAgentsFinishNotice` → `injectRunAgentsResultToSuperAgent` →
   `annotateMissionReport`). Les tests passent par elle avec l'identité
   **réellement allouée**.

3. **Tests réécrits (aucune constante de fixture)** :
   - l'identité vient de `allocateMissionIdentity(...)` (compteur monotone de
     production) et elle est **relue sur l'entrée de file estampillée**
     (`res.entry.id` / `res.entry.agentIds`) ;
   - le **brief exécuté** est comparé à cette identité estampillée ;
   - le **rapport livré** (via `finishRunAgentsToSuperAgent`) est comparé à la
     même identité, l'étiquette étant produite par `missionTag` (production) ;
   - ancres statiques ajoutées : 2 allocations par branche, 3 appels
     `enqueueMissionForProject(target, …, missionIdentity)`, 1 seul
     `stampQueuedMission`, 1 seule `makeMissionIdentity(nextMissionId()`,
     export de `finishRunAgentsToSuperAgent` + consignation avec `identity`.

## PREUVES DE CONTRÔLE (obligatoires)

Protocole : patch temporaire de `src/js/super-agent.js` par script Node (source
sauvegardée), exécution ciblée des deux fichiers de test, restauration, contrôle
d'intégrité.

| Contrôle | Patch temporaire | Résultat |
|---|---|---|
| A — identité neutralisée | `const missionIdentity = null;` (2 sites) | **ROUGE** : `l'identité de mission n'est plus allouée par la production: expected [] to have a length of 2` (1 test en échec / 16) |
| B — estampille neutralisée à l'empilement | `const stamped = {};` (plus de `stampQueuedMission`) | **ROUGE** : 8 tests en échec (`la production doit allouer l'identité de mission: expected 'undefined' to be 'number'`, ancre `stampQueuedMission` absente) |
| C — annotation neutralisée | `summary: buildRunAgentsSummary(result),` (plus d'`annotateMissionReport`) | **ROUGE** : 2 tests en échec (`expected '… Résultat …' to contain '[mission #1 · agents : codeur]'`) |

Restauration vérifiée :

- `sha256sum src/js/super-agent.js` = `c49ef012a255ae9070fed2a32dad22cf596eb8ce537bd6248e6cf18cd3fd2462`
  (identique avant/après les trois contrôles) ;
- `git diff | sha256sum` = `23a162d4911085b59eb9c5c63bababfd5fb60eb2439f512de5249e30dafec6ed`
  (identique avant/après) — les contrôles n'ont laissé aucune trace.

## Tests complets (`npm test`, une passe)

```
Test Files  119 passed (119)
     Tests  2026 passed (2026)
  Duration  6.12s
```

Fichiers de la preuve : `src/js/file-attente-regle-4.test.js` (9 tests),
`src/js/file-attente-identite-demande.test.js` (7 tests). Aucune régression sur
les 119 fichiers.

## Effet utilisateur

Aucun changement de comportement visible (extraction interne + exportabilité) :
aucune mise à jour de documentation (`spec_*`, `help/*`) n'est nécessaire.
`geminiReport.md` n'a pas été touché.
