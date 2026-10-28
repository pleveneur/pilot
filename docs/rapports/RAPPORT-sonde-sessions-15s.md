# RAPPORT — la sonde périodique qui appelait `list_agent_sessions` (toutes les 15 s)

> Micro-tâche : constater, corriger au minimum, verrouiller. Aucun écran, aucun
> réglage, aucune cadence n'a été modifié. Un seul commit local, pas de push.

---

## 1. Constat — où est la sonde, et qu'appelle-t-elle

### 1.1 Les deux coupables (même point de sonde)

| Ce qui tourne | Cadence | Preuve |
|---|---|---|
| Rejeu de la **file de missions** de l'assistant | 15 s | `src/js/super-agent.js:1312` (`const RUN_AGENTS_QUEUE_REPLAY_MS = 15 * 1000;`) → `setInterval` armé `:1420` (`armQueueReplay`) → `replayQueuedMissionForProject` |
| Rejeu de la **file de délégations** de l'assistant | 15 s | `src/js/super-agent.js:1553` (`const DELEGATION_QUEUE_REPLAY_MS = 15 * 1000;`) → `setInterval` armé `:1600` (`armDelegationQueueReplay`) → `replayDelegationQueueForProject` |

Les deux passes appellent le **même** prédicat d'admission
(`super-agent.js:1382` et `:1570`) :

```js
const isFree = deps.isAdmissionFree || (async (p) => !isTerrainReserved() && !(await isRunStillActive(p)));
```

et `isRunStillActive` (`src/js/super-agent.js:1343`) contenait, **avant
correctif** :

```js
const res = await invoke("list_agent_sessions");   // ← l'appel interdit, en boucle
const sessions = (res && res.sessions) || [];
return isProjectWorking(sessions, runProject);
```

### 1.2 Une TROISIÈME sonde, sur le même chemin

`isRunStillActive` libère d'abord un éventuel verrou de run fantôme
(`releaseStuckRunLock`, `src/js/agents-bus.js:903`), qui interroge lui-même
`anyActiveAgentWorking` (`agents-bus.js:1437`) et `projectHasWorkingSession`
(`agents-bus.js:1457`) — deux fonctions qui appelaient **aussi**
`list_agent_sessions`. La correction devait donc couvrir les trois, pas
seulement la première.

### 1.3 Permanente ou seulement dans un cas ?

**Conditionnelle, mais sans borne.** Le minuteur n'est armé que lorsqu'il y a
quelque chose à attendre : `armQueueReplay` est appelé à l'empilement d'une
mission, `armDelegationQueueReplay` à l'empilement d'une délégation, et chaque
passe **se réarme tant que la file n'est pas vide** (`super-agent.js:1420-1423`).
Conclusion : elle ne tourne pas « à vide » au démarrage, mais **elle tourne
indéfiniment dès qu'une demande attend** — c'est-à-dire exactement dans le cas
où l'utilisateur subit le défaut (25-30 min de file gelée pendant qu'une mission
attend son tour). Une sonde qu'on ne peut pas arrêter et qui bloque ce qu'elle
observe : c'est bien le motif interdit.

### 1.4 Ce que coûtait réellement l'appel

`invoke("list_agent_sessions")` → commande Tauri `src-tauri/src/agent_service.rs:4374`
→ `AgentService::list_agent_sessions` (`:2361`) :

- `collect_session_states` sur **toutes** les sessions du registre (`:3983`) ;
- pour chaque session **vivante**, un `get_state` **RPC synchrone** (timeout 2 s) :
  une session figée bloque la sonde jusqu'au timeout, à chaque passe ;
- une lecture de la table `agents` en base (SQLite) ;
- construction d'entrées **d'affichage** (`lastActivityRelative`, `lastEvent`,
  `sessionUid`, `prompt`, `resume`, `sessionId`… `:2440-2500`), dont la sonde
  n'utilisait **rien**.

### 1.5 Depuis quand

| Date (git) | Commit | Ce qui a été introduit |
|---|---|---|
| 2026-09-14 | `780b9ef` | la sonde `isRunStillActive` juge sur `list_agent_sessions` |
| 2026-09-28 | `79cd641` | rejeu **périodique** 15 s de la file de missions (rend la sonde cadencée) |
| 2026-09-29 | `ee927e8` | comparaison au projet réel dans `agents-bus` (mêmes appels en boucle) |
| 2026-09-30 | `00356db` | rejeu **périodique** 15 s de la file de délégations (seconde sonde) |

Le motif « en boucle » date donc du 28/09 ; il a été **doublé** le 30/09.

---

## 2. Ce qu'elle voulait vraiment savoir

**Une seule chose : « un agent TRAVAILLE-t-il encore sur ce projet ? »** (pour
savoir si le terrain est libre et si la tête de file peut démarrer).

Preuve : le résultat de la sonde n'est consommé que par `isProjectWorking`
(`src/js/exclusivity-queue.js:275`), qui ne lit que `project`, `alive`, `busy`,
`toolInProgress`, `lastActivity`. Tous les autres champs de
`list_agent_sessions` (état d'onglet, prompts, identifiants de session,
horodatage relatif) sont **ignorés** par ce chemin. Il n'y avait donc aucune
raison d'aller chercher la vue d'ensemble complète — base + RPC — pour répondre
à une question d'**occupation**.

---

## 3. Correction retenue

**Remplacer la SOURCE de la sonde, pas la sonde.** La cadence de 15 s est
conservée : c'est la latence garantie d'une mission mise en file (elle repart au
plus 15 s après la libération du projet). L'idée est de rendre la sonde
**assez légère pour être répétable**.

### 3.1 Côté Rust — une commande dédiée, minimale

`AgentService::agent_activity_probe` (`src-tauri/src/agent_service.rs`), exposée
comme commande Tauri `agent_activity_probe` (enregistrée dans
`src-tauri/src/lib.rs`) :

- lit le registre **en mémoire** (`collect_session_states`), **sans** RPC,
  **sans** accès base ;
- projette chaque session sur les seules clés utiles, avec les **mêmes noms**
  que la vue d'ensemble : `project`, `agent`, `alive`, et — seulement si une
  activité a été enregistrée — `busy`, `toolInProgress`, `lastActivity` ;
- la construction de l'entrée est une fonction **pure** (`activity_probe_entry`),
  testable sans `AppHandle`.

Aucune règle de décision n'a été recopiée en Rust : le verdict reste calculé à
**un seul endroit**, côté front (`isProjectWorking` / `isSessionWorking`).

### 3.2 Côté front — trois appels remplacés, une seule source

- `src/js/super-agent.js` — `isRunStillActive` appelle `agent_activity_probe`
  (commentaire et docstring indiquant désormais explicitement que
  `list_agent_sessions` est **interdit** dans un cadencement) ;
- `src/js/agents-bus.js` — nouveau `probeActivitySessions()` (source unique des
  chemins répétés), utilisé par `anyActiveAgentWorking` et
  `projectHasWorkingSession`. **La logique de verdict n'a pas bougé**
  (`isAnyAgentWorking`, comparaison au projet réel, `sameProject`).

Sémantique identique, champ pour champ : `alive` reste éliminatoire,
`toolInProgress` n'est jamais borné par la fenêtre d'activité périmée,
l'**absence** de `lastActivity` veut dire « aucune preuve de travail », et
l'erreur reste **fail-open** (on ne coupe jamais une run saine sur une erreur de
sonde).

### 3.3 Pourquoi c'est le choix le moins risqué

| Option | Verdict |
|---|---|
| **Espacer la sonde** (ex. 5 min) | Refusée : on change une cadence **visible** (latence de reprise des missions) pour économiser une sonde, et le défaut reste présent, juste plus rare. |
| **Supprimer la sonde** | Impossible : sans elle, une mission mise en file n'a plus aucun déclencheur, et le verrou fantôme n'est plus libéré (c'était le correctif G, `79cd641`). |
| **Réutiliser `get_agent_supervision`** | Refusé : même coût base + RPC, pensé pour un affichage. |
| **Réutiliser `get_project_agent_states`** | Refusé : déjà documenté comme bloquant la file (`rpc_manager.rs:724`). |
| **Sonde légère dédiée (retenu)** | Même information utile, même décision, même cadence, même fail-open. Rien de visible ne change : aucun écran n'est alimenté par cette sonde (elle ne sert qu'à décider de l'admission). |

---

## 4. Ce qui continue de marcher (vérifié, pas supposé)

`list_agent_sessions` **n'est pas supprimée** et garde tous ses usages
légitimes, non périodiques :

- **outil de l'assistant** `list_agent_sessions` (demande explicite :
  `super-agent.js` — deux appels) ;
- **porte de lancement** `run_agents` (vérification unique avant démarrage :
  `agents-bus.js` `isAgentActiveOnProject` / `findAgentSession`) ;
- **affichages** : tableau de bord, panneau des sessions d'agents, pastille
  d'activité de la colonne de gauche, sélecteur de session (`dashboard.js`,
  `agent-pi.js`, `sidebar.js`, `prompt-builder.js`, `main.js`).

Inchangés également : la colonne de gauche, la barre haute, le logo, la
restitution des comptes rendus, les 5 règles de la chaîne d'agents, et **aucun
réglage** n'a été ajouté à l'interface.

---

## 5. Verrou anti-récidive

Nouveau fichier `src/js/sonde-rejeu-sans-liste-sessions.test.js` — il **échoue**
si le motif interdit revient :

1. `isRunStillActive` ne contient plus `list_agent_sessions` et contient
   `agent_activity_probe` ;
2. `replayQueuedMissionForProject`, `replayDelegationQueueForProject`,
   `armQueueReplay`, `armDelegationQueueReplay` n'appellent jamais la liste ;
3. `anyActiveAgentWorking`, `projectHasWorkingSession`,
   `probeActivitySessions` (bus) non plus ;
4. les **deux** cadences restent à `15 * 1000` (personne ne « corrige » en
   espacant la sonde en silence) ;
5. preuve **d'exécution** : un rejeu réel (mission en file, puis délégation en
   file) et une libération de verrou sont exécutés avec un `invoke` instrumenté
   qui **jette** sur `list_agent_sessions` ; on vérifie que
   `agent_activity_probe` est bien appelée et que la mission/délégation se
   comporte comme avant (`{replayed:true, reason:"launched"}` /
   `{replayed:false, reason:"busy"}`) ;
6. garde **Rust** : la sonde légère existe, ne fait ni `get_agent(` ni
   `send_sync_timeout(`, et la commande est bien **enregistrée** dans `lib.rs`
   (sans branchement, la sonde échouerait en silence et les files ne
   repartiraient plus jamais) ;
7. non-régression inverse : `list_agent_sessions` est toujours présent pour les
   usages **explicites** (on ne supprime pas la supervision de l'assistant).

Un test Rust complète la preuve côté socle :
`activity_probe_entry_keeps_the_minimal_frontend_contract` (mêmes clés que
`isProjectWorking`, aucun champ d'affichage, `lastActivity` fourni quand
l'activité est connue).

---

## 6. Tests — comptés, pas déclarés

| Mesure | Avant | Après |
|---|---|---|
| Frontend `npx vitest run` | 3237 tests, **0 échec** | 3246 tests, **0 échec** |
| Dont nouveaux (verrou) | — | **9** |
| Rust `cargo test -p pilot --lib` | 778 réussis, 1 ignoré | **779 réussis**, 1 ignoré |
| Rust `cargo test --workspace` | — | **952 réussis**, 12 ignorés, 0 échec |

Les valeurs « après » ont été **recomptées par exécution** en fin de tâche ; les
valeurs « avant » s'en déduisent exactement (le verrou ajoute 9 tests front et 1
test Rust, les mocks n'ajoutent aucun test). Un premier passage intermédiaire,
fait juste après le remplacement de la sonde et **avant** la mise à jour des
mocks, affichait `PASS (3232) FAIL (5)` : les 5 échecs étaient tous du type
« mock périmé » (`expected 'idle' to be 'running'`), jamais un
comportement — preuve que seule la **source** de la sonde avait changé. Les fichiers de test qui simulaient auparavant la seule commande
`list_agent_sessions` répondent maintenant aux **deux** (`agent_activity_probe`
en plus) : ils ne dépendaient donc pas de la source et restent valables quelle
que soit la sonde légère utilisée.

> Note de méthode : ces mocks ne peuvent pas, à eux seuls, détecter un retour à
> l'appel lourd (ils répondraient aux deux). C'est précisément le rôle du test
> statique n° 1 à 4 du § 5.

---

## 7. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src-tauri/src/agent_service.rs` | + `agent_activity_probe` (méthode), + `activity_probe_entry` (pure), + commande Tauri, + test |
| `src-tauri/src/lib.rs` | enregistrement de la commande |
| `src/js/super-agent.js` | sonde de `isRunStillActive` remplacée + docstring d'interdiction |
| `src/js/agents-bus.js` | `probeActivitySessions()` + deux sondes rebranchées |
| `src/js/sonde-rejeu-sans-liste-sessions.test.js` | **nouveau** verrou anti-récidive |
| 10 fichiers `*.test.js` | mocks étendus (les deux commandes) |
| `spec_super_agent.md` | note technique : sonde périodique légère |

Aucune modification de `style.css`, `index.html`, des réglages, de la colonne de
gauche, de la barre haute ou du logo — vérifiable par `git diff --stat`.

---

## 8. Commandes à taper

```bash
npx vitest run                                    # frontend (dont le verrou)
cargo test --manifest-path src-tauri/Cargo.toml --lib   # socle Rust
cargo test --workspace                            # espace complet
```
