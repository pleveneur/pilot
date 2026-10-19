# RAPPORT 381 — supprimer le « devis » automatique : l'agent lancé doit être exactement l'agent demandé

Version inspectée : 0.4.31 (dépôt local, branche `main`). Aucune publication, aucun
tag, aucune version bumpée, aucune configuration utilisateur touchée.

---

## 1. Constat vérifié (code)

Chaque lancement d'agent par l'Assistant (`run_agents`) déclenchait une
**estimation préalable automatique** (« devis ») : avant de démarrer les agents
nommés, Pilot envoyait **le texte intégral de la mission** à un planificateur
(`plan-maker`, lecture seule) pour estimer les fichiers que le codeur allait
toucher, puis écrivait `.pilot/reservations.json`.

Conséquences observées :

1. la session `plan-maker` **démarre réellement** (ce n'est pas nommé par la
   mission : c'est un agent **non demandé**) ;
2. elle prend le **créneau de run du projet** (run de LECTURE) ;
3. l'annonce de `run_agents` répond `preparing: true` **immédiatement**, donc
   l'Assistant croit avoir lancé la mission alors que le lancement réel est
   seulement en arrière-plan ;
4. si l'estimation traîne (timeout 60 s) ou si le verrou n'est pas rendu,
   la mission **demandée** n'est jamais lancée : le seul agent ayant exécuté le
   texte de la mission est le planificateur, en lecture seule → **aucun
   fichier, aucun commit**, et le travail n'avance pas.

## 2. Cause exacte (fichier et ligne)

| Étage | Fichier | Ligne (avant correctif) |
|---|---|---|
| Déclenchement automatique du devis dans le chemin de lancement | `src/js/super-agent.js` | `const launchWithEstimate = () => {` **l. 4186** ; appel `estimateAndReserve(...)` **l. 4198** ; `return { …, preparing: true }` **l. 4216** |
| Calcul des « codeurs » qui conditionne le devis | `src/js/super-agent.js` | `const coderIds = agentIds.filter(...)` **l. 4106-4110** |
| Démarrage de l'agent NON demandé avec le texte de la mission | `src/js/reservations.js` | `estimateAndReserve` **l. 352** ; `runAgentsForAssistant([{ agentId: "plan-maker", brief: task, project }])` **l. 376** |
| Arrêt « de secours » du planificateur abandonné (timeout) | `src/js/reservations.js` | `stopAbandonedEstimation` **l. 294-330**, `ESTIMATION_TIMEOUT_MS` **l. 33** |
| Accusé de lancement qui masque le report | `src/js/super-agent.js` | `computeRunLaunchVerdict` : `preparing` **l. 86-106** |
| Enchaînement verrou → file d'attente | `src/js/super-agent.js` | `launchOrQueue` **l. 4131** (garde `isRunInProgress(target, {nature})` puis mise en file) |

Le routage **par identifiant** n'était pas en cause : `runAgentTurn`
(`src/js/agents-bus.js`) et le côté Rust (`agent_service.rs`, `rpc.rs`) lient la
session à la clé `(projet, agent_id)` sans aucun repli. Le détour venait
uniquement de cette **étape d'estimation insérée en amont** du lancement.

## 3. Correctif appliqué

1. **Suppression du devis automatique** (`src/js/super-agent.js`) : le chemin
   `run_agents` lance **directement** les agents demandés. Il ne reste plus
   aucune étape intermédiaire, aucun agent auxiliaire, aucun accusé
   `preparing` : l'outil ne rend la main qu'avec un verdict de lancement réel
   (`launched` / `queued`) ou une erreur explicite.
2. **Suppression du flux d'estimation** (`src/js/reservations.js`) :
   `estimateAndReserve` et `stopAbandonedEstimation` sont retirés, ainsi que le
   délai `ESTIMATION_TIMEOUT_MS`. **Plus aucun agent n'est lancé depuis ce
   fichier et le texte de la mission n'y passe plus jamais.**
   Le fichier `.pilot/reservations.json` et ses helpers
   (`writeReservations` / `deleteReservations` / `isProjectReserved*`, lus par
   la porte pré-écriture `pilot-reserve-gate.ts` et nettoyés par le bus)
   **restent en place** : ils ne reçoivent plus que des **chemins**, jamais une
   mission.
3. **Refus explicite avec la liste des agents disponibles**
   (`src/js/super-agent.js`, `run_agents` et `run_assistant_agents`) : un
   identifiant inconnu n'est plus signalé par un simple « Agents inconnus : … ».
   Le message donne désormais **la liste des agents disponibles** et précise
   qu'**aucun agent n'a été lancé**. Aucun repli silencieux : le message ne
   propose jamais de remplacer l'agent demandé par un autre.
4. **Agent demandé mais impossible à démarrer** : le lancement échoue
   explicitement pour cet agent (message nommant l'agent, ex. « Aucun modèle
   pour l'agent « X »… »), sans jamais confier la mission à un autre agent.

## 4. Comment vérifier

### 4.1 Tests automatiques (ajoutés / adaptés)

- `src/js/agent-demande-exact.test.js` (nouveau) :
  - le libellé de la mission n'est **jamais** transmis à un agent autre que
    ceux demandés (aucune apparition de `plan-maker`, aucune réservation
    automatique) ;
  - `run_agents` avec un identifiant inconnu → refus explicite contenant la
    liste des agents disponibles ;
  - le chemin de lancement ne contient plus d'étape d'estimation
    (`estimateAndReserve`, `preparing: true`).
- `src/js/reservations.test.js` : les cas de l'estimation automatique sont
  retirés ; les cas du fichier de réservations (helpers purs + écriture /
  suppression) sont conservés.
- `src/js/verrou-par-projet.test.js` : le cas « T6 — devis plan-maker » est
  remplacé par l'invariant inverse (le projet reste libre, l'agent demandé
  démarre immédiatement, sans run intermédiaire).

### 4.2 À la main

1. Dans l'onglet **🧭 Assistant**, demander une tâche qui nomme un agent
   précis (ex. « lance le codeur sur … »).
2. Vérifier dans le panneau d'activité : **aucun** agent planificateur ne
   démarre ; la session qui s'ouvre est **exactement** l'agent demandé.
3. Vérifier que `.pilot/reservations.json` n'apparaît **pas** (aucun devis
   automatique).
4. Demander une tâche sur un agent inexistant (ex. `agent-qui-nexiste-pas`) :
   le refus doit lister les agents disponibles et préciser qu'aucun agent n'a
   été lancé.

## 5. Vérifications exécutées

| Commande | Résultat |
|---|---|
| `npm test` (Vitest) | **106 fichiers, 1 847 tests, 0 échec** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | **637 passés, 1 ignoré, 0 échec** |
| `npm run build:handbook` | OK (41 blocs) |
| `npm run build` (Vite) | OK (seuls les avertissements préexistants) |
| `node --check` sur les fichiers JS touchés | OK |

### Non-régression vérifiée

| Point | Vérification | Résultat |
|---|---|---|
| Agent démarré = agent demandé | `verrou-par-projet.test.js` (T6) : « le codeur nommé démarre directement », `activeAgents == ["coder"]`, aucun autre `start_agent_process` | conforme |
| Aucune mission remise à un autre agent en amont | `agent-demande-exact.test.js` : `super-agent.js` ne contient plus `estimateAndReserve` ni `plan-maker` ; `reservations.js` ne peut ni démarrer ni arrêter de session | conforme |
| Nom inconnu refusé avec la liste | `unknownAgentsError` testée (liste des agents disponibles, « Aucun agent n'a été lancé »), utilisée par les **deux** points d'entrée | conforme |
| Aucune place de projet laissée occupée par un agent non demandé | T6 : `reservations.json` jamais écrit au lancement, créneau occupé par l'agent demandé seulement | conforme |
| Fichier de réservations + porte pré-écriture | `pilot-reserve-gate.ts` et ses tests inchangés (lecture de `.pilot/reservations.json`, participants exemptés, péremption 10 min) | conforme |
| Bail de vivacité des réservations | `reservations.test.js` conserve le test du battement de cœur (libération si la run détentrice a disparu) | conforme |
| Purges de `reservations.json` dans le bus | `agents-bus.js` inchangé sur ce point (arrêt, init, fin de tour) | conforme |
| Accusé de lancement honnête (#87) | `super-agent-launch-verdict.test.js` : refus → `ok:false` avec raison ; plus aucun `preparing: true` construit | conforme |

## 6. Complément : le prompt système ne prescrit plus de plan préalable

La suppression du devis dans le chemin de lancement (`super-agent.js`,
`reservations.js`) laissait **un second levier** intact, côté Rust :
`SUPER_AGENT_TOOLS_PROMPT` (`src-tauri/src/super_agent.rs`) demandait à
l'Assistant, mot pour mot, de « demander un plan à `plan-maker` via `run_agents` »
pour **toute demande de code importante**. Le lancement était donc direct, mais
l'Assistant lui-même réclamait un planificateur avant de déléguer : l'utilisateur
continuait de voir un agent qui n'était pas celui qu'il avait demandé, et la
mission du codeur n'arrivait qu'après.

C'était aussi une **contradiction avec la documentation** déjà mise à jour
(`spec_super_agent.md`, aide intégrée : « plus jamais automatique ni imposée
avant un lancement », « facultatif et explicite »).

**Correctif** : la consigne devient « Ne lance **jamais** d'agent de planification
de ta propre initiative : `plan-maker` (plan JSON) uniquement si l'utilisateur
demande explicitement un plan ; sinon délègue directement au codeur. » (texte
plus court de 39 caractères : le garde-fou de budget du prompt reste respecté).
La spécification est alignée (usage à la demande, preuve Rust citée) et l'aide
intégrée régénérée.

**Preuve** : `super_agent_tools_prompt_ne_previent_plus_par_un_plan_automatique`
(`src-tauri/src/super_agent.rs`) — l'ancienne formule « Pour une demande de code
importante » a disparu, `plan-maker` reste décrit (facultatif), et le prompt
réserve son usage à une demande explicite de l'utilisateur.
