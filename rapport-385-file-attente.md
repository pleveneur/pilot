# Mission 385 — File d'attente des tâches par projet

**Projet** : Pilot (`G:\IA_PL\pilot`)
**Périmètre** : uniquement la file d'attente par projet et son affichage.
**Hors périmètre (non touché)** : lancement d'agent, estimation préalable / « devis »,
plan-maker, prompt de l'assistant (commits `813095c`, `76e03f1`, `4ce4285`, `96d5b03`
laissés intacts).

---

## 1. Ce qui est livré

### Une seule tâche à la fois par projet, les autres attendent leur tour
- La file **n'invente pas** un second système de lancement : elle compose les files
  **réelles existantes** et n'ajoute que celle qui manquait.
- Famille ajoutée : les **commandes manuelles** du chat d'agent. Auparavant, une
  commande refusée (projet occupé) était **perdue** : elle est désormais **mise en
  file** avec son rang et démarre seule à la libération.
- La relance réutilise **`sendPrompt()` à l'identique** (aucune modification du
  lancement d'agent).

| Famille | Source de vérité | Rejeu |
|---|---|---|
| Commande manuelle du chat | `src/js/project-task-queue.js` (nouvelle file) | sonde périodique 5 s |
| Mission de l'assistant (`run_agents`) | `runAgentsQueueByProject` (`super-agent.js`) | existant (inchangé) |
| Délégation (`delegate_to_coder`, #66) | `delegationState(p).queue` | existant (inchangé) |
| Demande d'agent (spécialité occupée) | `exclusivityQueue` (`agents-bus.js`) | existant (inchangé) |

### Place toujours rendue, aucune place bloquée
- **Sonde d'admission** = la politique **existante**
  `canSendManualCommandAsync(projet, isRunInProgress, isProjectAgentBusy, releaseOrphanRunLock)` :
  elle tient compte du verrou de run, de l'activité réelle de l'agent et **libère un
  verrou orphelin** (session morte / chien de garde). Une activité résiduelle sans
  session vivante ne bloque donc plus le projet.
- **Fail-closed** : sonde absente ou en échec → rien ne démarre, la demande **reste
  en file** (jamais perdue).
- **Démarrage non confirmé** (projet toujours libre après `QUEUE_CONFIRM_MS` = 10 s,
  ou lanceur en échec / levant une exception) → la demande est remise **en tête** de
  file ; après `QUEUE_MAX_ATTEMPTS` = 3 tentatives elle est **abandonnée avec un
  message** (jamais en silence).
- Doublon (même texte + même agent) **non dupliqué** ; file plafonnée à 50 entrées.

### File visible dans l'onglet de l'agent
- Bloc discret `.agent-queue-block` sous la barre d'outils : titre
  « 🧾 File d'attente — N en cours · M en attente », lignes
  « en cours : … », « en attente (2e) : … » (libellés **français simples**), borné à
  6 lignes + « … et N autre(s) ».
- **Masqué** quand il n'y a rien à dire. Rafraîchi par l'événement
  `pilot-queue-changed` (émis en fin de passe de la boucle) et aux `agent_start` /
  `agent_end`.

### Commandes de chat `/file` et `/file vide`
- `/file` affiche la file complète du projet (tâche en cours + demande en attente
  avec rang).
- `/file vide` abandonne les demandes **en attente** et **annonce le nombre**
  abandonné, par famille (commandes, missions, délégations, agents en file). La
  tâche **en cours** n'est jamais arrêtée.
- Les deux commandes sont traitées **localement** (jamais envoyées au moteur), sur
  le modèle de `/verrou`.

---

## 2. Fichiers

### Créés
| Fichier | Rôle |
|---|---|
| `src/js/project-task-queue.js` | Module pur (rangs, libellés, vue, textes) **+ état** de la file des commandes manuelles : mise en file, sonde, boucle de rejeu, abandon. |
| `src/js/project-queue-view.js` | Composition **pure** de la file visible d'un projet (lecture seule des files réelles) + `abandonProjectQueue` pour `/file vide`. |
| `src/js/project-task-queue.test.js` | 18 tests : ordre, une seule tâche démarre, reprise seule à la libération, place rendue par les 4 chemins de sortie, rien perdu, abandon. |
| `src/js/project-queue-wiring.test.js` | 11 tests : composition de la file réelle, `/file vide`, câblage de l'onglet (bloc, `/file`, mise en file au lieu du refus, style). |

### Modifiés
| Fichier | Modification |
|---|---|
| `src/js/agent-pi.js` | Bloc de file + `refreshQueueBlock` ; les 2 gardes de `sendPrompt` **mettent en file** au lieu de perdre la demande ; `/file` et `/file vide` ; installation de la sonde, de la boucle et de l'écouteur `pilot-queue-changed` (via `onGlobal`, donc retiré proprement à la fermeture de l'onglet). |
| `src/js/agents-bus.js` | Ajout de deux **accesseurs en lecture seule** : `listProjectExclusivityEntries` (lecture de la file) et `abandonProjectExclusivityQueues` (abandon). Aucune logique de lancement changée. |
| `src/js/super-agent.js` | Ajout de **lecteurs/abandons** des files existantes : `getProjectMissionQueue`, `abandonProjectMissionQueue`, `getProjectDelegationQueue`, `abandonProjectDelegationQueue`. Aucune logique de lancement changée. |
| `src/css/style.css` | Styles `.agent-queue-block` (discret, sobre, max-height 128 px, masqué si vide). |
| `spec_gestion_agents.md` | §6 « File d'attente des tâches par projet » (invariant, tableau des familles, sonde, rejeu, affichage, commandes, tests) + ligne d'aide utilisateur (`<!-- HELP:agents -->`). |
| `help/handbook.md` | Régénéré par `npm run build:handbook` (jamais édité à la main). |
| `src/js/verrou-orphelin.test.js` | Inventaire des points d'entrée de commande manuelle : 5 → **6**, la **sonde de la file** étant un point d'entrée de plus qui applique la **même** levée ciblée du verrou orphelin (`isProjectAgentBusy, releaseOrphanRunLock`). L'invariant « 1 appel = 1 levée » est inchangé. |

---

## 3. Décisions

1. **Ne pas toucher au lancement d'agent.** La demande en file enregistre un
   `launch()` qui appelle `sendPrompt()` — le chemin d'envoi existant, à
   l'identique. Rien n'est dupliqué, rien n'est contourné ; un drapeau
   `replayingQueuedCommand` évite le ré-enfilage en boucle.
2. **Sonde périodique (5 s)** plutôt qu'événementielle : la place est rendue par
   plusieurs chemins (réussite, erreur, arrêt utilisateur, mort de session, chien de
   garde). Une sonde qui relit la politique existante garantit « place jamais
   perdue » sans modifier aucun de ces chemins.
3. **Aucune file parallèle pour les familles existantes** : elles sont **lues**
   (accesseurs ajoutés) et **abandonnables** (`/file vide`), jamais migrées — le
   risque de régression reste circonscrit.
4. **Ordre de démarrage déterministe** : commandes → missions → délégations → agents
   en file. Dans la vue, le rang 1 est la place de la tâche **en cours** ; s'il n'y a
   rien en cours, la première demande en attente occupe le rang 1.
5. **Rien en silence** : mise en file annoncée avec le rang, démarrage impossible
   annoncé, abandon après 3 tentatives annoncé, `/file vide` annonce le décompte.

---

## 4. Preuves

- `npm test` : **110 fichiers, 1893 tests, 0 échec** (dont les 29 nouveaux).
- Tests existants de la politique d'admission **toujours verts** :
  `agents-bus.test.js`, `run-policy.test.js`, `exclusivity-queue.test.js`,
  `verrou-par-projet.test.js`, `verrou-orphelin.test.js`,
  `agent-pi-listeners.test.js`.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` : voir résultat ci-dessous
  (aucun code Rust modifié par cette mission).

### Ce que les tests prouvent explicitement
| Exigence | Test |
|---|---|
| L'ordre est respecté | `project-task-queue.test.js` §3 (A, B, C conservent leur ordre) |
| Une seule tâche démarre | §4 (projet occupé → 0 démarrage ; libre → 1 seul) |
| La suivante démarre seule à la libération | §4 (pour réussite / erreur / arrêt utilisateur / session morte) |
| Aucune place bloquée par une session morte | §4 (sonde libre via `releaseOrphanRunLock`) + `verrou-orphelin.test.js` |
| Rien perdu en silence | §5 (non confirmé → remise en tête ; lanceur en échec → 3 essais puis abandon annoncé ; sonde en échec → fail-closed) |
| File visible, libellés français | §1, §2 (« en cours », « en attente (2e) »), câblage `project-queue-wiring.test.js` §2 |
| `/file` et `/file vide` | §2, §6 + `project-queue-wiring.test.js` (traitées localement, avant l'envoi) |
| Composition avec les files existantes | `project-queue-wiring.test.js` §1 (mission + commande + délégation + agent, rangs croissants avec la run en cours) |
